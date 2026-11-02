// Runs INSIDE the Vercel Sandbox. Usage: node render.mjs job.json outDir
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const [jobPath, out] = process.argv.slice(2);
const { slides, emailHtml, theme = {}, pageTitle } = JSON.parse(await readFile(jobPath, "utf8"));

// The theme comes from the model, so contrast is enforced here: text must reach 4.5:1 on its
// background (WCAG AA), or it falls back to black or white, whichever reads better.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const readable = (bg, want) => (want && contrast(want, bg) >= 4.5 ? want : contrast("#ffffff", bg) >= contrast("#1c1c1c", bg) ? "#ffffff" : "#1c1c1c");
const primary = theme.primary ?? "#1c1c1c"; // no brand color given: a dark neutral
const background = theme.background ?? "#f7f7f4";
const text = readable(background, theme.text);
const onPrimary = readable(primary);
const font = theme.font === "serif" ? '"Liberation Serif",Georgia,serif' : '"Liberation Sans",Arial,sans-serif';
await mkdir(out, { recursive: true });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const css = `*{margin:0;box-sizing:border-box}body{font-family:${font}}
section{width:1080px;height:1350px;padding:96px;display:flex;flex-direction:column;background:${background};color:${text};break-after:page}
section.first,section.last{background:${primary};color:${onPrimary}}
.box{flex:1;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:40px}
h1{font-size:84px;line-height:1.05}p{font-size:42px;line-height:1.35}
footer{display:flex;justify-content:space-between;font-size:28px;opacity:.75}
section:not(.first):not(.last) h1{border-left:16px solid ${primary};padding-left:32px}`;
const html = slides.map((s, i) => `<section class="${i === 0 ? "first" : i === slides.length - 1 ? "last" : ""}">
<div class="box"><h1>${esc(s.headline)}</h1><p>${esc(s.body)}</p></div>
<footer><span>${esc(pageTitle)}</span><span>${i + 1}/${slides.length}</span></footer></section>`).join("");

const browser = await chromium.launch();
// Carousel: vector PDF for LinkedIn + half-size JPEG previews for the panel
const deck = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 0.5 });
await deck.setContent(`<style>${css}</style>${html}`);
const overflowSlides = await deck.$$eval(".box", (els) =>
  els.flatMap((el, i) => (el.scrollHeight > el.clientHeight + 1 ? [i + 1] : [])));
await deck.pdf({ path: `${out}/carousel.pdf`, width: "1080px", height: "1350px", printBackground: true });
const sections = await deck.$$("section");
for (const [i, s] of sections.entries()) await s.screenshot({ path: `${out}/slide-${i + 1}.jpg`, type: "jpeg", quality: 60 });

// Email: untrusted model HTML, scripts stripped and every sub-request aborted
const mail = await browser.newPage({ viewport: { width: 600, height: 900 }, deviceScaleFactor: 0.75 });
await mail.route("**/*", (r) => r.abort());
await mail.setContent(emailHtml.replace(/<script[\s\S]*?<\/script>/gi, ""), { timeout: 10_000 });
const email = await mail.evaluate(() => ({
  width: document.documentElement.scrollWidth,
  links: [...document.links].map((a) => a.href),
  images: document.images.length,
}));
await mail.screenshot({ path: `${out}/email.jpg`, type: "jpeg", quality: 60, fullPage: true });
await browser.close();

await writeFile(`${out}/report.json`, JSON.stringify({ slides: slides.length, overflowSlides, email: { ...email, tooWide: email.width > 600 } }));

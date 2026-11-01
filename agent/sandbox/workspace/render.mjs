// Runs INSIDE the Vercel Sandbox. Usage: node render.mjs job.json outDir
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const [jobPath, out] = process.argv.slice(2);
const { slides, emailHtml, brandColor, pageTitle } = JSON.parse(await readFile(jobPath, "utf8"));
await mkdir(out, { recursive: true });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const css = `*{margin:0;box-sizing:border-box}body{font-family:"Liberation Sans",Arial,sans-serif}
section{width:1080px;height:1350px;padding:96px;display:flex;flex-direction:column;background:#f7f7f4;color:#1c1c1c;break-after:page}
section.first,section.last{background:${brandColor};color:#fff}
.box{flex:1;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:40px}
h1{font-size:84px;line-height:1.05}p{font-size:42px;line-height:1.35}
footer{display:flex;justify-content:space-between;font-size:28px;opacity:.75}
section:not(.first):not(.last) h1{border-left:16px solid ${brandColor};padding-left:32px}`;
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

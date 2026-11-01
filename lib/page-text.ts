/** Turn the page HTML returned by SitecoreAI into clean source text (browser only). */
export function extractPage(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const attr = (selector: string, name: string) => doc.querySelector(selector)?.getAttribute(name)?.trim() ?? "";
  doc.querySelectorAll("script,style,noscript,svg,nav,header,footer,form").forEach((n) => n.remove());
  const root = doc.querySelector("main") ?? doc.body;
  return {
    title: doc.querySelector("h1")?.textContent?.trim() || doc.title.trim(),
    description: attr('meta[name="description"]', "content"),
    url: attr('link[rel="canonical"]', "href") || attr('meta[property="og:url"]', "content"),
    text: (root?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 20_000),
  };
}

export const base64ToBlob = (b64: string, type: string) =>
  new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

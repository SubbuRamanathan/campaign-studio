/** A hex color (#rgb or #rrggbb) as a six-digit hex color, or null when it is not one. */
function hexColor(value: string): string | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())?.[1];
  if (!hex) return null;
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`.toLowerCase();
}

/**
 * The site's own accent color, read from the page: its `theme-color`, else a CSS variable named
 * like --brand, --primary or --accent in an inline style. Null when the page declares none; the
 * brand kit itself is not readable from the browser, so this is the best source available.
 */
function pageColor(doc: Document): string | null {
  const theme = hexColor(doc.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? "");
  if (theme) return theme;
  const css = [...doc.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
  for (const name of ["brand", "primary", "accent"]) {
    const value = new RegExp(`--[\\w-]*${name}[\\w-]*\\s*:\\s*(#[0-9a-f]{3,6})\\b`, "i").exec(css)?.[1];
    const color = value ? hexColor(value) : null;
    if (color) return color;
  }
  return null;
}

/** Turn the page HTML returned by SitecoreAI into clean source text (browser only). */
export function extractPage(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const attr = (selector: string, name: string) => doc.querySelector(selector)?.getAttribute(name)?.trim() ?? "";
  const brandColor = pageColor(doc); // before the styles are removed below
  doc.querySelectorAll("script,style,noscript,svg,nav,header,footer,form").forEach((n) => n.remove());
  const root = doc.querySelector("main") ?? doc.body;
  return {
    ...(brandColor && { brandColor }),
    title: doc.querySelector("h1")?.textContent?.trim() || doc.title.trim(),
    description: attr('meta[name="description"]', "content"),
    url: attr('link[rel="canonical"]', "href") || attr('meta[property="og:url"]', "content"),
    text: (root?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 20_000),
  };
}

/** Plain text of an HTML snippet, for sending the email body to the Brand Review API (browser only). */
export function htmlToText(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style").forEach((n) => n.remove());
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 6_000);
}

export const base64ToBlob = (b64: string, type: string) =>
  new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

import { z } from "zod";

/** The agent's structured output (enforced by eve's outputSchema). */
export const kitSchema = z.object({
  linkedinPost: z.string(),
  shortPost: z.string(),
  email: z.object({ subject: z.string(), preheader: z.string(), html: z.string() }),
  ads: z.object({ headlines: z.array(z.string()), descriptions: z.array(z.string()) }),
  carousel: z.array(z.object({ headline: z.string(), body: z.string() })),
  reviewNotes: z.array(z.string()),
});
export type Kit = z.infer<typeof kitSchema>;

/** What the panel sends to /api/campaign. */
export const kitRequest = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).default(""),
  url: z.string().url().max(500),
  text: z.string().min(200, "The page needs more text to repurpose.").max(20_000),
  /** Set when the page address could not be confirmed as the public one; shown in the review notes. */
  urlWarning: z.string().max(400).optional(),
  /** The site's brand kit, read on the server (see lib/brand-kit.ts). Checked, as it goes into an API path. */
  brandKitId: z.string().regex(/^[0-9a-f-]{32,36}$/i).optional(),
  /** The site's accent color, read from the page. Used when the brand kit gives none. */
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Set by "Apply brand feedback": the kit made earlier and the brand review's suggestions for it. */
  revise: z.object({ kit: kitSchema, feedback: z.string().min(1).max(6_000) }).optional(),
  /** Set by "Re-run checks": the kit as the author edited it. It is checked and rendered, never rewritten. */
  recheck: kitSchema.optional(),
});
export type KitRequest = z.infer<typeof kitRequest>;

/** Output of the render_assets sandbox tool (base64 files + QA report). */
export type Assets = {
  report: { overflowSlides: number[]; email: { width: number; tooWide: boolean; images: number } };
  carouselPdf: string;
  slidePreviews: string[];
  emailPreview: string;
};

/**
 * NDJSON events from /api/campaign:
 * - `step`  progress label
 * - `brand` ids of the brand kit's tone and voice sections, which the browser scores drafts against
 * - `draft` every asset, written but not yet fully checked (can arrive more than once)
 * - `done`  final kit after the brand editor and the sandbox render checks
 * - `error` the run failed
 */
export type StreamEvent =
  | { type: "step"; label: string }
  | { type: "brand"; voiceSections: string[] }
  | { type: "draft"; kit: Kit }
  | { type: "done"; kit: Kit; assets: Assets | null }
  | { type: "error"; message: string };

/**
 * Limits per asset, and where each comes from:
 * - linkedinPost: LinkedIn's hard limit for a post is 3,000 characters. The writer aims for 600
 *   to 1,300, which reads well; only the first 140 to 210 characters show before "see more".
 * - shortPost: X's limit is 280 weighted characters (see `xLength`). Threads allows 500, so a
 *   post that fits X fits both.
 * - adHeadline, adDescription: Google Ads responsive search ads, 30 and 90 characters.
 * - subject, preheader: no hard limit exists. Inboxes cut a subject at about 60 characters on
 *   desktop and fewer on mobile, and show roughly 90 characters of preheader.
 * - emailHtmlBytes: Gmail clips a message whose HTML is larger than 102 KB.
 * - slideHeadline, slideBody: a design limit, so the text fits the slide. LinkedIn document
 *   (carousel) posts have no text limit.
 */
export const LIMITS = {
  linkedinPost: 3000,
  shortPost: 280,
  subject: 60,
  preheader: 90,
  emailHtmlBytes: 102_000,
  adHeadline: 30,
  adDescription: 90,
  slideHeadline: 60,
  slideBody: 180,
} as const;

/** Characters as ad platforms and LinkedIn count them: one per code point, so an emoji is one. */
export const charCount = (text: string) => Array.from(text).length;

const URL_PATTERN = /https?:\/\/\S*[^\s.,;:!?)"']/g;

/**
 * Length of a post as X counts it. Every link counts 23 characters whatever its real length,
 * and characters outside the Latin ranges (emoji, Chinese, Japanese, Korean) count 2.
 */
export function xLength(text: string): number {
  const links = text.match(URL_PATTERN)?.length ?? 0;
  let length = links * 23;
  for (const ch of text.replace(URL_PATTERN, "")) {
    const c = ch.codePointAt(0) ?? 0;
    const light = c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247);
    length += light ? 1 : 2;
  }
  return length;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** Everything that breaks a platform limit or rule, e.g. "Ad headline 1 is 44/30". Empty when all is fine. */
export function limitViolations(kit: Kit): string[] {
  const over: string[] = [];
  const check = (label: string, size: number, max: number, unit = "") => {
    if (size > max) over.push(`${label} is ${size}/${max}${unit}`);
  };
  check("LinkedIn post", charCount(kit.linkedinPost), LIMITS.linkedinPost);
  check("Short post (X counts a link as 23 characters and an emoji as 2)", xLength(kit.shortPost), LIMITS.shortPost);
  check("Email subject", charCount(kit.email.subject), LIMITS.subject);
  check("Email preheader", charCount(kit.email.preheader), LIMITS.preheader);
  check("Email HTML (Gmail clips above 102 KB)", byteLength(kit.email.html), LIMITS.emailHtmlBytes, " bytes");
  kit.ads.headlines.forEach((h, i) => {
    check(`Ad headline ${i + 1}`, charCount(h), LIMITS.adHeadline);
    if (h.includes("!")) over.push(`Ad headline ${i + 1} has an exclamation mark, which Google Ads does not allow in headlines`);
  });
  kit.ads.descriptions.forEach((d, i) => check(`Ad description ${i + 1}`, charCount(d), LIMITS.adDescription));
  kit.carousel.forEach((s, i) => {
    check(`Slide ${i + 1} headline`, charCount(s.headline), LIMITS.slideHeadline);
    check(`Slide ${i + 1} body`, charCount(s.body), LIMITS.slideBody);
  });
  return over;
}

const LINK_PATTERN = /https?:\/\/[^\s"'<>\\)\]]+/gi;
const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");

/**
 * Links in the kit (posts, email HTML, slides) whose host is not the page's own host, e.g. a
 * link the model made up. Empty when every link points at the page's host.
 */
export function foreignLinks(kit: Kit, pageUrl: string): string[] {
  let expected: string;
  try {
    expected = bareHost(new URL(pageUrl).host);
  } catch {
    return [];
  }
  const text = [
    kit.linkedinPost,
    kit.shortPost,
    kit.email.subject,
    kit.email.preheader,
    kit.email.html,
    ...kit.ads.headlines,
    ...kit.ads.descriptions,
    ...kit.carousel.flatMap((s) => [s.headline, s.body]),
  ].join("\n");
  const found = new Set<string>();
  for (const link of text.match(LINK_PATTERN) ?? []) {
    try {
      const url = new URL(link.replace(/[.,;:!?]+$/, ""));
      if (bareHost(url.host) !== expected) found.add(url.href);
    } catch {
      // Not a parsable link: ignore it.
    }
  }
  return [...found];
}

/** The four tabs of the kit. Each is reviewed against the brand kit on its own. */
export type AssetKey = "carousel" | "social" | "email" | "ads";

/** Plain text of one asset, as sent to the Brand Review API. `emailBody` is the email HTML as text. */
export function assetText(kit: Kit, key: AssetKey, emailBody = ""): string {
  switch (key) {
    case "carousel":
      return kit.carousel.map((s, i) => `Slide ${i + 1}: ${s.headline}\n${s.body}`).join("\n\n");
    case "social":
      return `LinkedIn post:\n${kit.linkedinPost}\n\nShort post:\n${kit.shortPost}`;
    case "email":
      return `Subject: ${kit.email.subject}\nPreheader: ${kit.email.preheader}\n\n${emailBody}`;
    case "ads":
      return [...kit.ads.headlines.map((h) => `Headline: ${h}`), ...kit.ads.descriptions.map((d) => `Description: ${d}`)].join("\n");
  }
}

/** Result of a Brand Review for one asset, reduced to what the panel shows. */
export type BrandCheck =
  | { status: "running" }
  | { status: "error"; message: string }
  | { status: "done"; score: number; suggestions: string[]; sections: string[] };

import { z } from "zod";

/** What the panel sends to /api/campaign. */
export const kitRequest = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).default(""),
  url: z.string().url().max(500),
  text: z.string().min(200, "The page needs more text to repurpose.").max(20_000),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type KitRequest = z.infer<typeof kitRequest>;

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

/** Output of the render_assets sandbox tool (base64 files + QA report). */
export type Assets = {
  report: { overflowSlides: number[]; email: { width: number; tooWide: boolean; images: number } };
  carouselPdf: string;
  slidePreviews: string[];
  emailPreview: string;
};

export type StreamEvent =
  | { type: "step"; label: string }
  | { type: "done"; kit: Kit; assets: Assets | null }
  | { type: "error"; message: string };

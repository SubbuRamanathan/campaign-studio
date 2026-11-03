import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import type { Skills } from "@sitecore-marketplace-sdk/ai";

// The Brand Review API grades content against a SitecoreAI brand kit. It is called from the
// browser through the Marketplace SDK, which attaches the author's authorization. The server
// has no Sitecore identity, so it never calls this API itself.
//
// Only the brand's voice matters here: tone, style and wording. The server reads the kit's section
// names and sends the ids of the voice sections, so every score covers those sections only. The
// other sections judge what the content is about, which comes from the page and not from us.

type Review = Skills.SectionReview;

const CLEAN = 4; // scores of 4 or 5 need no change
const TIMEOUT_MS = 120_000; // a review takes 10 to 40 seconds; the SDK default of 30 is too short

/** Run one Brand Review of `text` against the given voice sections of the brand kit. */
export async function reviewText(
  client: ClientSDK,
  { contextId, brandKitId, sections, text }: { contextId: string; brandKitId: string; sections: string[]; text: string },
): Promise<Review[]> {
  const res = await client.mutate("ai.skills.generateBrandReview", {
    params: {
      query: { sitecoreContextId: contextId },
      body: { brandkitId: brandKitId, input: { content: text }, sections: sections.map((sectionId) => ({ sectionId })) },
    },
    timeoutMs: TIMEOUT_MS,
  });
  // The API returns the section reviews as a plain array, although the SDK types say `{ reviews: [...] }`.
  const body: unknown = res.data;
  const reviews = Array.isArray(body) ? body : (body as { reviews?: unknown } | null)?.reviews;
  if (!Array.isArray(reviews) || !reviews.length) throw new Error("The Brand Review API returned no review.");
  return reviews as Review[];
}

const unique = (items: string[]) => [...new Set(items.map((s) => s.trim()).filter(Boolean))];

/** Average score (1 to 5), the suggestions for everything that scored below 4, and the sections scored. */
export function summarize(reviews: Review[]) {
  const score = reviews.reduce((sum, r) => sum + r.score, 0) / reviews.length;
  const suggestions = unique(
    reviews.flatMap((r) => [
      ...(r.score < CLEAN ? [r.suggestion] : []),
      ...(r.fields ?? []).filter((f) => f.score < CLEAN).map((f) => f.suggestion),
    ]),
  );
  return { score, suggestions, sections: reviews.map((r) => r.sectionId) };
}

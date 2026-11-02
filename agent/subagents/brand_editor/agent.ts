import { defineAgent } from "eve";
import { DEFAULT_MODEL, modelOptions } from "../../../lib/model";

// A second pass over the drafts, also routed through AI Gateway.
// The model id comes from BRAND_EDITOR_MODEL (.env.local / Vercel env).
export default defineAgent({
  description:
    "Reviews campaign drafts against the source page: unsupported claims, tone, clarity and channel limits. Returns concrete fixes.",
  model: process.env.BRAND_EDITOR_MODEL ?? DEFAULT_MODEL,
  defaultTools: false,
  modelOptions: modelOptions(),
});

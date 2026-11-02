import { defineAgent } from "eve";
import { DEFAULT_MODEL, modelOptions } from "../../../lib/model";

// Email copy plus email-safe HTML. Runs in parallel with social_ads_writer.
// The model id comes from EMAIL_BUILDER_MODEL, falling back to AGENT_MODEL.
export default defineAgent({
  description:
    "Writes the promotional email (subject, preheader and email-safe HTML body with one call to action) from a brief. Replies with JSON only.",
  model: process.env.EMAIL_BUILDER_MODEL ?? process.env.AGENT_MODEL ?? DEFAULT_MODEL,
  defaultTools: false,
  modelOptions: modelOptions(),
});

import { defineAgent } from "eve";
import { DEFAULT_MODEL, modelOptions } from "../../../lib/model";

// Short-form copy with hard character limits. Runs in parallel with email_builder.
// The model id comes from SOCIAL_ADS_WRITER_MODEL, falling back to AGENT_MODEL.
export default defineAgent({
  description:
    "Writes the LinkedIn post, the short X/Threads post and the ad headlines and descriptions from a brief. Replies with JSON only.",
  model: process.env.SOCIAL_ADS_WRITER_MODEL ?? process.env.AGENT_MODEL ?? DEFAULT_MODEL,
  defaultTools: false,
  modelOptions: modelOptions(),
});

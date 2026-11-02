import { defineAgent } from "eve";
import { DEFAULT_MODEL, modelOptions } from "../../../lib/model";

// The slide copy of the LinkedIn carousel. Runs in parallel with social_ads_writer and email_builder.
// The model id comes from CAROUSEL_WRITER_MODEL, falling back to AGENT_MODEL.
export default defineAgent({
  description:
    "Writes the slides of the LinkedIn carousel (a headline and a short body per slide, hook first and call to action last) from a brief. Replies with JSON only.",
  model: process.env.CAROUSEL_WRITER_MODEL ?? process.env.AGENT_MODEL ?? DEFAULT_MODEL,
  defaultTools: false,
  modelOptions: modelOptions(),
});

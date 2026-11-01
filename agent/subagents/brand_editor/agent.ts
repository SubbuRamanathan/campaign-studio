import { defineAgent } from "eve";

// A second opinion from a different provider, also routed through AI Gateway.
export default defineAgent({
  description:
    "Reviews campaign drafts against the source page: unsupported claims, tone, clarity and channel limits. Returns concrete fixes.",
  model: "openai/gpt-6-luna-fast",
  defaultTools: false,
});

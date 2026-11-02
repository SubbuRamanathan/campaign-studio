import { defineAgent } from "eve";
import { DEFAULT_MODEL, modelOptions } from "../lib/model";

// The model string routes through Vercel AI Gateway: OIDC auth, no provider keys,
// ordered failover across providers, and cost/usage in the Gateway dashboard.
// The model id comes from AGENT_MODEL (.env.local / Vercel env). It is read when the
// agent is built, so changing it on Vercel needs a redeploy.
export default defineAgent({
  model: process.env.AGENT_MODEL ?? DEFAULT_MODEL,
  // Provider order comes from AGENT_PROVIDER_ORDER / AGENT_PROVIDER_ONLY (see lib/model.ts).
  modelOptions: modelOptions(),
  defaultTools: false, // least privilege: no bash/file/web tools, only what we author
  tool: false, // no self-copies; work is delegated only to the four declared subagents
  limits: {
    // Stop a runaway session. costUsd is reported by AI Gateway on every step.
    sessionUsage: ({ window }) => (window.costUsd ?? 0) >= 0.5,
    sessionTimeoutMs: 60 * 60 * 1000,
  },
});

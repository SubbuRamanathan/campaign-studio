import { defineAgent } from "eve";

// The model string routes through Vercel AI Gateway: OIDC auth, no provider keys,
// ordered failover across providers, and cost/usage in the Gateway dashboard.
export default defineAgent({
  model: "anthropic/claude-sonnet-5.5",
  modelOptions: {
    providerOptions: { gateway: { order: ["anthropic", "bedrock", "vertex"] } },
  },
  defaultTools: false, // least privilege: no bash/file/web tools, only what we author
  tool: false, // no self-copies; the brand editor is the only delegate
  limits: {
    // Stop a runaway session. costUsd is reported by AI Gateway on every step.
    sessionUsage: ({ window }) => (window.costUsd ?? 0) >= 0.5,
    sessionTimeoutMs: 60 * 60 * 1000,
  },
});

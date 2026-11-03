/**
 * Model routing shared by the lead agent and every subagent. Read when the agent is built, so
 * after changing the variables on Vercel, redeploy.
 *
 * - AGENT_PROVIDER_ORDER: AI Gateway providers to try, first to last, e.g. "azure,openai".
 *   Gateway fails over to the next one when a provider errors. Default: openai, then azure.
 * - AGENT_PROVIDER_ONLY: optional allow-list, e.g. "azure". Gateway never uses another provider,
 *   so there is no failover outside it. Use it when data must stay with one provider.
 */
/** The model every agent uses unless its own variable (AGENT_MODEL, BRAND_EDITOR_MODEL, ...) says otherwise. */
export const DEFAULT_MODEL = "openai/gpt-6-luna";

const list = (value: string | undefined) =>
  (value ?? "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);

export function modelOptions() {
  const order = list(process.env.AGENT_PROVIDER_ORDER);
  const only = list(process.env.AGENT_PROVIDER_ONLY);
  return {
    providerOptions: {
      gateway: {
        order: order.length ? order : ["openai", "azure"],
        ...(only.length && { only }),
      },
    },
  };
}

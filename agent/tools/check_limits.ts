import { defineTool } from "eve/tools";
import { kitSchema, limitViolations } from "../../lib/kit";

// Models miscount characters, so the limits are checked by code instead: ad headlines of 30
// characters, subject lines of 60, and so on. Returns exactly what is over and by how much.
// The app watches this tool: a kit that passes is shown to the author as a draft right away
// (see app/api/campaign/route.ts), so the agent needs no separate step to publish it.
export default defineTool({
  description:
    "Check every text in the kit against its platform limit (LinkedIn, X, email, Google Ads) and ad rules. " +
    "Pass the full kit. When it passes, the author sees the kit as a draft. Call it on the assembled kit, " +
    "and again after any rewrite, until it reports no violations.",
  inputSchema: kitSchema,
  async execute(kit) {
    const violations = limitViolations(kit);
    return { ok: violations.length === 0, violations };
  },
  toModelOutput: ({ ok, violations }) => ({
    type: "text",
    value: ok
      ? "All texts are within their limits, and the author can now see this draft. Continue with the checks."
      : `Fix these (shorten or reword, keep the meaning, do not just cut words off): ${violations.join("; ")}.`,
  }),
});

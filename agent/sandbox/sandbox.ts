import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";

// Built once at deploy time into a Vercel Sandbox snapshot:
// the workspace seed (render.mjs) plus Playwright and headless Chromium.
export const environment = VercelSandbox.environment({
  prepare: async (sandbox) => {
    const r = await sandbox.run({
      command: "npm install --no-audit --no-fund && npx playwright install --with-deps chromium",
    });
    if (r.exitCode !== 0) throw new Error(r.stderr || r.stdout);
  },
});

// Every live session starts from that snapshot with ALL network egress blocked:
// AI-written HTML is rendered here, never in your app or the author's browser.
export default defineSandbox(() => environment.open({ networkPolicy: "deny-all" }));

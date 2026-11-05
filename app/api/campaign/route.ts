import { getVercelOidcToken } from "@vercel/oidc";
import { Client } from "eve/client";
import { auth0 } from "@/lib/auth0";
import { brandKitText } from "@/lib/brand-kit";
import { foreignLinks, kitRequest, kitSchema, type Kit, type StreamEvent } from "@/lib/kit";
import { DEFAULT_MODEL } from "@/lib/model";

export const maxDuration = 300;

// Progress labels for the agent's calls.
const LABELS: Record<string, string> = {
  social_ads_writer: "Writing the LinkedIn post, short post and ads",
  email_builder: "Building the email",
  carousel_writer: "Writing the carousel slides",
  check_limits: "Checking character limits",
  brand_editor: "Brand editor is reviewing the drafts",
  render_assets: "Rendering the carousel and email in Vercel Sandbox",
};

// Keep untrusted text from closing the tag it is wrapped in.
const wrap = (tag: string, text: string) => `<${tag}>\n${text.replace(new RegExp(`</?${tag}>`, "gi"), "")}\n</${tag}>`;

export async function POST(req: Request) {
  // Only same-origin calls from the panel. The brand kit needs a signed-in Sitecore user (Auth0).
  // Add a Vercel Firewall rate limit for demos.
  const origin = new URL(req.url).origin;
  if (req.headers.get("origin") !== origin) return new Response("Forbidden", { status: 403 });

  const parsed = kitRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const page = parsed.data;

  // The whole brand kit, for the agent to read: how to sound and how to look. A kit that cannot be
  // read never stops the run; the review notes say so.
  let brandKit = "";
  let voiceSections: string[] = [];
  let kitNote: string | undefined;
  if (page.brandKitId) {
    // The kit is read as the signed-in Sitecore user, so it is only what that user may see.
    if (!(await auth0.getSession())) {
      return Response.json({ error: "Sign in to Sitecore to read the site's brand kit.", signIn: true }, { status: 401 });
    }
    try {
      const contextId = req.headers.get("x-sitecore-contextid");
      if (!contextId) throw new Error("missing x-sitecore-contextid header on /api/campaign");
      ({ text: brandKit, voiceSections } = await brandKitText(
        (await auth0.getAccessToken()).token,
        contextId,
        page.brandKitId,
      ));
    } catch (err) {
      kitNote = `The brand kit could not be read (${err instanceof Error ? err.message : "unknown error"}), so the content was written without its voice and visual rules.`;
    }
  }

  // Server-to-agent call on the same deployment, signed with the project's OIDC token.
  const agent = new Client({
    baseUrl: origin,
    auth: { vercelOidc: { token: () => getVercelOidcToken() } },
    redirect: "manual",
  });
  let delivery;
  try {
    ({ delivery } = await agent.sessions.create<Kit>({
      outputSchema: kitSchema,
      message: [
        `${page.recheck ? "Re-check the campaign kit for this page" : "Create a campaign kit for this page"}. Page URL: ${page.url}`,
        `Page color (use it for the design only when the brand kit states no colors): ${page.brandColor ?? "none, the page declares no color"}`,
        `Title: ${page.title}`,
        `Meta description: ${page.description}`,
        ...(page.recheck ? [] : [wrap("page", page.text)]),
        brandKit ? wrap("brand_kit", brandKit) : "No brand kit is available for this page.",
        ...(page.recheck
          ? [
              "This is a re-check of a kit the author edited by hand: only check and render it, never rewrite it.",
              wrap("author_kit", JSON.stringify(page.recheck)),
            ]
          : []),
        ...(page.revise
          ? [
              "This is a revision: apply the brand feedback to the current kit instead of starting over.",
              wrap("current_kit", JSON.stringify(page.revise.kit)),
              wrap("brand_feedback", page.revise.feedback),
            ]
          : []),
      ].join("\n"),
    }));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return Response.json({ error: `Could not start the agent: ${reason}` }, { status: 502 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const limitChecks = new Map<string, unknown>(); // check_limits calls: callId -> the kit that was checked
      const renderCalls = new Map<string, unknown>(); // render_assets calls: callId -> what was rendered
      // A re-check must render the author's text as is. A render of anything else is dropped.
      const rendersAuthorKit = (input: unknown) => {
        const job = input as { slides?: { headline: string; body: string }[]; emailHtml?: string } | null;
        const kit = page.recheck;
        return Boolean(
          kit &&
            job?.emailHtml === kit.email.html &&
            job.slides?.length === kit.carousel.length &&
            job.slides.every((s, i) => s.headline === kit.carousel[i].headline && s.body === kit.carousel[i].body),
        );
      };
      let assets: unknown = null;
      let lastLabel = "";
      try {
        const modelName = (process.env.AGENT_MODEL ?? DEFAULT_MODEL).split("/").pop();
        if (voiceSections.length) send({ type: "brand", voiceSections });
        send({ type: "step", label: `Planning the campaign with ${modelName}` });
        for await (const event of delivery.stream()) {
          if (event.type === "call.requested") {
            const name = event.data.capability.name;
            if (name === "check_limits") limitChecks.set(event.data.callId, event.data.input);
            if (name === "render_assets") renderCalls.set(event.data.callId, event.data.input);
            if (name.startsWith("eve__")) continue; // eve's own task bookkeeping, not a step the author cares about
            const label = LABELS[name] ?? name;
            if (label !== lastLabel) send({ type: "step", label });
            lastLabel = label;
          }
          if (event.type === "call.settled" && event.data.outcome === "completed") {
            const { callId, output } = event.data;
            // A kit that passes the limit check is complete: show it now, before the slow checks.
            const checked = limitChecks.has(callId) && (output as { ok?: boolean } | null)?.ok ? kitSchema.safeParse(limitChecks.get(callId)) : null;
            if (checked?.success && !page.recheck) send({ type: "draft", kit: checked.data });
            if (renderCalls.has(callId) && (!page.recheck || rendersAuthorKit(renderCalls.get(callId)))) assets = output; // keep the latest successful render
          }
        }
        const result = await delivery.result();
        // A re-check keeps the author's kit whatever the model returned; only the notes about links are redone.
        const final = page.recheck
          ? { ...page.recheck, reviewNotes: page.recheck.reviewNotes.filter((n) => !n.startsWith("Link to another host:")) }
          : result.data;
        if (!final) throw new Error(`The agent stopped (${result.status}) without a kit.`);
        // Every link must use the page's own host, not one the model made up.
        const foreign = foreignLinks(final, page.url);
        const notes = [
          ...(page.urlWarning ? [page.urlWarning] : []),
          ...(kitNote ? [kitNote] : []),
          ...foreign.map((l) => `Link to another host: ${l} (the page is on ${new URL(page.url).host}). Check it.`),
        ];
        const kit = notes.length ? { ...final, reviewNotes: [...new Set([...final.reviewNotes, ...notes])] } : final;
        send({ type: "done", kit, assets: assets as never });
      } catch (err) {
        console.error("[campaign] failed:", err);
        send({ type: "error", message: err instanceof Error ? err.message : "The agent run failed." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

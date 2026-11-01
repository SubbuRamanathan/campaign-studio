import { getVercelOidcToken } from "@vercel/oidc";
import { Client } from "eve/client";
import { kitRequest, kitSchema, type Kit, type StreamEvent } from "@/lib/kit";

export const maxDuration = 300;

const LABELS: Record<string, string> = {
  brand_editor: "Brand editor (second model) is reviewing the drafts",
  render_assets: "Rendering carousel and email in Vercel Sandbox",
};

export async function POST(req: Request) {
  // Built-in Marketplace auth gives the server no Sitecore identity to verify, so this
  // route only accepts same-origin calls from the panel. Add a Vercel Firewall rate
  // limit for demos; for production use Sitecore custom authorization (Auth0).
  const origin = new URL(req.url).origin;
  if (req.headers.get("origin") !== origin) return new Response("Forbidden", { status: 403 });

  const parsed = kitRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const page = parsed.data;

  // Server-to-agent call on the same deployment, signed with the project's OIDC token.
  const agent = new Client({
    baseUrl: origin,
    auth: { vercelOidc: { token: () => getVercelOidcToken() } },
    redirect: "manual",
  });
  const { delivery } = await agent.sessions.create<Kit>({
    outputSchema: kitSchema,
    message: [
      `Create a campaign kit for this page. Brand color: ${page.brandColor}. Page URL: ${page.url}`,
      `Title: ${page.title}`,
      `Meta description: ${page.description}`,
      `<page>\n${page.text}\n</page>`,
    ].join("\n"),
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const renderCalls = new Set<string>();
      let assets: unknown = null;
      try {
        send({ type: "step", label: "Writing drafts with Claude Sonnet 5.5" });
        for await (const event of delivery.stream()) {
          if (event.type === "call.requested") {
            const name = event.data.capability.name;
            send({ type: "step", label: LABELS[name] ?? name });
            if (name === "render_assets") renderCalls.add(event.data.callId);
          }
          if (event.type === "call.settled" && renderCalls.has(event.data.callId) && event.data.outcome === "completed") {
            assets = event.data.output; // keep the latest successful render
          }
        }
        const result = await delivery.result();
        if (!result.data) throw new Error(`The agent stopped (${result.status}) without a kit.`);
        send({ type: "done", kit: result.data, assets: assets as never });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "The agent run failed." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

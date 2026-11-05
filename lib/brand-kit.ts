// Server only. Reads a whole SitecoreAI brand kit through the Agent API, as the signed-in user, as
// text the agent can read: every section (Tone of Voice, Visual Guidelines, Image Style, ...) with
// its subsections. The agent decides from it how the content should sound and how the carousel and
// email should look. The user's token comes from lib/auth0.ts and never reaches the browser.

const API = "https://edge-platform.sitecorecloud.io/stream/ai-agent-api/api/v1/brandkits";
const MAX_SECTION = 2_500; // characters kept per section
const MAX_TOTAL = 16_000; // characters kept for the whole kit

const VOICE = /tone|voice|don.?t|grammar/i; // sections about how the brand sounds, matched on their real names

type Kit = { text: string; voiceSections: string[] };

/**
 * Headers every server-side SitecoreAI API call needs when it runs as the Marketplace user: the
 * user's token, the environment's Context ID, and the two headers that mark the call as coming
 * from a Marketplace app. Without the last three, downstream services such as brand kits answer 403.
 */
export const sitecoreHeaders = (accessToken: string, contextId: string): Record<string, string> => ({
  authorization: `Bearer ${accessToken}`,
  "x-sitecore-contextid": contextId,
  "sc-resource": "marketplace",
  "sc-marketplace-auth": "interactive/v1",
  accept: "application/json",
});

/** A subsection value as text: a string as is, a list as one `- item` line each (empty ones give ""). */
const fieldText = (value: unknown): string =>
  Array.isArray(value)
    ? value.map((item) => `- ${(item as { name?: string })?.name ?? JSON.stringify(item)}`).join("\n")
    : typeof value === "string"
      ? value
      : value == null
        ? ""
        : JSON.stringify(value);

/** The brand kit as text, one `## Section` block per section with its subsections beneath, and the ids of its voice sections. */
export async function brandKitText(accessToken: string, contextId: string, brandKitId: string): Promise<Kit> {
  if (!contextId) throw new Error("missing Sitecore Context ID; send x-sitecore-contextid from the client");
  if (!brandKitId) throw new Error("missing brand kit id; call brandKitText(accessToken, contextId, brandKitId)");
  const res = await fetch(`${API}/${encodeURIComponent(brandKitId)}`, {
    headers: sitecoreHeaders(accessToken, contextId),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Agent API ${res.status} for the brand kit: ${(await res.text()).slice(0, 600)}`);
  const { sections = [] } = (await res.json()) as { sections?: { id: string; name: string; fields?: { name: string; value: unknown }[] }[] };

  const filled = sections.map((s) => {
    const body = (s.fields ?? [])
      .map((f) => [f.name, fieldText(f.value)] as const)
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}:${value.includes("\n") ? "\n" : " "}${value}`)
      .join("\n")
      .slice(0, MAX_SECTION);
    return { ...s, block: body ? `## ${s.name}\n${body}` : "" };
  });
  const text = filled.map((s) => s.block).filter(Boolean).join("\n\n").slice(0, MAX_TOTAL);
  if (!text) throw new Error("the brand kit has no content yet; brand documents must be uploaded and processed in Stream");
  // An empty section cannot be scored, so only voice sections with content count.
  return { text, voiceSections: filled.filter((s) => s.block && VOICE.test(s.name)).map((s) => s.id) };
}
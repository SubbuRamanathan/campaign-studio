// Server only. Reads a whole SitecoreAI brand kit through the Brand Management REST API, as text
// the agent can read: every section (Tone of Voice, Visual Guidelines, Image Style, ...) with its
// subsections. The agent decides from it how the content should sound and how the carousel and
// email should look. The API needs a Stream client credential (SITECORE_AI_CLIENT_ID and
// SITECORE_AI_CLIENT_SECRET), which the browser must never see.

const API = "https://edge-platform.sitecorecloud.io/ai/ai-brands-api/api/brands";
const MAX_SECTION = 2_500; // characters kept per section
const MAX_TOTAL = 16_000; // characters kept for the whole kit
const CACHE_MS = 10 * 60 * 1000; // a kit rarely changes; avoid one API round trip per run

const VOICE = /tone|voice|don.?t|grammar/i; // sections about how the brand sounds, matched on their real names

type Kit = { text: string; voiceSections: string[] };
let token: { value: string; expires: number } | null = null; // valid for 24 hours; cached per instance
const kits = new Map<string, Kit & { expires: number }>();

async function accessToken(): Promise<string> {
  const { SITECORE_AI_CLIENT_ID: id, SITECORE_AI_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error("SITECORE_AI_CLIENT_ID and SITECORE_AI_CLIENT_SECRET are not set");
  if (token && token.expires > Date.now()) return token.value;
  const res = await fetch("https://auth.sitecorecloud.io/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials", audience: "https://api.sitecorecloud.io" }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Sitecore sign-in failed (${res.status})`);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: access_token, expires: Date.now() + (expires_in - 300) * 1000 };
  return token.value;
}

/** The list inside a response, whether the API returns a bare array or wraps it in an object. */
async function list<T>(path: string): Promise<T[]> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`Brand Management API ${res.status} for ${path.split("/").slice(-1)[0].split("?")[0]}`);
  const body = (await res.json()) as unknown;
  return (Array.isArray(body) ? body : Object.values((body ?? {}) as object).find(Array.isArray) ?? []) as T[];
}

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
export async function brandKitText(organizationId: string, brandKitId: string): Promise<Kit> {
  const key = `${organizationId}/${brandKitId}`;
  const hit = kits.get(key);
  if (hit && hit.expires > Date.now()) return hit;

  const kit = `/organizations/${organizationId}/brandkits/${brandKitId}`;
  const sections = await list<{ id: string; name: string }>(`/v1${kit}/sections`);
  const filled = await Promise.all(
    sections.map(async (s) => {
      const fields = await list<{ name: string; value: unknown }>(`/v3${kit}/sections/${s.id}/fields?pageNumber=1&pageSize=50`);
      const body = fields
        .map((f) => [f.name, fieldText(f.value)] as const)
        .filter(([, value]) => value)
        .map(([name, value]) => `${name}:${value.includes("\n") ? "\n" : " "}${value}`)
        .join("\n")
        .slice(0, MAX_SECTION);
      return { ...s, block: body ? `## ${s.name}\n${body}` : "" };
    }),
  );
  const text = filled.map((s) => s.block).filter(Boolean).join("\n\n").slice(0, MAX_TOTAL);
  if (!text) throw new Error("the brand kit has no content yet; brand documents must be uploaded and processed in Stream");
  // An empty section cannot be scored, so only voice sections with content count.
  const voice = filled.filter((s) => s.block && VOICE.test(s.name));
  const kitData = { text, voiceSections: voice.map((s) => s.id) };
  kits.set(key, { ...kitData, expires: Date.now() + CACHE_MS });
  return kitData;
}

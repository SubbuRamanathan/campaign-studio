# Campaign Studio

A SitecoreAI Marketplace app (Page builder context panel) that turns the page an author has
open into a campaign kit: a LinkedIn post, an X/Threads post, an email, ad copy and a LinkedIn
carousel. An [eve](https://vercel.com/docs/eve) agent writes the drafts, a second model reviews
them, and a Vercel Sandbox renders the carousel and email in headless Chromium, checks the
layout, and lets the agent fix overflowing slides before the author sees anything.

## How it fits together

```
SitecoreAI Page builder
  └─ iframe: /campaign-studio                 Marketplace SDK, built-in auth
       ├─ xmc.agent.pagesGetPageHtml          read the open page (client-side)
       ├─ POST /api/campaign                  same-origin only, streams progress
       │    └─ eve Client + Vercel OIDC  ──►  /eve/v1  (agent/, same deployment)
       │         ├─ model via AI Gateway      anthropic/claude-sonnet-5.5
       │         ├─ subagents/brand_editor    openai/gpt-6-luna-fast via AI Gateway
       │         └─ tools/render_assets  ──►  Vercel Sandbox (Chromium, egress deny-all)
       └─ xmc.agent.assetsUploadAsset         author clicks Save → Media Library
```

| Vercel capability | Where | Why |
| --- | --- | --- |
| eve | `agent/` | The agent is a directory: instructions, one tool, one subagent, sandbox, channel |
| AI Gateway | `agent/agent.ts`, `subagents/brand_editor/agent.ts` | Two providers, no API keys (OIDC), provider failover order, $0.50 per-session cap from Gateway-reported cost |
| Sandbox | `agent/sandbox/`, `agent/tools/render_assets.ts` | Chromium baked into a snapshot at build; untrusted AI HTML rendered with all network egress blocked |
| Connect (optional, off) | `extras/connect-hubspot.ts` | Push approved assets to HubSpot with short-lived scoped tokens and per-call approval |

Sitecore Marketplace guidelines followed: Next.js App Router; full-stack app with built-in
authorization because the server never calls SitecoreAI APIs; SDK initialized once in a
provider; only the `client` and `xmc` packages; no secrets in the browser; Blok UI;
`frame-ancestors 'self' https://*.sitecorecloud.io`.

## 1. Run locally

Requirements: Node.js 24+, a Vercel account, a SitecoreAI environment.

```bash
npm install
npm run setup:ui          # installs the Blok theme + Button, Badge, Skeleton, Alert, Tabs
npx eve link              # links/creates the Vercel project and pulls VERCEL_OIDC_TOKEN
cp .env.example .env.local
npm run dev               # Next.js on :3000; withEve starts the agent alongside it
```

Commit the generated `components/ui/*` and `app/globals.css` so Vercel can build them.
The first sandbox use prepares the Chromium snapshot, so it takes a few minutes once.

## 2. Push to GitHub and deploy on Vercel

```bash
git init && git add . && git commit -m "Campaign Studio"
gh repo create campaign-studio --private --source . --push
```

In Vercel: **Add New → Project → import the repo** (or reuse the project `eve link` created
and connect the repo under **Settings → Git**). Keep the Next.js preset. Set Node.js to 24.x
and add the three `NEXT_PUBLIC_*` variables. Every push to `main` now deploys the app and the
agent together; the build also prepares the sandbox snapshot. `npx eve deploy` deploys from
the CLI instead.

Recommended before a live demo:
- **Firewall → Rate limiting:** limit `POST /api/campaign`, e.g. 10 requests/minute per IP.
- **AI Gateway → Budgets:** set a monthly budget on the project.
- **Observability → Agent Runs:** watch each session's model calls, tools and cost.

## 3. Register the app in SitecoreAI

In the Sitecore Cloud Portal, open **App studio** and create a custom app:
1. Deployment URL: `https://<your-project>.vercel.app` (use `http://localhost:3000` while developing).
2. Extension point: **SitecoreAI Page builder context panel**, route `/campaign-studio`.
3. API access: SitecoreAI APIs (pages and assets).
4. Activate, then install it in your organization and pick an environment.
5. Open any page in Page builder → **Apps** → Campaign Studio → **Create campaign kit**.

## Security notes

- The browser never talks to the agent. `agent/channels/eve.ts` accepts only this
  deployment's OIDC-signed server calls (and local dev).
- `/api/campaign` accepts same-origin requests only. Built-in Marketplace auth gives the server
  no Sitecore identity to verify; for production, switch to Sitecore custom authorization
  (Auth0) and verify the token in the route.
- The agent has no default tools (`defaultTools: false`): no shell, files or web.
- Page text is passed as data inside `<page>` tags; the instructions say never to follow it.
- Nothing is written to Sitecore until the author clicks **Save to Media Library**.

## Things to rehearse

- **Media Library save:** confirm the folder in `NEXT_PUBLIC_MEDIA_FOLDER` exists and that the
  upload works in your tenant. **Download PDF** is the fallback.
- **Model IDs:** check both in the AI Gateway model catalog.
- **eve is in public preview:** this repo pins `eve@0.86.0`; upgrade deliberately.

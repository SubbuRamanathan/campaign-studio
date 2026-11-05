# Campaign Studio

A SitecoreAI Marketplace app (Page builder context panel) that turns the page an author has
open into a campaign kit: a LinkedIn post, an X/Threads post, an email, ad copy and a LinkedIn
carousel. An [eve](https://vercel.com/docs/eve) agent writes the drafts, a second model reviews
them, and a Vercel Sandbox renders the carousel and email in headless Chromium, checks the
layout, and lets the agent fix overflowing slides before the author sees anything.

## How it fits together

```
SitecoreAI Page builder
  └─ iframe: /campaign-studio                 Marketplace SDK, built-in auth + Auth0 sign-in for the server
       ├─ xmc.agent.pagesGetPageHtml          read the open page (client-side)
       ├─ POST /api/campaign                  same-origin only, streams drafts + progress
       │    ├─ Agent API (brand kits)         reads the whole brand kit as the signed-in user
       │    └─ eve Client + Vercel OIDC  ──►  /eve/v1  (agent/, same deployment)
       │         ├─ lead agent via AI Gateway AGENT_MODEL: plan, assemble the kit
       │         ├─ subagents/social_ads_writer   LinkedIn, short post, ads   ┐ the three
       │         ├─ subagents/email_builder       subject, preheader, HTML    ├ writers run
       │         ├─ subagents/carousel_writer     carousel slides             ┘ in parallel
       │         ├─ tools/check_limits       ──►  platform limits; a kit that passes is shown as a DRAFT
       │         ├─ subagents/brand_editor        BRAND_EDITOR_MODEL: claims, tone, brand rules
       │         └─ tools/render_assets      ──►  Vercel Sandbox (Chromium, egress deny-all)
       └─ ai.skills.generateBrandReview       review each final asset against the brand kit
```

How a run feels to the author: the drafts for every asset appear as soon as they are written,
under a banner that lists which checks are still running (brand editor, sandbox render of the
carousel and email, brand kit review). When the checks finish, the panel updates in place, marks
the tabs that changed, and adds the slide previews and the PDF (download, or open in a new tab).
The brand kit review runs in the browser because the server has no Sitecore identity.
**Apply brand feedback to all tabs** (shown when a review has suggestions) sends the kit and those
suggestions back to the agent as a revision. Only assets with feedback are rewritten; then the
limit checks, brand editor, render and brand reviews all run again. A revision costs a full run.

Limits are enforced in code (`LIMITS` in `lib/kit.ts`, run by the `check_limits` tool, and shown again as checks in the panel):

| Text | Limit | Source |
| --- | --- | --- |
| LinkedIn post | 3,000 characters (the writer aims for 600 to 1,300) | LinkedIn |
| Short post | 280 weighted characters; a link counts 23 and an emoji 2 | X (Threads allows 500) |
| Ad headline / description | 30 / 90 characters, no `!` in headlines | Google Ads responsive search ads |
| Email subject / preheader | 60 / 90 characters | Inbox display guidance, not a hard limit |
| Email HTML | 102 KB | Gmail clips larger messages |
| Slide headline / body | 60 / 180 characters | Design limit; LinkedIn carousels have no text limit |

| Vercel capability | Where | Why |
| --- | --- | --- |
| eve | `agent/` | The agent is a directory: instructions, two tools, four subagents, sandbox, channel |
| AI Gateway | `agent/agent.ts`, `agent/subagents/*/agent.ts` | No API keys (OIDC), provider failover order, $0.50 per-session cap from Gateway-reported cost |
| Sandbox | `agent/sandbox/`, `agent/tools/render_assets.ts` | Chromium baked into a snapshot at build; untrusted AI HTML rendered with all network egress blocked |
Sitecore Marketplace guidelines followed: Next.js App Router; full-stack app with built-in
authorization because the server never calls SitecoreAI APIs; SDK initialized once in a
provider; only the `client`, `xmc` and `ai` packages; no secrets in the browser; Blok UI;
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
and add the variables from `.env.example` (`AGENT_MODEL`, `BRAND_EDITOR_MODEL` and `AGENT_PROVIDER_ORDER`). Every push to `main` now deploys the app and the
agent together; the build also prepares the sandbox snapshot. `npx eve deploy` deploys from
the CLI instead.

### Before you share the URL: protect the endpoint

`POST /api/campaign` starts a paid agent run, and the server cannot tell which Sitecore user is
calling (built-in Marketplace auth). The same-origin check stops other websites, but a script can
still fake it. Add a rate limit first; it needs no code.

**Vercel Firewall rate limit** (Project → **Firewall** → **Configure** → **Add New Rule**):

| Setting | Value |
| --- | --- |
| Name | `campaign-studio rate limit` |
| If | Request Path **equals** `/api/campaign` **and** Method **equals** `POST` |
| Then | **Rate Limit**, Fixed Window, key **IP Address** |
| Limit | 10 requests per 60 seconds (a run takes minutes, so this is generous) |
| When exceeded | **Default (429)**, or **Deny** for repeat offenders |

Save the rule, then **Review Changes → Publish**. Test it with 11 quick `curl -X POST` calls; the
last one should return 429. Tighten the limit if your authors share few IP addresses.

### Best practices

- **Budgets:** set a monthly budget on the project under **AI Gateway → Budgets**, and use Vercel
  **Spend Management** to cap the whole account. The $0.50 per-session cap in `agent/agent.ts`
  stops one runaway run; run once, read its real cost in **Observability → Agent Runs**, and keep
  the cap above that cost, or runs end partway through.
- **Authentication:** for anything beyond a demo, use Sitecore custom authorization (Auth0) and
  verify the token in `app/api/campaign/route.ts`. The rate limit slows abuse; it does not
  identify users.
- **Embedding:** `next.config.ts` allows only `*.sitecorecloud.io` to frame `/campaign-studio`
  (`frame-ancestors`). If the panel stays blank in Page builder, check the browser console for a
  blocked frame first.
- **Deployment Protection:** the route calls the agent on the same deployment URL. On preview
  deployments with Vercel Authentication on, that call is blocked. Test on production, or use a
  protection bypass for automation.
- **Secrets:** keep model keys (BYOK) in the AI Gateway dashboard, never in `NEXT_PUBLIC_*`
  variables, which are bundled into the browser. Scope variables per environment, and never commit
  `.env.local`. The Auth0 client secret is server-only, so rotate it if it leaks.
- **Models:** the agents are read at build time, so redeploy after changing `*_MODEL` or the
  provider variables. Pin `eve` (it is in public preview) and upgrade on purpose.
- **Data:** to keep page content with one provider, set `AGENT_PROVIDER_ONLY`; Gateway then never
  fails over elsewhere.
- **Timeouts:** the route allows 300 seconds (`maxDuration`). Raise it on a plan that allows more
  if long pages time out.
- **Observability:** watch **Observability → Agent Runs** for each session's model calls, tools and
  cost, and Firewall logs for blocked requests.
- **Review before publishing:** the app never writes to Sitecore, and
  the kit lists claims, links and checks that could not run in "Check before publishing".

## 3. Register the app in SitecoreAI

In the Sitecore Cloud Portal, open **App studio** and create a custom app:
1. Deployment URL: `https://<your-project>.vercel.app` (use `http://localhost:3000` while developing).
2. Extension point: **SitecoreAI Page builder context panel**, route `/campaign-studio`.
3. API access: SitecoreAI APIs (pages and sites) and AI skills APIs (Brand Review). After
   you change API access, an admin must update the app in **My apps** in every organization.
   The page's public address is on the site host's hostname (Sites API): the canonical link when
   it is on that hostname, else the hostname plus the page route. A canonical on another host is
   ignored. If the site has no hostname, the canonical link (made absolute) is used, then the
   rendering host URL, and the review notes warn about it. Links in the finished kit that point
   to a different host than the page are also listed in the review notes.
   The server reads the whole brand kit (every section and subsection) through the Agent API as
   the signed-in Sitecore user, which needs custom authorization: create a **Regular web app**
   client credential in App Studio, set `AUTH0_*` and `APP_BASE_URL` (see `.env.example`), and add
   `<APP_BASE_URL>/auth/callback` to the allowed callback URLs (and the base URL to the logout,
   origin and web origin URLs). The first run shows a **Sign in to Sitecore** button, which opens
   the sign-in in a new window. The lead agent reads the kit: Tone of Voice and the other voice
   sections become the writing rules for every writer and the brand editor, and Visual Guidelines
   and Image Style become the design theme (primary, background and text colors, serif or sans)
   for the carousel and email. The sandbox enforces a 4.5:1 text contrast on the carousel whatever
   colors the model picks. When the kit cannot be read, the content is
   written without brand rules, the design uses the page's `theme-color` (or a `--brand`,
   `--primary` or `--accent` CSS variable), and with none a dark neutral. The review notes say when
   the kit could not be read.
4. Permissions: turn on **File downloads** and **Pop-ups**, or Download PDF and Open PDF do nothing.
5. Assign a brand kit to each site in SitecoreAI (site **Dashboard → Localization → Configuration →
   Brand kit**). The app uses the kit of the site that owns the open page to write and review.
6. Activate, then install it in your organization and pick an environment.
7. Open any page in Page builder → **Apps** → Campaign Studio → **Create campaign kit**.

## Security notes

- The browser never talks to the agent. `agent/channels/eve.ts` accepts only this
  deployment's OIDC-signed server calls (and local dev).
- `/api/campaign` accepts same-origin requests only. Built-in Marketplace auth gives the server
  no Sitecore identity to verify; for production, switch to Sitecore custom authorization
  (Auth0) and verify the token in the route.
- The agent has no default tools (`defaultTools: false`): no shell, files or web.
- Page text is passed as data inside `<page>` tags; the instructions say never to follow it.
- The app only reads from Sitecore (the page, its site and the brand kit); it never writes to it.

## Things to rehearse

- **PDF:** check that **Download PDF** saves the file and **Open PDF** opens it in a new tab.
- **Brand kit:** open a page of a site that has a brand kit assigned. Check that the carousel and
  email use the kit's colors, and that each tab shows a brand voice score. The scores come from the
  Brand Review API, which grades text against the kit and is separate from the Management API
  that feeds the writers. Only the kit's tone and voice sections count in a score; sections about
  products, SEO or inclusivity are ignored. The server picks those sections by name (`VOICE` in
  `lib/brand-kit.ts`: tone, voice, dos and don'ts, grammar) and sends the ids of those with content
  to the browser. The Checklist section is not scored; it describes logo, color and imagery checks. If your kit names them differently, widen that pattern.
- **Model IDs:** check all of them in the AI Gateway model catalog.
- **Providers and BYOK:** `AGENT_PROVIDER_ORDER` (and optionally `AGENT_PROVIDER_ONLY`) sets which
  AI Gateway providers every agent uses. Add your own provider keys (BYOK) in the Vercel dashboard.
- **eve is in public preview:** this repo pins `eve@0.86.0`; upgrade deliberately.

"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import type { PagesContext } from "@sitecore-marketplace-sdk/client";
import { useAppContext, useMarketplaceClient } from "@/components/providers/marketplace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { reviewText, summarize } from "@/lib/brand-review";
import { Icon } from "@/lib/icon";
import { assetText, charCount, LIMITS, limitViolations, xLength, type Assets, type AssetKey, type BrandCheck, type Kit, type StreamEvent } from "@/lib/kit";
import { base64ToBlob, extractPage, htmlToText } from "@/lib/page-text";
import { cn } from "@/lib/utils";

const ASSET_KEYS: AssetKey[] = ["carousel", "social", "email", "ads"];
const TAB_LABELS: Record<AssetKey, string> = { carousel: "Carousel", social: "Social", email: "Email", ads: "Ads" };

// draft: written, checks still running. final: checks finished. unchecked: the run stopped early.
type Stage = "draft" | "final" | "unchecked";
// kit: what is on screen, which the author can edit. checked: the kit the checks and previews belong to.
// rechecked: the checks were last run on the author's edits, so the brand editor did not look at them.
type Result = { kit: Kit; checked: Kit; assets: Assets | null; stage: Stage; updated: AssetKey[]; rechecked: boolean };

type CheckState = "pending" | "pass" | "warn";
type Check = { label: string; state: CheckState; detail?: string };

const comparable = (kit: Kit, key: AssetKey) => assetText(kit, key, kit.email.html);
/** The tabs whose text the author changed since the last checks. */
const editedAssets = ({ kit, checked }: Result) => ASSET_KEYS.filter((k) => comparable(kit, k) !== comparable(checked, k));
/** Whether what the sandbox renders (the slides, the email HTML) changed since the last render. */
const renderEdits = ({ kit, checked }: Result) => ({
  carousel: JSON.stringify(kit.carousel) !== JSON.stringify(checked.carousel),
  email: kit.email.html !== checked.email.html,
});
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
const errorText = (err: unknown) => (err instanceof Error ? err.message : "unknown error");

/** What is checked, and where each check stands. Drives the collapsible status panel. */
function buildChecks(result: Result | null, steps: string[], brand: Partial<Record<AssetKey, BrandCheck>>, brandReady: boolean): Check[] {
  if (!result) return [];
  const { kit, assets, stage } = result;
  const finished = stage === "final";
  const edited = editedAssets(result);
  const rendered = renderEdits(result);
  const rerun = "edited since the last check: re-run the checks";
  // A check that was not done when the run stopped counts as not passed.
  const state = (done: boolean, ok: boolean): CheckState => (done ? (ok ? "pass" : "warn") : stage === "unchecked" ? "warn" : "pending");

  const over = limitViolations(kit);
  const slides = assets?.report.overflowSlides ?? [];
  const checks: Check[] = [
    { label: "Platform limits: LinkedIn, X, email, Google Ads", state: over.length ? "warn" : "pass", detail: over.join(", ") || undefined },
    // The brand editor runs once, when the kit is made. It never rewrites the author's edits, so a re-check skips it.
    ...(result.rechecked ? [] : [{ label: "Brand editor review: claims, tone, limits", state: state(finished || steps.some((s) => s.startsWith("Rendering")), true) }]),
    {
      label: "Sandbox render: carousel PDF and slides",
      state: finished && rendered.carousel ? "warn" : state(finished, Boolean(assets) && slides.length === 0),
      detail: finished ? (rendered.carousel ? rerun : !assets ? "the render did not run" : slides.length ? `slides ${slides.join(", ")} overflow` : undefined) : undefined,
    },
    {
      label: "Sandbox render: email preview and width",
      state: finished && rendered.email ? "warn" : state(finished, Boolean(assets) && !assets?.report.email.tooWide),
      detail: finished ? (rendered.email ? rerun : !assets ? "the render did not run" : assets.report.email.tooWide ? `${assets.report.email.width}px wide, over 600px` : undefined) : undefined,
    },
  ];
  if (brandReady) {
    const reviews = ASSET_KEYS.map((k) => brand[k]);
    const settled = reviews.every((r) => r && r.status !== "running");
    const failed = reviews.find((r) => r?.status === "error");
    // Reviews of text that has since been edited no longer count, whatever they scored.
    const stale = finished && edited.length > 0;
    checks.push({
      label: "Brand voice review (tone and style)",
      state: stale ? "warn" : state(settled, !failed),
      detail: stale ? `${edited.map((k) => TAB_LABELS[k]).join(", ")} ${rerun}` : settled && failed?.status === "error" ? failed.message : undefined,
    });
  }
  return checks;
}

/** A status box that folds away. The title stays visible when it is closed. */
function Collapsible({ tone, title, open, onToggle, children }: { tone: "neutral" | "warning" | "success"; title: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  const background = { neutral: "bg-neutral-bg", warning: "bg-warning-bg", success: "bg-success-bg" }[tone];
  return (
    <div className={cn("rounded-md text-sm", background)}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-medium">
        <span className="min-w-0 flex-1">{title}</span>
        <Icon path={open ? mdiChevronUp : mdiChevronDown} size={1} className="size-5 shrink-0" />
      </button>
      {open && <div className="space-y-1 px-3 pb-3">{children}</div>}
    </div>
  );
}

export default function CampaignStudio() {
  const { client, error: sdkError } = useMarketplaceClient();
  const appContext = useAppContext();
  const [page, setPage] = useState<PagesContext | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [stepsOpen, setStepsOpen] = useState(true);
  const [checksOpen, setChecksOpen] = useState(true);
  const [revising, setRevising] = useState(false); // applying brand feedback; the kit on screen is the old one
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<"idle" | "working">("idle");
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string; signIn?: string } | null>(null); // signIn: organization id for the sign-in button
  const [brand, setBrand] = useState<Partial<Record<AssetKey, BrandCheck>>>({});
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const reviewed = useRef(new Map<AssetKey, string>()); // text last sent to Brand Review, per asset
  const voiceSections = useRef<string[]>([]); // ids of the brand kit's tone and voice sections, from the server

  // Follow whichever page the author has open in Page builder.
  useEffect(() => {
    if (!client) return;
    let unsubscribe: (() => void) | undefined;
    client
      .query("pages.context", { subscribe: true, onSuccess: setPage })
      .then((res) => {
        setPage(res.data ?? null);
        unsubscribe = res.unsubscribe;
      });
    return () => unsubscribe?.();
  }, [client]);

  // A blob URL downloads reliably in the iframe; a base64 data URL often does not.
  const carouselPdf = result?.assets?.carouselPdf;
  useEffect(() => {
    if (!carouselPdf) return setPdfUrl(null);
    const url = URL.createObjectURL(base64ToBlob(carouselPdf, "application/pdf"));
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [carouselPdf]);

  const resource = appContext?.resourceAccess?.[0]?.context;
  const contextId = resource?.preview ?? resource?.live; // Pages and Agent APIs
  const aiContextId = resource?.live ?? resource?.preview; // AI skills APIs
  // The brand kit assigned to the site of the open page in SitecoreAI, so each site follows its own.
  const brandKitId = page?.siteInfo?.brandKitId ?? "";
  const brandReady = Boolean(brandKitId && client && aiContextId);
  const pageId = page?.pageInfo?.id;
  const language = page?.pageInfo?.language ?? page?.siteInfo?.language ?? "en";

  // The PDF's name for the download: "<page>-linkedin-carousel-<date>".
  const fileBase = `${slug(page?.pageInfo?.displayName ?? page?.pageInfo?.name ?? "page")}-linkedin-carousel-${new Date().toISOString().slice(0, 10)}`;

  const checks = buildChecks(result, steps, brand, brandReady);
  const allPass = result?.stage === "final" && checks.length > 0 && checks.every((c) => c.state === "pass");
  // Fold the status panel away once every check has passed. The author can still open it.
  useEffect(() => {
    if (allPass) setChecksOpen(false);
  }, [allPass]);

  // Review each asset against the brand kit. Only assets whose text changed are sent again.
  function reviewKit(kit: Kit) {
    if (!client || !brandReady || !aiContextId) return;
    const emailBody = htmlToText(kit.email.html);
    for (const key of ASSET_KEYS) {
      const text = assetText(kit, key, emailBody);
      if (reviewed.current.get(key) === text) continue;
      reviewed.current.set(key, text);
      const settle = (check: BrandCheck) => {
        if (reviewed.current.get(key) === text) setBrand((b) => ({ ...b, [key]: check }));
      };
      setBrand((b) => ({ ...b, [key]: { status: "running" } }));
      (voiceSections.current.length
        ? reviewText(client, { contextId: aiContextId, brandKitId, sections: voiceSections.current, text })
        : Promise.reject(new Error("the brand kit's tone and voice sections could not be read")))
        .then((reviews) => settle({ status: "done", ...summarize(reviews) }))
        .catch((err) => settle({ status: "error", message: errorText(err) }));
    }
  }

  /**
   * Where the site is served from. `hosts` are the hostnames configured on the site's host in
   * SitecoreAI (target hostname first, wildcards left out); the best one is the public address.
   * `rendering` is the URL of the rendering host application, a last resort that may not be public.
   */
  async function siteAddress(): Promise<{ hosts: string[]; rendering: string }> {
    const site = page?.siteInfo;
    let hosts: string[] = [];
    if (client && site?.id && site.hostId) {
      try {
        const res = await client.query("xmc.sites.retrieveHost", {
          params: { path: { siteId: site.id, hostId: site.hostId }, query: { sitecoreContextId: contextId } },
        });
        const found = res.data?.data;
        hosts = [found?.targetHostname, ...(found?.hostnames ?? [])]
          .map((h) => h?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase() ?? "")
          .filter((h) => h && !h.includes("*"));
      } catch {
        // The Sites API may not be enabled for this app; the rendering host below still works.
      }
    }
    return { hosts, rendering: site?.renderingEngineApplicationUrl?.trim().replace(/\/+$/, "") ?? "" };
  }

  /**
   * The page's public address, and a warning when it could not be confirmed. The site's configured
   * hostname decides the host: the page's canonical link is used only when it is on that host
   * (it knows the exact path), otherwise the hostname plus the page route. Without a hostname the
   * canonical link is used unverified, then the rendering host, and the author is warned.
   */
  async function pageAddress(canonicalLink: string): Promise<{ url: string; warning?: string }> {
    const { hosts, rendering } = await siteAddress();
    const route = page?.pageInfo?.route ?? "";
    const bare = (h: string) => h.replace(/^www\./, "");
    const resolve = (href: string, base: string) => {
      try {
        return new URL(href, base || undefined).href; // fails on a relative link with no base
      } catch {
        return "";
      }
    };
    const canonical = canonicalLink ? resolve(canonicalLink, hosts[0] ? `https://${hosts[0]}` : rendering) : "";

    if (hosts.length) {
      if (canonical && hosts.some((h) => bare(h) === bare(new URL(canonical).host.toLowerCase()))) return { url: canonical };
      return { url: `https://${hosts[0]}${route}` };
    }
    if (canonical) {
      return { url: canonical, warning: "The site has no hostname in SitecoreAI, so the links use the page's canonical link as is. Check that the host is the public one." };
    }
    if (rendering) {
      return { url: `${rendering}${route}`, warning: "The site has no hostname in SitecoreAI and the page has no canonical link, so the links use the rendering host, which may not be public. Check them before sending." };
    }
    return { url: "" };
  }

  /**
   * Create the kit. With `revise`, rewrite the kit on screen using the brand review's feedback.
   * With `recheck`, run the checks again on the kit as the author edited it, without rewriting it.
   */
  async function createKit({ revise, recheck }: { revise?: { kit: Kit; feedback: string }; recheck?: Kit } = {}) {
    if (!client || !pageId) return;
    setStatus("working");
    setRevising(Boolean(revise));
    setSteps([recheck ? "Re-running the checks on your edits" : revise ? "Applying the brand feedback" : "Reading the page from SitecoreAI"]);
    setStepsOpen(true);
    setChecksOpen(true);
    // A revision or re-check keeps the current text on screen, so a failed run loses nothing. The
    // old previews and PDF no longer match it, and are dropped.
    setResult(
      recheck ? (r) => r && { ...r, checked: recheck, assets: null, stage: "draft", updated: [], rechecked: true }
      : revise ? (r) => r && { ...r, assets: null, stage: "draft", updated: [], rechecked: false }
      : null,
    );
    setMessage(null);
    if (recheck) {
      // Reviews of text that did not change stay. One that failed is tried again.
      for (const key of ASSET_KEYS) if (brand[key]?.status === "error") reviewed.current.delete(key);
      if (voiceSections.current.length) reviewKit(recheck); // runs while the sandbox renders
    } else {
      setBrand({});
      reviewed.current.clear();
      voiceSections.current = [];
    }
    let latest: Kit | null = null;
    let finished = false;
    try {
      const res = await client.query("xmc.agent.pagesGetPageHtml", {
        params: { path: { pageId }, query: { language, sitecoreContextId: contextId } },
      });
      const html = res.data?.data?.html;
      if (!html) throw new Error("SitecoreAI returned no HTML for this page.");
      const source = extractPage(html);
      // The page's public address, from the site's configured hostname (see pageAddress).
      const { url, warning: urlWarning } = await pageAddress(source.url);
      if (!url) throw new Error("This page has no public address: its site has no hostname or rendering host set in SitecoreAI and the page has no usable canonical link.");

      const response = await fetch("/api/campaign", {
        method: "POST",
        headers: { "content-type": "application/json", ...(contextId ? { "x-sitecore-contextid": contextId } : {}) },
        body: JSON.stringify({ ...source, url, urlWarning, brandKitId: brandKitId || undefined, revise, recheck }),
      });
      if (response.status === 401) {
        // The server reads the brand kit as the signed-in Sitecore user. Sign-in needs a click, as browsers block pop-ups otherwise.
        const organizationId = ((await client.query("host.state")).data as { organizationId?: string } | undefined)?.organizationId;
        throw Object.assign(new Error("Sign in to Sitecore so the app can read the site's brand kit, then run it again."), { signIn: organizationId ?? "" });
      }
      if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.error ?? "Request failed.");

      // Read the NDJSON progress stream from the agent run.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        buffer += chunk.value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as StreamEvent;
          // A step that runs again (a writer asked to fix a limit) is not listed twice.
          if (event.type === "step") setSteps((s) => (s.includes(event.label) ? s : [...s, event.label]));
          if (event.type === "brand") voiceSections.current = event.voiceSections;
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "draft") {
            setRevising(false);
            latest = event.kit;
            setResult({ kit: event.kit, checked: event.kit, assets: null, stage: "draft", updated: [], rechecked: false });
            setStepsOpen(false); // generation is done; the status panel now tracks the checks
            reviewKit(event.kit);
          }
          if (event.type === "done") {
            finished = true;
            const before = latest;
            const updated = before ? ASSET_KEYS.filter((k) => comparable(before, k) !== comparable(event.kit, k)) : [];
            latest = event.kit;
            setResult({ kit: event.kit, checked: event.kit, assets: event.assets, stage: "final", updated, rechecked: Boolean(recheck) });
            setStepsOpen(false);
            reviewKit(event.kit);
          }
        }
      }
      if (!finished) throw new Error("The connection closed before the checks finished.");
    } catch (err) {
      // Keep any draft on screen, but say plainly that it was never fully checked.
      setResult((r) => (r ? { ...r, stage: "unchecked" } : r));
      setMessage({ kind: "error", text: errorText(err), signIn: (err as { signIn?: string }).signIn });
    } finally {
      setStatus("idle");
      setRevising(false);
    }
  }

  if (sdkError) return <Alert className="m-4"><AlertDescription>Open Campaign Studio from SitecoreAI Page builder.</AlertDescription></Alert>;
  if (!page) return <div className="space-y-3 p-4"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-10 w-full" /></div>;

  const { kit, assets, stage, updated } = result ?? {};
  const working = status === "working";
  const busy = status !== "idle"; // while a run is going, the text on screen is locked
  const edited = result ? editedAssets(result) : [];
  const staleRender = result ? renderEdits(result) : { carousel: false, email: false };
  // The author's edit of one field of the kit. The checks, previews and PDF no longer match it
  // until the author re-runs the checks.
  const edit = (change: (kit: Kit) => Kit) => setResult((r) => r && { ...r, kit: change(r.kit) });
  const setAds = (part: "headlines" | "descriptions", i: number, value: string) =>
    edit((k) => ({ ...k, ads: { ...k.ads, [part]: k.ads[part].map((t, j) => (j === i ? value : t)) } }));
  const setSlide = (i: number, part: "headline" | "body", value: string) =>
    edit((k) => ({ ...k, carousel: k.carousel.map((s, j) => (j === i ? { ...s, [part]: value } : s)) }));

  const done = checks.filter((c) => c.state === "pass").length;
  const needAttention = checks.filter((c) => c.state === "warn").length;
  const checksTone = allPass ? "success" : "warning";
  const checksTitle =
    stage === "unchecked" ? "Draft only: checks did not finish"
    : stage === "final" && edited.length > 0 ? "You edited the content: re-run the checks"
    : allPass ? "✓ All checks passed"
    : checks.some((c) => c.state === "pending") ? `${stage === "draft" ? "Draft: " : ""}${done}/${checks.length} checks done`
    : `Checks finished: ${needAttention} need attention`;

  const generated = Boolean(kit) && !revising;
  const lastStep = steps[steps.length - 1];
  // The suggestions of every brand review that found something to improve, one list per tab.
  const feedback = ASSET_KEYS.flatMap((k) => {
    const check = brand[k];
    return check?.status === "done" && check.suggestions.length ? [`${TAB_LABELS[k]}:\n${check.suggestions.map((s) => `- ${s}`).join("\n")}`] : [];
  }).join("\n\n").slice(0, 6_000);
  return (
    <main className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        {brandKitId
          ? "Uses the tone and brand voice of the brand kit assigned to this site to write and review the content."
          : "This site has no brand kit assigned, so the content is written and reviewed without brand voice rules."}
      </p>

      <Button className="w-full" onClick={() => createKit()} disabled={status !== "idle" || !pageId}>
        {working ? "Creating…" : result ? "Create again" : "Create campaign kit"}
      </Button>

      {steps.length > 0 && (
        <Collapsible
          tone={generated ? "success" : "neutral"}
          open={stepsOpen}
          onToggle={() => setStepsOpen((o) => !o)}
          title={
            <span aria-live="polite">
              Current status: {generated ? "✓ Generation complete" : working ? `● ${lastStep}` : `Stopped after “${lastStep}”`}
            </span>
          }
        >
          <ol className="space-y-1">
            {steps.map((s, i) => (
              <li key={i} className={i === steps.length - 1 && working && !generated ? "font-medium" : "font-normal text-muted-foreground"}>
                {i === steps.length - 1 && working && !generated ? "● " : "✓ "}{s}
              </li>
            ))}
          </ol>
        </Collapsible>
      )}

      {message && (
        <Alert variant={message.kind === "error" ? "danger" : "success"}>
          <AlertDescription>{message.text}</AlertDescription>
          {message.signIn !== undefined && (
            <Button variant="outline" className="col-start-2 mt-2 justify-self-start" onClick={() => window.open(`/auth/login?returnTo=/signed-in${message.signIn ? `&organization=${message.signIn}` : ""}`, "_blank")}>
              Sign in to Sitecore
            </Button>
          )}
        </Alert>
      )}

      {kit && (
        <Collapsible tone={checksTone} open={checksOpen} onToggle={() => setChecksOpen((o) => !o)} title={checksTitle}>
          {stage === "draft" && <p className="font-normal">Everything below is written but not fully checked. It can still change, and this panel updates when the checks finish.</p>}
          <ul className="space-y-0.5 font-normal">
            {checks.map((c) => (
              <li key={c.label}>
                {c.state === "pass" ? "✓" : c.state === "warn" ? "!" : "…"} {c.label}
                {c.detail && <span className="text-muted-foreground">: {c.detail}</span>}
              </li>
            ))}
          </ul>
          <p className="font-normal text-muted-foreground">The LinkedIn post, short post and ads are not rendered. They are checked for length and by the brand editor.</p>
          {stage === "final" && !assets && <p className="font-normal">The sandbox render did not run, so there are no previews or PDF and the layout was not tested.</p>}
          {updated && updated.length > 0 && <p className="font-normal">Updated after the checks: {updated.map((k) => TAB_LABELS[k]).join(", ")} (marked •).</p>}
        </Collapsible>
      )}

      {kit && (
        <div className="space-y-1">
          <div className="flex gap-2">
            {feedback && (
              <Button variant="outline" className="flex-1" onClick={() => createKit({ revise: { kit, feedback } })} disabled={busy || edited.length > 0}>
                Apply brand feedback
              </Button>
            )}
            <Button variant={edited.length > 0 ? "default" : "outline"} className="flex-1" onClick={() => createKit({ recheck: kit })} disabled={busy || !pageId}>
              {working && result?.rechecked ? "Checking…" : "Re-run checks"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {feedback && "Apply brand feedback rewrites the assets using the suggestions in the brand voice reviews, then reviews them again. "}
            Every text can be edited. Re-run checks tests your edits against the platform limits, the brand kit and the sandbox render, and keeps your text as it is.
            {feedback && edited.length > 0 && " Re-run the checks before applying the feedback, which was written for the earlier text."}
          </p>
        </div>
      )}

      {kit && (
        <Tabs defaultValue="carousel">
          <TabsList className="grid w-full grid-cols-4">
            {ASSET_KEYS.map((k) => (
              <TabsTrigger key={k} value={k}>{TAB_LABELS[k]}{updated?.includes(k) ? " •" : ""}</TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="carousel">
            <Tabs defaultValue="content">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="preview">Preview and PDF</TabsTrigger>
              </TabsList>

              <TabsContent value="content" className="space-y-3">
                {kit.carousel.map((slide, i) => (
                  <div key={i} className="space-y-3">
                    <Field label={`Slide ${i + 1} headline`} text={slide.headline} limit={LIMITS.slideHeadline} readOnly={busy} onChange={(v) => setSlide(i, "headline", v)} />
                    <Field label={`Slide ${i + 1} body`} text={slide.body} limit={LIMITS.slideBody} readOnly={busy} onChange={(v) => setSlide(i, "body", v)} />
                  </div>
                ))}
                <BrandCard check={brand.carousel} enabled={brandReady} stale={edited.includes("carousel")} />
              </TabsContent>

              <TabsContent value="preview" className="space-y-3">
                {assets && staleRender.carousel ? (
                  <p className="text-sm text-muted-foreground">You edited the slides. Re-run the checks to refresh the previews and the PDF.</p>
                ) : assets ? (
                  <>
                    <div className="flex snap-x gap-2 overflow-x-auto pb-2">
                      {assets.slidePreviews.map((img, i) => (
                        <img key={i} src={`data:image/jpeg;base64,${img}`} alt={kit.carousel[i]?.headline ?? `Slide ${i + 1}`} className="w-56 shrink-0 snap-start rounded border" />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {pdfUrl && (
                        <>
                          <Button variant="outline" asChild>
                            <a download={`${fileBase}.pdf`} href={pdfUrl}>Download PDF</a>
                          </Button>
                          <Button variant="outline" asChild>
                            <a href={pdfUrl} target="_blank" rel="noreferrer">Open PDF</a>
                          </Button>
                        </>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      If Download or Open does nothing, turn on File downloads and Pop-ups for this app in App Studio, under Permissions.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {stage === "draft" ? "The slide previews and the PDF appear here when the sandbox render finishes." : "No slide previews or PDF were produced."}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="social" className="space-y-3">
            <Field label="LinkedIn post" text={kit.linkedinPost} limit={LIMITS.linkedinPost} readOnly={busy} onChange={(v) => edit((k) => ({ ...k, linkedinPost: v }))} />
            <Field label="X / Threads" text={kit.shortPost} limit={LIMITS.shortPost} measure={xLength} readOnly={busy} onChange={(v) => edit((k) => ({ ...k, shortPost: v }))} />
            <BrandCard check={brand.social} enabled={brandReady} stale={edited.includes("social")} />
          </TabsContent>

          <TabsContent value="email">
            <Tabs defaultValue="content">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>

              <TabsContent value="content" className="space-y-3">
                <Field label="Subject" text={kit.email.subject} limit={LIMITS.subject} readOnly={busy} onChange={(v) => edit((k) => ({ ...k, email: { ...k.email, subject: v } }))} />
                <Field label="Preheader" text={kit.email.preheader} limit={LIMITS.preheader} readOnly={busy} onChange={(v) => edit((k) => ({ ...k, email: { ...k.email, preheader: v } }))} />
                <Field label="HTML" text={kit.email.html} mono readOnly={busy} onChange={(v) => edit((k) => ({ ...k, email: { ...k.email, html: v } }))} />
                <BrandCard check={brand.email} enabled={brandReady} stale={edited.includes("email")} />
              </TabsContent>

              <TabsContent value="preview">
                {assets && staleRender.email ? (
                  <p className="text-sm text-muted-foreground">You edited the email HTML. Re-run the checks to refresh the preview.</p>
                ) : assets ? (
                  <img src={`data:image/jpeg;base64,${assets.emailPreview}`} alt="Email preview" className="w-full rounded border" />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {stage === "draft" ? "The email preview appears here when the sandbox render finishes." : "No email preview was produced."}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="ads" className="space-y-3">
            {kit.ads.headlines.map((h, i) => <Field key={`h${i}`} label={`Headline ${i + 1}`} text={h} limit={LIMITS.adHeadline} readOnly={busy} onChange={(v) => setAds("headlines", i, v)} />)}
            {kit.ads.descriptions.map((d, i) => <Field key={`d${i}`} label={`Description ${i + 1}`} text={d} limit={LIMITS.adDescription} readOnly={busy} onChange={(v) => setAds("descriptions", i, v)} />)}
            <BrandCard check={brand.ads} enabled={brandReady} stale={edited.includes("ads")} />
          </TabsContent>
        </Tabs>
      )}

      {kit && kit.reviewNotes.length > 0 && (
        <Alert>
          <AlertDescription>
            <p className="font-medium">Check before publishing</p>
            <ul className="list-disc pl-4">{kit.reviewNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </AlertDescription>
        </Alert>
      )}
    </main>
  );
}

/** Result of the SitecoreAI Brand Review API for one asset. Hidden when the site has no brand kit. */
function BrandCard({ check, enabled, stale = false }: { check?: BrandCheck; enabled: boolean; stale?: boolean }) {
  if (!enabled || !check) return null;
  if (check.status === "running") return <p className="text-xs text-muted-foreground">Reviewing against your brand kit…</p>;
  if (check.status === "error") return <p className="text-xs text-muted-foreground">Brand kit review unavailable: {check.message}</p>;
  const scheme = check.score >= 4 ? "success" : check.score >= 3 ? "warning" : "danger";
  return (
    <section className="space-y-1 rounded border p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Brand voice review</h2>
        <Badge colorScheme={scheme}>{check.score.toFixed(1)}/5</Badge>
      </div>
      {check.suggestions.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-sm">{check.suggestions.slice(0, 5).map((s, i) => <li key={i}>{s}</li>)}</ul>
      ) : (
        <p className="text-sm text-muted-foreground">Matches your brand kit.</p>
      )}
      {stale && <p className="text-xs font-medium">This review is of the text before your edits. Re-run the checks to review it again.</p>}
      <p className="text-xs text-muted-foreground">Scored on {check.sections.length} tone and voice section{check.sections.length === 1 ? "" : "s"} of the brand kit.</p>
    </section>
  );
}

/** One text of the kit. The author can edit it and sees its length against the platform limit. */
function Field({ label, text, limit, measure = charCount, mono = false, readOnly, onChange }: { label: string; text: string; limit?: number; measure?: (text: string) => number; mono?: boolean; readOnly: boolean; onChange: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const id = useId();
  const size = measure(text);
  const over = limit !== undefined && size > limit;
  return (
    <section className="space-y-1 rounded border p-3">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {limit !== undefined && <Badge colorScheme={over ? "danger" : "neutral"}>{size}/{limit}</Badge>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <textarea
        id={id}
        value={text}
        readOnly={readOnly}
        onChange={(e) => {
          setCopied(false);
          onChange(e.target.value);
        }}
        className={cn(
          "field-sizing-content max-h-48 min-h-9 w-full resize-y overflow-y-auto whitespace-pre-wrap rounded border border-transparent bg-transparent p-1 text-sm hover:border-input focus:border-input focus:outline-none focus-visible:ring-2 focus-visible:ring-ring read-only:opacity-60",
          mono && "font-mono text-xs",
        )}
      />
    </section>
  );
}
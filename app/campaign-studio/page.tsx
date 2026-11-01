"use client";

import { useEffect, useState } from "react";
import type { PagesContext } from "@sitecore-marketplace-sdk/client";
import { useAppContext, useMarketplaceClient } from "@/components/providers/marketplace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Assets, Kit, StreamEvent } from "@/lib/kit";
import { base64ToBlob, extractPage } from "@/lib/page-text";

const MEDIA_FOLDER = process.env.NEXT_PUBLIC_MEDIA_FOLDER ?? "/sitecore/media library/Images";

export default function CampaignStudio() {
  const { client, error: sdkError } = useMarketplaceClient();
  const appContext = useAppContext();
  const [page, setPage] = useState<PagesContext | null>(null);
  const [brandColor, setBrandColor] = useState(process.env.NEXT_PUBLIC_BRAND_COLOR ?? "#2f5bd3");
  const [steps, setSteps] = useState<string[]>([]);
  const [result, setResult] = useState<{ kit: Kit; assets: Assets | null } | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "saving">("idle");
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

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

  const contextId = appContext?.resourceAccess?.[0]?.context?.preview ?? appContext?.resourceAccess?.[0]?.context?.live;
  const pageId = page?.pageInfo?.id;
  const language = page?.pageInfo?.language ?? page?.siteInfo?.language ?? "en";

  async function createKit() {
    if (!client || !pageId) return;
    setStatus("working");
    setSteps(["Reading the page from SitecoreAI"]);
    setResult(null);
    setMessage(null);
    try {
      const res = await client.query("xmc.agent.pagesGetPageHtml", {
        params: { path: { pageId }, query: { language, sitecoreContextId: contextId } },
      });
      const html = res.data?.data?.html;
      if (!html) throw new Error("SitecoreAI returned no HTML for this page.");
      const source = extractPage(html);
      const url = source.url || `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com"}${page?.pageInfo?.route ?? ""}`;

      const response = await fetch("/api/campaign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...source, url, brandColor }),
      });
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
          if (event.type === "step") setSteps((s) => [...s, event.label]);
          if (event.type === "done") setResult({ kit: event.kit, assets: event.assets });
          if (event.type === "error") throw new Error(event.message);
        }
      }
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setStatus("idle");
    }
  }

  // Human in the loop: nothing reaches Sitecore until the author clicks Save.
  async function saveCarousel() {
    if (!client || !result?.assets) return;
    setStatus("saving");
    const name = `${page?.pageInfo?.name ?? "page"}-carousel`;
    try {
      await client.mutate("xmc.agent.assetsUploadAsset", {
        params: {
          query: { sitecoreContextId: contextId },
          body: {
            file: base64ToBlob(result.assets.carouselPdf, "application/pdf"),
            upload_request: JSON.stringify({ name, itemPath: MEDIA_FOLDER, language, extension: "pdf", siteName: page?.siteInfo?.name }),
          },
        },
      });
      setMessage({ kind: "ok", text: `Saved ${name}.pdf to ${MEDIA_FOLDER}.` });
    } catch (err) {
      setMessage({ kind: "error", text: `Save failed: ${err instanceof Error ? err.message : "unknown error"}. Download the PDF instead.` });
    } finally {
      setStatus("idle");
    }
  }

  if (sdkError) return <Alert className="m-4"><AlertDescription>Open Campaign Studio from SitecoreAI Page builder.</AlertDescription></Alert>;
  if (!page) return <div className="space-y-3 p-4"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-10 w-full" /></div>;

  const { kit, assets } = result ?? {};
  return (
    <main className="space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-base font-semibold">Campaign Studio</h1>
        <p className="text-sm text-muted-foreground">Turn “{page.pageInfo?.displayName ?? page.pageInfo?.name}” into posts, an email, ads and a carousel.</p>
      </header>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-8 w-8 cursor-pointer rounded border" />
          Brand color
        </label>
        <Button className="ml-auto" onClick={createKit} disabled={status !== "idle" || !pageId}>
          {status === "working" ? "Creating…" : result ? "Create again" : "Create campaign kit"}
        </Button>
      </div>

      {steps.length > 0 && (
        <ol className="space-y-1 text-sm" aria-live="polite">
          {steps.map((s, i) => (
            <li key={i} className={i === steps.length - 1 && status === "working" ? "font-medium" : "text-muted-foreground"}>
              {i === steps.length - 1 && status === "working" ? "● " : "✓ "}{s}
            </li>
          ))}
        </ol>
      )}

      {message && <Alert variant={message.kind === "error" ? "danger" : "success"}><AlertDescription>{message.text}</AlertDescription></Alert>}

      {kit && (
        <Tabs defaultValue="carousel">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="carousel">Carousel</TabsTrigger>
            <TabsTrigger value="social">Social</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="ads">Ads</TabsTrigger>
          </TabsList>

          <TabsContent value="carousel" className="space-y-3">
            {assets ? (
              <>
                <div className="flex snap-x gap-2 overflow-x-auto pb-2">
                  {assets.slidePreviews.map((img, i) => (
                    <img key={i} src={`data:image/jpeg;base64,${img}`} alt={kit.carousel[i]?.headline ?? `Slide ${i + 1}`} className="w-56 shrink-0 snap-start rounded border" />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Rendered and layout-checked in Vercel Sandbox. Overflowing slides: {assets.report.overflowSlides.length || "none"}.</p>
                <div className="flex gap-2">
                  <Button variant="outline" asChild>
                    <a download="carousel.pdf" href={`data:application/pdf;base64,${assets.carouselPdf}`}>Download PDF</a>
                  </Button>
                  <Button onClick={saveCarousel} disabled={status !== "idle"}>{status === "saving" ? "Saving…" : "Save to Media Library"}</Button>
                </div>
              </>
            ) : (
              <Copyable label="Slides" text={kit.carousel.map((s, i) => `${i + 1}. ${s.headline}\n${s.body}`).join("\n\n")} />
            )}
          </TabsContent>

          <TabsContent value="social" className="space-y-3">
            <Copyable label="LinkedIn post" text={kit.linkedinPost} limit={3000} />
            <Copyable label="X / Threads" text={kit.shortPost} limit={280} />
          </TabsContent>

          <TabsContent value="email" className="space-y-3">
            <Copyable label="Subject" text={kit.email.subject} limit={60} />
            <Copyable label="Preheader" text={kit.email.preheader} limit={90} />
            {assets && <img src={`data:image/jpeg;base64,${assets.emailPreview}`} alt="Email preview" className="w-full rounded border" />}
            <Copyable label="HTML" text={kit.email.html} />
          </TabsContent>

          <TabsContent value="ads" className="space-y-3">
            {kit.ads.headlines.map((h, i) => <Copyable key={`h${i}`} label={`Headline ${i + 1}`} text={h} limit={30} />)}
            {kit.ads.descriptions.map((d, i) => <Copyable key={`d${i}`} label={`Description ${i + 1}`} text={d} limit={90} />)}
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

function Copyable({ label, text, limit }: { label: string; text: string; limit?: number }) {
  const [copied, setCopied] = useState(false);
  const over = limit !== undefined && text.length > limit;
  return (
    <section className="space-y-1 rounded border p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">{label}</h2>
        {limit !== undefined && <Badge colorScheme={over ? "danger" : "neutral"}>{text.length}/{limit}</Badge>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm">{text}</p>
    </section>
  );
}

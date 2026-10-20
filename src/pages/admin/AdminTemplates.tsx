import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Download, Inbox, Mail, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Lines } from "@/components/Lines";
import { cardCls, focusRing } from "@/components/admin/ui";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Email templates.
 *
 * Every branded email template in one place. The list comes from the static file
 * /email-templates/templates.json (public/email-templates/). Each entry points at a
 * ready-to-use .html and a .eml. Mail opens an .eml that carries `X-Unsent: 1` as an
 * editable draft, so "Open in Mail" is a plain download link.
 */

const INDEX_URL = "/email-templates/templates.json";
const EMAIL_WIDTH = 600; // emails are built 600px wide; previews render at this width then scale down

type Brand = "Bestly" | "InventoryProof";

type Template = {
  slug: string;
  name: string;
  brand: Brand | string;
  kind: string;
  use: string;
  subject: string;
  html: string;
  eml: string;
  updated: string;
};

type Filter = "All" | Brand;
const FILTERS: Filter[] = ["All", "Bestly", "InventoryProof"];

const brandPill: Record<string, string> = {
  Bestly: "bg-[#c84d2b]/15 text-[#ff9a7a]",
  InventoryProof: "bg-sky-500/15 text-sky-300",
};

const btnBase =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium motion-safe:transition-colors motion-reduce:transition-none";

function isTemplate(v: unknown): v is Template {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return ["slug", "name", "brand", "kind", "use", "html", "eml"].every((k) => typeof t[k] === "string");
}

/**
 * The site sends `frame-ancestors 'none'` on every path (vercel.json), so an
 * <iframe src> of a template is blocked by the browser and shows nothing. We fetch
 * the HTML and hand it to the iframe as srcDoc instead, which that header does not
 * cover. One fetch per file per visit.
 */
const htmlCache = new Map<string, Promise<string>>();
function loadHtml(src: string): Promise<string> {
  let p = htmlCache.get(src);
  if (!p) {
    p = fetch(src, { cache: "no-cache" }).then(async (r) => {
      if (!r.ok) throw new Error(`${src} answered HTTP ${r.status}`);
      const text = await r.text();
      if (!/<table|<p[\s>]/i.test(text) || /id="root"/.test(text)) throw new Error(`${src} did not return an email`);
      return text;
    });
    htmlCache.set(src, p);
    p.catch(() => htmlCache.delete(src));
  }
  return p;
}

function useTemplateHtml(src: string | undefined) {
  const [state, setState] = useState<{ html: string | null; error: string | null }>({ html: null, error: null });
  useEffect(() => {
    if (!src) return;
    let alive = true;
    setState({ html: null, error: null });
    loadHtml(src).then(
      (html) => alive && setState({ html, error: null }),
      (e: unknown) => alive && setState({ html: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => { alive = false; };
  }, [src]);
  return state;
}

/** Renders the email at its real width and scales it down to whatever width the box has. */
function ScaledPreview({ src, title, onOpen }: { src: string; title: string; onOpen: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const { html, error } = useTemplateHtml(src);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setScale(w / EMAIL_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Box is 4:3, so the visible slice of the email is 600 wide by 450 tall before scaling.
  const emailHeight = (EMAIL_WIDTH * 3) / 4;

  return (
    <div ref={box} className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-white">
      {!html && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-neutral-500">
          {error ? `Preview could not load: ${error}` : <span className="h-full w-full animate-pulse rounded-lg bg-neutral-100 motion-reduce:animate-none" />}
        </div>
      )}
      <iframe
        srcDoc={html ?? ""}
        title={`${title} preview`}
        tabIndex={-1}
        sandbox=""
        className="pointer-events-none absolute left-0 top-0 border-0 bg-white"
        style={{
          width: EMAIL_WIDTH,
          height: emailHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open full-size preview of ${title}`}
        className={cn(
          "absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/0 to-transparent opacity-0 hover:from-black/30 hover:opacity-100 focus-visible:from-black/30 focus-visible:opacity-100 motion-safe:transition-opacity motion-reduce:transition-none",
          focusRing,
          "focus-visible:ring-inset",
        )}
      >
        <span className="mb-3 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
          Full-size preview
        </span>
      </button>
    </div>
  );
}

function FullPreview({ src, name }: { src: string; name: string }) {
  const { html, error } = useTemplateHtml(src);
  if (error) return <p className="p-6 text-sm text-neutral-600">Preview could not load: {error}</p>;
  return (
    <iframe
      srcDoc={html ?? ""}
      title={`${name} full-size preview`}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="block h-[70vh] w-full border-0 bg-white"
    />
  );
}

function TemplateCard({ t, onPreview }: { t: Template; onPreview: () => void }) {
  const { toast } = useToast();

  const copyLink = async () => {
    const url = window.location.origin + t.html;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url });
    } catch {
      toast({ title: "Copy blocked by the browser. Link:", description: url });
    }
  };

  return (
    <article className={cn(cardCls, "flex min-w-0 flex-col gap-4 p-4 sm:p-5")}>
      <ScaledPreview src={t.html} title={t.name} onOpen={onPreview} />

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              brandPill[t.brand] ?? "bg-white/10 text-white/70",
            )}
          >
            {t.brand}
          </span>
          <span className="text-xs text-white/50">{t.kind}</span>
          {t.updated && (
            <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-white/35">
              Updated {t.updated}
            </span>
          )}
        </div>
        <h2 className="text-lg font-semibold leading-snug text-white [overflow-wrap:anywhere]">{t.name}</h2>
        <p className="text-sm leading-relaxed text-white/60">
          <Lines>{t.use}</Lines>
        </p>
        {t.subject && (
          <p className="text-xs text-white/40 [overflow-wrap:anywhere]">
            Subject: <span className="text-white/60">{t.subject}</span>
          </p>
        )}
      </div>

      <div className="mt-auto space-y-2">
        <div className="flex flex-wrap gap-2">
          <a
            href={t.eml}
            download={`${t.slug}.eml`}
            className={cn(btnBase, "bg-[#0A84FF] text-white hover:bg-[#3395ff]", focusRing)}
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            Open in Mail
          </a>
          <a
            href={t.html}
            download
            className={cn(btnBase, "border border-white/[0.12] bg-white/[0.04] text-white hover:bg-white/[0.08]", focusRing)}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download HTML
          </a>
          <button
            type="button"
            onClick={copyLink}
            aria-label={`Copy link to ${t.name} HTML`}
            title="Copy link"
            className={cn(
              btnBase,
              "min-w-[44px] border border-white/[0.12] bg-transparent px-0 text-white/70 hover:bg-white/[0.06] hover:text-white",
              focusRing,
            )}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-xs text-white/40">
          <Lines>Opens as a new draft in Apple Mail. On other apps it downloads.</Lines>
        </p>
      </div>
    </article>
  );
}

export default function AdminTemplates() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [preview, setPreview] = useState<Template | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setError(null);
    setTemplates(null);
    try {
      const res = await fetch(INDEX_URL, { cache: "no-cache", signal });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        throw new Error("the file is not valid JSON (the site may be serving its home page instead)");
      }
      if (!Array.isArray(data)) throw new Error("the file is not a list of templates");
      const bad = data.findIndex((t) => !isTemplate(t));
      if (bad !== -1) throw new Error(`entry ${bad + 1} is missing a required field`);
      setTemplates(data as Template[]);
    } catch (e) {
      if (signal.aborted) return;
      setError(`${INDEX_URL} failed to load: ${e instanceof Error ? e.message : String(e)}.`);
    }
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load, attempt]);

  const shown = useMemo(
    () => (templates ?? []).filter((t) => filter === "All" || t.brand === filter),
    [templates, filter],
  );

  const countFor = (f: Filter) =>
    (templates ?? []).filter((t) => f === "All" || t.brand === f).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email templates"
        description="Branded emails for Bestly and InventoryProof. Open one in Mail to write from it, or download it."
      />

      <div role="group" aria-label="Filter by brand" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={active}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm font-medium motion-safe:transition-colors motion-reduce:transition-none",
                active
                  ? "border-white/25 bg-white/[0.12] text-white"
                  : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.07] hover:text-white",
                focusRing,
              )}
            >
              {f}
              {templates && <span className="text-xs tabular-nums text-white/40">{countFor(f)}</span>}
            </button>
          );
        })}
      </div>

      {!templates && !error && (
        <div className="grid gap-5 lg:grid-cols-2" aria-busy="true" aria-label="Loading templates">
          {[0, 1].map((i) => (
            <div key={i} className={cn(cardCls, "p-4 sm:p-5")}>
              <div className="aspect-[4/3] w-full rounded-xl bg-white/[0.05] motion-safe:animate-pulse" />
              <div className="mt-4 h-4 w-1/3 rounded bg-white/[0.06]" />
              <div className="mt-3 h-3 w-3/4 rounded bg-white/[0.05]" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-amber-200">Could not load the template list</p>
            <p className="mt-1 text-white/60 [overflow-wrap:anywhere]">{error}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className={cn(btnBase, "mt-3 border border-white/[0.12] bg-white/[0.04] text-white hover:bg-white/[0.08]", focusRing)}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      )}

      {templates && shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/[0.1] px-6 py-16 text-center">
          <Inbox className="mx-auto h-5 w-5 text-white/25" aria-hidden="true" />
          <p className="mt-3 text-sm text-white/55">
            <Lines>
              {templates.length === 0
                ? "No templates yet. Add entries to /email-templates/templates.json and they show up here."
                : `No ${filter} templates yet.`}
            </Lines>
          </p>
          {templates.length > 0 && (
            <button
              type="button"
              onClick={() => setFilter("All")}
              className={cn(btnBase, "mt-4 border border-white/[0.12] bg-white/[0.04] text-white hover:bg-white/[0.08]", focusRing)}
            >
              Show all templates
            </button>
          )}
        </div>
      )}

      {shown.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          {shown.map((t) => (
            <TemplateCard key={t.slug} t={t} onPreview={() => setPreview(t)} />
          ))}
        </div>
      )}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-[640px] flex-col gap-0 overflow-hidden border-white/10 bg-neutral-950 p-0 text-white">
          <DialogHeader className="shrink-0 border-b border-white/[0.08] px-5 py-4 pr-12">
            <DialogTitle className="[overflow-wrap:anywhere]">{preview?.name}</DialogTitle>
            <DialogDescription className="text-white/50 [overflow-wrap:anywhere]">
              {preview?.subject ? `Subject: ${preview.subject}` : "Full-size preview"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-white">
            {preview && (
              <FullPreview src={preview.html} name={preview.name} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

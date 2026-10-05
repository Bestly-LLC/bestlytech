import { useCallback, useEffect, useState } from "react";
import { AdminMark } from "@/components/AdminMark";

/**
 * "We'll be right back" - what /admin (and the partner portal) shows when the page crashes,
 * instead of a raw error. Scout speaks it, because Scout is the one who watches the servers.
 *
 * The "last known reason" comes from the get_outage_note() RPC, which reads the watchdog's
 * ops_incidents log and returns a fixed plain-English vocabulary (never raw error text).
 *
 * This screen renders when the app has just crashed, so it stays lean on purpose:
 * no supabase client (it may be the thing that broke), no router, no providers - a plain fetch
 * with a short timeout. If that fails it still says something useful.
 *
 * Apple HIG pass (ui-ux-pro-max, 2026-10-05): system font, rem units only (the header's text-size
 * control scales root), 44pt minimum targets, one primary action, visible focus rings, status
 * conveyed by words not colour, polite live region, reduced motion respected, times in 12-hour
 * Pacific with the time and AM/PM never split across lines.
 */

type Note = {
  ongoing?: boolean;
  started_at?: string;
  ended_at?: string | null;
  what?: string;
  how?: string;
  fixed_by?: string | null;
};

type Phase = "loading" | "ready" | "unavailable";

const NBSP = " ";
const POLL_MS = 30_000;

function fmtTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tz = "America/Los_Angeles";
  const time = d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz })
    .replace(/[\s ]+/g, NBSP);
  const day = (x: Date) => x.toLocaleDateString("en-US", { timeZone: tz });
  if (day(d) === day(new Date())) return `${time}`;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz }).replace(" ", NBSP);
  return `${date} at${NBSP}${time}`;
}

async function fetchNote(signal: AbortSignal): Promise<Note | null> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
    | string
    | undefined;
  if (!url || !key) return null;
  const r = await fetch(`${url}/rest/v1/rpc/get_outage_note`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
  if (!r.ok) return null;
  const j = (await r.json()) as Note;
  return j && typeof j === "object" ? j : null;
}

/** What Scout says about the last incident, in plain words. */
function reasonLines(n: Note | null): { headline: string; detail: string } {
  if (!n || !n.started_at) {
    return {
      headline: "I don't have a recent incident on record.",
      detail: "The servers look fine, so this looks like a bug in the page itself rather than an outage.",
    };
  }
  const what = n.what ?? "one of our systems";
  const how = n.how ?? "had a problem";
  const started = fmtTime(n.started_at);
  if (n.ongoing) {
    return {
      headline: `${cap(what)} ${how} at${NBSP}${started}.`,
      detail: "That's still going. I'm working on it and this page will update by itself.",
    };
  }
  const ended = fmtTime(n.ended_at);
  const fixed = n.fixed_by ? `Fixed by ${n.fixed_by}` : "Fixed";
  return {
    headline: `Last time, ${what} ${how} at${NBSP}${started}.`,
    detail: `${fixed}${ended ? ` at${NBSP}${ended}` : ""}. Nothing is down right now, so this crash looks like a bug in the page itself.`,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function OutageScreen({ error, onRetry }: { error?: Error | null; onRetry: () => void }) {
  const [note, setNote] = useState<Note | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 5000);
    fetchNote(ctl.signal)
      .then((n) => { setNote(n); setPhase(n ? "ready" : "unavailable"); })
      .catch(() => setPhase((p) => (p === "ready" ? p : "unavailable")))
      .finally(() => window.clearTimeout(t));
    return () => { window.clearTimeout(t); ctl.abort(); };
  }, []);

  useEffect(() => {
    const stop = load();
    const id = window.setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => { stop(); window.clearInterval(id); };
  }, [load]);

  const reason = phase === "ready" ? reasonLines(note) : null;
  const where = typeof window !== "undefined" ? window.location.pathname : "";

  const copyDetails = async () => {
    const text = [
      `Scout, the admin crashed on ${where}.`,
      error?.message ? `Error: ${error.message}` : "",
      error?.stack ? `Stack:\n${error.stack.split("\n").slice(0, 8).join("\n")}` : "",
      typeof navigator !== "undefined" ? `Browser: ${navigator.userAgent}` : "",
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard blocked: the details are still on screen */ }
  };

  return (
    <main
      className="min-h-dvh bg-black text-white flex items-center justify-center px-4 py-10"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif' }}
    >
      <div className="w-full max-w-[28rem] text-center">
        <AdminMark className="mx-auto h-24 w-24" label="Scout" />

        <h1
          className="mt-6 text-[2.125rem] font-bold leading-tight tracking-[-0.015em]"
          style={{ textWrap: "balance" }}
        >
          We&rsquo;ll be right back
        </h1>
        <p className="mt-2 text-base text-white/70" style={{ textWrap: "pretty" }}>
          Scout here. The admin hit a snag and I&rsquo;m on it.
        </p>

        {/* Scout's note: the last known reason */}
        <section
          aria-labelledby="outage-reason"
          className="mt-8 rounded-2xl border border-white/10 bg-white/[0.06] p-5 text-left"
        >
          <h2 id="outage-reason" className="text-xs font-semibold uppercase tracking-wider text-white/55">
            Last known reason
          </h2>
          <div aria-live="polite" className="mt-2 min-h-[4.5rem]">
            {phase === "loading" && (
              <div className="space-y-2" aria-label="Checking">
                <div className="h-4 w-11/12 rounded bg-white/10 motion-safe:animate-pulse" />
                <div className="h-4 w-3/4 rounded bg-white/10 motion-safe:animate-pulse" />
              </div>
            )}
            {reason && (
              <>
                <p className="text-base font-medium text-white" style={{ textWrap: "pretty" }}>{reason.headline}</p>
                <p className="mt-1 text-sm text-white/70" style={{ textWrap: "pretty" }}>{reason.detail}</p>
              </>
            )}
            {phase === "unavailable" && (
              <p className="text-sm text-white/70" style={{ textWrap: "pretty" }}>
                I can&rsquo;t reach my status log right now, which usually means the connection or the
                database is the problem. I&rsquo;ll keep checking.
              </p>
            )}
          </div>
        </section>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[2.75rem] rounded-xl bg-white px-6 text-base font-semibold text-black transition-opacity active:opacity-70 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={copyDetails}
            className="min-h-[2.75rem] rounded-xl border border-white/20 px-6 text-base font-medium text-white transition-opacity active:opacity-70 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {copied ? "Copied for Scout" : "Copy details for Scout"}
          </button>
        </div>

        <p className="mt-6 text-xs text-white/55">
          Checking again every 30{NBSP}seconds.{" "}
          <a href="/" className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            Back to home
          </a>
        </p>

        {error?.message && (
          <details className="mt-6 text-left">
            <summary className="min-h-[2.75rem] cursor-pointer py-3 text-sm text-white/55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              Technical details
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded-xl bg-white/[0.06] p-3 text-xs text-white/70 whitespace-pre-wrap break-words">
              {error.message}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}

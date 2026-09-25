/**
 * /admin/vesta - everything Vesta in one place: live health from the Scout watchdog
 * (vesta_admin_status: counts only, never post text) and every link Jared needs.
 * The watchdog itself is edge fn vesta-watchdog (cron every 10 min); see bestly_memory vesta/*.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { AlertTriangle, CheckCircle2, ExternalLink, HeartHandshake, Loader2, RefreshCw } from "lucide-react";
import { VestaInvites } from "./VestaInvites";

type Status = {
  release: string; deployment: string; last_run: string | null; paused: boolean;
  site: "ok" | string[] | null;
  db: { ok?: boolean; members?: number; pending?: number; reports_open?: number; crisis_open?: number; crisis_high_open?: number;
        posts_24h?: number; messages_24h?: number; codes_left?: number; error?: string } | null;
  issues: { key: string; title: string; severity: string; needs: string | null; opened_at: string }[];
};

const rpc = (fn: string) =>
  supabase.rpc(fn as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

const time12 = (iso: string | null) => iso
  ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  : "never";

type L = { label: string; url: string; note?: string };
const SECTIONS: { title: string; links: L[] }[] = [
  { title: "The app", links: [
    { label: "Vesta (the app women use)", url: "https://vesta-app.bestly.tech", note: "Sign in, then You > Admin to approve women and see the crisis queue" },
    { label: "Investor walkthrough", url: "https://vesta.bestly.tech", note: "Clickable demo, not the live app" },
  ]},
  { title: "Run it", links: [
    { label: "Supabase project (Vesta)", url: "https://supabase.com/dashboard/project/ulpdhwmjnmcbccluyhzg", note: "Database, Mumbai" },
    { label: "Supabase: users", url: "https://supabase.com/dashboard/project/ulpdhwmjnmcbccluyhzg/auth/users" },
    { label: "Supabase: sign-in email settings", url: "https://supabase.com/dashboard/project/ulpdhwmjnmcbccluyhzg/auth/smtp", note: "Sends through Resend" },
    { label: "Supabase: app releases", url: "https://supabase.com/dashboard/project/ulpdhwmjnmcbccluyhzg/storage/buckets/vesta-web" },
    { label: "Vercel: vesta-beta (the app)", url: "https://vercel.com/bestly/vesta-beta" },
    { label: "Vercel: vesta-walkthrough", url: "https://vercel.com/bestly/vesta-walkthrough" },
    { label: "Resend: sent emails", url: "https://resend.com/emails", note: "Free plan, 3,000/month shared with Studio + Turo" },
    { label: "Google Play Console", url: "https://play.google.com/console", note: "Android later; needs a closed-testing group" },
  ]},
  { title: "Plan", links: [
    { label: "To-dos (Bestly Ops board)", url: "https://cloud.bestly.tech/index.php/apps/deck/board/2" },
  ]},
];

function Stat({ n, label, warn }: { n: number | undefined; label: string; warn?: boolean }) {
  return (
    <div className={cn("min-w-[92px] flex-1 rounded-2xl p-3 ring-1", warn ? "bg-red-500/10 ring-red-500/40" : "bg-white/[0.03] ring-white/10")}>
      <div className={cn("text-2xl font-semibold", warn ? "text-red-300" : "text-white")}>{n ?? "—"}</div>
      <div className="mt-1 text-xs text-white/55">{label}</div>
    </div>
  );
}

export default function Vesta() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await rpc("vesta_admin_status");
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setErr(null); setS(data as Status);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60000); return () => clearInterval(t); }, [load]);

  const db = s?.db ?? null;
  const siteOk = s?.site === "ok";
  const allOk = !!s && siteOk && !!db?.ok && (s.issues?.length ?? 0) === 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Vesta" description="Women-only support app with Eli and Rohit. Health from the Scout watchdog, and every link."
        actions={<button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/80 ring-1 ring-white/15 hover:bg-white/5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh</button>} />

      {err && <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Could not load status: {err}</div>}

      {s && (
        <div className={cn("rounded-3xl p-5 ring-1", allOk ? "bg-emerald-500/[0.06] ring-emerald-500/25" : "bg-amber-500/[0.06] ring-amber-500/30")}>
          <div className="flex items-center gap-3">
            {allOk ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <AlertTriangle className="h-6 w-6 text-amber-300" />}
            <div>
              <div className="text-lg font-semibold text-white">{allOk ? "All good" : "Needs a look"}</div>
              <div className="text-xs text-white/55">Checked {time12(s.last_run)} · release {s.release}{s.paused ? " · watchdog paused" : ""}</div>
            </div>
          </div>
          {!siteOk && Array.isArray(s.site) && <ul className="mt-3 list-disc pl-6 text-sm text-amber-200">{s.site.map((x) => <li key={x}>{x}</li>)}</ul>}
          {db && !db.ok && <p className="mt-3 text-sm text-red-200">Database check failed: {db.error}</p>}
          {s.issues?.length > 0 && (
            <ul className="mt-3 space-y-2">{s.issues.map((i) => (
              <li key={i.key} className="rounded-xl bg-black/20 p-3 text-sm">
                <div className={cn("font-medium", i.severity === "error" ? "text-red-300" : "text-amber-200")}>{i.title}</div>
                {i.needs && <div className="mt-1 text-white/60">Needs you: {i.needs}</div>}
              </li>))}</ul>
          )}
          {db?.ok && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Stat n={db.crisis_open} label="crisis flags open" warn={(db.crisis_open ?? 0) > 0} />
              <Stat n={db.reports_open} label="reports open" warn={(db.reports_open ?? 0) > 0} />
              <Stat n={db.pending} label="women waiting" warn={(db.pending ?? 0) > 0} />
              <Stat n={db.members} label="members" />
              <Stat n={db.posts_24h} label="posts, 24 h" />
              <Stat n={db.messages_24h} label="messages, 24 h" />
              <Stat n={db.codes_left} label="invite codes left" />
            </div>
          )}
        </div>
      )}

      <VestaInvites />

      {SECTIONS.map((sec) => (
        <div key={sec.title} className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/50">{sec.title}</h2>
          <ul>{sec.links.map((l) => (
            <li key={l.url} className="border-b border-white/[0.06] last:border-0">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-3 hover:text-white">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] text-white">{l.label}</div>
                  <div className="truncate text-xs text-white/45">{l.url.replace(/^https:\/\//, "")}{l.note ? ` · ${l.note}` : ""}</div>
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-white/40" />
              </a>
            </li>))}</ul>
        </div>
      ))}

      <p className="flex items-center gap-2 text-xs text-white/45"><HeartHandshake className="h-4 w-4" />
        Crisis flags push to your phone through Scout within about 10 minutes. Agreed rule: a person looks within 2 hours.</p>
    </div>
  );
}

/**
 * /admin/playbook — what Scout has learned (scout_lessons).
 *
 * Lessons come from three places: the nightly reflect (what failed, then what worked), Scout
 * saving one mid-chat with its learn tool, and Jared teaching it ("remember that..."). Each one
 * carries a score: shown after a failure, did the next try work? Lessons that keep failing retire
 * themselves; Jared can switch any lesson on or off, or delete it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Binoculars, Power, Search, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { askScout } from "@/components/admin/scoutBus";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Lesson {
  id: string; scope: string; title: string; when_text: string; do_text: string; avoid_text: string | null;
  source: string; shown: number; wins: number; losses: number; active: boolean; updated_at: string; last_used_at: string | null;
}

const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const SOURCE: Record<string, string> = { reflect: "Learned overnight", scout: "Learned mid-chat", jared: "You taught it" };
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const d = (Date.now() - Date.parse(iso)) / 864e5;
  return d < 1 ? "today" : d < 2 ? "yesterday" : `${Math.round(d)} days ago`;
};

export default function AdminPlaybook() {
  const [rows, setRows] = useState<Lesson[] | null>(null);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all");
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("scout_lessons" as never).select("*").order("active", { ascending: false }).order("wins", { ascending: false }).order("updated_at", { ascending: false });
    setRows(((data ?? []) as unknown) as Lesson[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const scopes = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) { const k = r.scope.split(":")[0]; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const shown = (rows ?? []).filter((r) => (scope === "all" || r.scope.split(":")[0] === scope) &&
    (!q.trim() || `${r.scope} ${r.title} ${r.when_text} ${r.do_text}`.toLowerCase().includes(q.trim().toLowerCase())));
  const stats = useMemo(() => {
    const r = rows ?? [];
    return { active: r.filter((x) => x.active).length, wins: r.reduce((n, x) => n + x.wins, 0), shown: r.reduce((n, x) => n + x.shown, 0) };
  }, [rows]);

  const act = async (l: Lesson, what: "toggle" | "delete") => {
    const { error } = await supabase.rpc("scout_lesson_admin" as never, { p_id: l.id, p_active: what === "toggle" ? !l.active : null, p_delete: what === "delete" } as never);
    if (error) toast.error(error.message); else { toast.success(what === "delete" ? "Deleted" : l.active ? "Switched off" : "Switched on"); load(); }
  };
  const reflectNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("scout-daily", { body: { op: "reflect", days: 3 } });
    setRunning(false);
    if (error || data?.ok === false) toast.error(error?.message ?? data?.error ?? "Failed");
    else toast.success(`Looked back 3 days: ${data?.reflect?.learned ?? 0} learned`);
    load();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <PageHeader
        title="Scout's playbook"
        description="What Scout learned from things that failed and what fixed them. It checks these whenever a tool fails, and every Claude session can read them."
      />

      <section className="grid grid-cols-3 gap-3">
        {[["Lessons in use", stats.active], ["Times shown after a failure", stats.shown], ["Times the next try worked", stats.wins]].map(([k, v]) => (
          <div key={k as string} className={cn(card, "p-4")}>
            <p className="text-2xl font-semibold tabular-nums text-white">{v}</p>
            <p className="mt-0.5 text-xs text-white/50">{k}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lessons"
            className="h-10 w-full rounded-full border border-white/10 bg-white/[0.04] pl-9 pr-4 text-[16px] text-white outline-none placeholder:text-white/35 bento:bg-[#fff] bento:border-black/5" />
        </div>
        <button onClick={reflectNow} disabled={running} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/[0.08] px-4 text-sm font-medium text-white disabled:opacity-50">
          <Sparkles className={cn("h-4 w-4", running && "animate-pulse")} /> {running ? "Looking back…" : "Learn from the last 3 days"}
        </button>
        <button onClick={() => askScout("Remember this for next time: ", { fresh: true })} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/[0.08] px-4 text-sm font-medium text-white">
          <Binoculars className="h-4 w-4" /> Teach Scout
        </button>
      </div>

      {scopes.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {[["all", rows?.length ?? 0] as [string, number], ...scopes].map(([k, n]) => (
            <button key={k} onClick={() => setScope(k)}
              className={cn("rounded-full px-3 py-1.5 text-xs font-medium transition", scope === k ? "bg-white text-black bento:bg-[#111114] bento:text-[#fff]" : "bg-white/[0.06] text-white/70")}>
              {k === "all" ? "All" : k} · {n}
            </button>
          ))}
        </div>
      )}

      {rows === null ? <div className={cn(card, "h-40 animate-pulse")} /> : shown.length === 0 ? (
        <p className={cn(card, "px-5 py-4 text-white/60")}>{rows.length ? "No lessons match." : "Nothing learned yet. The first reflection runs tonight at 2am."}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((l) => (
            <li key={l.id} className={cn(card, "p-4 sm:p-5", !l.active && "opacity-50")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white/45">{l.scope}</p>
                  <p className="mt-0.5 text-[0.975rem] font-semibold text-white">{l.title}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => act(l, "toggle")} title={l.active ? "Switch off" : "Switch on"} className="grid h-9 w-9 place-items-center rounded-full text-white/55 hover:bg-white/[0.06]"><Power className="h-4 w-4" /></button>
                  <button onClick={() => act(l, "delete")} title="Delete" className="grid h-9 w-9 place-items-center rounded-full text-white/55 hover:bg-white/[0.06]"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div><dt className="inline font-medium text-white/55">When: </dt><dd className="inline text-white/80">{l.when_text}</dd></div>
                <div><dt className="inline font-medium text-emerald-300 bento:text-emerald-700">Do: </dt><dd className="inline text-white/85">{l.do_text}</dd></div>
                {l.avoid_text && <div><dt className="inline font-medium text-red-300 bento:text-red-700">Avoid: </dt><dd className="inline text-white/75">{l.avoid_text}</dd></div>}
              </dl>
              <p className="mt-2.5 text-xs text-white/40">
                {SOURCE[l.source] ?? l.source} · updated {ago(l.updated_at)}
                {l.shown > 0 ? ` · used ${l.shown}×, worked ${l.wins}` : ""}{!l.active ? " · switched off" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

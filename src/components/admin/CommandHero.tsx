/**
 * Command Center top (Jared): the same shape as Eli's partner Home.
 *   Greeting + Join next meeting (from the Nextcloud calendar via next-meeting) + what's coming up
 *   Your to-dos from calls (tick off in place)
 *   Quick actions: Ask Scout, Talk, Studio, Eli's portal
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Binoculars, CalendarClock, Check, ExternalLink, MessagesSquare, Users, Video } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { openScout } from "@/components/admin/scoutBus";
import { AdminMark } from "@/components/AdminMark";
import { useNextMeeting, whenLabel } from "@/pages/partner/PartnerExtras";
import { cn } from "@/lib/utils";

interface Todo { id: string; title: string; status: string; action: Record<string, any> }
const card = "rounded-[1.5rem] border border-white/[0.07] bg-white/[0.03] bento:border-transparent bento:bg-[#fff]";
const PT = { timeZone: "America/Los_Angeles" } as const;

export function CommandHero() {
  const { next, events } = useNextMeeting();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("scout_daily" as never).select("id, title, status, action").eq("kind", "call").eq("status", "open")
      .order("created_at", { ascending: false }).limit(60);
    setTodos(((data ?? []) as unknown as Todo[]).filter((t) => String(t.action?.owner ?? "jared").toLowerCase() === "jared"));
  }, []);
  useEffect(() => { load(); }, [load]);
  const tick = async (t: Todo) => {
    setTodos((xs) => (xs ?? []).filter((x) => x.id !== t.id));
    const { error } = await supabase.rpc("partner_task_set" as never, { p_id: t.id, p_status: "done" } as never);
    if (error) load();
  };

  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, ...PT }));
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const upcoming = events.filter((e) => e !== next).slice(0, 3);
  const joinUrl = next?.join_url ?? "https://cloud.bestly.tech/call/sm33w3fu";

  return (
    <section className="space-y-4" aria-label="Today at a glance">
      <div className={cn(card, "relative overflow-hidden p-5 sm:p-6")}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#0A84FF]/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <AdminMark className="h-14 w-14 shrink-0" />
            <div>
              <h2 className="text-[1.6rem] font-bold leading-tight tracking-tight text-white">{hello}, Jared</h2>
              <p className="text-sm text-white/55">
                {todos === null ? "…" : todos.length ? `${todos.length} to-do${todos.length === 1 ? "" : "s"} from calls` : "No call to-dos on you"}
                {next ? ` · next meeting ${whenLabel(next.start).toLowerCase()}` : ""}
              </p>
            </div>
          </div>
          <a href={joinUrl} target="_blank" rel="noreferrer"
            className="inline-flex min-h-12 items-center gap-2.5 rounded-2xl bg-emerald-500 px-5 py-2 text-[#fff] shadow-[0_8px_24px_-8px_rgba(16,185,129,0.6)] transition hover:bg-emerald-400 active:scale-[0.98]">
            <Video className="h-5 w-5 shrink-0" />
            <span className="text-left leading-tight">
              <span className="block font-semibold">{next ? "Join next meeting" : "Open the call room"}</span>
              <span className="block max-w-[16rem] truncate text-xs opacity-90">{next ? `${whenLabel(next.start)} · ${next.title}` : next === undefined ? "Checking your calendar…" : "Nothing on the calendar this week"}</span>
            </span>
          </a>
        </div>
        {upcoming.length > 0 && (
          <ul className="relative mt-5 grid gap-2 sm:grid-cols-3">
            {upcoming.map((e, i) => (
              <li key={i} className="flex items-center gap-2.5 rounded-2xl bg-white/[0.05] px-3 py-2.5 bento:bg-[#F3F2EE]">
                <CalendarClock className="h-4 w-4 shrink-0 text-white/45" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{e.title}</p>
                  <p className="text-xs text-white/50">{whenLabel(e.start)}</p>
                </div>
                {e.join_url && <a href={e.join_url} target="_blank" rel="noreferrer" aria-label={`Join ${e.title}`} className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500/15 text-emerald-300 bento:text-emerald-700"><Video className="h-4 w-4" /></a>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* One tight row, not a tall column of stretched buttons beside the to-dos. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Quick onClick={openScout} icon={Binoculars} label="Ask Scout" tone="from-slate-700 to-slate-900" />
        <Quick href="https://cloud.bestly.tech/apps/spreed" icon={MessagesSquare} label="Talk" tone="from-sky-400 to-blue-600" />
        <Quick href="https://studio.bestly.tech" icon={ExternalLink} label="Studio" tone="from-violet-500 to-fuchsia-500" />
        <Quick to="/partner" icon={Users} label="Eli's portal" tone="from-emerald-400 to-teal-600" />
      </div>

      <div className={cn(card, "p-5")}>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Check className="h-4 w-4 text-white/50" /> Your to-dos from calls</h3>
        {todos === null ? <div className="mt-3 h-16 animate-pulse rounded-xl bg-white/[0.04]" /> : todos.length === 0 ? (
          <p className="mt-2 text-sm text-white/50">All clear.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {todos.slice(0, 8).map((t) => (
              <li key={t.id} className="flex items-start gap-3 py-2.5">
                <button aria-label="Mark done" onClick={() => tick(t)}
                  className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-white/25 text-transparent transition hover:border-emerald-400 hover:text-emerald-400 active:scale-90">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <div className="min-w-0">
                  <p className="text-[0.95rem] text-white">{t.title}</p>
                  <p className="text-xs text-white/45">{t.action?.due ? `Due ${t.action.due} · ` : ""}{String(t.action?.meeting ?? "")}</p>
                </div>
              </li>
            ))}
            {todos.length > 8 && <li className="pt-2 text-xs text-white/45">+{todos.length - 8} more below in From calls</li>}
          </ul>
        )}
      </div>
    </section>
  );
}

function Quick({ href, to, onClick, icon: Icon, label, tone }: { href?: string; to?: string; onClick?: () => void; icon: typeof Video; label: string; tone: string }) {
  const cls = cn(
    "flex h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br px-3 text-sm font-semibold text-[#fff]",
    "shadow-sm transition hover:brightness-110 active:scale-[0.98]",
    tone,
  );
  const inner = <><Icon className="h-4 w-4 shrink-0" /><span className="truncate">{label}</span></>;
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>;
  return <button onClick={onClick} className={cls}>{inner}</button>;
}

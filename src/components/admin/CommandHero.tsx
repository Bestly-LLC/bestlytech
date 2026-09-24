/**
 * Command Center top (Jared): the same shape as Eli's partner Home.
 *   Greeting + Join next meeting (from the Nextcloud calendar via next-meeting) + what's coming up
 *   Your to-dos from calls (tick off in place)
 *   Quick actions: Emergency (one tap: EcoFlow to 100%, phone push, checklist), Ask Scout, Talk, Studio, Eli's portal
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Binoculars, CalendarClock, Check, ChevronDown, ExternalLink, Loader2, MessagesSquare, Siren, Users, Video, X } from "lucide-react";
import { startEmergency } from "@/pages/admin/Emergency";
import { supabase } from "@/integrations/supabase/client";
import { askScout, openScout } from "@/components/admin/scoutBus";
import { AdminMark } from "@/components/AdminMark";
import { WeatherNow } from "@/components/admin/WeatherNow";
import { useNextMeeting, whenLabel } from "@/pages/partner/PartnerExtras";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CheckAllPanel, CheckButton, CheckResult, ClosedByScout, useRemembered, useTodoCheck, type CheckRow } from "@/components/admin/todoCheck";

interface Todo { id: string; title: string; status: string; action: Record<string, any>; done_at?: string | null }

function NotifBanner() {
  const [perm, setPerm] = useState<NotificationPermission | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setPerm(Notification.permission);
  }, []);
  if (dismissed || perm !== "default") return null;
  const request = async () => {
    const result = await Notification.requestPermission();
    setPerm(result);
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm">
      <Bell className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
      <span className="flex-1 text-amber-100">Enable browser notifications so Scout can reach you even when this tab is in the background.</span>
      <button
        onClick={request}
        className="shrink-0 rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-300 active:scale-[0.97]"
      >
        Enable
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 rounded-full p-1 text-amber-300 hover:bg-white/10 transition"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
const card = "rounded-[1.5rem] border border-white/[0.07] bg-white/[0.03] bento:border-transparent bento:bg-[#fff]";
const PT = { timeZone: "America/Los_Angeles" } as const;

export function CommandHero() {
  const { next, events } = useNextMeeting();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [closed, setClosed] = useState<Todo[]>([]);
  const load = useCallback(async () => {
    const [{ data }, { data: shut }] = await Promise.all([
      supabase.from("scout_daily" as never).select("id, title, status, action").eq("kind", "call").eq("status", "open")
        .order("created_at", { ascending: false }).limit(60),
      // what Scout closed on its own lately, so a wrong one is one tap to put back
      supabase.from("scout_daily" as never).select("id, title, status, action, done_at").in("kind", ["call", "pick"]).eq("status", "done")
        .not("action->auto_closed", "is", null).gte("done_at", new Date(Date.now() - 3 * 864e5).toISOString()).order("done_at", { ascending: false }).limit(20),
    ]);
    setTodos(((data ?? []) as unknown as Todo[]).filter((t) => String(t.action?.owner ?? "jared").toLowerCase() === "jared"));
    setClosed((shut ?? []) as unknown as Todo[]);
  }, []);
  const tc = useTodoCheck(load);
  const [todosOpen, toggleTodos] = useRemembered("admin.todosCard.open", true);
  useEffect(() => { load(); }, [load]);
  const tick = async (t: Todo) => {
    setTodos((xs) => (xs ?? []).filter((x) => x.id !== t.id));
    const { error } = await supabase.rpc("partner_task_set" as never, { p_id: t.id, p_status: "done" } as never);
    if (error) { load(); return; }
    toast.success(`Done: ${t.title}`, {
      duration: 8000,
      action: { label: "Undo", onClick: async () => {
        await supabase.rpc("partner_task_set" as never, { p_id: t.id, p_status: "open" } as never);
        load();
      } },
    });
  };

  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, ...PT }));
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const upcoming = events.filter((e) => e !== next).slice(0, 3);
  const joinUrl = next?.join_url ?? "https://cloud.bestly.tech/call/sm33w3fu";

  return (
    <section className="space-y-4" aria-label="Today at a glance">
      <NotifBanner />
      <div className={cn(card, "relative overflow-hidden p-5 sm:p-6")}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[#0A84FF]/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
            <div className="flex items-center gap-3.5">
              <AdminMark className="h-14 w-14 shrink-0" />
              <div>
                <h2 className="text-[1.6rem] font-bold leading-tight tracking-tight text-white">{hello}, Jared</h2>
                <p className="text-sm text-white/55">
                  {todos === null ? "\u2026" : todos.length ? `${todos.length} to-do${todos.length === 1 ? "" : "s"} from calls` : "No call to-dos on you"}
                  {next ? ` \u00b7 next meeting ${whenLabel(next.start).toLowerCase()}` : ""}
                </p>
              </div>
            </div>
            {/* Beside the greeting, not under it: it is the second thing worth
                seeing up here, and at this size it reads without stopping. */}
            <WeatherNow />
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <EmergencyTile />
        <Quick onClick={openScout} icon={Binoculars} label="Ask Scout" tone="from-slate-700 to-slate-900" />
        <Quick href="https://cloud.bestly.tech/apps/spreed" icon={MessagesSquare} label="Talk" tone="from-sky-400 to-blue-600" />
        <Quick href="https://studio.bestly.tech" icon={ExternalLink} label="Studio" tone="from-violet-500 to-fuchsia-500" />
        <Quick to="/partner" icon={Users} label="Eli's portal" tone="from-emerald-400 to-teal-600" />
      </div>

      {/* Your to-dos, with Scout's "did it get done?" check right on top: it's the thing to use here. */}
      <div className={cn(card, "p-5")}>
        <h3 className={cn(todosOpen && "mb-3")}>
          <button onClick={toggleTodos} aria-expanded={todosOpen} aria-controls="hero-todos"
            className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-xl px-2 py-1 text-left text-sm font-semibold text-white transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/80">
            <Check className="h-4 w-4 text-white/50" aria-hidden />
            <span className="flex-1">Your to-dos from calls{todos?.length ? <span className="font-normal text-white/50"> · {todos.length}</span> : null}</span>
            <ChevronDown className={cn("h-4 w-4 text-white/50 transition-transform", !todosOpen && "-rotate-90")} aria-hidden />
          </button>
        </h3>
        {todosOpen && (<div id="hero-todos">
        <CheckAllPanel tc={tc} />
        {todos === null ? <div className="mt-3 h-16 animate-pulse rounded-xl bg-white/[0.04]" /> : todos.length === 0 ? (
          <p className="mt-3 text-sm text-white/50">All clear.</p>
        ) : (
          <ul className="mt-1 columns-[22rem] gap-x-8">
            {todos.slice(0, 12).map((t) => {
              const checking = tc.pending.has(t.id);
              return (
                <li key={t.id} className="break-inside-avoid border-b border-white/[0.06] py-3">
                  <div className="flex items-start gap-3">
                    <button aria-label="Mark done" onClick={() => tick(t)}
                      className="mt-px grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] border-white/30 text-transparent transition hover:border-[#30D158] hover:text-[#30D158] active:scale-90 bento:hover:border-[#34C759] bento:hover:text-[#34C759]">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.9375rem] leading-snug text-white">{t.title}</p>
                      <p className="mt-0.5 text-[0.75rem] text-white/40">{t.action?.due ? `Due ${t.action.due} · ` : ""}{String(t.action?.meeting ?? "")}</p>
                      {t.action?.check && !checking && <CheckResult r={t as CheckRow} tc={tc} onDone={() => tick(t)} onNext={(q) => askScout(q, { about: t.title })} />}
                    </div>
                    <CheckButton busy={checking} onClick={() => tc.checkOne(t.id)} />
                  </div>
                </li>
              );
            })}
            {todos.length > 12 && <li className="break-inside-avoid pt-2 text-xs text-white/45">+{todos.length - 12} more below in From calls</li>}
          </ul>
        )}
        <ClosedByScout rows={closed as CheckRow[]} tc={tc} />
        </div>)}
      </div>
    </section>
  );
}

/** One tap: charge the EcoFlow to 100%, buzz the phone, open the checklist. */
function EmergencyTile() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <Quick
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try { await startEmergency("general"); } catch { /* the page says what went wrong */ }
        setBusy(false);
        nav("/admin/emergency");
      }}
      icon={busy ? Loader2 : Siren}
      label={busy ? "Starting…" : "Emergency"}
      tone="from-red-500 to-red-700 col-span-2 sm:col-span-1"
    />
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

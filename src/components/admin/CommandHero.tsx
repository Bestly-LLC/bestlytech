/**
 * Command Center top (Jared): the same shape as Eli's partner Home.
 *   Greeting + Join next meeting (from the Nextcloud calendar via next-meeting) + the next few after it
 *   Quick actions: Emergency (one tap: EcoFlow to 100%, phone push, checklist), Ask Scout, Talk, Studio, Eli's portal
 * The call to-dos themselves live once, in Scout's "From your calls" list below; up here is just
 * the count, and tapping it jumps there.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Binoculars, ExternalLink, Loader2, MessagesSquare, Siren, Users, Video, X } from "lucide-react";
import { startEmergency } from "@/pages/admin/Emergency";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { openScout } from "@/components/admin/scoutBus";
import { AdminMark } from "@/components/AdminMark";
import { WeatherNow } from "@/components/admin/WeatherNow";
import { useNextMeeting, whenLabel } from "@/pages/partner/PartnerExtras";
import { cn } from "@/lib/utils";
import { IconButton, btnPrimary, btnTinted, cardCls, divider, focusRing, hairline, inset, rowCls, text, tint } from "@/components/admin/ui";

interface Todo { id: string; title: string; status: string; action: Record<string, any> }

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
    <div className={cn(cardCls, rowCls, "py-2 pr-2 sm:pr-3")}>
      <Bell className={cn("h-4 w-4 shrink-0", tint.orange)} aria-hidden />
      <p className={cn(text.title, "flex-1 font-normal")}>Turn on notifications so Scout can reach you.</p>
      <button type="button" onClick={request} className={cn(btnTinted, "px-4")}>Turn on</button>
      <IconButton label="Dismiss" onClick={() => setDismissed(true)}>
        <X className="h-4 w-4" aria-hidden />
      </IconButton>
    </div>
  );
}

const PT = { timeZone: "America/Los_Angeles" } as const;

function jumpToCalls() {
  const el = document.getElementById("calls");
  if (!el) return;
  el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  el.querySelector<HTMLElement>("h2")?.setAttribute("tabindex", "-1");
  el.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
}

export function CommandHero() {
  const { next, events } = useNextMeeting();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("scout_daily" as never).select("id, title, status, action").eq("kind", "call").eq("status", "open")
      .order("created_at", { ascending: false }).limit(60);
    setTodos(((data ?? []) as unknown as Todo[]).filter((t) => String(t.action?.owner ?? "jared").toLowerCase() === "jared"));
  }, []);
  // Same cadence as Scout's list below, so the count and the list agree within a minute.
  useEffect(() => {
    load();
    const iv = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", ...PT }));
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const upcoming = events.filter((e) => e !== next).slice(0, 3);
  const joinUrl = next?.join_url ?? "https://cloud.bestly.tech/call/sm33w3fu";
  const n = todos?.length ?? 0;

  return (
    <section className="space-y-3" aria-label="Today at a glance">
      <NotifBanner />
      <div className={cn(cardCls, "overflow-hidden")}>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <div className="flex items-center gap-3">
              <AdminMark className="h-12 w-12 shrink-0" />
              <div>
                <h2 className="text-[28px] font-bold leading-tight tracking-tight text-white">{hello}, Jared</h2>
                <p className={text.detail}>
                  {todos === null ? "…" : n ? (
                    <button type="button" onClick={jumpToCalls} className={cn("rounded font-medium underline-offset-2 hover:underline", tint.blue, focusRing)}>
                      {n} to-do{n === 1 ? "" : "s"} from calls
                    </button>
                  ) : "No call to-dos on you"}
                </p>
              </div>
            </div>
            {/* Beside the greeting, not under it: it is the second thing worth
                seeing up here, and at this size it reads without stopping. */}
            <WeatherNow />
          </div>

          {/* The one primary action up here. */}
          <a href={joinUrl} target="_blank" rel="noreferrer"
            className={cn(btnPrimary, "min-h-12 justify-start rounded-2xl px-4 py-2 sm:min-h-12")}>
            <Video className="h-5 w-5 shrink-0" aria-hidden />
            <span className="text-left leading-tight">
              <span className="block">{next ? "Join next meeting" : "Open the call room"}</span>
              <span className="block max-w-[16rem] truncate text-[13px] font-normal opacity-90">
                {next ? `${whenLabel(next.start)} · ${next.title}` : next === undefined ? "Checking your calendar…" : "Nothing this week"}
              </span>
            </span>
          </a>
        </div>
        {upcoming.length > 0 && (
          <ul className={cn("border-t", hairline, divider)} aria-label="Later">
            {upcoming.map((e, i) => (
              <li key={i} className={cn(rowCls, "py-2", e.join_url && "pr-2 sm:pr-3")}>
                <span className={cn(text.meta, "w-24 shrink-0")}>{whenLabel(e.start)}</span>
                <p className={cn(text.title, "min-w-0 flex-1 truncate font-normal")}>{e.title}</p>
                {e.join_url && (
                  <a href={e.join_url} target="_blank" rel="noreferrer" aria-label={`Join ${e.title}`} title={`Join ${e.title}`}
                    className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9 hover:bg-white/[0.06]", tint.blue, focusRing)}>
                    <Video className="h-4 w-4" aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* One quiet row. Only Emergency gets color. */}
      <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <EmergencyTile />
        <Quick onClick={openScout} icon={Binoculars} label="Ask Scout" />
        <Quick href="https://cloud.bestly.tech/apps/spreed" icon={MessagesSquare} label="Talk" />
        <Quick href="https://studio.bestly.tech" icon={ExternalLink} label="Studio" />
        <Quick to="/partner" icon={Users} label="Eli's portal" />
      </nav>
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
        // Swallowing this and navigating anyway made a failed emergency look like a started one,
        // which is the worst possible thing for this particular button to get wrong.
        try {
          await startEmergency("general");
        } catch (e) {
          setBusy(false);
          toast.error("Couldn't start it", { description: (e as Error).message });
          return;
        }
        setBusy(false);
        nav("/admin/emergency");
      }}
      icon={busy ? Loader2 : Siren}
      spin={busy}
      label={busy ? "Starting…" : "Emergency"}
      tone="col-span-2 bg-[#FF453A26] text-[#FF6961] hover:bg-[#FF453A40] bento:bg-[#FF3B301f] bento:text-[#D70015] bento:hover:bg-[#FF3B302e]"
    />
  );
}

function Quick({ href, to, onClick, icon: Icon, label, tone, spin }: {
  href?: string; to?: string; onClick?: () => void; icon: typeof Video; label: string; tone?: string; spin?: boolean;
}) {
  const cls = cn(
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 text-[15px] font-semibold transition active:scale-[0.97] sm:min-h-9",
    tone ?? "bg-white/[0.06] text-white hover:bg-white/[0.1]",
    focusRing,
  );
  const inner = <><Icon className={cn("h-4 w-4 shrink-0", spin && "animate-spin")} aria-hidden /><span className="truncate">{label}</span></>;
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>;
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

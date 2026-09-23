import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { playNotifySound } from "@/lib/notifySound";
import { AlertPane, type PaneAlert } from "@/components/admin/AlertPane";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle, Bell, BellOff, Briefcase, CheckCheck, CircleDollarSign, Cloud, FileSignature, ListChecks, Mail,
  Rocket, Snowflake, Store, Wrench, Binoculars, Check, Copy, Car, QrCode, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { copyForClaude } from "@/lib/copyForClaude";
import { enablePush, disablePush, sendTestPush, syncPushOnLoad, type PushState } from "@/lib/webPush";

/*
 * Header bell: admin_notifications, filled by database triggers (new leads from each funnel,
 * deal milestones, marketplace intakes, hire requests, messages, waitlist signups, Cookie Yeti
 * sites that need a hand). Realtime inserts pop a toast with an Open button. Clicking a
 * notification marks it read and goes to its tab or detail view.
 */

type Notification = {
  id: string;
  created_at: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  severity: "info" | "success" | "warning";
  read_at: string | null;
  entity_key?: string | null;
};

const KIND: Record<string, { icon: LucideIcon; tint: string; label: string }> = {
  lead_new: { icon: Cloud, tint: "bg-sky-400/15 text-sky-300", label: "In-House Cloud" },
  deal_deposit: { icon: CircleDollarSign, tint: "bg-emerald-400/15 text-emerald-300", label: "Deposit" },
  deal_signed: { icon: FileSignature, tint: "bg-emerald-400/15 text-emerald-300", label: "Signed" },
  deal_intake: { icon: Wrench, tint: "bg-fuchsia-400/15 text-fuchsia-300", label: "Tech intake" },
  deal_live: { icon: Rocket, tint: "bg-emerald-400/15 text-emerald-300", label: "Live" },
  intake_submitted: { icon: Store, tint: "bg-amber-400/15 text-amber-300", label: "Marketplace" },
  hire_new: { icon: Briefcase, tint: "bg-violet-400/15 text-violet-300", label: "Hire request" },
  contact_new: { icon: Mail, tint: "bg-indigo-400/15 text-indigo-300", label: "Message" },
  waitlist_new: { icon: ListChecks, tint: "bg-white/10 text-white/70", label: "Waitlist" },
  cy_needs_you: { icon: Snowflake, tint: "bg-cyan-400/15 text-cyan-300", label: "Cookie Yeti" },
  monitor: { icon: Wrench, tint: "bg-rose-400/15 text-rose-300", label: "Monitor" },
  scout: { icon: Binoculars, tint: "bg-white/10 text-white", label: "Scout" },
  "scout.push": { icon: Binoculars, tint: "bg-amber-400/15 text-amber-300", label: "Scout · sent to your phone" },
};
const kindMeta = (k: string) => KIND[k] ?? { icon: AlertTriangle, tint: "bg-white/10 text-white/70", label: "Update" };

// Sort alerts by what they're about, not who sent them: a Scout push about the LAX pass files under
// "LAX Parking Pass", Turo Watch runs under "Turo". Group drives the filter chips.
type Meta = { icon: LucideIcon; tint: string; label: string; group: string };
const TOPICS: { test: (n: Notification) => boolean; meta: Omit<Meta, "label"> & { label: string } }[] = [
  { test: (n) => /\/admin\/turo\/lax-pass/.test(n.url ?? "") || /\blax (parking|pass)|parking code|host pass/i.test(n.title),
    meta: { icon: QrCode, tint: "bg-teal-400/15 text-teal-300", label: "LAX Parking Pass", group: "Turo" } },
  { test: (n) => /\/admin\/turo/.test(n.url ?? "") || /\bturo\b/i.test(n.title),
    meta: { icon: Car, tint: "bg-orange-400/15 text-orange-300", label: "Turo", group: "Turo" } },
];
function metaFor(n: Notification): Meta {
  const topic = TOPICS.find((t) => t.test(n));
  if (topic) return { ...topic.meta, label: n.kind === "scout.push" ? `${topic.meta.label} · sent to your phone` : topic.meta.label };
  const k = kindMeta(n.kind);
  const group = n.kind.startsWith("scout") ? "Scout" : n.kind === "monitor" ? "Monitor" : n.kind === "cy_needs_you" ? "Cookie Yeti" : "Work";
  return { ...k, group };
}

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [items, setItems] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pane, setPane] = useState<PaneAlert | null>(null);
  // Desktop alerts (Web Push): the worker registers on every admin load; turning it on needs a click.
  const [push, setPush] = useState<PushState | "busy">("off");
  useEffect(() => { syncPushOnLoad().then(setPush); }, []);
  const togglePush = async () => {
    const was = push;
    setPush("busy");
    try {
      const next = was === "on" ? await disablePush() : await enablePush();
      setPush(next);
      if (next === "on" && was !== "on") toast.success("Desktop alerts are on", { description: "Scout's alerts now pop up even when this tab is closed." });
      if (next === "denied") toast.error("Notifications are blocked for bestly.tech", { description: "Allow them in the browser's site settings, then try again." });
    } catch (e) {
      setPush(was);
      toast.error("Couldn't turn on desktop alerts", { description: (e as Error).message });
    }
  };
  const testPush = async () => {
    const r = await sendTestPush();
    if (!r) toast.error("Test alert didn't send");
    else toast(`Test sent to ${r.sent} browser${r.sent === 1 ? "" : "s"}`, { description: r.failed ? `${r.failed} failed` : "It should pop up outside the browser." });
  };

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("admin_notifications" as any)
      .select("id, created_at, kind, title, body, url, severity, read_at, entity_key")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) { setLoadError(error.message); return; }
    setLoadError(null);
    setItems((data as unknown as Notification[]) ?? []);
  }, []);

  const go = useCallback(async (n: Notification) => {
    setOpen(false);
    if (!n.read_at) {
      const at = new Date().toISOString();
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: at } : x)));
      await supabase.from("admin_notifications" as any).update({ read_at: at } as any).eq("id", n.id).select("id");
    }
    // Open the alert in a reading pane with suggested next moves for Scout (it has a link to the page).
    setPane({ ...n, kindLabel: metaFor(n).label });
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("admin-notifications")
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "admin_notifications" }, (payload: any) => {
        const n = payload.new as Notification;
        setItems((xs) => [n, ...xs.filter((x) => x.id !== n.id)].slice(0, 50));
        playNotifySound();
        toast(n.title, {
          description: n.body ?? undefined,
          action: n.url ? { label: "Open", onClick: () => go(n) } : undefined,
        });
      })
      .on("postgres_changes" as any, { event: "UPDATE", schema: "public", table: "admin_notifications" }, (payload: any) => {
        const n = payload.new as Notification;
        setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: n.read_at } : x)));
      })
      .subscribe();
    const poll = window.setInterval(() => { if (!document.hidden) load(); }, 120_000);
    return () => { supabase.removeChannel(channel); window.clearInterval(poll); };
  }, [load, go]);

  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);
  const groups = useMemo(() => {
    const order = ["Turo", "Work", "Scout", "Monitor", "Cookie Yeti"];
    const present = new Set(items.map((n) => metaFor(n).group));
    return order.filter((g) => present.has(g));
  }, [items]);
  const shown = filter === "unread" ? items.filter((n) => !n.read_at)
    : filter === "all" ? items : items.filter((n) => metaFor(n).group === filter);

  const markAll = async () => {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    const at = new Date().toISOString();
    const { data, error } = await supabase.from("admin_notifications" as any).update({ read_at: at } as any).in("id", ids).select("id");
    if (error || !data?.length) { toast.error("Couldn't mark them read", { description: error?.message }); return; }
    setItems((xs) => xs.map((x) => (x.read_at ? x : { ...x, read_at: at })));
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
              className="relative h-8 w-8 grid place-items-center rounded-md text-white/60 hover:text-white hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[1.05rem] h-[1.05rem] px-1 rounded-full bg-red-500 text-[0.625rem] font-semibold leading-[1.05rem] text-white text-center tabular-nums">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" sideOffset={8} className="w-[min(24rem,calc(100vw-1rem))] p-0 border-white/10 bg-[#0b0d12] text-white overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <p className="text-sm font-semibold flex-1">Notifications</p>
          <button type="button" onClick={markAll} disabled={!unread}
            className="flex items-center gap-1 rounded-md px-2 h-8 text-xs text-white/65 hover:text-white disabled:opacity-40 disabled:hover:text-white/65">
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Mark all read
          </button>
        </div>
        {push !== "unsupported" && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-xs">
            <Bell className="h-3.5 w-3.5 flex-none text-white/55" aria-hidden="true" />
            <span className="flex-1 text-white/70">
              {push === "on" ? "Desktop alerts on" : push === "denied" ? "Desktop alerts blocked in browser settings" : "Desktop alerts off"}
            </span>
            {push === "on" && (
              <button type="button" onClick={testPush} className="h-7 rounded-md px-2 text-white/65 hover:text-white">Test</button>
            )}
            {push !== "denied" && (
              <button type="button" onClick={togglePush} disabled={push === "busy"}
                className={cn("h-7 rounded-md px-2.5 font-medium disabled:opacity-50", push === "on" ? "text-white/55 hover:text-white" : "bg-white text-black")}>
                {push === "on" ? "Turn off" : push === "busy" ? "…" : "Turn on"}
              </button>
            )}
          </div>
        )}
        <div className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]" role="group" aria-label="Show">
          {["all", "unread", ...groups].map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={cn("h-8 shrink-0 rounded-md px-2.5 text-xs", filter === f ? "bg-white/10 text-white" : "text-white/55 hover:text-white")}>
              {f === "all" ? "All" : f === "unread" ? `Unread${unread ? ` ${unread}` : ""}` : f}
            </button>
          ))}
        </div>

        <div className="max-h-[min(28rem,70vh)] overflow-y-auto border-t border-white/[0.06]">
          {loadError ? (
            <p className="px-4 py-6 text-sm text-red-200">Couldn't load notifications: {loadError}</p>
          ) : shown.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <BellOff className="h-6 w-6 text-white/30 mx-auto" aria-hidden="true" />
              <p className="mt-2 text-sm text-white/80">{filter === "unread" ? "All caught up" : "Nothing yet"}</p>
              <p className="mt-1 text-xs text-white/50">New leads, deposits, intakes and messages show up here.</p>
            </div>
          ) : (
            <ul>
              {shown.map((n) => {
                const k = metaFor(n);
                const Icon = k.icon;
                return (
                  <li key={n.id} className="group/row relative">
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        const ok = await copyForClaude(n.title, n.body, { Type: `${k.label} (${n.severity})`, Sent: new Date(n.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }), Link: n.url });
                        if (ok) { setCopied(n.id); setTimeout(() => setCopied((c) => (c === n.id ? null : c)), 1400); }
                      }}
                      aria-label="Copy this alert"
                      title="Copy to paste to Claude"
                      className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-lg border border-[#ffffff26] bg-[#26262c] text-[#e8e8ec] opacity-100 shadow-sm transition hover:bg-[#34343c] hover:text-[#ffffff] md:opacity-0 md:group-hover/row:opacity-100 focus-visible:opacity-100 bento:border-[#dcdad4] bento:bg-[#ffffff] bento:text-[#111114] bento:hover:bg-[#f3f2ee] bento:hover:text-[#111114]"
                    >
                      {copied === n.id ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                    <button type="button" onClick={() => go(n)}
                      className={cn("w-full text-left flex gap-3 px-4 py-3 border-b border-white/[0.05] hover:bg-white/[0.04] focus-visible:outline-none focus-visible:bg-white/[0.06]",
                        !n.read_at && "bg-white/[0.025]")}>
                      <span className={cn("mt-0.5 h-8 w-8 flex-none rounded-lg grid place-items-center", k.tint)}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <span className={cn("flex-1 text-sm leading-snug", n.read_at ? "text-white/75" : "font-semibold text-white")}>{n.title}</span>
                          {!n.read_at && <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-cyan-400" aria-label="Unread" />}
                        </span>
                        {n.body && <span className="mt-0.5 block text-xs text-white/55 line-clamp-2">{n.body}</span>}
                        <span className="mt-1 block text-[0.6875rem] text-white/40">{k.label} · {ago(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
      <AlertPane alert={pane} onClose={() => setPane(null)} />
    </Popover>
  );
}

import { useMemo, useState, type ComponentType } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, AudioLines, Binoculars, BookOpen, Bot, Brush, Briefcase, CalendarCheck, Car,
  CheckCircle2, ChevronRight, CircleDashed, CircleHelp, ClipboardCheck, Clapperboard, Cookie, Cpu, Crown,
  Database, Dog, Eye, GalleryHorizontal, GraduationCap, Hammer, HandHeart, Handshake, House, Image, Inbox,
  KeyRound, Landmark, Laptop, LineChart, ListChecks, ListTodo, Lock, Mail, MailPlus, Mails, Megaphone,
  MessageCircle, MessageSquareShare, Mic, Moon, NotebookPen, PauseCircle, PenLine, PhoneCall, PlaneLanding,
  Projector, Repeat, ScanEye, Search, Send, SendHorizontal, Server, ShieldCheck, Siren, Sparkles, SprayCan,
  Sunrise, Trash2, Users, Wrench, XCircle, ArrowUpRight, Network,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { AdminMark } from "@/components/AdminMark";
import { askScout } from "@/components/admin/scoutBus";
import { pollInterval } from "@/lib/polling";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { Sheet, btnPlain, btnPrimary, btnTinted, card, field, label, secondary, tertiary, tint } from "./laxUi";

/**
 * Team — the Bestly org chart. Jared on top, Scout as Chief of Staff, then each department.
 * Every card is live: it reads where each bot already logs (bestly_agents.pulse, see
 * supabase/migrations/20261004000000_org_chart.sql). team_watch (every 10 min) hands a bot that
 * goes quiet to the Fix Ladder / Scout as team.silent.<slug>; the Pi pings team_watch_ping to watch the watcher.
 */

type Health = "green" | "yellow" | "red" | "unknown" | "paused" | "planned";
type Issue = { key: string; title: string; severity: string; fix_stage: string | null; opened_at: string; needs_jared: string | null };
type Agent = {
  slug: string; name: string; role: string; what_it_does: string; dept: string; reports_to: string | null;
  kind: "human" | "agent" | "job" | "open_role"; status: "active" | "paused" | "planned" | "new";
  runs_on: string | null; schedule: string | null; admin_url: string | null; icon: string | null; private: boolean; sort: number;
  last_at: string | null; last_ok: boolean | null; summary: string | null; gap_min: number | null; on_demand: boolean;
  watched: boolean; source: string | null; issues: Issue[]; health: Health;
};
type Chart = { agents: Agent[]; checked_at: string | null; now: string };

const DEPTS: { key: string; title: string; blurb: string }[] = [
  { key: "scout", title: "Scout's team", blurb: "Helpers that work under your Chief of Staff." },
  { key: "ops", title: "Ops & Security", blurb: "Keeps everything running and fixes what breaks." },
  { key: "studio", title: "Studio & Marketing", blurb: "Posts, videos and client content." },
  { key: "turo", title: "Turo", blurb: "Guests, keys, the car and parking." },
  { key: "sales", title: "Sales & Clients", blurb: "Finding and answering customers." },
  { key: "mail", title: "Mail Room", blurb: "Moves and tidies your email." },
  { key: "home", title: "Home & Wall", blurb: "The Pi, the wall and the house." },
  { key: "desk", title: "Your Desk", blurb: "Personal errands." },
  { key: "unassigned", title: "New hires", blurb: "Bots that showed up on their own. Tap one to give it a place." },
];

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  crown: Crown, binoculars: Binoculars, moon: Moon, "calendar-check": CalendarCheck, "graduation-cap": GraduationCap,
  mic: Mic, "notebook-pen": NotebookPen, "audio-lines": AudioLines, handshake: Handshake, "list-checks": ListChecks,
  ladder: Network, activity: Activity, dog: Dog, wrench: Wrench, "shield-check": ShieldCheck, eye: Eye, database: Database,
  cpu: Cpu, server: Server, laptop: Laptop, users: Users, repeat: Repeat, sparkles: Sparkles, "pen-line": PenLine,
  hammer: Hammer, image: Image, "gallery-horizontal": GalleryHorizontal, send: Send, "spray-can": SprayCan,
  clapperboard: Clapperboard, cookie: Cookie, car: Car, "message-square-share": MessageSquareShare, "line-chart": LineChart,
  "book-open": BookOpen, "plane-landing": PlaneLanding, "key-round": KeyRound, "clipboard-check": ClipboardCheck,
  siren: Siren, brush: Brush, "mail-plus": MailPlus, search: Search, "phone-call": PhoneCall, house: House,
  "message-circle": MessageCircle, "hand-heart": HandHeart, sunrise: Sunrise, inbox: Inbox, "send-horizontal": SendHorizontal,
  mails: Mails, "trash-2": Trash2, "house-wifi": House, projector: Projector, "scan-eye": ScanEye, "list-todo": ListTodo,
  megaphone: Megaphone, landmark: Landmark, briefcase: Briefcase, mail: Mail,
};

const RUNS_ON: Record<string, string> = {
  pi: "Pi", mac_mini: "Mac mini", macbook: "MacBook", cloud: "Cloud", claude: "Claude", external: "Outside service", mac: "Mac",
};

const HEALTH: Record<Health, { word: string; icon: ComponentType<{ className?: string }>; text: string; dot: string }> = {
  green: { word: "Working", icon: CheckCircle2, text: tint.green, dot: "bg-[#30D158] bento:bg-[#34C759]" },
  yellow: { word: "Needs a look", icon: AlertTriangle, text: tint.orange, dot: "bg-[#FF9F0A] bento:bg-[#FF9500]" },
  red: { word: "Gone quiet", icon: XCircle, text: tint.red, dot: "bg-[#FF453A] bento:bg-[#FF3B30]" },
  unknown: { word: "No check-in yet", icon: CircleHelp, text: secondary, dot: "bg-[#8E8E93]" },
  paused: { word: "Paused", icon: PauseCircle, text: secondary, dot: "bg-[#8E8E93]" },
  planned: { word: "Open role", icon: CircleDashed, text: secondary, dot: "bg-transparent ring-1 ring-[#8E8E93]" },
};

const LA = "America/Los_Angeles";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: LA }).format(d);
const clock = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: LA, hour: "numeric", minute: "2-digit" }).format(d);

/** 12-hour, Pacific: "10:53 PM", "Yesterday 10:53 PM", "Oct 1, 1:17 AM". */
export function when(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const today = dayKey(new Date());
  const yest = dayKey(new Date(Date.now() - 86_400_000));
  const k = dayKey(d);
  if (k === today) return clock(d);
  if (k === yest) return `Yesterday ${clock(d)}`;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: LA, month: "short", day: "numeric" }).format(d)}, ${clock(d)}`;
}

/** Keep a number with its unit ("10 min", "9:30 AM", "40 checks") — never split across lines. */
export function nb(s: string | null | undefined): string {
  return (s ?? "").replace(/(\d)\s+(?=[A-Za-z%])/g, "$1 ");
}

function statusLine(a: Agent): string {
  if (a.kind === "human") return "That's you";
  if (a.health === "planned") return "Not hired yet";
  if (a.health === "paused") return "Paused — no alerts";
  if (!a.last_at) return a.source === "none" ? "Can't see this one from here" : "Waiting for its first check-in";
  return `${a.on_demand ? "Last worked" : "Last ran"} ${when(a.last_at)}`;
}

function sourceWords(a: Agent): string {
  switch (a.source) {
    case "pi_job": return "Reports every run to the Pi job list.";
    case "pi_any": return "Reads the newest run of all Pi jobs.";
    case "cron": return "Reads its last run in the database schedule.";
    case "cron_family": return "Reads the last run of every watchdog in the database schedule.";
    case "beat": return "Checks in by itself when it finishes a run.";
    case "at": return "Reads the timestamp it already writes when it works.";
    case "none": return "Lives outside Bestly, so it can't check in yet.";
    default: return "Nothing to check — it's a person or an open role.";
  }
}

function useChart() {
  return useQuery({
    queryKey: ["org-chart"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_org_chart" as never);
      if (error) throw error;
      return data as unknown as Chart;
    },
    refetchInterval: () => (document.hidden ? false : pollInterval(60_000)),
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    staleTime: 20_000,
  });
}

function AgentIcon({ a, size = "md" }: { a: Agent; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 rounded-[16px]" : "h-11 w-11 rounded-[13px]";
  if (a.slug === "scout") {
    return (
      <span className={cn(box, "grid shrink-0 place-items-center bg-[#0A84FF1f] bento:bg-[#007AFF14]")}>
        <AdminMark className={cn(size === "lg" ? "h-10 w-10" : "h-8 w-8", "text-[#fff] bento:text-[#000]")} label="Scout" />
      </span>
    );
  }
  const Icon = (a.icon && ICONS[a.icon]) || (a.kind === "human" ? Crown : Bot);
  const tone =
    a.kind === "human" ? "bg-[#FFD60A26] text-[#FFD60A] bento:bg-[#FFCC001f] bento:text-[#A05A00]"
      : a.health === "planned" ? "bg-transparent border border-dashed border-[#8E8E93] text-[#8E8E93]"
      : "bg-[#0A84FF1f] text-[#409CFF] bento:bg-[#007AFF14] bento:text-[#007AFF]";
  return (
    <span className={cn(box, "grid shrink-0 place-items-center", tone)}>
      <Icon className={size === "lg" ? "h-7 w-7" : "h-[22px] w-[22px]"} />
    </span>
  );
}

function HealthTag({ a }: { a: Agent }) {
  if (a.kind === "human") return null;
  const h = HEALTH[a.health] ?? HEALTH.unknown;
  const Icon = h.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium", h.text)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {a.status === "new" ? "New hire" : h.word}
    </span>
  );
}

/** One person/bot. `lead` = a department head or top-row card (bigger). */
function AgentCard({ a, onOpen, lead }: { a: Agent; onOpen: (a: Agent) => void; lead?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      className={cn(
        "group flex w-full min-h-[64px] items-start gap-3 rounded-[16px] p-3 text-left transition-colors duration-150",
        "hover:bg-[#ffffff0a] active:bg-[#ffffff12] bento:hover:bg-[#0000000a] bento:active:bg-[#00000012]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]",
        a.health === "planned" && "opacity-75",
      )}
      aria-label={`${a.name}, ${a.role}. ${HEALTH[a.health]?.word ?? ""}. ${statusLine(a)}`}
    >
      <AgentIcon a={a} size={lead ? "lg" : "md"} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cn("font-semibold", lead ? "text-[17px]" : "text-[15px]", label)}>{a.name}</span>
          <span className={cn("text-[13px]", secondary)}>{a.role}</span>
          {a.private && <Lock className={cn("h-3 w-3 self-center", tertiary)} aria-label="Private" />}
        </span>
        <span className={cn("mt-0.5 line-clamp-2 text-[13px] leading-snug", secondary)} style={{ textWrap: "pretty" } as never}>
          {nb(a.what_it_does)}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <HealthTag a={a} />
          <span className={cn("whitespace-nowrap text-[12px]", tertiary)}>{nb(statusLine(a))}</span>
          {a.runs_on && a.kind !== "human" && (
            <span className={cn("rounded-full bg-[#7676803d] px-2 py-0.5 text-[11px] font-medium bento:bg-[#7676801f]", secondary)}>
              {RUNS_ON[a.runs_on] ?? a.runs_on}
            </span>
          )}
          {a.status === "new" && (
            <span className="rounded-full bg-[#FF9F0A26] px-2 py-0.5 text-[11px] font-semibold text-[#FF9F0A] bento:text-[#C93400]">Place me</span>
          )}
        </span>
      </span>
      <ChevronRight className={cn("mt-3 h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100", tertiary)} aria-hidden />
    </button>
  );
}

/** Nest a department by reports_to (head first, then who reports to whom inside it). */
function nest(list: Agent[]): { a: Agent; depth: number }[] {
  const inDept = new Set(list.map((a) => a.slug));
  const kids = new Map<string, Agent[]>();
  const roots: Agent[] = [];
  for (const a of list) {
    if (a.reports_to && inDept.has(a.reports_to)) kids.set(a.reports_to, [...(kids.get(a.reports_to) ?? []), a]);
    else roots.push(a);
  }
  const out: { a: Agent; depth: number }[] = [];
  const walk = (a: Agent, d: number) => {
    out.push({ a, depth: d });
    for (const k of (kids.get(a.slug) ?? []).sort((x, y) => x.sort - y.sort)) walk(k, Math.min(d + 1, 2));
  };
  roots.sort((x, y) => x.sort - y.sort).forEach((r) => walk(r, 0));
  return out;
}

function Department({ title, blurb, list, onOpen, bossName }: { title: string; blurb: string; list: Agent[]; onOpen: (a: Agent) => void; bossName?: string }) {
  const rows = nest(list);
  const red = list.filter((a) => a.health === "red").length;
  const yellow = list.filter((a) => a.health === "yellow").length;
  return (
    <section className={cn(card, "flex flex-col p-3 sm:p-3")} aria-label={title}>
      <header className="flex items-start justify-between gap-3 px-3 pb-1 pt-2">
        <div className="min-w-0">
          <h2 className={cn("text-[17px] font-semibold", label)}>{title}</h2>
          <p className={cn("text-[13px] leading-snug", secondary)}>{blurb}{bossName && bossName !== "Scout" ? ` Reports to ${bossName}.` : ""}</p>
        </div>
        <span className={cn("shrink-0 whitespace-nowrap pt-1 text-[12px] font-medium", red ? tint.red : yellow ? tint.orange : tertiary)}>
          {red ? `${red} quiet` : yellow ? `${yellow} to look at` : `${list.length} bots`}
        </span>
      </header>
      <ul className="mt-1">
        {rows.map(({ a, depth }) => (
          <li key={a.slug} className={cn("relative", depth > 0 && "ml-5 border-l border-[#38383A] pl-2 bento:border-[#C6C6C8]", depth > 1 && "ml-10")}>
            <AgentCard a={a} onOpen={onOpen} lead={depth === 0 && list.length > 1} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Connector() {
  return <div aria-hidden className="mx-auto h-6 w-px bg-[#38383A] bento:bg-[#C6C6C8]" />;
}

/* ---------------------------------------------------------------- detail sheet */

function DetailSheet({ a, all, onClose }: { a: Agent | null; all: Agent[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Agent>>({});
  const [busy, setBusy] = useState(false);
  const open = !!a;
  const boss = a?.reports_to ? all.find((x) => x.slug === a.reports_to) : null;

  const startEdit = () => {
    if (!a) return;
    setDraft({ name: a.name, role: a.role, what_it_does: a.what_it_does, dept: a.dept === "unassigned" ? "" : a.dept, reports_to: a.reports_to, admin_url: a.admin_url });
    setEditing(true);
  };
  const close = () => { setEditing(false); onClose(); };

  const save = async (patch: Record<string, unknown>, done: string) => {
    if (!a) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("admin_agent_set" as never, { p_slug: a.slug, p_patch: patch } as never);
      if (error) throw error;
      toast.success(done);
      await qc.invalidateQueries({ queryKey: ["org-chart"] });
      setEditing(false);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "That didn't save");
    } finally {
      setBusy(false);
    }
  };

  if (!a) return <Sheet open={false} onClose={close} title="">{null}</Sheet>;
  const h = HEALTH[a.health] ?? HEALTH.unknown;
  const bosses = all.filter((x) => x.slug !== a.slug && x.health !== "planned");

  return (
    <Sheet open={open} onClose={close} title={editing ? `Edit ${a.name}` : a.name}
      footer={editing ? (
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={btnPlain} onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy || (a.status === "new" && !draft.dept)}
            onClick={() => save({ ...draft, dept: draft.dept || a.dept }, a.status === "new" ? `${draft.name || a.name} has a place now` : "Saved")}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      ) : undefined}>
      {!editing ? (
        <div className="space-y-5">
          <div className="flex items-start gap-4">
            <AgentIcon a={a} size="lg" />
            <div className="min-w-0">
              <p className={cn("text-[15px] font-medium", label)}>{a.role}</p>
              {boss && <p className={cn("text-[13px]", secondary)}>Reports to {boss.name}</p>}
              <p className={cn("mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium", h.text)}>
                <span className={cn("h-2 w-2 rounded-full", h.dot)} aria-hidden />
                {a.kind === "human" ? "Founder" : a.status === "new" ? "New hire" : h.word} · <span className={secondary}>{nb(statusLine(a))}</span>
              </p>
            </div>
          </div>

          <p className={cn("text-[15px] leading-relaxed", label)} style={{ textWrap: "pretty" } as never}>{nb(a.what_it_does)}</p>

          {a.kind !== "human" && (
            <dl className="divide-y divide-[#38383A] rounded-[14px] bg-[#2C2C2E] px-4 text-[15px] bento:divide-[#C6C6C8] bento:bg-[#fff]">
              <Row k="Runs on" v={a.runs_on ? RUNS_ON[a.runs_on] ?? a.runs_on : "—"} />
              <Row k="How often" v={nb(a.schedule) || "—"} />
              {a.gap_min && !a.on_demand ? <Row k="Quiet after" v={nb(gapWords(a.gap_min))} /> : null}
              <Row k="How we know" v={sourceWords(a)} />
              {a.summary && <Row k="Last said" v={nb(a.summary)} />}
              <Row k="Alerts" v={a.watched ? "Team Watch tells Scout if it goes quiet" : a.on_demand ? "Only works when asked, so silence is fine" : "Its own watchdog tells Scout"} />
            </dl>
          )}

          {a.issues.length > 0 && (
            <div className="space-y-2">
              <h4 className={cn("px-1 text-[13px] font-semibold uppercase tracking-[0.02em]", secondary)}>Open problems</h4>
              <ul className="space-y-2">
                {a.issues.map((i) => (
                  <li key={i.key} className="rounded-[14px] bg-[#2C2C2E] px-4 py-3 bento:bg-[#fff]">
                    <p className={cn("text-[15px] font-medium", label)}>{i.title}</p>
                    <p className={cn("text-[13px]", secondary)}>
                      Opened {when(i.opened_at)}{i.fix_stage ? ` · Fix Ladder: ${i.fix_stage.replace(/_/g, " ")}` : ""}
                    </p>
                    {i.needs_jared && <p className={cn("mt-1 text-[13px]", tint.orange)}>Needs you: {i.needs_jared}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {a.status === "new" && <button type="button" className={btnPrimary} onClick={startEdit}>Give it a place</button>}
            {a.admin_url && a.admin_url !== "/admin/team" && (
              <Link to={a.admin_url} className={btnTinted} onClick={close}>Open its page <ArrowUpRight className="h-4 w-4" /></Link>
            )}
            {a.kind !== "human" && (
              <button type="button" className={btnTinted} onClick={() => {
                close();
                askScout(`What's going on with ${a.name}?`, {
                  about: [`Bot: ${a.name} (${a.slug}), ${a.role}`, a.what_it_does, `Health: ${h.word}. ${statusLine(a)}`,
                    a.summary ? `Last said: ${a.summary}` : "", `Runs on ${a.runs_on ?? "?"}, ${a.schedule ?? ""}`,
                    ...a.issues.map((i) => `Open problem: ${i.key} — ${i.title}`)].filter(Boolean).join("\n"),
                });
              }}>
                <Binoculars className="h-4 w-4" /> Ask Scout
              </button>
            )}
          </div>

          {a.kind !== "human" && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#38383A] pt-3 bento:border-[#C6C6C8]">
              {a.status !== "new" && <button type="button" className={btnPlain} onClick={startEdit}>Edit</button>}
              {a.health !== "planned" && (
                <button type="button" className={cn(btnPlain, "text-[13px]")} disabled={busy}
                  onClick={() => save({ status: a.status === "paused" ? "active" : "paused" },
                    a.status === "paused" ? "Alerts are back on" : "Paused. No alerts until you turn it back on.")}>
                  {a.status === "paused" ? "Resume alerts" : "Pause alerts"}
                </button>
              )}
            </div>
          )}
          {a.kind !== "human" && a.health !== "planned" && (
            <p className={cn("text-[12px]", tertiary)}>Pausing only stops alerts. It doesn't stop the bot.</p>
          )}
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <Field name="Name"><input className={field} value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field name="Role"><input className={field} value={draft.role ?? ""} onChange={(e) => setDraft({ ...draft, role: e.target.value })} /></Field>
          <Field name="What it does"><textarea className={cn(field, "min-h-[88px]")} value={draft.what_it_does ?? ""} onChange={(e) => setDraft({ ...draft, what_it_does: e.target.value })} /></Field>
          <Field name="Department">
            <select className={field} value={draft.dept ?? ""} onChange={(e) => setDraft({ ...draft, dept: e.target.value })}>
              <option value="" disabled>Pick one</option>
              {DEPTS.filter((d) => d.key !== "unassigned").map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}
            </select>
          </Field>
          <Field name="Reports to">
            <select className={field} value={draft.reports_to ?? ""} onChange={(e) => setDraft({ ...draft, reports_to: e.target.value || null })}>
              <option value="">No one</option>
              {bosses.map((b) => <option key={b.slug} value={b.slug}>{b.name} — {b.role}</option>)}
            </select>
          </Field>
          <Field name="Its admin page (optional)"><input className={field} placeholder="/admin/…" value={draft.admin_url ?? ""} onChange={(e) => setDraft({ ...draft, admin_url: e.target.value })} /></Field>
        </form>
      )}
    </Sheet>
  );
}

function gapWords(m: number): string {
  if (m < 120) return `${m} min`;
  if (m < 2880) return `${Math.round(m / 60)} hours`;
  return `${Math.round(m / 1440)} days`;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className={cn("shrink-0", secondary)}>{k}</dt>
      <dd className={cn("min-w-0 text-right", label)} style={{ textWrap: "pretty" } as never}>{v}</dd>
    </div>
  );
}

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className={cn("px-1 text-[13px] font-medium", secondary)}>{name}</span>
      {children}
    </label>
  );
}

/* ---------------------------------------------------------------- page */

type Filter = "all" | "attention" | "new" | "open";

export default function Team() {
  const { data, isLoading, error, refetch, isFetching } = useChart();
  const [filter, setFilter] = useState<Filter>("all");
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const agents = useMemo(() => data?.agents ?? [], [data]);
  const bySlug = useMemo(() => new Map(agents.map((a) => [a.slug, a])), [agents]);
  const opened = openSlug ? bySlug.get(openSlug) ?? null : null;

  const counts = useMemo(() => {
    const bots = agents.filter((a) => a.kind !== "human");
    return {
      team: bots.filter((a) => a.health !== "planned").length,
      working: bots.filter((a) => a.health === "green").length,
      attention: bots.filter((a) => a.health === "red" || a.health === "yellow").length,
      fresh: bots.filter((a) => a.status === "new").length,
      open: bots.filter((a) => a.health === "planned").length,
      unknown: bots.filter((a) => a.health === "unknown").length,
    };
  }, [agents]);

  const keep = (a: Agent) =>
    filter === "all" ? true
      : filter === "attention" ? a.health === "red" || a.health === "yellow"
      : filter === "new" ? a.status === "new"
      : a.health === "planned";

  const jared = bySlug.get("jared");
  const scout = bySlug.get("scout");
  const watchStale = data?.checked_at ? Date.now() - new Date(data.checked_at).getTime() > 30 * 60_000 : false;

  const chips: { key: Filter; text: string; tone?: string; show: boolean }[] = [
    { key: "all", text: `${counts.team} on the team`, show: true },
    { key: "attention", text: `${counts.attention} need${counts.attention === 1 ? "s" : ""} a look`, tone: counts.attention ? tint.orange : undefined, show: true },
    { key: "new", text: `${counts.fresh} new hire${counts.fresh === 1 ? "" : "s"}`, tone: tint.orange, show: counts.fresh > 0 },
    { key: "open", text: `${counts.open} open role${counts.open === 1 ? "" : "s"}`, show: counts.open > 0 },
  ];

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 pb-16">
      <PageHeader
        title="Team"
        description="Everyone who works for Bestly — you, Scout, and the bots under them. Live."
        actions={
          <button type="button" className={btnTinted} onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Checking…" : "Check now"}
          </button>
        }
      />

      {error && !data && (
        <div className={cn(card, "flex items-center justify-between gap-3")}>
          <p className={cn("text-[15px]", label)}>Couldn't load the team. {(error as Error).message}</p>
          <button type="button" className={btnTinted} onClick={() => refetch()}>Try again</button>
        </div>
      )}

      {isLoading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className={cn(card, "h-56 animate-pulse")} />)}
        </div>
      ) : data ? (
        <>
          {/* summary: each phrase is a filter */}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter the team">
            {chips.filter((c) => c.show).map((c) => (
              <button key={c.key} type="button" onClick={() => setFilter(filter === c.key && c.key !== "all" ? "all" : c.key)}
                aria-pressed={filter === c.key}
                className={cn("min-h-[36px] rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                  filter === c.key ? "bg-[#636366] text-[#fff] bento:bg-[#000] bento:text-[#fff]" : "bg-[#7676803d] bento:bg-[#7676801f]",
                  filter !== c.key && (c.tone ?? label))}>
                {c.text}
              </button>
            ))}
            <span className={cn("ml-auto whitespace-nowrap text-[12px]", watchStale ? tint.orange : tertiary)}>
              {counts.working}&nbsp;working · Roll call {when(data.checked_at)}
            </span>
          </div>

          {/* top of the chart */}
          {filter === "all" && jared && scout && (
            <div className="mx-auto max-w-md">
              <div className={cn(card, "p-2")}><AgentCard a={jared} onOpen={(x) => setOpenSlug(x.slug)} lead /></div>
              <Connector />
              <div className={cn(card, "p-2 ring-[#0A84FF40] bento:ring-[#007AFF33]")}><AgentCard a={scout} onOpen={(x) => setOpenSlug(x.slug)} lead /></div>
              <Connector />
            </div>
          )}

          {/* departments */}
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {DEPTS.map((d) => {
              const list = agents.filter((a) => a.dept === d.key && keep(a));
              if (!list.length) return null;
              const head = list.find((a) => !a.reports_to || !list.some((x) => x.slug === a.reports_to));
              const boss = head?.reports_to ? bySlug.get(head.reports_to)?.name : undefined;
              return <Department key={d.key} title={d.title} blurb={d.blurb} list={list} bossName={boss} onOpen={(x) => setOpenSlug(x.slug)} />;
            })}
          </div>

          {filter !== "all" && !agents.some((a) => a.kind !== "human" && a.dept !== "top" && keep(a)) && (
            <div className={cn(card, "text-center")}>
              <p className={cn("text-[15px]", label)}>Nothing here right now.</p>
            </div>
          )}

          {counts.unknown > 0 && filter === "all" && (
            <p className={cn("px-1 text-[13px]", secondary)}>
              {counts.unknown}&nbsp;bots haven't checked in yet. Most run on a schedule and will show up after their next run.
            </p>
          )}
        </>
      ) : null}

      <DetailSheet a={opened} all={agents} onClose={() => setOpenSlug(null)} />
    </div>
  );
}

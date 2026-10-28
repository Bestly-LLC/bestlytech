/**
 * /admin/skill-inbox: Radar's Skill Inbox (Platform Analyst). STAGED 2026-10-27, matches the approved preview
 * (claude.ai/artifact/8h3mew3C4yrQFJhqrm18v2).
 *
 * Meta's Muse reads Jared's Instagram Saves and files each one here (edge function skill-inbox-mcp). A free Pi job watches each Reel,
 * pulls out the skill or tool, has Ares vet it, maps it to an AI employee or app and scores it. Radar shows at most 3 a day.
 *   Today's picks  one card each: what it does, where it fits, Ares safety check, cost, Add / Park / Skip / Watch the Reel.
 *                  Deciding collapses the card to a one-line receipt with Undo. All decided -> "That's it for today."
 *   Parked         everything else: saved, searchable, brought back the day it fits current work.
 * Buttons (2026-10-28, every one does something real):
 *   Cleared card  ONE primary "Install": Radar writes the Reel up as a Claude skill (free AI, Pi job), then BOTH Macs (Mac mini and MacBook Air)
 *                 drop it into ~/.claude/skills, then the Claude app offers it. The receipt says it is being written, then lists each Mac from
 *                 skill_inbox_claude_hosts. Undo works until a Mac has installed it.
 *   Flagged card  ONE primary "Send to Ares": decision 'ares' queues a REAL review (Pi job skill_inbox_ares on Clio, every 15 minutes: source,
 *                 GitHub facts, permissions, install commands, free AI). Cleared -> installs by itself. Blocked -> hidden. Unsure -> "Needs your call".
 *   Parked rows   the same Install / Send to Ares action, so parked saves do not have to wait for a daily pick.
 * Nothing third-party is ever installed or run. The skill text is written from the Reel, never from the tool.
 * Data: skill_inbox_today / skill_inbox_decide / skill_inbox_parked (admin only). Migration 20261027221500_skill_inbox.sql.
 * House rules: 12-hour times, a number never wraps away from its unit, no "..." truncation, 44px targets, dark + light (bento).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, Download, ExternalLink, Loader2, Play, Radar, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Lines } from "@/components/Lines";
import { PageHeader } from "@/components/admin/PageHeader";
import { cn } from "@/lib/utils";
import { btnPlain, card, field, label, secondary, tertiary, tint } from "./laxUi";
import { rpc, shortDay, shortTime } from "./settlementsShared";

export type Safe = "cleared" | "needs_look" | "blocked";
export type Decision = "add" | "park" | "skip" | "claude" | "ares" | null;
export type ClaudeStatus = "drafting" | "ready" | "installed" | "failed" | null;
export type AresStatus = "queued" | "reviewing" | "cleared" | "blocked" | "needs_call" | null;
export type HostRow = { host: string; status: "installed" | "failed" };
export type Pick = {
  id: string; reel_url: string; creator_handle: string | null; saved_at: string | null; received_at: string;
  title: string | null; what_it_does: string | null;
  fit_agent_slug: string | null; fit_label: string | null; fit_kind: "agent" | "app" | "idea" | "none" | null; fit_why: string | null;
  safe_status: Safe | null; safe_why: string | null; cost_label: string | null; cost_why: string | null;
  decision: Decision; surfaced_on: string | null; resurfaced_at: string | null; resurfaced_why: string | null;
  claude_status?: ClaudeStatus;
  ares_status?: AresStatus; ares_why?: string | null; hosts?: HostRow[];
};
export type Today = {
  day: string; picks: Pick[]; left: number; parked_count: number; picks_per_day: number;
  synced: { last_sync_at: string | null; last_post_at: string | null; next_sync_at: string | null; every_minutes: number };
  handled: { duplicates: number; off_topic: number; blocked: number };
  working: { waiting: number; failed: number };
};

/* A number and its unit never split across lines. */
const nb = (text: string) => <span className="whitespace-nowrap">{text}</span>;
const plural = (n: number, one: string, many = `${one}s`) => nb(`${n} ${n === 1 ? one : many}`);

/** "Scout" from "Scout · Code Worker". Buttons and receipts name the employee; the tile shows the full label. */
const who = (p: Pick) => (p.fit_label ?? "").split(" · ")[0].trim();

const violet = "bg-[#7C3AED] text-[#fff] hover:bg-[#8B5CF6] bento:bg-[#6D28D9] bento:hover:bg-[#5B21B6]";
const press = "transition-[transform,background-color,opacity] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA] focus-visible:ring-offset-2 focus-visible:ring-offset-[#000] bento:focus-visible:ring-offset-[#fff]";
const btnBase = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[12px] px-4 text-[15px] font-semibold disabled:opacity-40 disabled:active:scale-100";
const btnAdd = cn(btnBase, press, violet, "px-[18px]");
const btnQuiet = cn(btnBase, press, "bg-[#2C2C2E] text-[#fff] hover:bg-[#3A3A3C] bento:bg-[#7676801f] bento:text-[#000] bento:hover:bg-[#7676802e]");
const btnGhost = cn(btnBase, press, "text-[#EBEBF599] hover:bg-[#ffffff0d] bento:text-[#3C3C4399] bento:hover:bg-[#0000000a]");
const link = "inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-semibold text-[#A78BFA] hover:opacity-80 active:opacity-60 bento:text-[#6D28D9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A78BFA] rounded-md";
const tile = "flex flex-col gap-1 rounded-[14px] bg-[#2C2C2E] px-3.5 py-3 bento:bg-[#F2F2F7]";

const SAFE: Record<Safe, { word: string; cls: string; Icon: typeof Check }> = {
  cleared: { word: "Cleared", cls: tint.green, Icon: ShieldCheck },
  needs_look: { word: "Needs a look", cls: tint.orange, Icon: ShieldAlert },
  blocked: { word: "Blocked", cls: tint.red, Icon: ShieldAlert },
};

/** The two Macs that install a cleared skill (host names as the installers report them in skill_inbox_claude_hosts). */
const HOSTS = [{ key: "mac-mini", name: "Mac mini" }, { key: "macbook-air", name: "MacBook Air" }] as const;
const hostStatus = (p: Pick, key: string) => p.hosts?.find((h) => h.host === key)?.status ?? null;
const NB = " "; // a number and its unit never split across lines, also inside plain strings

/** Where a save is in its life: 'review' = with Ares, 'install' = being written or installed, null = waiting for a decision. */
const inFlight = (p: Pick) => p.decision === "ares" || p.decision === "claude";

/** The one primary action. Cleared saves install. Flagged saves go to a real Ares review. Reviewed-and-unsure ones wait for Jared's call. */
function PrimaryAction({ p, busy, onDecide }: { p: Pick; busy: boolean; onDecide: (d: Decision) => void }) {
  if (p.safe_status === "blocked" || p.ares_status === "needs_call") return null;
  if (p.safe_status === "cleared") {
    return (
      <button type="button" disabled={busy} onClick={() => onDecide("claude")} className={btnAdd} aria-label={`Install ${p.title ?? "this skill"}`}>
        <Download className="h-4 w-4" aria-hidden /> <span className="whitespace-nowrap">Install</span>
      </button>
    );
  }
  return (
    <button type="button" disabled={busy} onClick={() => onDecide("ares")} className={btnAdd} aria-label={`Send ${p.title ?? "this save"} to Ares`}>
      <ShieldCheck className="h-4 w-4" aria-hidden /> <span className="whitespace-nowrap">Send to Ares</span>
    </button>
  );
}

/** One plain line under the buttons: what the primary button will do. */
function helpLine(p: Pick): string | null {
  if (p.safe_status === "blocked" || p.ares_status === "needs_call") return null;
  if (p.safe_status === "cleared") return "Installs it in Claude Code on your Mac mini and MacBook Air, then offers it in the Claude app.";
  return "Ares checks who makes it and what it asks for. If it is clear, it installs by itself.";
}

/** The receipt after a choice. It only says what is true right now. */
function receipt(p: Pick): { text: string; dot: string } {
  if (p.decision === "claude") {
    const done = HOSTS.filter((h) => hostStatus(p, h.key) === "installed").map((h) => h.name);
    const left = HOSTS.filter((h) => hostStatus(p, h.key) !== "installed").map((h) => h.name);
    const pre = p.ares_status === "cleared" ? "Ares cleared it. " : "";
    if (done.length === HOSTS.length) return { text: `Installed on ${done.join(" and ")}. Next time you open a Claude chat, it offers to save it in the Claude app.`, dot: "bg-[#30D158]" };
    if (done.length > 0) return { text: `Installed on ${done.join(" and ")}. ${left.join(" and ")} is next, as soon as it is awake.`, dot: "bg-[#A78BFA]" };
    if (p.claude_status === "installed") return { text: "Installed in Claude Code. Next time you open a Claude chat, it offers to save it in the Claude app.", dot: "bg-[#30D158]" };
    if (p.claude_status === "failed") return { text: `${pre}The skill did not install. Radar flagged it and keeps the Reel safe. Undo and tap Install to try again.`, dot: "bg-[#FF9F0A]" };
    if (p.claude_status === "ready") return { text: `${pre}Installing. It is written and waiting for your Macs, usually under 5${NB}minutes.`, dot: "bg-[#A78BFA]" };
    return { text: `${pre}Installing. Radar is writing it.`, dot: "bg-[#A78BFA]" };
  }
  if (p.decision === "ares") {
    if (p.ares_status === "reviewing") return { text: "Ares is checking it now. If it is clear, it installs by itself.", dot: "bg-[#FF9F0A]" };
    return { text: `Sent to Ares. He checks who makes it and what it asks for within 15${NB}minutes. If it is clear, it installs by itself.`, dot: "bg-[#FF9F0A]" };
  }
  if (p.decision === "add") return { text: "Noted. Nothing installs by itself.", dot: "bg-[#8E8E93]" };
  if (p.decision === "park") return { text: "Parked. Radar will bring it back when it fits.", dot: "bg-[#A78BFA]" };
  return { text: "Skipped. Radar will not show this one again.", dot: "bg-[#8E8E93]" };
}

function savedWhen(p: Pick): string {
  const iso = p.saved_at ?? p.received_at;
  const d = Math.round((Date.parse(new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) + "T00:00:00Z") -
    Date.parse(new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) + "T00:00:00Z")) / 864e5);
  return d <= 0 ? "Today" : d === 1 ? "Yesterday" : d < 7 ? `${d} days ago` : shortDay(iso);
}

function PickCard({ p, busy, onDecide }: { p: Pick; busy: boolean; onDecide: (d: Decision) => void }) {
  const s = SAFE[p.safe_status ?? "needs_look"];
  const help = helpLine(p);
  return (
    <article className={cn(card, "flex animate-in fade-in flex-col gap-3.5 p-5 duration-300 motion-reduce:animate-none")} data-testid="skill-pick" aria-label={p.title ?? "Saved post"}>
      <div className="flex flex-col gap-1.5">
        <p className={cn("text-[12px] font-semibold uppercase tracking-[0.04em]", secondary)}>
          Saved Reel · {savedWhen(p)}{p.creator_handle ? <> · <span className="normal-case tracking-normal">@{p.creator_handle}</span></> : null}
        </p>
        <h3 className={cn("break-words text-[20px] font-semibold leading-[1.25] tracking-[-0.01em]", label)}>{p.title}</h3>
        <p className={cn("text-[15px] leading-relaxed", secondary)}><Lines>{p.what_it_does ?? ""}</Lines></p>
        {p.resurfaced_why && (
          <p className={cn("flex items-start gap-1.5 text-[13px] font-medium", tint.blue)}>
            <Radar className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span>Back today. <Lines>{p.resurfaced_why}</Lines></span>
          </p>
        )}
        {p.ares_status === "needs_call" && (
          <p className={cn("flex items-start gap-1.5 text-[14px] font-medium", tint.orange)} data-testid="skill-needs-call">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>Needs your call. Ares checked it and could not clear it: <Lines>{p.ares_why ?? "he could not decide"}</Lines> Nothing was installed.</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div className={tile}>
          <span className={cn("text-[12px]", secondary)}>Where it fits</span>
          <span className={cn("break-words text-[15px] font-semibold", label)}>{p.fit_label}</span>
          <span className={cn("text-[13px] leading-snug", secondary)}><Lines>{p.fit_why ?? ""}</Lines></span>
        </div>
        <div className={tile}>
          <span className={cn("text-[12px]", secondary)}>Ares safety check</span>
          <span className={cn("flex items-center gap-1.5 text-[15px] font-semibold", s.cls)}><s.Icon className="h-4 w-4 shrink-0" aria-hidden />{s.word}</span>
          <span className={cn("text-[13px] leading-snug", secondary)}><Lines>{p.safe_why ?? ""}</Lines></span>
        </div>
        <div className={tile}>
          <span className={cn("text-[12px]", secondary)}>Cost to run</span>
          <span className={cn("text-[15px] font-semibold", label)}>{p.cost_label}</span>
          <span className={cn("text-[13px] leading-snug", secondary)}><Lines>{p.cost_why ?? ""}</Lines></span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PrimaryAction p={p} busy={busy} onDecide={onDecide} />
          <button type="button" disabled={busy} onClick={() => onDecide("park")} className={btnQuiet}>Park</button>
          <button type="button" disabled={busy} onClick={() => onDecide("skip")} className={btnGhost}>Skip</button>
          <a href={p.reel_url} target="_blank" rel="noopener noreferrer" className={cn(link, "ml-auto")}>
            <Play className="h-4 w-4" aria-hidden /> <span className="whitespace-nowrap">Watch the Reel</span><span className="sr-only"> (opens Instagram)</span>
          </a>
        </div>
        {help && <p className={cn("text-[13px] leading-snug", secondary)}>{help}</p>}
      </div>
    </article>
  );
}

/** Per-Mac install status, shown once the skill is written. Each Mac installs on its own, so each gets its own line. */
function HostList({ p }: { p: Pick }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 pl-5" aria-label="Install status on each Mac">
      {HOSTS.map((h) => {
        const st = hostStatus(p, h.key);
        const Icon = st === "installed" ? Check : st === "failed" ? CircleAlert : Loader2;
        const cls = st === "installed" ? tint.green : st === "failed" ? tint.orange : secondary;
        return (
          <li key={h.key} className={cn("flex min-h-[28px] items-center gap-1.5 text-[14px]", cls)}>
            <Icon className={cn("h-4 w-4 shrink-0", !st && "animate-spin motion-reduce:animate-none")} aria-hidden />
            <span className={cn("font-medium", label)}>{h.name}</span>
            <span className="whitespace-nowrap">{st === "installed" ? "Installed" : st === "failed" ? "Could not install" : "Waiting"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Receipt({ p, busy, onUndo, showTitle }: { p: Pick; busy: boolean; onUndo: () => void; showTitle?: boolean }) {
  const r = receipt(p);
  const installed = p.decision === "claude" && (p.claude_status === "installed" || (p.hosts ?? []).some((h) => h.status === "installed"));
  const checking = p.decision === "ares" && p.ares_status === "reviewing";
  const hosts = p.decision === "claude" && p.claude_status !== "drafting" && p.claude_status !== null;
  return (
    <div className={cn("flex animate-in fade-in flex-col gap-2 rounded-[16px] bg-[#ffffff0a] px-4 py-2 duration-300 motion-reduce:animate-none bento:bg-[#0000000a]")} role="status" data-testid="skill-receipt">
      {showTitle && <span className={cn("break-words pt-1 text-[15px] font-semibold", label)}>{p.title}</span>}
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", r.dot)} aria-hidden />
        <span className={cn("min-w-[180px] flex-1 text-[15px]", label)}><Lines>{r.text}</Lines></span>
        {!installed && !checking && (
          <button type="button" disabled={busy} onClick={onUndo} className={cn(btnBase, press, "min-h-[44px] bg-transparent px-3.5 text-[14px] text-[#A78BFA] hover:bg-[#ffffff0d] bento:text-[#6D28D9] bento:hover:bg-[#0000000a]")}>Undo</button>
        )}
      </div>
      {hosts && <HostList p={p} />}
    </div>
  );
}

/** A parked save: the same Install / Send to Ares action as a pick, or its live receipt once it has been sent. */
function ParkedRow({ p, busy, onDecide }: { p: Pick; busy: boolean; onDecide: (d: Decision) => void }) {
  if (inFlight(p)) {
    return <li className="py-1.5"><Receipt p={p} busy={busy} onUndo={() => onDecide(null)} showTitle /></li>;
  }
  const help = helpLine(p);
  return (
    <li className="flex flex-col gap-1 border-t border-[#ffffff0f] py-2.5 bento:border-[#0000000f]" data-testid="skill-parked-row">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={cn("min-w-[180px] flex-1 break-words text-[15px]", label)}>{p.title}</span>
        <span className={cn("whitespace-nowrap text-[14px]", secondary)}>{p.fit_kind === "idea" ? "New app idea" : p.fit_kind === "none" || !who(p) ? "No fit yet" : `Fits ${who(p)}`}</span>
      </div>
      {p.ares_status === "needs_call" && (
        <p className={cn("flex items-start gap-1.5 text-[13px] font-medium", tint.orange)}>
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span>Needs your call. <Lines>{p.ares_why ?? "Ares could not decide."}</Lines></span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryAction p={p} busy={busy} onDecide={onDecide} />
        <a href={p.reel_url} target="_blank" rel="noopener noreferrer" className={cn(link, "min-w-[44px] justify-center")} aria-label={`Watch the Reel: ${p.title ?? "saved post"} (opens Instagram)`}><ExternalLink className="h-4 w-4" aria-hidden /></a>
        {help && <span className={cn("min-w-[200px] flex-1 text-[13px] leading-snug", secondary)}>{help}</span>}
      </div>
    </li>
  );
}

function syncLine(t: Today): { items: ReactNode[]; late: boolean } {
  const last = t.synced.last_sync_at;
  const hours = last ? (Date.now() - Date.parse(last)) / 36e5 : null;
  const late = hours !== null && hours > 6;
  const items: ReactNode[] = [nb("Synced from Instagram via Muse")];
  if (!last) items.push(<span key="w">Waiting for the first sync from Muse</span>);
  else {
    items.push(<span key="l" className="whitespace-nowrap">Last sync {shortTime(last)}</span>);
    if (late) items.push(<span key="late" className={cn("inline-flex items-center gap-1 whitespace-nowrap font-medium", tint.orange)}><CircleAlert className="h-3.5 w-3.5" aria-hidden />No sync for {Math.floor(hours as number)} hours</span>);
    else if (t.synced.next_sync_at) items.push(<span key="n" className="whitespace-nowrap">Next sync about {shortTime(t.synced.next_sync_at)}</span>);
  }
  return { items, late };
}

export default function SkillInbox() {
  const [t, setT] = useState<Today | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showParked, setShowParked] = useState(false);
  const [q, setQ] = useState("");
  const [parked, setParked] = useState<Pick[] | null>(null);
  const [parkedFailed, setParkedFailed] = useState(false);
  const qRef = useRef(q);
  qRef.current = q;

  const load = useCallback(async () => {
    const { data, error } = await rpc<Today>("skill_inbox_today");
    if (error || !data) { setFailed(true); return; }
    setFailed(false); setT(data);
  }, []);
  const loadParked = useCallback(async (text: string) => {
    const { data, error } = await rpc<Pick[]>("skill_inbox_parked", { p_q: text.trim() || null });
    if (qRef.current !== text) return;                       // a newer search is already running
    if (error || !data) { setParkedFailed(true); return; }
    setParkedFailed(false); setParked(data);
  }, []);

  // while a skill is being written or installed, check every 15 seconds so the receipt flips to "installed" on its own
  const pendingOf = (x: Pick) =>
    (x.decision === "claude" && x.claude_status !== "installed" && x.claude_status !== "failed" && !(x.hosts ?? []).some((h) => h.status === "installed")) ||
    (x.decision === "ares" && (x.ares_status === "queued" || x.ares_status === "reviewing"));
  const claudePending = !!t?.picks.some(pendingOf) || !!parked?.some(pendingOf);
  const showParkedRef = useRef(showParked);
  showParkedRef.current = showParked;
  useEffect(() => {
    const tick = () => { if (document.hidden) return; void load(); if (showParkedRef.current) void loadParked(qRef.current); };
    void load();
    const iv = setInterval(tick, claudePending ? 15_000 : 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", tick); };
  }, [load, loadParked, claudePending]);
  useEffect(() => {
    if (!showParked) return;
    const h = setTimeout(() => void loadParked(q), q ? 250 : 0);
    return () => clearTimeout(h);
  }, [showParked, q, loadParked, t?.parked_count]);

  const decide = async (p: Pick, d: Decision) => {
    setBusy(p.id);
    const before = t, beforeParked = parked;
    const patch = (x: Pick): Pick => (x.id !== p.id ? x : {
      ...x, decision: d,
      claude_status: d === "claude" ? (x.claude_status && x.claude_status !== "failed" ? x.claude_status : "drafting") : x.claude_status,
      ares_status: d === "ares" ? "queued" : x.ares_status === "queued" ? null : x.ares_status,
    });
    setT((cur) => cur && { ...cur, picks: cur.picks.map(patch), left: cur.picks.map(patch).filter((x) => x.decision === null).length });
    setParked((cur) => cur && cur.map(patch));
    const { error } = await rpc("skill_inbox_decide", { p_id: p.id, p_decision: d });
    setBusy(null);
    if (error) {
      setT(before); setParked(beforeParked);
      toast.error(error.message && error.message.length <= 90 ? error.message : "That didn't save. Try again.");
      return;
    }
    void load();
    if (showParked) void loadParked(qRef.current);
  };

  if (failed && !t) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <PageHeader title="Skill Inbox" description="Run by Radar, Platform Analyst" />
        <p className={cn("mt-6 flex flex-wrap items-center gap-2 text-[15px]", tint.orange)}><CircleAlert className="h-4 w-4" aria-hidden /> Couldn&rsquo;t load the Skill Inbox. <button type="button" className={btnPlain} onClick={() => void load()}>Try again</button></p>
      </div>
    );
  }
  if (!t) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <PageHeader title="Skill Inbox" description="Run by Radar, Platform Analyst" />
        <Loader2 className="mt-6 h-5 w-5 animate-spin text-white/50 bento:text-black/40" aria-label="Loading" />
      </div>
    );
  }

  const sync = syncLine(t);
  const allDone = t.picks.length > 0 && t.left === 0;
  const handled = [
    t.handled.duplicates > 0 ? <>{plural(t.handled.duplicates, "duplicate")} dropped quietly</> : "Duplicates dropped quietly",
    t.handled.off_topic > 0 ? <>{plural(t.handled.off_topic, "off-topic save")} ignored</> : "Off-topic saves ignored",
    t.handled.blocked > 0 ? <>{plural(t.handled.blocked, "scam")} blocked by Ares</> : "Nothing installs without Ares",
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pb-16 sm:px-6">
      <PageHeader title="Skill Inbox" description="Run by Radar, Platform Analyst" />

      <header className="space-y-3.5">
        <p className={cn("text-[17px] leading-snug", label)}><Lines>Radar watched your new Instagram saves and picked the ones worth your time. Everything else is parked, not lost.</Lines></p>
        <p className={cn("flex flex-wrap gap-x-4 gap-y-1 text-[13px]", secondary)}>{sync.items.map((i, k) => <span key={k}>{i}</span>)}</p>
        {t.working.waiting > 0 && <p className={cn("text-[13px]", secondary)}>Radar is reading {plural(t.working.waiting, "new save")} now.</p>}
        {t.working.failed > 0 && <p className={cn("flex items-center gap-1.5 text-[13px]", tint.orange)}><CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />{plural(t.working.failed, "save")} could not be read. Radar keeps retrying and will flag it.</p>}
      </header>

      <section aria-label="Today's picks" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className={cn("text-[20px] font-semibold tracking-[-0.01em]", label)}>Today&rsquo;s picks</h2>
          <span className={cn("text-[14px]", secondary)} aria-live="polite">{t.picks.length === 0 ? "None today" : t.left === 0 ? "All done" : nb(`${t.left} left`)}</span>
        </div>

        {t.picks.map((p) => p.decision === null
          ? <PickCard key={p.id} p={p} busy={busy === p.id} onDecide={(d) => void decide(p, d)} />
          : <Receipt key={p.id} p={p} busy={busy === p.id} onUndo={() => void decide(p, null)} />)}

        {t.picks.length === 0 && (
          <div className={cn(card, "space-y-1")}>
            <p className={cn("text-[17px] font-semibold", label)}>{t.synced.last_sync_at ? "No picks today." : "Nothing here yet."}</p>
            <p className={cn("text-[15px]", secondary)}><Lines>{t.synced.last_sync_at
              ? "Radar sends the next picks at 9:00 AM on the days something good comes in. Everything saved is in Parked below."
              : "Once Muse is set up, your Instagram Saves arrive here every 2 hours and Radar picks the best 3 a day."}</Lines></p>
          </div>
        )}
        {allDone && (
          <div className="flex flex-col gap-1.5 rounded-[20px] bg-[#30D15814] p-5 bento:bg-[#34C7591a]" role="status">
            <span className={cn("text-[17px] font-semibold", tint.green)}>That&rsquo;s it for today.</span>
            <span className={cn("text-[15px]", secondary)}><Lines>{`Radar sends the next ${t.picks_per_day} picks tomorrow at 9:00 AM. Nothing else needs you.`}</Lines></span>
          </div>
        )}
      </section>

      <section aria-label="Parked" className={cn(card, "space-y-2.5 !p-[18px_20px]")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={cn("text-[17px] font-semibold", label)}>Parked <span className={cn("font-medium", secondary)}>{plural(t.parked_count, "save")}</span></h2>
          <button type="button" aria-expanded={showParked} onClick={() => setShowParked((v) => !v)} className={btnQuiet}>{showParked ? "Hide" : "Show"}</button>
        </div>
        <p className={cn("text-[14px] leading-relaxed", secondary)}><Lines>Saved and searchable. Install one or send it to Ares right here, or wait for Radar to bring it back the day it fits something you&rsquo;re working on.</Lines></p>
        {showParked && (
          <div className="space-y-2">
            <label className="relative block">
              <span className="sr-only">Search parked saves</span>
              <Search className={cn("pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2", tertiary)} aria-hidden />
              <input type="search" inputMode="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parked saves" className={cn(field, "min-h-[44px] pl-10")} />
            </label>
            {parkedFailed && <p className={cn("flex items-center gap-2 text-[14px]", tint.orange)}><CircleAlert className="h-4 w-4" aria-hidden />Couldn&rsquo;t load the parked list. <button type="button" className={btnPlain} onClick={() => void loadParked(q)}>Try again</button></p>}
            {!parked && !parkedFailed && <Loader2 className="h-5 w-5 animate-spin text-white/50 bento:text-black/40" aria-label="Loading" />}
            {parked && parked.length === 0 && <p className={cn("py-2 text-[14px]", secondary)}>{q.trim() ? "Nothing parked matches that." : "Nothing parked yet."}</p>}
            {parked && parked.length > 0 && (
              <ul className="m-0 list-none p-0">
                {parked.map((p) => <ParkedRow key={p.id} p={p} busy={busy === p.id} onDecide={(d) => void decide(p, d)} />)}
              </ul>
            )}
          </div>
        )}
      </section>

      <footer className={cn("flex flex-wrap gap-x-5 gap-y-1 px-1 text-[13px]", secondary)} aria-label="Already handled">
        {handled.map((h, i) => <span key={i}>{h}</span>)}
      </footer>
    </div>
  );
}

/**
 * Calls for a template agent (replaces Maya's maya-admin list). Rows are agent_calls, filled by the post-call webhook and Switchboard's sync.
 *   "#12 · Today 4:04 PM · 3 min · (213) 555-0100", a title or summary, an unread dot, ticket chips, the Coach's score.
 *   Tap a row for the call sheet: transcript bubbles, recording, share, the Coach's review, mark unread, archive, delete.
 * Data: admin_agent_calls(slug, view), admin_agent_call(id), admin_agent_call_set(id, action). Delete only removes the row here; it never touches the voice platform.
 */
import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, ChevronRight, Loader2, PhoneIncoming, PhoneOutgoing, RefreshCw, Trash2, Globe, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtPhone } from "@/components/admin/roofguard/AvaShared";
import { CallNo, LiveTranscript, Recording, ShareCall, type Line } from "@/components/admin/roofguard/AvaCalls";
import { ScrollSheet } from "@/components/admin/roofguard/AvaSheet";
import { callLength, clock, dayWord, whenWords } from "@/components/admin/maya/mayaFormat";
import { AGENT_CHANGED, announceAgentChanged, boxCls, btnQuiet, ring, rpcArgs, type AgentInfo } from "./agentApi";

export type CallRow = {
  id: string; call_no: number | null; conversation_id: string; direction: "inbound" | "outbound" | "web"; phone: string | null; caller_name: string | null;
  started_at: string | null; duration_secs: number | null; status: string | null; summary: string | null; title: string | null; cost: number | null;
  has_audio: boolean; read_at: string | null; archived_at: string | null; score: number | null; tickets: string[];
};
type CallFull = CallRow & { transcript: Line[]; data: Record<string, unknown>;
  review: { score: number; went_well: string | null; fix: string | null } | null };

export const OPEN_CALL = "agent:open-call";
export const LIVE_ENDED = "agent:live-ended";
const NB = " ";
const chip = "inline-flex items-center whitespace-nowrap rounded-full bg-white/10 px-2 py-0.5 font-mono text-[12px] text-white/80";
const labelOf = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const h4 = "mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55";

export function useAgentCalls(slug: string) {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    const r = await rpcArgs<CallRow[]>("admin_agent_calls", { p_slug: slug, p_view: "all", p_lim: 50 });
    if (r.error) setErr("Couldn't load calls. Try again in a minute."); else { setRows(r.data ?? []); setErr(null); }
    setBusy(false);
  }, [slug]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60000);
    const h = (e: Event) => { if ((e as CustomEvent<string>).detail === slug) void load(); };
    const ended = (e: Event) => { if ((e as CustomEvent<string>).detail === slug) setTimeout(() => void load(), 6000); };   // the post-call webhook lands a few seconds later
    window.addEventListener(AGENT_CHANGED, h);
    window.addEventListener(LIVE_ENDED, ended);
    return () => { clearInterval(t); window.removeEventListener(AGENT_CHANGED, h); window.removeEventListener(LIVE_ENDED, ended); };
  }, [load, slug]);
  return { rows, err, busy, load, setRows };
}

/** Closed-state header text for the Messages column. */
export function callsSummary(rows: CallRow[] | null) {
  const todays = rows?.filter((c) => c.started_at && dayWord(c.started_at) === "Today") ?? null;
  const last = rows?.find((c) => c.started_at);
  const n = todays?.length ?? 0;
  const unread = rows?.filter((c) => !c.read_at).length ?? 0;
  const summary = !rows?.length ? "No calls yet"
    : `${n}${NB}${n === 1 ? "call" : "calls"} today${last?.started_at ? ` · last ${dayWord(last.started_at) === "Today" ? "" : `${dayWord(last.started_at)} `}${clock(last.started_at)}` : ""}${unread ? ` · ${unread} unread` : ""}`;
  return { summary, today: n, unread };
}

function DirIcon({ d }: { d: CallRow["direction"] }) {
  const I = d === "outbound" ? PhoneOutgoing : d === "web" ? Globe : PhoneIncoming;
  return <I className="h-4 w-4" aria-label={d === "web" ? "Web call" : d === "outbound" ? "Outgoing" : "Incoming"} />;
}

function Row({ c, onOpen }: { c: CallRow; onOpen: (c: CallRow) => void }) {
  const unread = !c.read_at;
  const who = c.caller_name || (c.phone ? fmtPhone(c.phone) : c.direction === "web" ? "Web call" : "Unknown caller");
  return (
    <button type="button" onClick={() => onOpen(c)}
      className={cn("block w-full rounded-2xl bg-white/[0.04] p-4 text-left ring-1 ring-white/10 hover:bg-white/[0.07] motion-safe:transition-transform motion-safe:duration-100 motion-safe:active:scale-[0.99]", ring)}>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-white/65">
        {unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-400" aria-hidden />}
        {unread && <span className="sr-only">Unread</span>}
        <DirIcon d={c.direction} />
        <CallNo n={c.call_no} />
        <span className="font-semibold text-white">{c.started_at ? whenWords(c.started_at) : "Time unknown"}</span>
        {c.duration_secs != null && <span className="whitespace-nowrap">{callLength(c.duration_secs)}</span>}
        <span className="whitespace-nowrap">{who}</span>
        {c.score != null && <span className="ml-auto whitespace-nowrap rounded-md bg-white/10 px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-white/80" aria-label={`Coach score ${c.score} out of 10`}>{c.score}/10</span>}
      </span>
      {c.title && <span className="mt-1.5 block text-[15px] font-semibold leading-snug text-white">{c.title}</span>}
      <span className={cn("block text-[15px] leading-snug text-white/80", c.title ? "mt-0.5" : "mt-1.5")}>{c.summary || "No summary yet. It shows up a minute after the call ends."}</span>
      {c.tickets.length > 0 && <span className="mt-2 flex flex-wrap gap-1.5">{c.tickets.map((code) => <span key={code} className={chip}>{code}</span>)}</span>}
    </button>
  );
}

function ArchivedRows({ slug, tick, onOpen }: { slug: string; tick: number; onOpen: (c: CallRow) => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const load = useCallback(async () => {
    const r = await rpcArgs<CallRow[]>("admin_agent_calls", { p_slug: slug, p_view: "archived", p_lim: 50 });
    setRows(r.error ? [] : r.data ?? []);
  }, [slug]);
  useEffect(() => { if (open) void load(); }, [open, load, tick]);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={cn("flex min-h-[44px] w-full items-center gap-2 rounded-2xl px-3 text-left text-[15px] font-medium text-white/75 hover:bg-white/[0.05] hover:text-white", ring)}>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-white/55 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
        <span className="whitespace-nowrap">Archived{rows ? ` · ${rows.length}` : ""}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {rows === null && <div className="h-[92px] rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />}
          {rows?.length === 0 && <p className={boxCls}>Nothing archived.</p>}
          {rows?.map((c) => <Row key={c.id} c={c} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

export function AgentCallsList({ agent, rows, err, busy, load, setRows }:
  { agent: AgentInfo; rows: CallRow[] | null; err: string | null; busy: boolean; load: () => Promise<void>; setRows: (f: (r: CallRow[] | null) => CallRow[] | null) => void }) {
  const [open, setOpen] = useState<CallRow | null>(null);
  const [detail, setDetail] = useState<CallFull | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [ask, setAsk] = useState(false);
  const [acting, setActing] = useState(false);

  const openCall = useCallback(async (c: CallRow) => {
    setOpen(c); setDetail(null); setDetailErr(null); setAsk(false);
    if (!c.read_at) {                                    // opening a call reads it
      setRows((rs) => rs && rs.map((x) => (x.id === c.id ? { ...x, read_at: new Date().toISOString() } : x)));
      void rpcArgs("admin_agent_call_set", { p_id: c.id, p_action: "read" }).then(() => announceAgentChanged(agent.slug));
    }
    const r = await rpcArgs<CallFull>("admin_agent_call", { p_id: c.id });
    if (r.error || !r.data) setDetailErr("Couldn't load that call. Try again in a minute."); else setDetail(r.data);
  }, [agent.slug, setRows]);

  // The Coach's review rows open the same sheet.
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const c = rows?.find((x) => x.id === id);
      if (c) void openCall(c);
      else void rpcArgs<CallFull>("admin_agent_call", { p_id: id }).then((r) => { if (r.data) void openCall(r.data); });
    };
    window.addEventListener(OPEN_CALL, h);
    return () => window.removeEventListener(OPEN_CALL, h);
  }, [rows, openCall]);

  const act = async (action: "unread" | "archive" | "unarchive" | "delete") => {
    if (!open) return;
    setActing(true);
    const r = await rpcArgs("admin_agent_call_set", { p_id: open.id, p_action: action });
    setActing(false);
    if (r.error) { toast.error("Couldn't do that. Try again."); return; }
    const done = { unread: "Marked unread", archive: "Archived", unarchive: "Moved back to calls", delete: "Deleted from this page" }[action];
    toast.success(done);
    setOpen(null); setAsk(false); setTick((n) => n + 1);
    announceAgentChanged(agent.slug);
    await load();
  };

  const who = (c: CallRow) => c.caller_name || (c.phone ? fmtPhone(c.phone) : c.direction === "web" ? "Web call" : "Unknown caller");
  const data = detail ? Object.entries(detail.data ?? {}).filter(([k, v]) => k !== "coach_skip" && v !== null && v !== "") : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[14px] text-white/60">Tap a call for the transcript and recording.</p>
        <button type="button" onClick={() => void load()} disabled={busy} className={cn(btnQuiet, "shrink-0")}>
          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden />Refresh
        </button>
      </div>

      {err && (
        <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
          <p>{err}</p>
          <button type="button" onClick={() => void load()} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button>
        </div>
      )}
      {rows === null && !err && Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[92px] rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />)}
      {rows?.length === 0 && <p className={boxCls}>No calls yet.</p>}
      {rows?.map((c) => <Row key={c.id} c={c} onOpen={(x) => void openCall(x)} />)}
      <ArchivedRows slug={agent.slug} tick={tick} onOpen={(x) => void openCall(x)} />

      <ScrollSheet open={!!open} onClose={() => { setOpen(null); setAsk(false); }}
        title={<>{open?.call_no != null && <CallNo n={open.call_no} />}{open?.started_at ? whenWords(open.started_at) : "Call"}</>}
        description={open ? [who(open), callLength(open.duration_secs)].filter(Boolean).join(" · ") : undefined}>
        {detailErr && <p role="alert" className="rounded-xl bg-amber-500/10 p-3 text-[15px] text-amber-100">{detailErr}</p>}
        {!detail && !detailErr && <div className="h-40 rounded-2xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden />}
        {detail && open && (
          <div className="space-y-5 pb-4">
            {detail.review && (
              <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
                <h4 className={h4}>Coach review</h4>
                <p className="text-[15px] text-white"><span className="font-semibold tabular-nums">{detail.review.score}/10</span></p>
                {detail.review.went_well && <p className="mt-1.5 text-[14px] leading-snug text-white/80"><span className="text-emerald-300">Went well</span>{" · "}{detail.review.went_well}</p>}
                {detail.review.fix && <p className="mt-1 text-[14px] leading-snug text-white/80"><span className="text-amber-200">Next time</span>{" · "}{detail.review.fix}</p>}
              </div>
            )}
            {detail.tickets?.length > 0 && (
              <div><h4 className={h4}>Tickets filed</h4><div className="flex flex-wrap gap-1.5">{detail.tickets.map((code) => <span key={code} className={chip}>{code}</span>)}</div></div>
            )}
            {detail.summary && <div><h4 className={h4}>Summary</h4><p className="text-[15px] leading-snug text-white/90">{detail.summary}</p></div>}
            {data.length > 0 && (
              <div>
                <h4 className={h4}>Collected on the call</h4>
                <dl className="space-y-1.5 text-[14px]">
                  {data.map(([k, v]) => (
                    <div key={k} className="flex flex-wrap gap-x-2">
                      <dt className="text-white/55">{labelOf(k)}</dt>
                      <dd className="break-words text-white/90">{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {detail.has_audio && <div><h4 className={h4}>Recording</h4><Recording callId={detail.id} fn="agent-hub" /></div>}
            <ShareCall callId={detail.id} fn="agent-hub" callNo={detail.call_no} lines={detail.transcript ?? []} hasRecording={detail.has_audio} agent={agent.name} />
            <div>
              <h4 className={h4}>Transcript</h4>
              <LiveTranscript lines={detail.transcript ?? []} inline agent={agent.name} them="Caller" />
            </div>

            <div className="space-y-2 border-t border-white/10 pt-4">
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={acting} onClick={() => void act("unread")} className={btnQuiet}><EyeOff className="h-4 w-4" aria-hidden />Mark unread</button>
                {open.archived_at
                  ? <button type="button" disabled={acting} onClick={() => void act("unarchive")} className={btnQuiet}><ArchiveRestore className="h-4 w-4" aria-hidden />Move back</button>
                  : <button type="button" disabled={acting} onClick={() => void act("archive")} className={btnQuiet}><Archive className="h-4 w-4" aria-hidden />Archive</button>}
              </div>
              {!ask ? (
                <button type="button" onClick={() => setAsk(true)} className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-[15px] font-medium text-red-300 hover:bg-red-500/10", ring)}>
                  <Trash2 className="h-4 w-4" aria-hidden />Delete this call</button>
              ) : (
                <div role="alert" className="rounded-2xl bg-red-500/10 p-4 ring-1 ring-red-500/30">
                  <p className="text-[15px] text-red-100">Delete call {open.call_no != null ? `#${open.call_no}` : ""} from this page? Its transcript and notes go away here. The recording stays on the voice platform.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={acting} onClick={() => void act("delete")} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-red-500 px-4 text-[15px] font-semibold text-white hover:bg-red-400 disabled:opacity-50">
                      {acting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Delete</button>
                    <button type="button" disabled={acting} onClick={() => setAsk(false)} className={btnQuiet}>Keep it</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </ScrollSheet>
    </div>
  );
}

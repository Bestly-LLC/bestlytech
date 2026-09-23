/**
 * Scout for partners (the Scout tab). Free: answers come from the local model on Jared's Mac mini
 * (scripts/partner-ai/worker.py), not a paid API, so an answer can take a little while.
 *
 * usePartnerScout() lives in the portal shell, not the tab, so the conversation keeps updating while
 * Eli is elsewhere in the portal. When Scout finishes and he isn't looking, ScoutAlert pops up
 * ("Scout answered · Open"), the tab gets a dot, the browser tab title changes, and (if he allowed it)
 * a system notification fires. Coming back later, anything answered while he was away is flagged too.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Bell, Loader2, MessagesSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/CopyText";
import { AdminMark } from "@/components/AdminMark";
import { cn } from "@/lib/utils";
import { playNotifySound, playSuccessSound } from "@/lib/notifySound";
import { reportToScout } from "@/lib/reportToScout";
import { showLocalNotification, registerServiceWorker, enablePush, syncPushOnLoad } from "@/lib/webPush";
import { useStickToBottom } from "@/lib/useStickToBottom";

export interface ScoutMsg { id: string; role: "user" | "assistant"; content: string; status: "pending" | "working" | "done" | "error"; reply_to: string | null; created_at: string; updated_at?: string }

export const SCOUT_IDEAS = [
  "What did Jared and I decide on our last call?",
  "What's on my plate this week?",
  "Where are the In-House Cloud deals at?",
  "Draft a short intro email I can send to a potential partner",
];

const SEEN_KEY = "bestly-partner-scout-seen";
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) ?? ""; } catch { return ""; } };

/* ───────── state, shared by the whole portal ───────── */

export interface ScoutThread { id: string; title: string; created_at: string; updated_at: string }
const ACTIVE_KEY = "bestly-partner-scout-thread";
const seenMap = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(SEEN_KEY + "-map") ?? "{}"); } catch { return {}; } };

export function usePartnerScout(userId: string, viewing: boolean) {
  const [msgs, setMsgs] = useState<(ScoutMsg & { thread_id?: string | null })[] | null>(null);
  const [threads, setThreads] = useState<ScoutThread[]>([]);
  const [active, setActiveState] = useState<string | null>(() => { try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; } });
  const [online, setOnline] = useState<boolean | null>(null);
  const [seen, setSeen] = useState<Record<string, string>>(() => ({ ...seenMap() }));
  const legacySeen = useMemo(readSeen, []);
  const [alert, setAlert] = useState<(ScoutMsg & { thread_id?: string | null }) | null>(null);
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;
  const activeRef = useRef(active);
  activeRef.current = active;
  const firstLoad = useRef(true);

  const setActive = useCallback((id: string | null) => {
    setActiveState(id);
    try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); } catch { /* ok */ }
  }, []);

  const load = useCallback(async () => {
    const [{ data: m }, { data: t }] = await Promise.all([
      supabase.from("partner_chat" as never).select("id, role, content, status, reply_to, created_at, updated_at, thread_id").order("created_at", { ascending: true }).limit(500),
      supabase.from("partner_chat_threads" as never).select("id, title, created_at, updated_at").order("updated_at", { ascending: false }).limit(100),
    ]);
    setMsgs((m ?? []) as unknown as ScoutMsg[]);
    const th = (t ?? []) as unknown as ScoutThread[];
    setThreads(th);
    // Remembered conversation gone? Open the newest one.
    if (activeRef.current && !th.some((x) => x.id === activeRef.current)) setActive(th[0]?.id ?? null);
    if (!firstLoad.current) return;
    firstLoad.current = false;
    if (!activeRef.current && th.length) setActive(th[0].id);
  }, [setActive]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`partner-scout-${userId}`)
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "partner_chat", filter: `user_id=eq.${userId}` } as never,
        (p: { eventType: string; new: ScoutMsg & { thread_id?: string }; old: { id: string; status?: string } }) => {
          setMsgs((cur) => {
            const list = cur ?? [];
            if (p.eventType === "DELETE") return list.filter((m) => m.id !== p.old.id);
            const i = list.findIndex((m) => m.id === p.new.id);
            if (i === -1) return [...list, p.new].sort((a, b) => a.created_at.localeCompare(b.created_at));
            const next = list.slice(); next[i] = { ...list[i], ...p.new }; return next;
          });
          const lookingAtIt = viewingRef.current && !document.hidden && p.new.thread_id === activeRef.current;
          const finished = p.eventType === "UPDATE" && p.new.role === "assistant" && (p.new.status === "done" || p.new.status === "error")
            && p.old?.status !== p.new.status;
          if (finished) (p.new.status === "done" ? playSuccessSound : playNotifySound)(); // same sounds as Scout in the admin
          if (finished && !lookingAtIt) {
            setAlert(p.new);
            notify(p.new);
          }
        })
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "partner_chat_threads", filter: `user_id=eq.${userId}` } as never,
        (p: { eventType: string; new: ScoutThread; old: { id: string } }) => {
          setThreads((cur) => {
            if (p.eventType === "DELETE") return cur.filter((t) => t.id !== p.old.id);
            const rest = cur.filter((t) => t.id !== p.new.id);
            return [p.new, ...rest].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
          });
        })
      .subscribe((st) => { if (st === "SUBSCRIBED") load(); }); // catch anything that finished while offline
    const back = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", back);
    return () => { supabase.removeChannel(ch); document.removeEventListener("visibilitychange", back); };
  }, [userId, load]);

  // Real push for this partner's own answers, so they reach him with the portal closed.
  // Already allowed on this browser? Quietly (re)subscribe on every visit.
  useEffect(() => { syncPushOnLoad("partner").then((st) => { partnerPushOn = st === "on"; }); }, []);

  // Is the Mac answering? The worker bumps this every ~15s while it's up.
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.from("partner_ai_status" as never).select("seen_at").eq("id", 1).maybeSingle();
      const at = (data as { seen_at: string | null } | null)?.seen_at;
      setOnline(!!at && Date.now() - Date.parse(at) < 90_000);
    };
    check();
    const t = window.setInterval(check, 30_000);
    return () => window.clearInterval(t);
  }, []);

  const answers = useMemo(() => (msgs ?? []).filter((m) => m.role === "assistant" && (m.status === "done" || m.status === "error")), [msgs]);
  const seenFor = useCallback((tid: string | null | undefined) => (tid && seen[tid]) || legacySeen || "", [seen, legacySeen]);
  const unreadBy = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of answers) if (a.thread_id && a.created_at > seenFor(a.thread_id)) out[a.thread_id] = (out[a.thread_id] ?? 0) + 1;
    return out;
  }, [answers, seenFor]);
  const unread = Object.values(unreadBy).reduce((a, b) => a + b, 0);
  const answered = useMemo(() => new Set((msgs ?? []).filter((m) => m.role === "assistant").map((m) => m.reply_to)), [msgs]);
  const busyThreads = useMemo(() => new Set((msgs ?? []).filter((m) =>
    (m.role === "user" && m.status !== "done" && !answered.has(m.id)) || (m.role === "assistant" && m.status === "working")).map((m) => m.thread_id ?? "")), [msgs, answered]);
  const thinking = busyThreads.size > 0;

  // Looking at a conversation = its answers are read.
  const newestInActive = useMemo(() => answers.filter((a) => a.thread_id === active).pop(), [answers, active]);
  useEffect(() => {
    if (!viewing || !active || !newestInActive || document.hidden) return;
    if (newestInActive.created_at > seenFor(active)) {
      setSeen((cur) => { const next = { ...cur, [active]: newestInActive.created_at }; try { localStorage.setItem(SEEN_KEY + "-map", JSON.stringify(next)); } catch { /* ok */ } return next; });
    }
    if (alert?.thread_id === active) setAlert(null);
  }, [viewing, active, newestInActive, seenFor, alert]);

  // Came back after closing the portal and Scout had answered: show it once.
  const shownAway = useRef(false);
  useEffect(() => {
    if (shownAway.current || msgs === null) return;
    shownAway.current = true;
    if (!viewing && unread > 0) setAlert(answers.filter((a) => a.thread_id && a.created_at > seenFor(a.thread_id)).pop() ?? null);
  }, [msgs, viewing, unread, answers, seenFor]);

  // Browser tab title: "(1) Scout answered".
  useEffect(() => {
    const base = "Bestly · Partner";
    document.title = unread && !viewing ? `(${unread}) Scout answered · ${base}` : thinking && !viewing ? `Scout is thinking… · ${base}` : base;
  }, [unread, thinking, viewing]);

  const send = useCallback(async (q: string) => {
    const t = q.trim(); if (!t) return { error: null };
    const { data, error } = await supabase.rpc("partner_chat_send" as never, { p_text: t, p_thread: activeRef.current } as never);
    if (error) return { error: error.message };
    const row = data as unknown as ScoutMsg & { thread_id: string };
    setMsgs((cur) => (cur?.some((m) => m.id === row.id) ? cur : [...(cur ?? []), row]));
    if (row.thread_id && row.thread_id !== activeRef.current) setActive(row.thread_id);
    return { error: null };
  }, [setActive]);
  const rename = useCallback(async (id: string, title: string) => {
    setThreads((cur) => cur.map((t) => (t.id === id ? { ...t, title } : t)));
    await supabase.rpc("partner_thread_rename" as never, { p_id: id, p_title: title } as never);
  }, []);
  const remove = useCallback(async (id: string) => {
    setThreads((cur) => cur.filter((t) => t.id !== id));
    setMsgs((cur) => (cur ?? []).filter((m) => m.thread_id !== id));
    if (activeRef.current === id) setActive(null);
    await supabase.rpc("partner_thread_delete" as never, { p_id: id } as never);
  }, [setActive]);

  return {
    msgs: (msgs ?? null) && (msgs ?? []).filter((m) => m.thread_id === active), allLoaded: msgs !== null,
    threads, active, setActive, unreadBy, busyThreads, online, unread, thinking, answered, alert,
    dismissAlert: () => setAlert(null), send, rename, remove,
  };
}
export type ScoutState = ReturnType<typeof usePartnerScout>;

/** True once this browser is subscribed to the partner's own pushes (then the server sends the popup). */
let partnerPushOn = false;

/**
 * Ask for notification permission and subscribe this browser to his Scout answers. The ask
 * happens synchronously inside the click: Safari silently ignores a request made after an await,
 * which is why the old "ask after send" never showed.
 */
export function askNotifyPermission(): Promise<NotificationPermission | "unsupported"> {
  try {
    if (!("Notification" in window)) return Promise.resolve("unsupported");
    if (Notification.permission === "denied") return Promise.resolve("denied");
    registerServiceWorker();
    return enablePush("partner")
      .then((st) => { partnerPushOn = st === "on"; return Notification.permission; })
      .catch(() => Notification.permission);
  } catch { return Promise.resolve("unsupported"); } /* iOS Safari outside a home-screen app has no Notification */
}
/** An OS notification when an answer lands and he isn't looking at it (other tab, other app, other chat). */
function notify(m: ScoutMsg) {
  if (partnerPushOn) return; // the push from the server covers it, even with the portal closed
  const failed = m.status === "error";
  showLocalNotification(failed ? "Scout hit a snag" : "Scout answered", (m.content || "").slice(0, 140), "/partner#scout", "partner-scout");
}

/* ───────── the floating "Scout answered" alert ───────── */

export function ScoutAlert({ scout, open }: { scout: ScoutState; open: () => void }) {
  const m = scout.alert;
  if (!m) return null;
  const failed = m.status === "error";
  return (
    <div role="status" aria-live="polite"
      className="fixed inset-x-3 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:mx-0 lg:w-[24rem]">
      <div className="flex items-start gap-3 rounded-[1.4rem] border border-white/10 bg-[#141418]/95 p-3.5 pr-2 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl bento:border-black/5 bento:bg-[#fff]/95">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.08] bento:bg-[#F3F2EE]"><AdminMark watchCursor={false} className="h-7 w-7" /></span>
        <button onClick={() => { if (m.thread_id) scout.setActive(m.thread_id); scout.dismissAlert(); open(); }} className="min-w-0 flex-1 text-left">
          <p className="text-sm font-semibold">{failed ? "Scout hit a snag" : "Scout answered"}</p>
          <p className="mt-0.5 line-clamp-2 text-sm text-white/60">{m.content}</p>
          <span className="mt-2 inline-flex h-8 items-center rounded-full bg-[#0A84FF] px-3.5 text-[13px] font-semibold text-[#fff]">Open</span>
        </button>
        <button onClick={scout.dismissAlert} aria-label="Dismiss" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/45 hover:bg-white/[0.06]">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ───────── the Scout tab ───────── */

/** **bold** and simple bullets; everything else as typed. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const bullet = /^\s*([-*•]|\d+\.)\s+/.test(line);
        const body = line.replace(/^\s*[-*•]\s+/, "");
        const bits = body.split(/(\*\*[^*]+\*\*)/g).map((b, j) =>
          b.startsWith("**") && b.endsWith("**") ? <strong key={j} className="font-semibold">{b.slice(2, -2)}</strong> : b);
        if (!line.trim()) return <div key={i} className="h-2" />;
        return bullet
          ? <div key={i} className="flex gap-2 pl-1"><span className="select-none opacity-60">•</span><span>{bits}</span></div>
          : <div key={i}>{bits}</div>;
      })}
    </>
  );
}

export function PartnerScout({ scout, name, draft, onDraftUsed }: { scout: ScoutState; name: string; draft?: string; onDraftUsed?: () => void }) {
  const { msgs, online, threads, active } = scout;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [below, setBelow] = useState(false); // new content arrived while scrolled up
  const box = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [perm, setPerm] = useState(() => ("Notification" in window ? Notification.permission : "unsupported"));
  const current = threads.find((t) => t.id === active);

  useEffect(() => { if (draft) { setText(draft); onDraftUsed?.(); box.current?.focus(); } }, [draft, onDraftUsed]);
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = "0px"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }, [text]);

  // Opens at the newest message and stays there while Scout thinks and types. Only Eli
  // scrolling up unpins it (useStickToBottom explains why earlier fixes kept jumping).
  const { atBottom, jump: toNewest, isStuck } = useStickToBottom("window", active ?? "new", listRef);
  const last = msgs?.[msgs.length - 1];
  useEffect(() => {
    if (!msgs?.length) return;
    if (!isStuck()) setBelow(true);
  }, [msgs?.length, last?.content, last?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (atBottom) setBelow(false); }, [atBottom]);
  const jump = () => { setBelow(false); toNewest(); };

  const send = async (q = text) => {
    if (!q.trim() || sending) return;
    // First, while we still have the click, and only the first time.
    const permAsk = "Notification" in window && Notification.permission === "default" ? askNotifyPermission() : Promise.resolve("unsupported" as const);
    setSending(true); setErr(null);
    jump();
    const { error } = await scout.send(q);
    permAsk.then((p) => { if (p !== "unsupported") setPerm(p); });
    setSending(false);
    if (error) { setErr(error); reportToScout("scout.send", error); } else setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };
  const newChat = () => { scout.setActive(null); setListOpen(false); setText(""); box.current?.focus(); };
  const pick = (id: string) => { scout.setActive(id); setListOpen(false); };
  const waiting = (msgs ?? []).some((m) => m.role === "user" && m.status !== "done" && !scout.answered.has(m.id));
  const thinkingHere = !!active && scout.busyThreads.has(active);

  const list = (
    <div className="flex h-full flex-col">
      <button onClick={newChat} className="mb-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#0A84FF] text-sm font-semibold text-[#fff] active:scale-[0.98]">
        <Plus className="h-4 w-4" /> New chat
      </button>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {threads.length === 0 && <li className="px-2 py-3 text-xs text-white/45">Your conversations show up here.</li>}
        {threads.map((t) => (
          <li key={t.id} className={cn("group relative flex items-center rounded-xl", t.id === active ? "bg-white/[0.09] bento:bg-[#fff]" : "hover:bg-white/[0.05]")}>
            {editing === t.id ? (
              <input autoFocus defaultValue={t.title} aria-label="Rename conversation"
                onBlur={(e) => { scout.rename(t.id, e.target.value); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }}
                className="m-1 h-9 w-full rounded-lg border border-white/15 bg-transparent px-2 text-[16px] text-white outline-none sm:text-sm" />
            ) : (
              <button onClick={() => pick(t.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm text-white/90">{t.title}</span>
                  {scout.busyThreads.has(t.id) ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/45" />
                    : scout.unreadBy[t.id] ? <span className="h-2 w-2 shrink-0 rounded-full bg-[#0A84FF]" aria-label="New answer" /> : null}
                </span>
                <span className="block text-[11px] text-white/40">{new Date(t.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </button>
            )}
            {editing !== t.id && (
              <span className="flex shrink-0 pr-1 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                <button onClick={() => setEditing(t.id)} aria-label="Rename" className="grid h-8 w-8 place-items-center rounded-lg text-white/45 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => { if (window.confirm("Delete this conversation?")) scout.remove(t.id); }} aria-label="Delete" className="grid h-8 w-8 place-items-center rounded-lg text-white/45 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-6">
      <aside className="hidden lg:block"><div className="sticky top-6 h-[calc(100dvh-3rem)]">{list}</div></aside>

      <div className="mx-auto flex w-full max-w-3xl flex-col">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/[0.07] bento:bg-[#fff]"><AdminMark className="h-9 w-9" /></span>
            <div className="min-w-0">
              <h1 className="truncate text-[1.5rem] font-bold leading-tight tracking-tight">{current?.title ?? "Scout"}</h1>
              <p className="flex items-center gap-1.5 text-sm text-white/55">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", online ? "bg-emerald-400" : online === false ? "bg-amber-400" : "bg-white/30")} />
                <span className="truncate">{online === false ? "Resting. Questions get answered when Scout wakes up." : "Knows your calls, emails, to-dos and the pipeline."}</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            {perm === "default" && (
              <button onClick={() => askNotifyPermission().then((p) => { if (p !== "unsupported") setPerm(p); })}
                className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-white/70 hover:bg-white/[0.06]" title="Get a notification when Scout answers">
                <Bell className="h-4 w-4" /> <span className="hidden sm:inline">Notify me</span>
              </button>
            )}
            <button onClick={() => setListOpen(true)} className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-white/70 hover:bg-white/[0.06] lg:hidden">
              <MessagesSquare className="h-4 w-4" /> Chats{threads.length ? ` ${threads.length}` : ""}
            </button>
            {active && (
              <button onClick={newChat} className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-white/70 hover:bg-white/[0.06]">
                <Plus className="h-4 w-4" /> New
              </button>
            )}
          </div>
        </div>

        {thinkingHere && (
          <p className="mt-4 rounded-2xl bg-[#0A84FF]/10 px-4 py-3 text-sm text-white/75">
            Scout takes a minute on bigger questions. Feel free to look around or start another chat: you'll get an alert when the answer is ready.
            {perm === "default" && <button onClick={() => askNotifyPermission().then((p) => { if (p !== "unsupported") setPerm(p); })} className="ml-1 inline-flex items-center gap-1 font-semibold text-[#5AB0FF] bento:text-[#0A6FD8]"><Bell className="h-3.5 w-3.5" />Also notify me outside this page</button>}
          </p>
        )}

        <div ref={listRef} className="mt-6 min-h-[40vh] space-y-3" aria-live="polite">
          {msgs === null ? (
            <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-white/40" /></div>
          ) : msgs.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <AdminMark className="h-20 w-20" />
              <p className="mt-4 text-lg font-semibold">Hi {name}, I'm Scout. What do you want to know?</p>
              <p className="mt-1 max-w-sm text-sm text-white/55">Ask about your calls with Jared, his emails, what's due, the pipeline, or have me draft something. Free to use.</p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {SCOUT_IDEAS.map((q) => (
                  <button key={q} onClick={() => send(q)}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-left text-[0.95rem] text-white/85 transition hover:bg-white/[0.08] active:scale-[0.99] bento:border-black/5 bento:bg-[#fff]">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            msgs.map((m) => m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-[1.35rem] rounded-br-md bg-[#0A84FF] px-4 py-2.5 text-[0.975rem] leading-relaxed text-[#fff]">{m.content}</div>
              </div>
            ) : (
              <div key={m.id} className="group flex items-end gap-2">
                <AdminMark animated={m.status === "working"} watchCursor={false} className="mb-1 h-7 w-7 shrink-0" />
                <div className="min-w-0 max-w-[85%]">
                  <div className={cn("rounded-[1.35rem] rounded-bl-md px-4 py-2.5 text-[0.975rem] leading-relaxed",
                    m.status === "error" ? "bg-red-500/10 text-red-200 bento:text-red-700" : "bg-white/[0.07] text-white bento:bg-[#fff]")}>
                    {m.content ? <Rich text={m.content} /> : <Dots />}
                    {m.status === "working" && m.content && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-white/60" />}
                  </div>
                  {m.status === "done" && m.content && (
                    <div className="mt-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                      <CopyButton text={m.content} className="h-7 bg-transparent px-2 text-[12px] text-white/55 hover:bg-white/[0.06]" />
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {waiting && (
            <div className="flex items-end gap-2">
              <AdminMark watchCursor={false} className="mb-1 h-7 w-7 shrink-0" />
              <div className="rounded-[1.35rem] rounded-bl-md bg-white/[0.07] px-4 py-3 bento:bg-[#fff]">
                <Dots />
                {online === false && <p className="mt-1 text-xs text-white/50">Waiting for Scout to wake up.</p>}
              </div>
            </div>
          )}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] mt-6 lg:bottom-6">
          {below && (
            <button type="button" onClick={jump} className="mx-auto mb-2 flex h-9 items-center gap-1.5 rounded-full bg-[#0A84FF] px-4 text-sm font-semibold text-[#fff] shadow-lg">
              <ArrowDown className="h-4 w-4" /> New reply
            </button>
          )}
          {err && <p role="alert" className="mb-2 text-sm text-red-400 bento:text-red-600">{err}</p>}
          <div className="flex items-end gap-2 rounded-[1.6rem] border border-white/10 bg-[#141418]/95 p-2 pl-4 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)] backdrop-blur bento:border-black/5 bento:bg-[#fff]/95">
            <textarea ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
              placeholder={active ? "Reply to Scout" : "Ask Scout anything"} aria-label="Your question"
              className="max-h-[180px] min-h-[40px] flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-snug text-white outline-none placeholder:text-white/35" />
            <button type="submit" disabled={!text.trim() || sending} aria-label="Send"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0A84FF] text-[#fff] transition active:scale-95 disabled:opacity-30">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
            </button>
          </div>
        </form>
      </div>

      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-xs border-white/10 bg-[#0b0d12] p-4 pt-12 text-white bento:bg-[#F3F2EE]">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <SheetDescription className="sr-only">Your Scout conversations</SheetDescription>
          {list}
        </SheetContent>
      </Sheet>
    </div>
  );
}

const Dots = () => (
  <span className="inline-flex items-center gap-1 py-1" aria-label="Thinking">
    {[0, 150, 300].map((d) => <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-white/50" style={{ animationDelay: `${d}ms` }} />)}
  </span>
);

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
import { ArrowUp, Bell, Loader2, RotateCcw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/CopyText";
import { AdminMark } from "@/components/AdminMark";
import { cn } from "@/lib/utils";

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

export function usePartnerScout(userId: string, viewing: boolean) {
  const [msgs, setMsgs] = useState<ScoutMsg[] | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [seen, setSeen] = useState(readSeen); // created_at of the newest answer he has looked at
  const [alert, setAlert] = useState<ScoutMsg | null>(null);
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;

  const load = useCallback(async () => {
    const { data } = await supabase.from("partner_chat" as never).select("id, role, content, status, reply_to, created_at, updated_at")
      .order("created_at", { ascending: true }).limit(200);
    setMsgs((data ?? []) as unknown as ScoutMsg[]);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel(`partner-scout-${userId}`)
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "partner_chat", filter: `user_id=eq.${userId}` } as never,
        (p: { eventType: string; new: ScoutMsg; old: { id: string } }) => {
          setMsgs((cur) => {
            const list = cur ?? [];
            if (p.eventType === "DELETE") return list.filter((m) => m.id !== p.old.id);
            const i = list.findIndex((m) => m.id === p.new.id);
            if (i === -1) return [...list, p.new].sort((a, b) => a.created_at.localeCompare(b.created_at));
            const next = list.slice(); next[i] = { ...list[i], ...p.new }; return next;
          });
          // Finished while he was looking at something else: tell him.
          if (p.eventType === "UPDATE" && p.new.role === "assistant" && (p.new.status === "done" || p.new.status === "error")
              && (!viewingRef.current || document.hidden)) {
            if (!viewingRef.current) setAlert(p.new);
            notify(p.new);
          }
        })
      .subscribe((s) => { if (s === "SUBSCRIBED") load(); }); // catch anything that finished while offline
    const back = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", back);
    return () => { supabase.removeChannel(ch); document.removeEventListener("visibilitychange", back); };
  }, [userId, load]);

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
  const newest = answers[answers.length - 1];
  const unread = useMemo(() => answers.filter((m) => m.created_at > seen).length, [answers, seen]);
  const answered = useMemo(() => new Set((msgs ?? []).filter((m) => m.role === "assistant").map((m) => m.reply_to)), [msgs]);
  const thinking = useMemo(() => (msgs ?? []).some((m) =>
    (m.role === "user" && m.status !== "done" && !answered.has(m.id)) || (m.role === "assistant" && m.status === "working")), [msgs, answered]);

  // Looking at the Scout tab = read.
  useEffect(() => {
    if (!viewing || !newest || document.hidden) return;
    if (newest.created_at > seen) { setSeen(newest.created_at); try { localStorage.setItem(SEEN_KEY, newest.created_at); } catch { /* ok */ } }
    setAlert(null);
  }, [viewing, newest, seen]);

  // Came back after closing the portal and Scout had answered: show it once.
  const shownAway = useRef(false);
  useEffect(() => {
    if (shownAway.current || msgs === null) return;
    shownAway.current = true;
    if (!viewing && newest && seen && newest.created_at > seen) setAlert(newest);
  }, [msgs, newest, seen, viewing]);

  // Browser tab title: "(1) Scout answered".
  useEffect(() => {
    const base = "Bestly · Partner";
    document.title = unread && !viewing ? `(${unread}) Scout answered · ${base}` : thinking && !viewing ? `Scout is thinking… · ${base}` : base;
  }, [unread, thinking, viewing]);

  const send = useCallback(async (q: string) => {
    const t = q.trim(); if (!t) return { error: null };
    const { data, error } = await supabase.rpc("partner_chat_send" as never, { p_text: t } as never);
    if (error) return { error: error.message };
    const row = data as unknown as ScoutMsg;
    setMsgs((cur) => (cur?.some((m) => m.id === row.id) ? cur : [...(cur ?? []), row]));
    askNotifyPermission();
    return { error: null };
  }, []);
  const clear = useCallback(async () => { await supabase.rpc("partner_chat_clear" as never); setMsgs([]); }, []);

  return { msgs, online, unread, thinking, answered, alert, dismissAlert: () => setAlert(null), send, clear };
}
export type ScoutState = ReturnType<typeof usePartnerScout>;

/** Ask once, the first time he sends something, so a finished answer can reach him in another tab/app. */
function askNotifyPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  } catch { /* iOS Safari outside a home-screen app has no Notification */ }
}
function notify(m: ScoutMsg) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    const n = new Notification("Scout answered", { body: m.content.slice(0, 140), icon: "/favicon.ico", tag: "partner-scout" });
    n.onclick = () => { window.focus(); window.location.hash = "scout"; n.close(); };
  } catch { /* ok */ }
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
        <button onClick={open} className="min-w-0 flex-1 text-left">
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
  const { msgs, online, thinking } = scout;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [perm, setPerm] = useState(() => ("Notification" in window ? Notification.permission : "unsupported"));

  useEffect(() => { if (draft) { setText(draft); onDraftUsed?.(); box.current?.focus(); } }, [draft, onDraftUsed]);
  const last = msgs?.[msgs.length - 1];
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs?.length, last?.content]);
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = "0px"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }, [text]);

  const send = async (q = text) => {
    if (!q.trim() || sending) return;
    setSending(true); setErr(null);
    const { error } = await scout.send(q);
    setSending(false);
    if (error) setErr(error); else setText("");
    if ("Notification" in window) setTimeout(() => setPerm(Notification.permission), 1500);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };
  const clear = async () => { if (window.confirm("Start a new conversation? This clears the chat.")) await scout.clear(); };
  const waiting = (msgs ?? []).some((m) => m.role === "user" && m.status !== "done" && !scout.answered.has(m.id));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.07] bento:bg-[#fff]"><AdminMark className="h-9 w-9" /></span>
          <div>
            <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">Scout</h1>
            <p className="flex items-center gap-1.5 text-sm text-white/55">
              <span className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-400" : online === false ? "bg-amber-400" : "bg-white/30")} />
              {online === false ? "Resting. Questions get answered when Scout wakes up." : "Knows your calls, to-dos and the pipeline."}
            </p>
          </div>
        </div>
        {!!msgs?.length && (
          <button onClick={clear} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-white/60 hover:bg-white/[0.06]">
            <RotateCcw className="h-4 w-4" /> New chat
          </button>
        )}
      </div>

      {thinking && (
        <p className="mt-4 rounded-2xl bg-[#0A84FF]/10 px-4 py-3 text-sm text-white/75">
          Scout takes a minute on bigger questions. Feel free to look around: you'll get an alert when the answer is ready.
          {perm === "default" && <button onClick={() => Notification.requestPermission().then(setPerm)} className="ml-1 inline-flex items-center gap-1 font-semibold text-[#5AB0FF] bento:text-[#0A6FD8]"><Bell className="h-3.5 w-3.5" />Also notify me outside this page</button>}
        </p>
      )}

      <div className="mt-6 min-h-[40vh] space-y-3" aria-live="polite">
        {msgs === null ? (
          <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-white/40" /></div>
        ) : msgs.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <AdminMark className="h-20 w-20" />
            <p className="mt-4 text-lg font-semibold">Hi {name}, I'm Scout. What do you want to know?</p>
            <p className="mt-1 max-w-sm text-sm text-white/55">Ask about your calls with Jared, what's due, the pipeline, or have me draft something. Free to use.</p>
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
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] mt-6 lg:bottom-6">
        {err && <p role="alert" className="mb-2 text-sm text-red-400 bento:text-red-600">{err}</p>}
        <div className="flex items-end gap-2 rounded-[1.6rem] border border-white/10 bg-[#141418]/95 p-2 pl-4 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)] backdrop-blur bento:border-black/5 bento:bg-[#fff]/95">
          <textarea ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
            placeholder="Ask Scout anything" aria-label="Your question"
            className="max-h-[180px] min-h-[40px] flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-snug text-white outline-none placeholder:text-white/35" />
          <button type="submit" disabled={!text.trim() || sending} aria-label="Send"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#0A84FF] text-[#fff] transition active:scale-95 disabled:opacity-30">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </div>
      </form>
    </div>
  );
}

const Dots = () => (
  <span className="inline-flex items-center gap-1 py-1" aria-label="Thinking">
    {[0, 150, 300].map((d) => <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-white/50" style={{ animationDelay: `${d}ms` }} />)}
  </span>
);

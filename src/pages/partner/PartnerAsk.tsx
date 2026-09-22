/**
 * The partner assistant (Ask tab). Free: answers come from the local model on Jared's Mac mini
 * (see scripts/partner-ai/worker.py), not a paid API. Messages live in partner_chat (RLS: your own),
 * and answers stream in over Realtime while the Mac writes them.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/CopyText";
import { PartnerMark } from "@/components/PartnerMark";
import { cn } from "@/lib/utils";

interface Msg { id: string; role: "user" | "assistant"; content: string; status: "pending" | "working" | "done" | "error"; reply_to: string | null; created_at: string }

export const ASK_IDEAS = [
  "What did Jared and I decide on our last call?",
  "What's on my plate this week?",
  "Where are the In-House Cloud deals at?",
  "Draft a short intro email I can send to a potential partner",
];

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

export function PartnerAsk({ userId, name, draft, onDraftUsed }: { userId: string; name: string; draft?: string; onDraftUsed?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("partner_chat" as never).select("id, role, content, status, reply_to, created_at")
      .order("created_at", { ascending: true }).limit(200);
    setMsgs((data ?? []) as unknown as Msg[]);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel(`partner-chat-${userId}`)
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "partner_chat", filter: `user_id=eq.${userId}` } as never, (p: { eventType: string; new: Msg; old: { id: string } }) => {
        setMsgs((cur) => {
          const list = cur ?? [];
          if (p.eventType === "DELETE") return list.filter((m) => m.id !== p.old.id);
          const i = list.findIndex((m) => m.id === p.new.id);
          if (i === -1) return [...list, p.new].sort((a, b) => a.created_at.localeCompare(b.created_at));
          const next = list.slice(); next[i] = { ...list[i], ...p.new }; return next;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  // Is the Mac answering? (the worker bumps this every ~15s while it's up)
  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.from("partner_ai_status" as never).select("seen_at").eq("id", 1).maybeSingle();
      const seen = (data as { seen_at: string | null } | null)?.seen_at;
      setOnline(!!seen && Date.now() - Date.parse(seen) < 90_000);
    };
    check();
    const t = window.setInterval(check, 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (draft) { setText(draft); onDraftUsed?.(); box.current?.focus(); }
  }, [draft, onDraftUsed]);

  const last = msgs?.[msgs.length - 1];
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs?.length, last?.content]);

  useEffect(() => {
    const el = box.current; if (!el) return;
    el.style.height = "0px"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const send = async (q = text) => {
    const t = q.trim(); if (!t || sending) return;
    setSending(true); setErr(null);
    const { data, error } = await supabase.rpc("partner_chat_send" as never, { p_text: t } as never);
    setSending(false);
    if (error) { setErr(error.message); return; }
    setText("");
    const row = data as unknown as Msg;
    setMsgs((cur) => (cur?.some((m) => m.id === row.id) ? cur : [...(cur ?? []), row]));
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };
  const clear = async () => {
    if (!window.confirm("Start a new conversation? This clears the chat.")) return;
    await supabase.rpc("partner_chat_clear" as never);
    setMsgs([]);
  };

  const answered = new Set((msgs ?? []).filter((m) => m.role === "assistant").map((m) => m.reply_to));
  const waiting = (msgs ?? []).some((m) => m.role === "user" && m.status !== "done" && !answered.has(m.id));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-bold tracking-tight">Ask</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-white/55">
            <span className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-400" : online === false ? "bg-amber-400" : "bg-white/30")} />
            {online === false ? "Assistant is asleep. Questions get answered when it wakes up." : "Knows your calls, to-dos and the pipeline. Free to use."}
          </p>
        </div>
        {!!msgs?.length && (
          <button onClick={clear} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-white/60 hover:bg-white/[0.06]">
            <RotateCcw className="h-4 w-4" /> New chat
          </button>
        )}
      </div>

      <div className="mt-6 min-h-[40vh] space-y-3" aria-live="polite">
        {msgs === null ? (
          <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-white/40" /></div>
        ) : msgs.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <PartnerMark className="h-20 w-20" />
            <p className="mt-4 text-lg font-semibold">Hi {name}, what do you want to know?</p>
            <p className="mt-1 max-w-sm text-sm text-white/55">Ask about your calls with Jared, what's due, the pipeline, or have it draft something for you.</p>
            <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
              {ASK_IDEAS.map((q) => (
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
              <PartnerMark animated={m.status === "working"} watchCursor={false} className="mb-1 h-7 w-7 shrink-0" />
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
            <PartnerMark watchCursor={false} className="mb-1 h-7 w-7 shrink-0" />
            <div className="rounded-[1.35rem] rounded-bl-md bg-white/[0.07] px-4 py-3 bento:bg-[#fff]">
              <Dots />
              {online === false && <p className="mt-1 text-xs text-white/50">Waiting for the assistant to wake up.</p>}
            </div>
          </div>
        )}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(); }}
        className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] mt-6 lg:bottom-6">
        {err && <p role="alert" className="mb-2 text-sm text-red-400 bento:text-red-600">{err}</p>}
        <div className="flex items-end gap-2 rounded-[1.6rem] border border-white/10 bg-[#141418]/95 p-2 pl-4 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)] backdrop-blur bento:border-black/5 bento:bg-[#fff]/95">
          <textarea ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
            placeholder="Ask anything" aria-label="Your question"
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

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  X,
  CornerDownLeft,
  ArrowLeft,
  Plus,
  MessagesSquare,
  Pencil,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import { RecorderBar, useRecorder, useNow, clock, listNames, type RecentRecording } from "./ScoutRecorder";

/**
 * Scout - the assistant that lives in the corner of the admin.
 *
 * The thinking happens in the admin-chat edge function: it holds the tools
 * (the queue, read-only SQL, repo read and commit, jobs for the Mac agent),
 * checks the admin role against the caller's own JWT, and writes every tool run
 * to admin_chat_actions. This component is the window, not the brain.
 *
 * Colours: `white` and `black` are variable-backed in this repo (tailwind.config
 * maps them to --tw-white / --tw-black, which .admin-bento swaps). They already
 * flip for the light theme on their own - adding `bento:` overrides on top flips
 * them a second time and the text goes unreadable. Do not reintroduce them.
 */

interface Msg {
  id?: string;
  role: "user" | "assistant";
  body: string;
}

interface ThreadRow {
  id: string;
  title: string | null;
  updated_at: string;
  message_count: number;
  last_body: string | null;
}

type Mood = "idle" | "think" | "alert";

const OPENERS = [
  "What needs me most right now?",
  "Is the Mac agent alive?",
  "What changed on the site this week?",
];

function Scoutie({ mood, className }: { mood: Mood; className?: string }) {
  return (
    <svg
      viewBox="0 0 26 20"
      className={cn("scoutie", `scoutie-${mood}`, className)}
      fill="none"
      aria-hidden="true"
    >
      <g>
        <rect x="10.4" y="6.2" width="5.2" height="3" rx="1.2" fill="currentColor" />
        <circle cx="6.6" cy="9.4" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="19.4" cy="9.4" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <g className="scoutie-eyes">
          <circle cx="8.5" cy="9.9" r="2.1" fill="currentColor" />
          <circle cx="21.3" cy="9.9" r="2.1" fill="currentColor" />
        </g>
        <g className="scoutie-lids">
          <path d="M0 8.2 h13.2 v-4 a6.6 6.6 0 0 0 -13.2 0 z" fill="currentColor" />
          <path d="M12.8 8.2 h13.2 v-4 a6.6 6.6 0 0 0 -13.2 0 z" fill="currentColor" />
        </g>
      </g>
    </svg>
  );
}

const SCOUT_CSS = `
.scoutie { overflow: visible; }
.scoutie-lids { transform-box: fill-box; transform-origin: center top; }
.scoutie-eyes { transform-box: fill-box; transform-origin: center; }
.scoutie-idle .scoutie-lids { animation: scout-blink 6.5s ease-in-out infinite; }
.scoutie-idle .scoutie-eyes { animation: scout-glance 9s ease-in-out infinite; }
.scoutie-think .scoutie-lids { animation: scout-squint 1.4s ease-in-out infinite; }
.scoutie-think .scoutie-eyes { animation: scout-scan 1.1s ease-in-out infinite; }
.scoutie-alert .scoutie-lids { animation: scout-pop 2.6s ease-in-out infinite; }
.scoutie-alert .scoutie-eyes { animation: scout-glance 3.4s ease-in-out infinite; }
@keyframes scout-blink { 0%,88%,100% { transform: translateY(0) } 92%,95% { transform: translateY(3.8px) } }
@keyframes scout-glance { 0%,30%,100% { transform: translateX(0) } 40%,52% { transform: translateX(1.5px) } 62%,74% { transform: translateX(-1.5px) } }
@keyframes scout-squint { 0%,100% { transform: translateY(2.1px) } 50% { transform: translateY(2.9px) } }
@keyframes scout-scan { 0%,100% { transform: translateX(-1.6px) } 50% { transform: translateX(1.6px) } }
@keyframes scout-pop { 0%,100% { transform: translateY(0) } 8%,26% { transform: translateY(-2.2px) } }
.scout-nudge { animation: scout-nudge 4.5s ease-in-out infinite; }
@keyframes scout-nudge {
  0%,82%,100% { transform: translateY(0) rotate(0deg) }
  86% { transform: translateY(-4px) rotate(-3deg) }
  90% { transform: translateY(0) rotate(2deg) }
  94% { transform: translateY(-2px) rotate(-1deg) }
}
.scout-pop-in { animation: scout-pop-in 220ms cubic-bezier(0.22,1.2,0.36,1) both; }
@keyframes scout-pop-in { from { opacity: 0; transform: translateY(10px) scale(0.96) } to { opacity: 1; transform: none } }
.scout-bubble-in { animation: scout-bubble-in 260ms cubic-bezier(0.22,1.2,0.36,1) both; }
@keyframes scout-bubble-in { from { opacity: 0; transform: translateY(6px) scale(0.94) } to { opacity: 1; transform: none } }
.scout-dots span { display: inline-block; animation: scout-dot 1.1s ease-in-out infinite; }
.scout-dots span:nth-child(2) { animation-delay: .15s }
.scout-dots span:nth-child(3) { animation-delay: .3s }
@keyframes scout-dot { 0%,60%,100% { opacity: .25; transform: translateY(0) } 30% { opacity: 1; transform: translateY(-2px) } }
.scout-row .scout-tools { opacity: 0; transition: opacity .12s ease; }
.scout-row:hover .scout-tools, .scout-row:focus-within .scout-tools { opacity: 1; }
@media (hover: none) { .scout-row .scout-tools { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .scoutie-lids, .scoutie-eyes, .scout-nudge, .scout-pop-in, .scout-bubble-in, .scout-dots span { animation: none !important }
}
`;

function when(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function Scout() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [bubble, setBubble] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const { state: rec, latest: lastCall, refresh: refreshRec } = useRecorder(open);
  const recNow = useNow(rec?.status === "recording");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let gone = false;
    (async () => {
      const { data } = await (supabase.rpc as any)("admin_today");
      if (gone) return;
      const urgent = ((data ?? []) as { rank: number }[]).filter((r) => r.rank <= 1).length;
      setWaiting(urgent);
      if (urgent > 0) {
        setBubble(true);
        setTimeout(() => setBubble(false), 9000);
      }
    })();
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [msgs, busy, view]);

  useEffect(() => {
    if (open && view === "chat") inputRef.current?.focus();
  }, [open, view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open) return;
      if (view === "history") setView("chat");
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, view]);

  const loadThreads = useCallback(async () => {
    const { data } = await supabase
      .from("admin_chat_thread_list" as any)
      .select("id, title, updated_at, message_count, last_body")
      .order("updated_at", { ascending: false })
      .limit(40);
    setThreads((data ?? []) as unknown as ThreadRow[]);
  }, []);

  const loadThread = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("admin_chat_messages" as any)
      .select("id, role, body")
      .eq("thread_id", id)
      .order("created_at");
    setMsgs((data ?? []) as unknown as Msg[]);
  }, []);

  const send = useCallback(
    async (body: string, replacing?: string | null, fresh?: boolean) => {
      const asked = body.trim();
      if (!asked || busy) return;

      if (replacing) {
        await (supabase.rpc as any)("admin_chat_truncate", { p_message_id: replacing });
        setEditing(null);
      }

      if (fresh) {
        setTitle(null);
        setEditing(null);
      }
      setMsgs((m) => [...(fresh ? [] : m), { role: "user", body: asked }]);
      setText("");
      setBusy(true);

      const { data, error } = await supabase.functions.invoke("admin-chat", {
        body: { body: asked, thread_id: fresh ? null : threadId },
      });

      const id = (data as { thread_id?: string })?.thread_id ?? (fresh ? null : threadId);
      if (error) {
        setMsgs((m) => [...m, { role: "assistant", body: `I couldn't reach the server: ${error.message}` }]);
      } else if (id) {
        setThreadId(id);
        await loadThread(id);
      }

      setBusy(false);
      inputRef.current?.focus();
    },
    [busy, threadId, loadThread],
  );

  const startEdit = (m: Msg) => {
    if (!m.id) return;
    setEditing(m.id);
    setText(m.body);
    inputRef.current?.focus();
  };

  const dropFrom = async (m: Msg) => {
    if (!m.id || !threadId) return;
    if (!window.confirm("Delete this message and everything after it?")) return;
    await (supabase.rpc as any)("admin_chat_truncate", { p_message_id: m.id });
    await loadThread(threadId);
  };

  const removeThread = async (id: string) => {
    if (!window.confirm("Delete this conversation for good?")) return;
    await (supabase.rpc as any)("admin_chat_delete_thread", { p_thread_id: id });
    if (id === threadId) {
      setThreadId(null);
      setMsgs([]);
      setTitle(null);
    }
    loadThreads();
  };

  const saveRename = async (id: string) => {
    await (supabase.rpc as any)("admin_chat_rename", { p_thread_id: id, p_title: renameText });
    setRenaming(null);
    if (id === threadId) setTitle(renameText.trim() || null);
    loadThreads();
  };

  const newChat = () => {
    setThreadId(null);
    setMsgs([]);
    setTitle(null);
    setEditing(null);
    setText("");
    setView("chat");
  };

  const debrief = (r: RecentRecording) => {
    const who = r.roster.length ? ` with ${listNames(r.roster)}` : "";
    send(`Debrief my call${who} (${r.name}): the decisions, who owes what, and the follow-ups.`, null, true);
  };

  const recording = rec?.status === "recording";

  const mood: Mood = busy ? "think" : waiting > 0 && !open ? "alert" : "idle";

  if (!open) {
    return (
      <>
        <style>{SCOUT_CSS}</style>
        {bubble && (
          <button
            type="button"
            onClick={() => {
              setBubble(false);
              setOpen(true);
            }}
            className="scout-bubble-in fixed bottom-[4.5rem] right-5 z-40 max-w-[14rem] rounded-2xl rounded-br-sm border border-white/10 bg-white px-3.5 py-2.5 text-left text-xs font-medium text-black shadow-xl"
          >
            {waiting === 1 ? "One thing needs you. Want the detail?" : `${waiting} things need you. Want the detail?`}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Scout"
          className={cn(
            "fixed bottom-5 right-5 z-40 flex items-center gap-2.5 rounded-full",
            "px-4 py-2.5 text-sm font-semibold shadow-lg transition-transform hover:scale-105",
            "bg-white text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            waiting > 0 && "scout-nudge",
          )}
        >
          <Scoutie mood={mood} className="h-[1.15rem] w-[1.55rem]" />
          Scout
          {recording && (
            <span className="ml-0.5 flex items-center gap-1.5 rounded-full bg-red-500 px-2 py-0.5 text-[0.6875rem] font-bold tabular-nums text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />
              REC {clock(rec?.started_at ?? null, recNow)}
            </span>
          )}
          {waiting > 0 && (
            <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[0.6875rem] font-bold text-white">
              {waiting}
            </span>
          )}
        </button>
      </>
    );
  }

  return (
    <>
      <style>{SCOUT_CSS}</style>
      <section
        aria-label="Scout"
        className={cn(
          "scout-pop-in fixed bottom-5 right-5 z-40 flex flex-col overflow-hidden rounded-2xl shadow-2xl",
          "w-[min(25rem,calc(100vw-2.5rem))] max-h-[min(38rem,calc(100vh-6rem))]",
          "border border-white/[0.08] bg-black/95 backdrop-blur-xl",
        )}
      >
        <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-2.5">
          {view === "history" ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setView("chat")}
              aria-label="Back to the conversation"
              className="h-8 w-8 shrink-0 border-0 text-white/60 hover:bg-white/5 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Scoutie mood={mood} className="ml-1.5 h-[1.15rem] w-[1.55rem] shrink-0 text-white" />
          )}

          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-sm font-semibold text-white">
              {view === "history" ? "History" : title ?? "Scout"}
            </p>
            <p className="truncate text-[0.6875rem] text-white/50">
              {view === "history"
                ? `${threads.length} conversation${threads.length === 1 ? "" : "s"}`
                : busy
                  ? "thinking it through"
                  : recording ? "recording your call" : "reads the data, changes the site"}
            </p>
          </div>

          {view === "chat" && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={newChat}
                aria-label="New conversation"
                className="h-8 w-8 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  loadThreads();
                  setView("history");
                }}
                aria-label="History"
                className="h-8 w-8 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white"
              >
                <MessagesSquare className="h-4 w-4" />
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label="Close Scout"
            className="h-8 w-8 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {view === "history" ? (
          <div className="flex-1 overflow-y-auto p-2">
            {threads.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-white/50">Nothing here yet.</p>
            )}
            <ul className="space-y-1">
              {threads.map((t) => (
                <li key={t.id} className="scout-row group rounded-xl px-2 py-2 hover:bg-white/[0.04]">
                  {renaming === t.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename(t.id);
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        className="flex-1 rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Button
                        size="icon"
                        onClick={() => saveRename(t.id)}
                        aria-label="Save name"
                        className="h-7 w-7 bg-white text-black hover:bg-white/90"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setThreadId(t.id);
                          setTitle(t.title);
                          await loadThread(t.id);
                          setView("chat");
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm text-white">{t.title ?? "Untitled"}</p>
                        <p className="truncate text-xs text-white/45">
                          {when(t.updated_at)} · {t.message_count} message{t.message_count === 1 ? "" : "s"}
                          {t.last_body ? ` · ${t.last_body.slice(0, 40)}` : ""}
                        </p>
                      </button>
                      <span className="scout-tools flex shrink-0 gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Rename"
                          onClick={() => {
                            setRenaming(t.id);
                            setRenameText(t.title ?? "");
                          }}
                          className="h-7 w-7 border-0 text-white/45 hover:bg-white/5 hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete conversation"
                          onClick={() => removeThread(t.id)}
                          className="h-7 w-7 border-0 text-white/45 hover:bg-red-500/10 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
          <RecorderBar state={rec} latest={lastCall} refresh={refreshRec} onDebrief={debrief} />
          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {msgs.length === 0 && (
              <>
                <p className="text-sm text-white/80">
                  I can read anything in the database, change the site, and give your Mac jobs. What do you need?
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {OPENERS.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => send(o)}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/30 hover:text-white"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </>
            )}

            {msgs.map((m, i) => (
              <div key={m.id ?? i} className="scout-row group">
                {m.role === "user" ? (
                  <div className="flex items-start justify-end gap-1">
                    <span className="scout-tools flex shrink-0 gap-0.5 pt-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit and resend"
                        onClick={() => startEdit(m)}
                        className="h-7 w-7 border-0 text-white/40 hover:bg-white/5 hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete from here"
                        onClick={() => dropFrom(m)}
                        className="h-7 w-7 border-0 text-white/40 hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                    <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-white px-3 py-2 text-sm text-black">
                      {m.body}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-1">
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-white/90">
                      {m.body}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Copy"
                      onClick={() => {
                        navigator.clipboard?.writeText(m.body);
                        setCopied(i);
                        setTimeout(() => setCopied(null), 1200);
                      }}
                      className="scout-tools h-7 w-7 shrink-0 border-0 text-white/40 hover:bg-white/5 hover:text-white"
                    >
                      {copied === i ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <p className="flex items-center gap-2 text-sm text-white/50" aria-live="polite">
                <Scoutie mood="think" className="h-[1.15rem] w-[1.55rem] shrink-0 text-white/60" />
                <span className="scout-dots">
                  Scout is working<span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            )}
          </div>
          </>
        )}

        {view === "chat" && (
          <div className="border-t border-white/[0.06] p-3">
            {editing && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs text-white/70">
                <Pencil className="h-3 w-3 shrink-0" aria-hidden />
                <span className="flex-1">Editing - sending replaces it and everything after.</span>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setText("");
                  }}
                  className="text-white/50 underline-offset-2 hover:text-white hover:underline"
                >
                  cancel
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                id="scout-input"
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(text, editing);
                  }
                }}
                placeholder="Ask, or say what to change..."
                className="max-h-28 min-h-[2.375rem] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                size="icon"
                onClick={() => send(text, editing)}
                disabled={busy || !text.trim()}
                aria-label="Send to Scout"
                className="h-[2.375rem] w-[2.375rem] shrink-0 bg-white text-black hover:bg-white/90"
              >
                <CornerDownLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

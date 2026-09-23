import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
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
  RotateCcw,
} from "lucide-react";
import { RecorderBar, useRecorder, useNow, clock, listNames, type RecentRecording } from "./ScoutRecorder";
import { ScoutJobs, useMacJobs, type MacJob } from "./ScoutJobs";
import { SCOUT_ASK_EVENT, SCOUT_OPEN_EVENT, type ScoutAsk } from "./scoutBus";

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
  "What's on this page that needs me?",
  "Check the Mac mini is healthy",
];

/* Where Scout sits. Dragging the header moves it, the corner grips resize it,
 * double-clicking the header puts it back. Remembered per browser; on phones it
 * always docks (there is no room to move it). */
type Box = { x: number; y: number; w: number; h: number };
const BOX_KEY = "scout.box.v1";
const canMove = () => typeof window !== "undefined" && window.innerWidth >= 640;
function clampBox(b: Box): Box {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(Math.max(b.w, 320), vw - 16);
  const h = Math.min(Math.max(b.h, 340), vh - 16);
  return { w, h, x: Math.min(Math.max(b.x, 8), vw - w - 8), y: Math.min(Math.max(b.y, 8), vh - h - 8) };
}
function loadBox(): Box | null {
  try {
    const b = JSON.parse(localStorage.getItem(BOX_KEY) ?? "null");
    return b && typeof b.w === "number" && canMove() ? clampBox(b) : null;
  } catch {
    return null;
  }
}
function saveBox(b: Box | null) {
  try {
    if (b) localStorage.setItem(BOX_KEY, JSON.stringify(b));
    else localStorage.removeItem(BOX_KEY);
  } catch {
    /* private window: it just won't be remembered */
  }
}

/* What Jared is looking at, so "this" means something to Scout. */
function pageContext(path: string, about?: string) {
  const main = document.querySelector("main");
  const heading = main?.querySelector("h1, h2")?.textContent?.trim() ?? "";
  return { path, title: document.title, heading: heading.slice(0, 200), about: about?.slice(0, 1500) };
}

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
.scout-pop-in { transform-origin: bottom right; animation: scout-open 300ms cubic-bezier(0.2,1.15,0.3,1) both; }
.scout-pop-in.scout-closing { animation: scout-close 170ms cubic-bezier(0.4,0,1,1) both; }
@keyframes scout-open { from { opacity: 0; transform: translateY(16px) scale(0.88); filter: blur(6px) } 60% { filter: blur(0) } to { opacity: 1; transform: none; filter: none } }
@keyframes scout-close { to { opacity: 0; transform: translateY(12px) scale(0.92); filter: blur(3px) } }
.scout-settling { transition: left .34s cubic-bezier(0.2,1,0.3,1), top .34s cubic-bezier(0.2,1,0.3,1), width .34s cubic-bezier(0.2,1,0.3,1), height .34s cubic-bezier(0.2,1,0.3,1); }
.scout-panel { transition: box-shadow .2s ease, transform .2s ease; }
.scout-dragging { box-shadow: 0 40px 90px -24px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.12); transform: scale(1.01); }
.scout-launcher { transition: transform .22s cubic-bezier(0.2,1.3,0.4,1), box-shadow .22s ease; animation: scout-launch 320ms cubic-bezier(0.2,1.3,0.4,1) both; }
.scout-launcher:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 14px 30px -10px rgba(0,0,0,.45); }
.scout-launcher:active { transform: scale(0.95); transition-duration: .08s; }
@keyframes scout-launch { from { opacity: 0; transform: translateY(8px) scale(0.7) } to { opacity: 1; transform: none } }
.scout-badge-pop { animation: scout-badge 420ms cubic-bezier(0.3,1.7,0.5,1) both; }
@keyframes scout-badge { from { transform: scale(0.3); opacity: 0 } to { transform: none; opacity: 1 } }
.scout-msg-user { animation: scout-in-right 280ms cubic-bezier(0.2,1.15,0.3,1) both; transform-origin: right bottom; }
.scout-msg-bot { animation: scout-in-up 360ms cubic-bezier(0.2,0.9,0.3,1) both; }
@keyframes scout-in-right { from { opacity: 0; transform: translateX(14px) scale(0.94) } to { opacity: 1; transform: none } }
@keyframes scout-in-up { from { opacity: 0; transform: translateY(8px); filter: blur(2px) } to { opacity: 1; transform: none; filter: none } }
.scout-view-fwd { animation: scout-view-fwd 240ms cubic-bezier(0.2,0.9,0.3,1) both; }
.scout-view-back { animation: scout-view-back 240ms cubic-bezier(0.2,0.9,0.3,1) both; }
@keyframes scout-view-fwd { from { opacity: 0; transform: translateX(18px) } to { opacity: 1; transform: none } }
@keyframes scout-view-back { from { opacity: 0; transform: translateX(-18px) } to { opacity: 1; transform: none } }
.scout-chip { transition: transform .15s ease, border-color .15s ease, color .15s ease, background-color .15s ease; animation: scout-in-up 380ms cubic-bezier(0.2,0.9,0.3,1) both; }
.scout-chip:hover { transform: translateY(-1px); background-color: rgba(255,255,255,.05); }
.scout-chip:active { transform: scale(0.96); }
.scout-press { transition: transform .12s ease, background-color .15s ease, color .15s ease, opacity .15s ease; }
.scout-press:active { transform: scale(0.9); }
.scout-card-in { animation: scout-card 340ms cubic-bezier(0.2,1.15,0.3,1) both; }
@keyframes scout-card { from { opacity: 0; transform: translateY(10px) scale(0.97) } to { opacity: 1; transform: none } }
.scout-collapse { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .28s cubic-bezier(0.2,0.9,0.3,1), opacity .2s ease; opacity: 0; }
.scout-collapse.is-open { grid-template-rows: 1fr; opacity: 1; }
.scout-collapse > * { overflow: hidden; min-height: 0; }
.scout-shimmer { background: linear-gradient(90deg, rgba(255,255,255,.35), rgba(255,255,255,.9), rgba(255,255,255,.35)); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: scout-shimmer 1.6s linear infinite; }
@keyframes scout-shimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
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
  .scoutie-lids, .scoutie-eyes, .scout-nudge, .scout-pop-in, .scout-bubble-in, .scout-dots span, .scout-launcher, .scout-badge-pop,
  .scout-msg-user, .scout-msg-bot, .scout-view-fwd, .scout-view-back, .scout-chip, .scout-card-in, .scout-shimmer { animation: none !important }
  .scout-settling, .scout-panel, .scout-launcher, .scout-collapse, .scout-chip, .scout-press { transition: none !important }
  .scout-shimmer { color: inherit; background: none }
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
  const location = useLocation();
  const navigate = useNavigate();
  const [box, setBox] = useState<Box | null>(() => loadBox());
  // On a phone Scout is the whole screen: the draggable box, the resize grips and the
  // saved position are desktop furniture and get ignored rather than shrunk.
  const phone = useIsMobile();
  const [closing, setClosing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [viewDir, setViewDir] = useState<"fwd" | "back">("fwd");
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 170);
  }, []);
  const sectionRef = useRef<HTMLElement>(null);
  const { jobs, refresh: refreshJobs } = useMacJobs(threadId, open);
  const pendingJobs = jobs.filter((j) => j.status === "proposed").length;

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

  // The log sits at the bottom, the way a chat should: new answers push up, and it
  // stays pinned while Scout is still typing. Scroll up to read something and it lets
  // go; come back to the bottom and it takes over again.
  const stick = useRef(true);
  const pin = useCallback((smooth = false) => {
    const el = logRef.current;
    if (!el || !stick.current) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Streaming answers grow the log without a re-render we can see, so watch the box itself.
    const ro = new ResizeObserver(() => pin());
    for (const child of Array.from(el.children)) ro.observe(child);
    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) ro.observe(child);
      pin();
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
    };
  }, [view, open, pin]);

  // A new message or a fresh open always goes to the bottom, whatever was scrolled before.
  useEffect(() => {
    stick.current = true;
    pin();
  }, [threadId, open, view, pin]);

  useEffect(() => {
    pin();
  }, [msgs, busy, jobs, pin]);

  useEffect(() => {
    if (open && view === "chat") inputRef.current?.focus();
  }, [open, view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open) return;
      if (view === "history") setView("chat");
      else close();
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
    async (body: string, replacing?: string | null, fresh?: boolean, about?: string) => {
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
        body: { body: asked, thread_id: fresh ? null : threadId, page: pageContext(location.pathname + location.search, about) },
      });

      const id = (data as { thread_id?: string })?.thread_id ?? (fresh ? null : threadId);
      if (error) {
        const status = (error as { context?: { status?: number } })?.context?.status;
        const body = status === 504 || status === 546
          ? "That one ran too long and got cut off. Say \"keep going\" and I'll pick it up, or ask for a smaller piece."
          : status === 401 || status === 403
            ? "Your sign-in expired. Refresh the page and sign in again."
            : "I couldn't reach the server just now. Try again in a moment.";
        setMsgs((m) => [...m, { role: "assistant", body }]);
      } else if (id) {
        setThreadId(id);
        await loadThread(id);
      }

      setBusy(false);
      refreshJobs();
      inputRef.current?.focus();
    },
    [busy, threadId, loadThread, location.pathname, location.search, refreshJobs],
  );

  // Other parts of the admin open Scout or hand it a question (scoutBus.ts).
  const pendingAsk = useRef<ScoutAsk | null>(null);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<ScoutAsk>).detail;
      if (!d?.text) return;
      setOpen(true);
      setView("chat");
      pendingAsk.current = d;
      setTimeout(() => {
        const a = pendingAsk.current;
        pendingAsk.current = null;
        if (a) send(a.text, null, a.fresh !== false, a.about);
      }, 0);
    };
    const onOpen = () => {
      setOpen(true);
      setView("chat");
    };
    window.addEventListener(SCOUT_ASK_EVENT, onAsk);
    window.addEventListener(SCOUT_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(SCOUT_ASK_EVENT, onAsk);
      window.removeEventListener(SCOUT_OPEN_EVENT, onOpen);
    };
  }, [send]);

  // A push or bell item links to ?scout=open: open Scout and tidy the URL.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("scout") !== "open") return;
    setOpen(true);
    setView("chat");
    q.delete("scout");
    const rest = q.toString();
    navigate(location.pathname + (rest ? `?${rest}` : ""), { replace: true });
  }, [location.search, location.pathname, navigate]);

  // Cmd/Ctrl+J toggles Scout from anywhere in the admin.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "j" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (sectionRef.current) close();
        else setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  // Keep a moved window on screen when the browser is resized.
  useEffect(() => {
    const onResize = () => setBox((b) => (b && canMove() ? clampBox(b) : null));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startDrag = (e: ReactPointerEvent, mode: "move" | "nw" | "se") => {
    if (!canMove() || e.button !== 0 || !sectionRef.current) return;
    if (mode === "move" && (e.target as HTMLElement).closest("button, input, a")) return;
    e.preventDefault();
    const r = sectionRef.current.getBoundingClientRect();
    const start = { x: r.left, y: r.top, w: r.width, h: r.height };
    const px = e.clientX, py = e.clientY;
    let last: Box = start;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - px, dy = ev.clientY - py;
      const next =
        mode === "move" ? { ...start, x: start.x + dx, y: start.y + dy }
        : mode === "se" ? { ...start, w: start.w + dx, h: start.h + dy }
        : { x: start.x + dx, y: start.y + dy, w: start.w - dx, h: start.h - dy };
      last = clampBox(next);
      setBox(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      setDragging(false);
      saveBox(last);
    };
    document.body.style.userSelect = "none";
    setDragging(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Glide back to the corner, then hand positioning back to CSS.
  const resetBox = () => {
    saveBox(null);
    if (!box) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(400, vw - 40), h = Math.min(box.h, 608, vh - 96);
    setSettling(true);
    setBox({ x: vw - w - 20, y: vh - h - 20, w, h });
    window.setTimeout(() => {
      setSettling(false);
      setBox(null);
    }, 360);
  };

  const jobFinished = useCallback(
    (j: MacJob) => {
      if (j.thread_id && j.thread_id !== threadId) return;
      send(
        `The Mac mini job "${j.title}" ${j.status === "done" ? "finished" : "failed"}${j.exit_code !== null ? ` (exit ${j.exit_code})` : ""}. Read the output and tell me if it worked and what's next.`,
      );
    },
    [send, threadId],
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

  const needs = waiting + pendingJobs;
  const mood: Mood = busy ? "think" : needs > 0 && !open ? "alert" : "idle";

  if (!open) {
    return (
      <>
        <style>{SCOUT_CSS}</style>
        {!bubble && pendingJobs > 0 && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="scout-bubble-in fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-5 z-40 max-w-[14rem] rounded-2xl rounded-br-sm border border-white/10 bg-white px-3.5 py-2.5 text-left text-xs font-medium text-black shadow-xl"
          >
            {pendingJobs === 1 ? "I have a Mac job ready. Tap Run?" : `${pendingJobs} Mac jobs are waiting for you.`}
          </button>
        )}
        {bubble && (
          <button
            type="button"
            onClick={() => {
              setBubble(false);
              setOpen(true);
            }}
            className="scout-bubble-in fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-5 z-40 max-w-[14rem] rounded-2xl rounded-br-sm border border-white/10 bg-white px-3.5 py-2.5 text-left text-xs font-medium text-black shadow-xl"
          >
            {waiting === 1 ? "One thing needs you. Want the detail?" : `${waiting} things need you. Want the detail?`}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Scout (Cmd+J)"
          title="Scout (⌘J)"
          className={cn(
            "scout-launcher fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-40 flex items-center gap-2.5 rounded-full",
            "px-4 py-2.5 text-sm font-semibold shadow-lg",
            "bg-white text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            needs > 0 && "scout-nudge",
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
          {needs > 0 && (
            <span key={needs} className={cn(
              "scout-badge-pop ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.6875rem] font-bold",
              waiting > 0 ? "bg-red-500 text-white" : "bg-amber-400 text-black",
            )}>
              {needs}
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
        ref={sectionRef}
        aria-label="Scout"
        style={box && !phone ? { left: box.x, top: box.y, width: box.w, height: box.h } : undefined}
        className={cn(
          "scout-pop-in scout-panel fixed z-40 flex flex-col overflow-hidden rounded-2xl shadow-2xl",
          closing && "scout-closing",
          dragging && "scout-dragging",
          settling && "scout-settling",
          phone
            ? "inset-0 rounded-none pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
            : !box && "bottom-5 right-5 w-[min(25rem,calc(100vw-2.5rem))] max-h-[min(38rem,calc(100vh-6rem))]",
          "border border-white/[0.08] bg-black/95 backdrop-blur-xl",
        )}
      >
        <div
          aria-hidden
          onPointerDown={(e) => startDrag(e, "nw")}
          title="Drag to resize"
          className="absolute left-0 top-0 z-10 hidden h-4 w-4 cursor-nwse-resize sm:block"
        />
        <div
          aria-hidden
          onPointerDown={(e) => startDrag(e, "se")}
          title="Drag to resize"
          className="absolute bottom-0 right-0 z-10 hidden h-4 w-4 cursor-nwse-resize sm:block"
        >
          <svg viewBox="0 0 10 10" className="absolute bottom-1 right-1 h-2.5 w-2.5 text-white/30"><path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.2" /></svg>
        </div>
        <div
          onPointerDown={(e) => startDrag(e, "move")}
          onDoubleClick={resetBox}
          className="flex cursor-default items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-2.5 sm:cursor-grab sm:active:cursor-grabbing"
        >
          {view === "history" ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setViewDir("back");
                setView("chat");
              }}
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
                  : recording ? "recording your call" : pendingJobs ? "a Mac job is waiting for you" : "reads the data, fixes things, runs the Mac"}
            </p>
          </div>

          {box && (
            <Button
              variant="ghost"
              size="icon"
              onClick={resetBox}
              aria-label="Put Scout back in the corner"
              title="Put back in the corner"
              className="scout-press h-8 w-8 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          {view === "chat" && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={newChat}
                aria-label="New conversation"
                className="scout-press h-8 w-8 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  loadThreads();
                  setViewDir("fwd");
                  setView("history");
                }}
                aria-label="History"
                className="scout-press h-8 w-8 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white"
              >
                <MessagesSquare className="h-4 w-4" />
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={close}
            aria-label="Close Scout"
            className="scout-press h-8 w-8 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {view === "history" ? (
          <div key="history" className="scout-view-fwd flex-1 overflow-y-auto p-2">
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
          <div key="chat" className={cn("flex min-h-0 flex-1 flex-col", viewDir === "back" ? "scout-view-back" : "")}>
          <RecorderBar state={rec} latest={lastCall} refresh={refreshRec} onDebrief={debrief} />
          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto scroll-smooth px-4 py-4">
            {msgs.length === 0 && (
              <>
                <p className="text-sm text-white/80">
                  I can read anything in the database, change the site, and run jobs on the Mac mini (you tap Run). I know which page you're on. What do you need?
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {OPENERS.map((o, n) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => send(o)}
                      style={{ animationDelay: `${80 + n * 60}ms` }}
                      className="scout-chip rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:border-white/30 hover:text-white"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </>
            )}

            {msgs.map((m, i) => (
              <div key={i} className={cn("scout-row group", m.role === "user" ? "scout-msg-user" : "scout-msg-bot")}>
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

            <ScoutJobs jobs={jobs} refresh={refreshJobs} onFinished={jobFinished} />

            {busy && (
              <p className="scout-msg-bot flex items-center gap-2 text-sm text-white/50" aria-live="polite">
                <Scoutie mood="think" className="h-[1.15rem] w-[1.55rem] shrink-0 text-white/60" />
                <span className="scout-dots scout-shimmer">
                  Scout is working<span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            )}
          </div>
          </div>
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
                className="max-h-28 min-h-[2.375rem] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-white/40 focus:border-white/25 focus:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                size="icon"
                onClick={() => send(text, editing)}
                disabled={busy || !text.trim()}
                aria-label="Send to Scout"
                className="scout-press h-[2.375rem] w-[2.375rem] shrink-0 bg-white text-black transition-opacity hover:bg-white/90 disabled:opacity-40"
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

import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { QuestionCard, splitQuestions } from "@/components/admin/ScoutQuestions";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { playNotifySound, playSuccessSound } from "@/lib/notifySound";
import { useStickToBottom } from "@/lib/useStickToBottom";
import {
  X,
  ArrowLeft,
  Plus,
  MessagesSquare,
  Pencil,
  Trash2,
  Copy,
  Check,
  RotateCcw,
  Wrench,
  Square,
  ArrowUp,
  Clock3,
  AppWindow,
} from "lucide-react";
import { CopyBlock } from "@/components/CopyText";
import { copyText } from "@/lib/copyForClaude";
import { RecorderBar, useRecorder, useNow, clock, listNames, type RecentRecording } from "./ScoutRecorder";
import { JobCard, useJobFollow, useMacJobs, type MacJob } from "./ScoutJobs";
import { AttachBar, AttachButton, useScoutFiles } from "./ScoutAttach";
import { ScoutAutoRunBar } from "./ScoutAutoRun";
import { SCOUT_ASK_EVENT, SCOUT_OPEN_EVENT, type ScoutAsk } from "./scoutBus";
import { NeedsYouCard, useNeedsYou, type TodayRow } from "./ScoutNeedsYou";
import { dotHex, markScoutThreadRead, publishScoutDot, scoutDotColor, useScoutUnread } from "./scoutUnread";

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
  /** When it was said; places Mac job cards in the conversation where they were proposed. */
  created_at?: string;
}

interface ThreadRow {
  id: string;
  title: string | null;
  updated_at: string;
  message_count: number;
  last_body: string | null;
}

type Mood = "idle" | "think" | "alert";

/** v34 (2026-10-06): what Jared typed while Scout was busy. Sent as one message when Scout finishes, the way
 *  Claude queues mid-turn messages; "Send now" interrupts instead. */
interface Queued {
  id: number;
  body: string;
}
/** Written by the server when he taps Stop (admin-chat v34). Drawn as a divider, never as a bubble. */
const STOP_MARK = "[Stopped]";
/** The last line of a free-AI progress note while it carries on by itself (admin-chat v33). */
// v36: the one progress note reads "...\n\nStill working on it (step 23, 4 min in)."; the older form ended "Still working on it."
const CONTINUING = /Still working on it(?: \([^)\n]*\))?\.\s*$/;
/** A chain that has said nothing for this long has died: stop showing it as running. */
const CHAIN_IDLE_MS = 4 * 60_000;

/** 4:05 PM, the way the rest of the admin writes times. */
function clockTime(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

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
/** The first window ("main") keeps the keys Scout has always used, so nothing saved is lost. Others get per-id keys. */
const PRIMARY_ID = "main";
const boxKeyFor = (id: string) => (id === PRIMARY_ID ? BOX_KEY : `${BOX_KEY}:${id}`);
const canMove = () => typeof window !== "undefined" && window.innerWidth >= 640;
function clampBox(b: Box): Box {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(Math.max(b.w, 320), vw - 16);
  const h = Math.min(Math.max(b.h, 340), vh - 16);
  return { w, h, x: Math.min(Math.max(b.x, 8), vw - w - 8), y: Math.min(Math.max(b.y, 8), vh - h - 8) };
}
function loadBox(key: string = BOX_KEY): Box | null {
  try {
    const b = JSON.parse(localStorage.getItem(key) ?? "null");
    return b && typeof b.w === "number" && canMove() ? clampBox(b) : null;
  } catch {
    return null;
  }
}
function saveBox(b: Box | null, key: string = BOX_KEY) {
  try {
    if (b) localStorage.setItem(key, JSON.stringify(b));
    else localStorage.removeItem(key);
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

/**
 * Scout ends a reply that needs a decision with one line:
 *
 *   OPTIONS: Do it | Not now | Show me first
 *
 * We lift that line out of the text and render it as buttons. Jared taps; the tap is
 * sent as his next message, exactly as if he had typed it. No copying, no retyping,
 * no "reply with yes" - which is the whole point.
 */
const OPTION_LINE = /\n?^\s*OPTIONS?\s*:\s*(.+?)\s*$/im;

// Regex that matches a fenced code block: ```optional-lang\ncontent\n```
const FENCE_RE = /```[^\n]*\n([\s\S]*?)```/g;

/**
 * Splits a Scout message body into alternating plain-text and code-block segments.
 * Returns an array of {kind:'text'|'code', content:string}.
 */
export function splitFences(body: string): Array<{ kind: "text" | "code"; content: string }> {
  const parts: Array<{ kind: "text" | "code"; content: string }> = [];
  let last = 0;
  for (const m of body.matchAll(FENCE_RE)) {
    if (m.index! > last) parts.push({ kind: "text", content: body.slice(last, m.index) });
    parts.push({ kind: "code", content: m[1].trimEnd() });
    last = m.index! + m[0].length;
  }
  if (last < body.length) parts.push({ kind: "text", content: body.slice(last) });
  return parts;
}

const SCOUT_STATE_KEY = "bestly-scout-state";
const stateKeyFor = (id: string) => (id === PRIMARY_ID ? SCOUT_STATE_KEY : `${SCOUT_STATE_KEY}:${id}`);
type ScoutSaved = { open: boolean; threadId: string | null; text: string; at: number };
function loadScoutState(key: string = SCOUT_STATE_KEY): ScoutSaved | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as ScoutSaved | null;
    // Kept for a working day; after that a fresh start is what you'd expect.
    return v && Date.now() - v.at < 12 * 3600_000 ? v : null;
  } catch { return null; }
}
function saveScoutState(v: Omit<ScoutSaved, "at">, key: string = SCOUT_STATE_KEY) {
  try { localStorage.setItem(key, JSON.stringify({ ...v, at: Date.now() })); } catch { /* private mode */ }
}

/* The open windows, remembered across a reload: [{ id, threadId }]. The first one is always the primary. */
const WINDOWS_KEY = "bestly-scout-windows";
const MAX_WINDOWS = 4;
const CASCADE = 32;
interface WinEntry { id: string; threadId: string | null }
function loadWindows(): WinEntry[] {
  const main: WinEntry = { id: PRIMARY_ID, threadId: loadScoutState()?.threadId ?? null };
  try {
    const raw = JSON.parse(localStorage.getItem(WINDOWS_KEY) ?? "[]");
    const extra = (Array.isArray(raw) ? raw : [])
      .filter((w): w is WinEntry => !!w && typeof w.id === "string" && w.id !== PRIMARY_ID)
      // A window whose saved state has aged out (12 hours) is gone, like the primary's open/closed state.
      .filter((w) => !!loadScoutState(stateKeyFor(w.id)))
      .map((w) => ({ id: w.id, threadId: loadScoutState(stateKeyFor(w.id))?.threadId ?? null }));
    return [main, ...extra].slice(0, MAX_WINDOWS);
  } catch {
    return [main];
  }
}

/** Where a new window opens: 32 px off the one that spawned it, on screen, and not exactly on top of another window. */
function cascadeBox(from: DOMRect): Box {
  const taken = [...document.querySelectorAll("[data-scout-window]")].map((el) => el.getBoundingClientRect());
  const size = { w: from.width, h: from.height };
  const dirs: Array<[number, number]> = [[1, 1], [-1, -1], [1, -1], [-1, 1]];
  let best: Box = clampBox({ ...size, x: from.left - CASCADE, y: from.top - CASCADE });
  for (let k = 1; k <= 4; k++) {
    for (const [dx, dy] of dirs) {
      const b = clampBox({ ...size, x: from.left + dx * CASCADE * k, y: from.top + dy * CASCADE * k });
      // "On top of another window" = within a title-bar's width of its corner (the docked window sits 12 px off the clamp).
      if (!taken.some((r) => Math.abs(r.left - b.x) < 24 && Math.abs(r.top - b.y) < 24)) return b;
      best = b;
    }
  }
  return best;
}

export function splitOptions(body: string): { text: string; options: string[] } {
  const m = body.match(OPTION_LINE);
  if (!m) return { text: body, options: [] };
  const options = m[1]
    .split("|")
    .map((o) => o.trim().replace(/^[-*\u2022]\s*/, ""))
    .filter((o) => o && o.length <= 60)
    .slice(0, 4);
  if (!options.length) return { text: body, options: [] };
  return { text: body.replace(OPTION_LINE, "").trimEnd(), options };
}

/**
 * What to show when Scout forgets its OPTIONS line.
 *
 * The system prompt asks for one on every reply that leaves a decision, but a prompt is
 * a request, not a guarantee, and the reply it forgets on is usually the "want me to keep
 * going?" - the exact moment Jared would otherwise have to type. So the buttons are
 * generated here instead of hoped for, matched to what the message is actually doing.
 */
export function fallbackOptions(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const tail = t.slice(-400).toLowerCase();

  // "Want me to keep going", "should I", "shall I", "ready for me to"
  if (/\b(want me to|should i|shall i|ready for me to|do you want me to|keep going|carry on|continue\?)/.test(tail)) {
    return ["Yes, keep going", "Not now", "Show me first"];
  }
  // Anything else phrased as a question still deserves a tap rather than typing.
  if (t.endsWith("?")) return ["Yes", "No", "Tell me more"];
  // A plain answer or status: the useful next tap is forward, not a yes/no.
  return ["Keep going", "What else needs me?"];
}

/**
 * Turn a Scout exchange into a prompt Jared can paste to Claude to get the thing fixed.
 *
 * Scout runs on a small model and can read and propose, but it does not write code. When
 * it surfaces something broken the next step has always been Jared retyping the problem
 * into a Claude session from memory. This hands him the whole thing - what he asked, what
 * Scout answered, and where he was - so the fix starts with the context already in it.
 */
export function claudeFixPrompt(botText: string, userText?: string, path?: string): string {
  return [
    "In the Bestly admin (repo Bestly-LLC/bestlytech), Scout flagged this and I want it fixed.",
    "",
    userText ? `What I asked Scout:\n${userText.trim()}` : null,
    "",
    `What Scout said:\n${botText.trim()}`,
    "",
    path ? `Where: ${path}` : null,
    "",
    "Find the actual cause, fix it properly, and commit and push. Tell me what was wrong.",
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
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
@media (hover: none) {
  .scout-row .scout-tools { opacity: 0; pointer-events: none; }
  .scout-row.scout-tools-on .scout-tools { opacity: 1; pointer-events: auto; }
}
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

/** What the host needs to know about the primary window to draw the launcher. */
interface PrimaryStatus { open: boolean; running: boolean; pendingJobs: number }
export interface ScoutHandle { open: () => void }

interface WindowProps {
  id: string;
  /** The first window: owns Cmd+J, ?scout=open, the askScout events, and stays mounted (closed) behind the launcher. */
  primary: boolean;
  /** 1-based, for the title of a window with no conversation title yet. */
  n: number;
  /** Stacking: 0 is the back-most window. */
  z: number;
  /** The window that gets Esc when focus is not inside any Scout window. */
  isFront: boolean;
  /** Room for another window (under the max). */
  canSpawn: boolean;
  /** Conversations open in the other windows, so a Mac job card shows up in the window that owns its thread. */
  others: string[];
  today: ReturnType<typeof useNeedsYou>;
  recorder: ReturnType<typeof useRecorder>;
  /** Unread replies across every thread (read once in the host): the dots on History rows. */
  unreadThreads: ReturnType<typeof useScoutUnread>["threads"];
  onFront: (id: string) => void;
  onThread: (id: string, threadId: string | null) => void;
  onSpawn: (from: DOMRect) => void;
  /** A secondary window closed itself: the host forgets it. */
  onRemove: (id: string) => void;
  onStatus?: (s: PrimaryStatus) => void;
}

const ScoutWindow = forwardRef<ScoutHandle, WindowProps>(function ScoutWindow(
  { id: winId, primary, n, z, isFront, canSpawn, others, today, recorder, unreadThreads, onFront, onThread, onSpawn, onRemove, onStatus },
  handleRef,
) {
  // Where you were (open or not, which conversation, a half-typed message) survives a reload,
  // a discarded tab or a new build, so coming back never means starting Scout over.
  const stateKey = stateKeyFor(winId);
  const boxKey = boxKeyFor(winId);
  const saved = useRef(loadScoutState(stateKey)).current;
  // A secondary window exists only while it is open: closing it removes it.
  const [open, setOpen] = useState(primary ? saved?.open ?? false : true);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [text, setText] = useState(saved?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(saved?.threadId ?? null);
  const [title, setTitle] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [copiedFix, setCopiedFix] = useState<"ok" | "fail" | null>(null);
  const [toolsFor, setToolsFor] = useState<number | null>(null);
  // v34: queue + interrupt. `chaining` = the server is still carrying the job on by itself after the request returned.
  const [queue, setQueue] = useState<Queued[]>([]);
  const [chaining, setChaining] = useState(false);
  const [runStart, setRunStart] = useState<string | null>(null);
  const runId = useRef(0);
  const lastSeen = useRef(Date.now());
  const logRef = useRef<HTMLDivElement>(null);
  // The recorder, Needs you and the badge are read once by the host and handed down: N windows must not mean N× polling.
  const { state: rec, latest: lastCall, refresh: refreshRec } = recorder;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [box, setBox] = useState<Box | null>(() => loadBox(boxKey));
  // On a phone Scout is the whole screen: the draggable box, the resize grips and the
  // saved position are desktop furniture and get ignored rather than shrunk.
  const phone = useIsMobile();
  // A `fixed; inset-0` sheet is laid out against the LAYOUT viewport. iOS never resizes
  // that for the keyboard, and when it auto-zooms or pans it moves the VISUAL viewport
  // underneath instead - so the sheet ends up wider than the screen and shoved sideways,
  // which is exactly what it was doing. Pin the sheet to the visual viewport instead:
  // that rectangle is, by definition, what the person can actually see.
  const [vv, setVv] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!phone || !open) return setVv(null);
    if (!v) return;
    let raf: number | null = null;
    const on = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        setVv({ top: v.offsetTop, left: v.offsetLeft, width: v.width, height: v.height });
      });
    };
    on();
    v.addEventListener("resize", on);
    v.addEventListener("scroll", on);
    return () => {
      v.removeEventListener("resize", on);
      v.removeEventListener("scroll", on);
      if (raf) cancelAnimationFrame(raf);
      setVv(null);
    };
  }, [phone, open]);

  // While the sheet is up, the page behind it must not scroll or rubber-band.
  useEffect(() => {
    if (!phone || !open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [phone, open]);
  const [closing, setClosing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [viewDir, setViewDir] = useState<"fwd" | "back">("fwd");
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      if (primary) {
        setOpen(false);
        setClosing(false);
      } else onRemove(winId);
    }, 170);
  }, [primary, winId, onRemove]);
  const sectionRef = useRef<HTMLElement>(null);
  const { jobs: liveJobs, refresh: refreshJobs } = useMacJobs(threadId, open);
  // A Mac job belongs to the window whose conversation proposed it. The primary also keeps the ones nobody
  // else owns (exactly what it showed before there were several windows); a secondary shows only its own.
  const othersKey = others.join("|");
  const jobs = useMemo(
    () => liveJobs.filter((j) => (primary
      ? !j.thread_id || j.thread_id === threadId || !othersKey.split("|").includes(j.thread_id)
      : !!j.thread_id && j.thread_id === threadId)),
    [liveJobs, primary, threadId, othersKey],
  );
  const pendingJobs = jobs.filter((j) => j.status === "proposed").length;

  // The badge and the list inside Scout read the same rows, so the number always has something behind it.
  const { rows: todayRows, urgent, refresh: refreshToday } = today;
  const waiting = urgent.length;

  useImperativeHandle(handleRef, () => ({
    open: () => {
      setOpen(true);
      setView("chat");
    },
  }), []);
  useEffect(() => {
    onThread(winId, threadId);
  }, [winId, threadId, onThread]);

  // The log sits at the bottom, the way a chat should, and only the reader can unpin it
  // (see useStickToBottom for why layout reflows used to throw it back up the page).
  const { jump: toNewest } = useStickToBottom(logRef, `${open}:${view}:${threadId ?? "new"}`);

  useEffect(() => {
    if (open && view === "chat" && !phone) inputRef.current?.focus();
  }, [open, view, phone]);


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
      .select("id, role, body, created_at")
      .eq("thread_id", id)
      .order("created_at");
    setMsgs((data ?? []) as unknown as Msg[]);
  }, []);

  // He is looking at this conversation, so what Scout said in it counts as read. Runs when the thread opens and
  // again (debounced ~1 s) when new messages land while he is watching; hidden tabs don't count as looking.
  const lastMsgAt = msgs.length ? msgs[msgs.length - 1].created_at : null;
  useEffect(() => {
    if (!open || view !== "chat" || !threadId) return;
    const t = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      void markScoutThreadRead(threadId);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [open, view, threadId, msgs.length, lastMsgAt]);
  useEffect(() => {
    if (!open || view !== "chat" || !threadId) return;
    const onVis = () => document.visibilityState === "visible" && void markScoutThreadRead(threadId);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [open, view, threadId]);

  // Put the remembered conversation back on screen, then keep remembering.
  useEffect(() => {
    if (saved?.threadId) loadThread(saved.threadId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    saveScoutState({ open, threadId, text }, stateKey);
  }, [open, threadId, text, stateKey]);

  const attach = useScoutFiles();
  const [overDrop, setOverDrop] = useState(false);

  // v34: Scout is "running" while a request is in flight OR while the server is still carrying the job on by itself
  // (its last note ends "Still working on it." or "Still working on it (step 23, 4 min in)." and is recent). Derived from the messages, so it can't get stuck.
  const lastMsg = msgs[msgs.length - 1];
  const chainAlive = !!lastMsg && lastMsg.role === "assistant" && CONTINUING.test(lastMsg.body)
    && Date.now() - Date.parse(lastMsg.created_at ?? "") < CHAIN_IDLE_MS;
  const running = busy || chainAlive;
  const lastUserIdx = msgs.map((m) => m.role === "user" && m.body !== STOP_MARK).lastIndexOf(true);
  const lastBotIdx = msgs.map((m) => m.role === "assistant").lastIndexOf(true);

  const send = useCallback(
    async (body: string, replacing?: string | null, fresh?: boolean, about?: string, opts?: { now?: boolean; raw?: boolean }) => {
      const asked = body.trim();
      // A file on its own is a real ask ("read this"), so an empty box with an attachment sends.
      if ((!asked && !attach.count) || attach.busy) return;

      // Busy, and not told to cut in: it waits in line and goes out when Scout is done (like Claude's queue).
      if (running && !opts?.now && !replacing && !fresh) {
        const queued = opts?.raw ? asked : attach.compose(asked);
        setQueue((q) => [...q, { id: Date.now() + Math.random(), body: queued }]);
        setText("");
        attach.drop();
        requestAnimationFrame(toNewest);
        return;
      }
      // From here on this is the run the window follows. Anything still in flight is stale: its answer is
      // ignored here, and the server stops it because this message is newer than the one it was answering.
      const my = ++runId.current;

      if (replacing) {
        await (supabase.rpc as any)("admin_chat_truncate", { p_message_id: replacing });
        setEditing(null);
      }

      if (fresh) {
        setTitle(null);
        setEditing(null);
      }
      // The files' text rides along in the message body, so the thread keeps the whole ask and
      // Scout can refer back to a file later in the conversation without re-reading it.
      const withFiles = opts?.raw ? asked : attach.compose(asked);
      const at = new Date().toISOString();
      setMsgs((m) => [...(fresh ? [] : m), { role: "user", body: withFiles, created_at: at }]);
      if (!opts?.raw) {
        setText("");
        attach.drop();
      }
      requestAnimationFrame(toNewest); // you just asked: follow the answer
      setBusy(true);
      setRunStart(at);

      const { data, error } = await supabase.functions.invoke("admin-chat", {
        body: { body: withFiles, thread_id: fresh ? null : threadId, page: pageContext(location.pathname + location.search, about) },
      });
      if (my !== runId.current) return; // he sent something newer or tapped Stop while this one ran

      const id = (data as { thread_id?: string })?.thread_id ?? (fresh ? null : threadId);
      if (error) {
        const status = (error as { context?: { status?: number } })?.context?.status;
        const body = status === 504 || status === 546
          ? "That one ran too long and got cut off. Say \"keep going\" and I'll pick it up, or ask for a smaller piece."
          : status === 401 || status === 403
            ? "Your sign-in expired. Refresh the page and sign in again."
            : "I couldn't reach the server just now. Try again in a moment.";
        setMsgs((m) => [...m, { role: "assistant", body, created_at: new Date().toISOString() }]);
      } else if (id) {
        setThreadId(id);
        await loadThread(id);
      }

      setBusy(false);
      // Done: the happy pop. A problem: the alert. Still carrying on by itself: quiet until it really finishes.
      if (error) playNotifySound();
      else if (!(data as { continuing?: boolean })?.continuing) playSuccessSound();
      refreshJobs();
      inputRef.current?.focus();
    },
    // 2026-09-24: attach.* must be here. Without them send() kept the first render's attach (no files), so
    // attachments uploaded and read fine but the message went out without them ("can you read that?" -> nothing).
    [running, threadId, loadThread, location.pathname, location.search, refreshJobs, toNewest, attach.compose, attach.count, attach.busy, attach.drop],
  );

  /** Stop: like Esc in Claude. The run ends where it is, and anything queued comes back into the box to edit. */
  const stop = useCallback(async () => {
    if (!running) return;
    runId.current++;
    setBusy(false);
    if (queue.length) {
      setText((t) => [...queue.map((q) => q.body), t].filter((x) => x.trim()).join("\n\n"));
      setQueue([]);
    }
    setMsgs((m) => [...m, { role: "user", body: STOP_MARK, created_at: new Date().toISOString() }]);
    inputRef.current?.focus();
    if (threadId) {
      await supabase.functions.invoke("admin-chat", { body: { op: "stop", thread_id: threadId } });
      await loadThread(threadId);
    }
  }, [running, queue, threadId, loadThread]);

  /** Send now: interrupt whatever is running and send the queue (and whatever is in the box) this second. */
  const sendNow = useCallback(() => {
    const parts = [...queue.map((q) => q.body), attach.compose(text.trim())].filter((x) => x.trim());
    if (!parts.length) return;
    setQueue([]);
    setText("");
    attach.drop();
    void send(parts.join("\n\n"), null, false, undefined, { now: true, raw: true });
  }, [queue, text, attach, send]);

  // While a job runs on the server, follow it: its progress notes and the final answer land here live.
  useEffect(() => {
    if (!open || !threadId || !running) return;
    const t = window.setInterval(() => {
      // While a request is in flight the window already shows his message; only reload once the server
      // has had time to save it, or the optimistic bubble would blink.
      if (busy && runStart && Date.now() - Date.parse(runStart) < 5000) return;
      void loadThread(threadId);
    }, 3000);
    return () => window.clearInterval(t);
  }, [open, threadId, running, busy, runStart, loadThread]);

  // The job carried on by itself and has now finished: same sound as a normal finish.
  const wasChain = useRef(false);
  useEffect(() => {
    if (wasChain.current && !chainAlive && !busy && lastMsg?.body !== STOP_MARK) playSuccessSound();
    wasChain.current = chainAlive;
  }, [chainAlive, busy, lastMsg?.body]);

  // The box grows with what is in it (a queue pulled back after Stop can be several lines), up to its max height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "";
    if (!text) return; // empty: the CSS height (one line) is right
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 112)}px`;
  }, [text, open, view]);

  // Esc: stops a running job first (like Claude), then leaves History, then closes.
  // With several windows it acts only on the one that has focus; if focus is somewhere else on the page
  // (as it can be with one window), the front-most window takes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open) return;
      const focused = (document.activeElement as HTMLElement | null)?.closest?.("[data-scout-window]");
      if (focused ? focused !== sectionRef.current : !isFront) return;
      if (running && view === "chat") { e.preventDefault(); void stop(); return; }
      if (view === "history") setView("chat");
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, view, running, stop, close, isFront]);

  // Scout is done: what he queued goes out as one message, in the order he wrote it.
  useEffect(() => {
    if (running || !queue.length || attach.busy) return;
    const body = queue.map((q) => q.body).join("\n\n");
    setQueue([]);
    void send(body, null, false, undefined, { raw: true });
  }, [running, queue, attach.busy, send]);

  // Other parts of the admin open Scout or hand it a question (scoutBus.ts).
  const pendingAsk = useRef<ScoutAsk | null>(null);
  useEffect(() => {
    if (!primary) return; // the global hooks belong to the primary window only
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
  }, [send, primary]);

  // A push or bell item links to ?scout=open: open Scout and tidy the URL.
  useEffect(() => {
    if (!primary) return;
    const q = new URLSearchParams(location.search);
    if (q.get("scout") !== "open") return;
    setOpen(true);
    setView("chat");
    q.delete("scout");
    const rest = q.toString();
    navigate(location.pathname + (rest ? `?${rest}` : ""), { replace: true });
  }, [location.search, location.pathname, navigate, primary]);

  // Cmd/Ctrl+J toggles Scout from anywhere in the admin.
  useEffect(() => {
    if (!primary) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "j" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (sectionRef.current) close();
        else setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, primary]);

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
      saveBox(last, boxKey);
    };
    document.body.style.userSelect = "none";
    setDragging(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Glide back to the corner, then hand positioning back to CSS.
  const resetBox = () => {
    if (!primary) return; // the corner is the primary's; another window put there would sit on top of it
    saveBox(null, boxKey);
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
  const jobDecided = useJobFollow(jobs, refreshJobs, jobFinished);
  /** Mac job cards sit in the conversation where they were proposed (after the last message said
   *  before the job was created), not stuck under the newest message. -1 = before the first message. */
  const jobsAfter = useMemo(() => {
    const out = new Map<number, MacJob[]>();
    let last = 0;
    const ts = msgs.map((m) => { const t = m.created_at ? Date.parse(m.created_at) : NaN; last = Number.isFinite(t) ? t : last; return last; });
    for (const j of [...jobs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
      const t = Date.parse(j.created_at);
      let at = -1;
      for (let i = 0; i < ts.length; i++) if (ts[i] <= t) at = i;
      out.set(at, [...(out.get(at) ?? []), j]);
    }
    return out;
  }, [msgs, jobs]);
  const jobCards = (at: number) => {
    const list = jobsAfter.get(at);
    return list?.length ? <div className="space-y-3">{list.map((j) => <JobCard key={j.id} job={j} onDecided={jobDecided} />)}</div> : null;
  };

  const startEdit = (m: Msg) => {
    if (!m.id) return;
    setEditing(m.id);
    setText(m.body);
    inputRef.current?.focus();
  };

  const dropFrom = async (m: Msg) => {
    if (!m.id || !threadId) return;
    if (!window.confirm("Delete this message and everything after it?")) return;
    const { error } = await (supabase.rpc as any)("admin_chat_truncate", { p_message_id: m.id });
    if (error) { toast.error("Couldn't delete those", { description: error.message }); return; }
    await loadThread(threadId);
  };

  const removeThread = async (id: string) => {
    if (!window.confirm("Delete this conversation for good?")) return;
    // Clearing it from the list before knowing the delete landed is how a "deleted" conversation
    // comes back on the next load.
    const { error } = await (supabase.rpc as any)("admin_chat_delete_thread", { p_thread_id: id });
    if (error) { toast.error("Couldn't delete that conversation", { description: error.message }); return; }
    if (id === threadId) {
      setThreadId(null);
      setMsgs([]);
      setTitle(null);
    }
    loadThreads();
  };

  const saveRename = async (id: string) => {
    const { error } = await (supabase.rpc as any)("admin_chat_rename", { p_thread_id: id, p_title: renameText });
    setRenaming(null);
    if (error) { toast.error("Couldn't rename that", { description: error.message }); loadThreads(); return; }
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
  const mood: Mood = running ? "think" : needs > 0 && !open ? "alert" : "idle";
  const workingFor = useNow(running);
  const openUrl = (url: string) => {
    if (/^https?:\/\//.test(url)) window.open(url, "_blank", "noopener");
    else navigate(url);
  };
  const askAbout = (r: TodayRow) =>
    send(`Help me with this one from Needs you: ${r.title}${r.detail ? `\n\n${r.detail}` : ""}\n\nWhat's the fastest way to clear it, and can you do any of it for me?`, null, true);

  // The primary tells the host what the launcher needs; the launcher itself lives in the host (drawn once).
  useEffect(() => {
    onStatus?.({ open, running, pendingJobs });
  }, [open, running, pendingJobs, onStatus]);

  if (!open) return null;

  return (
    <>
      <section
        ref={sectionRef}
        data-scout-window={winId}
        aria-label={primary ? "Scout" : `Scout window ${n}`}
        onPointerDownCapture={() => onFront(winId)}
        onFocusCapture={() => onFront(winId)}
        style={{
          ...(box && !phone ? { left: box.x, top: box.y, width: box.w, height: box.h } : phone && vv ? vv : {}),
          // Stacking among Scout's own windows only; page dialogs (z-50) stay above all of them.
          zIndex: 40 + z,
        }}
        className={cn(
          "scout-pop-in scout-panel fixed z-40 flex flex-col overflow-hidden rounded-2xl shadow-2xl",
          closing && "scout-closing",
          dragging && "scout-dragging",
          settling && "scout-settling",
          phone
            ? "inset-0 max-w-[100vw] overflow-x-hidden rounded-none border-0"
            : !box && "bottom-5 right-5 w-[min(25rem,calc(100vw-2.5rem))] max-h-[min(44rem,calc(100vh-6rem))]",
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
          onPointerDown={(e) => !phone && startDrag(e, "move")}
          onDoubleClick={resetBox}
          className={cn(
            "flex cursor-default items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-2 sm:cursor-grab sm:active:cursor-grabbing",
            phone && "pt-[max(0.5rem,env(safe-area-inset-top))]",
          )}
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
              className="h-10 w-10 shrink-0 border-0 text-white/60 hover:bg-white/5 hover:text-white sm:h-8 sm:w-8"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Scoutie mood={mood} className="ml-1.5 h-[1.15rem] w-[1.55rem] shrink-0 text-white" />
          )}

          <div className="min-w-0 flex-1 px-1">
            <p className="break-words text-sm font-semibold leading-tight text-white">
              {view === "history" ? "History" : title ?? (primary ? "Scout" : `Scout ${n}`)}
            </p>
            <p className="text-[0.6875rem] leading-tight text-white/50">
              {view === "history"
                ? `${threads.length} conversation${threads.length === 1 ? "" : "s"}`
                : running
                  ? queue.length ? `working · ${queue.length} queued` : "working on it"
                  : recording ? "recording your call" : pendingJobs ? "waiting for your OK" : "reads data, fixes things"}
            </p>
          </div>

          {box && primary && (
            <Button
              variant="ghost"
              size="icon"
              onClick={resetBox}
              aria-label="Put Scout back in the corner"
              title="Put back in the corner"
              className="scout-press h-11 w-11 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white sm:h-8 sm:w-8"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          {view === "chat" && (
            <>
              {/* Desktop only: a phone keeps its one full-screen sheet. */}
              {!phone && canMove() && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => sectionRef.current && onSpawn(sectionRef.current.getBoundingClientRect())}
                  disabled={!canSpawn}
                  aria-label="New Scout window"
                  title={canSpawn ? "New Scout window" : `${MAX_WINDOWS} windows is the most`}
                  className="scout-press h-11 w-11 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white disabled:opacity-30 sm:h-8 sm:w-8"
                >
                  <AppWindow className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={newChat}
                aria-label="New conversation"
                className="scout-press h-11 w-11 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white sm:h-8 sm:w-8"
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
                className="scout-press h-11 w-11 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white sm:h-8 sm:w-8"
              >
                <MessagesSquare className="h-4 w-4" />
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={close}
            aria-label={primary ? "Close Scout" : "Close this Scout window"}
            className="scout-press h-11 w-11 shrink-0 border-0 text-white/50 hover:bg-white/5 hover:text-white sm:h-8 sm:w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {view === "chat" && <ScoutAutoRunBar />}

        {view === "history" ? (
          <div key="history" className="scout-view-fwd flex-1 overflow-y-auto p-2">
            {threads.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-white/50">Nothing here yet.</p>
            )}
            <ul className="space-y-1">
              {threads.map((t) => (
                <li key={t.id} className="scout-row group rounded-xl px-2.5 py-2.5 hover:bg-white/[0.04]">
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
                        <p className="break-words text-sm leading-snug text-white">
                          {(() => {
                            const u = t.id === threadId ? undefined : unreadThreads.find((x) => x.id === t.id);
                            if (!u) return null;
                            const c = u.needs_you ? "orange" : "purple";
                            return (
                              <span
                                role="img"
                                aria-label={u.needs_you ? "Needs you" : "Unread replies"}
                                style={{ background: dotHex(c) }}
                                className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full align-middle"
                              />
                            );
                          })()}
                          {t.title ?? "Untitled"}
                        </p>
                        <p className="mt-0.5 text-xs text-white/45">
                          {when(t.updated_at)} · <span className="whitespace-nowrap">{t.message_count} message{t.message_count === 1 ? "" : "s"}</span>
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
          <div key="chat" className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", viewDir === "back" ? "scout-view-back" : "")}>
          <RecorderBar state={rec} latest={lastCall} refresh={refreshRec} onDebrief={debrief} />
          <NeedsYouCard
            rows={urgent}
            extra={Math.max(0, (todayRows?.length ?? 0) - urgent.length)}
            onAsk={(r) => { askAbout(r); void refreshToday(); }}
            onOpen={openUrl}
            startFolded={msgs.length > 0}
          />
          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4">
            {msgs.length === 0 && !running && (
              <div className="scout-card-in flex flex-col items-center px-2 pb-2 pt-6 text-center">
                <Scoutie mood="idle" className="h-8 w-11 text-white" />
                <p className="mt-3 text-[1.0625rem] font-semibold text-white">What do you need?</p>
                <p className="mt-1 max-w-[18rem] text-[0.8125rem] leading-snug text-white/55">
                  I read the data, fix things and run jobs on the Mac mini. I know which page you're on.
                </p>
                <div className="mt-5 w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] text-left">
                  {OPENERS.map((o, n) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => send(o)}
                      style={{ animationDelay: `${80 + n * 60}ms` }}
                      className="scout-chip flex min-h-12 w-full items-center gap-3 border-t text-left border-white/[0.06] px-4 text-[0.9375rem] text-white first:border-t-0 hover:bg-white/[0.05] sm:min-h-11 sm:text-sm"
                    >
                      <span className="flex-1">{o}</span>
                      <ArrowUp className="h-3.5 w-3.5 rotate-45 text-white/35" aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {jobCards(-1)}
            {msgs.map((m, i) => {
              const toolsOn = i === lastUserIdx || i === lastBotIdx || i === toolsFor;
              // Messages-style time stamps: the first message, and again after a 10-minute gap.
              const prev = msgs[i - 1];
              const gap = !prev?.created_at || !m.created_at || Date.parse(m.created_at) - Date.parse(prev.created_at) > 10 * 60_000;
              const stamp = gap && m.created_at ? (
                <p className="pt-1 text-center text-[0.6875rem] font-medium text-white/35">{clockTime(m.created_at)}</p>
              ) : null;
              if (m.body === STOP_MARK) {
                return (
                  <Fragment key={m.id ?? i}>
                    <div className="flex items-center gap-2 py-1 text-[0.6875rem] font-medium text-white/40" role="note">
                      <span className="h-px flex-1 bg-white/10" />
                      <Square className="h-2.5 w-2.5 fill-current" aria-hidden />
                      You stopped Scout{m.created_at ? ` at ${clockTime(m.created_at)}` : ""}
                      <span className="h-px flex-1 bg-white/10" />
                    </div>
                    {jobCards(i)}
                  </Fragment>
                );
              }
              return (
              <Fragment key={m.id ?? i}>
              {stamp}
              <div
                className={cn("scout-row group", toolsOn && "scout-tools-on", m.role === "user" ? "scout-msg-user" : "scout-msg-bot")}
                onClick={(e) => {
                  // On a phone there is no hover: tap a message to show its copy / edit buttons.
                  if (!(e.target as HTMLElement).closest("button, a, pre")) setToolsFor((t) => (t === i ? null : i));
                }}
              >
                {m.role === "user" ? (
                  <div className="flex items-start justify-end gap-1">
                    <span className="scout-tools flex shrink-0 gap-0.5 pt-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit and resend"
                        onClick={() => startEdit(m)}
                        className="h-7 w-7 border-0 text-white/40 hover:bg-white/5 hover:text-white [@media(hover:none)]:h-9 [@media(hover:none)]:w-9"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete from here"
                        onClick={() => dropFrom(m)}
                        className="h-7 w-7 border-0 text-white/40 hover:bg-red-500/10 hover:text-red-400 [@media(hover:none)]:h-9 [@media(hover:none)]:w-9"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                    <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[1.125rem] rounded-br-md bg-[#0A84FF] px-3.5 py-2 text-[0.9375rem] leading-snug text-[#fff] sm:max-w-[80%] sm:text-sm">
                      {m.body}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-1">
                    <div className="min-w-0 flex-1">
                      {/* A fenced block becomes a real copyable box. splitFences and CopyBlock
                          have been imported and unused since before the chip work - so anything
                          Scout suggested running showed up as plain text with backticks around
                          it, which is the one kind of reply you most want to copy. */}
                      {splitFences(splitOptions(splitQuestions(m.body).text).text).map((part, k) =>
                        part.kind === "code" ? (
                          <CopyBlock key={k} text={part.content} className="max-w-[85%] sm:max-w-[80%]" />
                        ) : part.content.trim() ? (
                          <p key={k} className="whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed text-white/90 sm:text-sm">
                            {part.content.trim()}
                          </p>
                        ) : null,
                      )}
                      {(() => {
                        const qs = splitQuestions(m.body).questions;
                        return qs.length ? (
                          <p className="mt-1 text-xs text-white/45">
                            Asked you: {qs.map((q) => q.header || q.question).join(" · ")}
                          </p>
                        ) : null;
                      })()}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Copy"
                      onClick={async () => {
                        // copyText, not navigator.clipboard directly: the raw call rejects in a
                        // non-secure context and on older Safari, and nothing awaited it, so this
                        // used to show a tick whether or not anything reached the clipboard.
                        if (await copyText(splitOptions(splitQuestions(m.body).text).text)) {
                          setCopied(i);
                          setTimeout(() => setCopied(null), 1200);
                        }
                      }}
                      className="scout-tools h-7 w-7 shrink-0 border-0 text-white/40 hover:bg-white/5 hover:text-white [@media(hover:none)]:h-9 [@media(hover:none)]:w-9"
                    >
                      {copied === i ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                )}
              </div>
              {jobCards(i)}
              </Fragment>
              );
            })}

            {running && (
              <div className="scout-msg-bot flex items-center gap-2 text-sm text-white/50" aria-live="polite">
                <Scoutie mood="think" className="h-[1.15rem] w-[1.55rem] shrink-0 text-white/60" />
                <span className="scout-dots scout-shimmer">
                  {busy ? "Scout is working" : "Still going on its own"}<span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
                <span className="whitespace-nowrap text-xs tabular-nums text-white/35">
                  {clock(runStart ?? lastMsg?.created_at ?? null, workingFor)}
                </span>
                <span className="ml-auto hidden text-[0.6875rem] text-white/30 sm:inline">esc to stop</span>
              </div>
            )}
          </div>
          </div>
        )}

        {view === "chat" && (
          <div className={cn("border-t border-white/[0.06] p-3", phone && "pb-[max(0.75rem,env(safe-area-inset-bottom))]")}>
            {/* Everything tappable lives here, directly above the composer: the openers on an
                empty chat, then the reply options. Under the message they ended up wherever
                the reply happened to end and scrolled away as the conversation grew. */}
            {!running && !editing && (() => {
              const lastBot = [...msgs].reverse().find((m) => m.role !== "user");
              if (!lastBot) return null;
              const asked = splitQuestions(lastBot.body);
              if (asked.questions.length) {
                return <QuestionCard questions={asked.questions} onSubmit={(msg) => send(msg)} disabled={running} />;
              }
              const { text: botText, options } = splitOptions(asked.text);
              const chips = options.length ? options : fallbackOptions(botText);
              const lastAsk = [...msgs].reverse().find((m) => m.role === "user")?.body;
              return (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {chips.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => send(o)}
                      className="scout-chip min-h-9 rounded-full border border-white/15 bg-white/[0.06] px-3.5 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/[0.12] active:scale-[0.97]"
                    >
                      {o}
                    </button>
                  ))}
                  {/* Scout reads and proposes but never writes code. This is the door to the
                      thing that does, with the context already packed in. */}
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyText(
                        claudeFixPrompt(botText, lastAsk, typeof window !== "undefined" ? window.location.pathname : undefined),
                      );
                      setCopiedFix(ok ? "ok" : "fail");
                      setTimeout(() => setCopiedFix(null), 2200);
                    }}
                    className={cn(
                      "scout-chip inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed px-3.5 text-sm font-medium transition active:scale-[0.97]",
                      copiedFix === "fail"
                        ? "border-red-400/40 text-red-200"
                        : "border-white/20 text-white/70 hover:border-white/40 hover:text-white",
                    )}
                  >
                    {copiedFix === "ok" ? <Check className="h-3.5 w-3.5" /> : <Wrench className="h-3.5 w-3.5" />}
                    {copiedFix === "ok" ? "Copied - paste to Claude"
                      : copiedFix === "fail" ? "Couldn't copy - long-press the reply"
                      : "Fix with Claude"}
                  </button>
                </div>
              );
            })()}
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
            {queue.length > 0 && (
              <div className="scout-card-in mb-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2" aria-label="Queued messages">
                <div className="flex items-center gap-1.5 px-1.5 pb-1.5 text-[0.6875rem] font-medium text-white/50">
                  <Clock3 className="h-3 w-3" aria-hidden />
                  <span className="flex-1">
                    {queue.length === 1 ? "Queued. Sends when Scout finishes." : `${queue.length} queued. They go as one message when Scout finishes.`}
                  </span>
                </div>
                <ul className="max-h-32 space-y-1 overflow-y-auto">
                  {queue.map((q) => (
                    <li key={q.id} className="flex items-start gap-1 rounded-xl bg-white/[0.05] py-1 pl-2.5 pr-1">
                      <button
                        type="button"
                        onClick={() => {
                          // Tap to take it back into the box and change it.
                          setQueue((all) => all.filter((x) => x.id !== q.id));
                          setText((t) => [t, q.body].filter((x) => x.trim()).join("\n\n"));
                          inputRef.current?.focus();
                        }}
                        className="min-h-9 min-w-0 flex-1 whitespace-pre-wrap break-words py-1.5 text-left text-sm text-white/85"
                        aria-label="Edit this queued message"
                      >
                        {q.body}
                      </button>
                      <button
                        type="button"
                        onClick={() => setQueue((all) => all.filter((x) => x.id !== q.id))}
                        aria-label="Remove from queue"
                        className="scout-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/40 hover:bg-white/5 hover:text-white"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2 px-1 pt-2">
                  <button
                    type="button"
                    onClick={sendNow}
                    className="scout-press inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#0A84FF] px-3.5 text-[0.8125rem] font-semibold text-[#fff]"
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                    Send now
                  </button>
                  <span className="text-[0.6875rem] text-white/40">stops Scout and sends these</span>
                </div>
              </div>
            )}
            <AttachBar files={attach.files} onRemove={attach.remove} />
            <div className="flex items-end gap-2">
              <AttachButton onPick={attach.add} disabled={attach.busy} />
              <textarea
                ref={inputRef}
                id="scout-input"
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => {
                  // Cmd+Shift+4 then paste: the commonest way to show Scout what you are looking at.
                  const f = [...e.clipboardData.files];
                  if (f.length) { e.preventDefault(); void attach.add(f); }
                }}
                onDragOver={(e) => { e.preventDefault(); setOverDrop(true); }}
                onDragLeave={() => setOverDrop(false)}
                onDrop={(e) => {
                  e.preventDefault(); setOverDrop(false);
                  const f = [...e.dataTransfer.files];
                  if (f.length) void attach.add(f);
                }}
                onKeyDown={(e) => {
                  // On a phone Return is the only Return there is, so it types a newline
                  // and the button sends. On a keyboard, Enter sends and Shift+Enter wraps.
                  if (e.key === "Enter" && !e.shiftKey && !phone) {
                    e.preventDefault();
                    // While Scout works: Enter queues, Cmd/Ctrl+Enter interrupts and sends now.
                    if (running && (e.metaKey || e.ctrlKey)) sendNow();
                    else send(text, editing);
                  }
                }}
                enterKeyHint={phone ? "enter" : "send"}
                placeholder={running ? "Queue the next thing" : attach.count ? "Ask about the file" : "Ask Scout anything"}
                className={cn(overDrop && "border-[#0A84FF] bg-[#0A84FF]/10", "max-h-28 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-base sm:min-h-[2.375rem] sm:text-sm text-white transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-white/40 focus:border-white/25 focus:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
              />
              {running && !text.trim() && !attach.count ? (
                <Button
                  size="icon"
                  onClick={() => void stop()}
                  aria-label="Stop Scout"
                  title="Stop (Esc)"
                  className="scout-press h-11 w-11 shrink-0 rounded-full bg-white text-black transition-opacity hover:bg-white/90 sm:h-[2.375rem] sm:w-[2.375rem]"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  onClick={() => send(text, editing)}
                  disabled={attach.busy || (!text.trim() && !attach.count)}
                  aria-label={running ? "Add to the queue" : "Send to Scout"}
                  title={running ? "Queue it (Enter). Cmd+Enter sends now." : "Send (Enter)"}
                  className={cn(
                    "scout-press h-11 w-11 shrink-0 rounded-full transition-opacity disabled:opacity-40 sm:h-[2.375rem] sm:w-[2.375rem]",
                    running ? "border border-white/20 bg-white/[0.08] text-white hover:bg-white/[0.14]" : "bg-[#0A84FF] text-[#fff] hover:bg-[#0A84FF]/90",
                  )}
                >
                  {running ? <Clock3 className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
});

/**
 * Scout, as callers import it: the launcher (drawn once) plus one ScoutWindow per open window.
 *
 * Desktop can open up to four windows, each with its own conversation, position and draft. The first is the
 * primary: it keeps the original storage keys, owns Cmd+J, ?scout=open and the askScout events, and stays mounted
 * behind the launcher when closed (so a Mac job that finishes still reports back). Closing any other window
 * removes it. A phone shows only the primary, as the one full-screen sheet. The things that poll (Needs you,
 * the call recorder) are read once here and handed down, so more windows do not mean more requests.
 */
export function Scout() {
  const phone = useIsMobile();
  const [wins, setWins] = useState<WinEntry[]>(loadWindows);
  // Back to front. The last one is on top, and gets Esc when focus is not inside any Scout window.
  const [order, setOrder] = useState<string[]>(() => wins.map((w) => w.id));
  const [status, setStatus] = useState<PrimaryStatus>(() => ({ open: loadScoutState()?.open ?? false, running: false, pendingJobs: 0 }));
  const [bubble, setBubble] = useState(false);
  const primaryRef = useRef<ScoutHandle>(null);

  const shown = phone ? wins.slice(0, 1) : wins;
  const anyOpen = status.open || shown.length > 1;
  const today = useNeedsYou(anyOpen);
  const recorder = useRecorder(anyOpen);
  const recNow = useNow(recorder.state?.status === "recording");

  useEffect(() => {
    try { localStorage.setItem(WINDOWS_KEY, JSON.stringify(wins)); } catch { /* private mode */ }
  }, [wins]);

  const front = useCallback((id: string) => setOrder((o) => (o[o.length - 1] === id ? o : [...o.filter((x) => x !== id), id])), []);
  const setThread = useCallback((id: string, threadId: string | null) => {
    setWins((ws) => (ws.some((w) => w.id === id && w.threadId !== threadId) ? ws.map((w) => (w.id === id ? { ...w, threadId } : w)) : ws));
  }, []);
  const spawn = useCallback((from: DOMRect) => {
    if (wins.length >= MAX_WINDOWS) return;
    const id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    saveBox(cascadeBox(from), boxKeyFor(id));
    setWins((ws) => (ws.length >= MAX_WINDOWS ? ws : [...ws, { id, threadId: null }]));
    setOrder((o) => [...o, id]);
  }, [wins.length]);
  const remove = useCallback((id: string) => {
    setWins((ws) => ws.filter((w) => w.id !== id || w.id === PRIMARY_ID));
    setOrder((o) => o.filter((x) => x !== id));
    try {
      localStorage.removeItem(stateKeyFor(id));
      localStorage.removeItem(boxKeyFor(id));
    } catch { /* private mode */ }
  }, []);

  // The launcher's bubble: a new set of urgent items speaks up once; the same set never nags again.
  const waiting = today.urgent.length;
  const urgentSig = today.urgent.map((r) => r.key).join("|");
  const bubbleFor = useRef("");
  useEffect(() => {
    if (!urgentSig || urgentSig === bubbleFor.current || status.open) return;
    bubbleFor.current = urgentSig;
    setBubble(true);
    window.setTimeout(() => setBubble(false), 9000);
  }, [urgentSig, status.open]);

  const { pendingJobs, running } = status;
  const needs = waiting + pendingJobs;
  // Unread replies across every thread: the dot on the launcher, the phone tab bar and the History rows.
  const { threads: unreadThreads, anyUnread, anyNeedsYou } = useScoutUnread(anyOpen);
  const dotColor = scoutDotColor({
    anyNeedsYou,
    urgent: waiting,
    pendingJobs,
    anyUnread,
    normalWaiting: Math.max(0, (today.rows?.length ?? 0) - waiting),
  });
  useEffect(() => {
    publishScoutDot(dotColor);
  }, [dotColor]);
  const mood: Mood = running ? "think" : needs > 0 && !status.open ? "alert" : "idle";
  const recording = recorder.state?.status === "recording";
  const openPrimary = () => primaryRef.current?.open();

  const shownOrder = order.filter((id) => shown.some((w) => w.id === id));
  const frontId = shownOrder[shownOrder.length - 1];

  return (
    <>
      <style>{SCOUT_CSS}</style>
      {shown.map((w, i) => (
        <ScoutWindow
          key={w.id}
          ref={w.id === PRIMARY_ID ? primaryRef : undefined}
          id={w.id}
          primary={w.id === PRIMARY_ID}
          n={i + 1}
          z={Math.max(0, shownOrder.indexOf(w.id))}
          isFront={w.id === frontId}
          canSpawn={wins.length < MAX_WINDOWS}
          others={phone ? NO_THREADS : wins.filter((x) => x.id !== w.id && x.threadId).map((x) => x.threadId as string)}
          today={today}
          recorder={recorder}
          unreadThreads={unreadThreads}
          onFront={front}
          onThread={setThread}
          onSpawn={spawn}
          onRemove={remove}
          onStatus={w.id === PRIMARY_ID ? setStatus : undefined}
        />
      ))}
      {!status.open && (
        <>
          {!bubble && pendingJobs > 0 && (
            <button
              type="button"
              onClick={openPrimary}
              className="scout-bubble-in fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-5 z-40 hidden md:block max-w-[14rem] rounded-2xl rounded-br-sm border border-white/10 bg-white px-3.5 py-2.5 text-left text-xs font-medium text-black shadow-xl"
            >
              {pendingJobs === 1 ? "I have a Mac job ready. Tap Run?" : `${pendingJobs} Mac jobs are waiting for you.`}
            </button>
          )}
          {bubble && (
            <button
              type="button"
              onClick={() => {
                setBubble(false);
                openPrimary();
              }}
              className="scout-bubble-in fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-5 z-40 hidden md:block max-w-[14rem] rounded-2xl rounded-br-sm border border-white/10 bg-white px-3.5 py-2.5 text-left text-xs font-medium text-black shadow-xl"
            >
              {waiting === 1 ? "One thing needs you. Want the detail?" : `${waiting} things need you. Want the detail?`}
            </button>
          )}
          <button
            type="button"
            onClick={openPrimary}
            aria-label={`Open Scout (Cmd+J)${dotColor === "orange" ? ", needs you" : dotColor === "purple" ? ", unread replies" : ""}`}
            title="Scout (⌘J)"
            className={cn(
              "scout-launcher fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-40 hidden items-center gap-2.5 rounded-full md:flex",
              "px-4 py-2.5 text-sm font-semibold shadow-lg",
              "bg-white text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              needs > 0 && "scout-nudge",
              "relative",
            )}
          >
            <Scoutie mood={mood} className="h-[1.15rem] w-[1.55rem]" />
            Scout
            {recording && (
              <span className="ml-0.5 flex items-center gap-1.5 rounded-full bg-red-500 px-2 py-0.5 text-[0.6875rem] font-bold tabular-nums text-white">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />
                REC {clock(recorder.state?.started_at ?? null, recNow)}
              </span>
            )}
            {needs > 0 && (
              <span key={needs} className={cn(
                "scout-badge-pop ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[0.6875rem] font-bold",
                "text-black",
              )} style={{ background: dotHex(dotColor === "purple" ? "purple" : "orange") }}>
                {needs}
              </span>
            )}
            {dotColor && needs === 0 && (
              <span
                key={dotColor}
                aria-hidden
                data-testid="scout-unread-dot"
                style={{ background: dotHex(dotColor) }}
                className="scout-badge-pop absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-white"
              />
            )}
          </button>
        </>
      )}
    </>
  );
}
const NO_THREADS: string[] = [];

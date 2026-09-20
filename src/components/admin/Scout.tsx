import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X, CornerDownLeft } from "lucide-react";

/**
 * Scout - the assistant that lives in the corner of the admin.
 *
 * The thinking happens in the admin-chat edge function: it holds the tools
 * (read the queue, read the database, read and commit repo files), checks the
 * admin role against the caller's own JWT, and writes every tool run to
 * admin_chat_actions. This component is the window, not the brain.
 *
 * Colours: `white` and `black` are variable-backed in this repo (tailwind.config
 * maps them to --tw-white / --tw-black, which .admin-bento swaps). They already
 * flip for the light theme on their own - adding `bento:` overrides on top flips
 * them a second time and the text goes unreadable. Do not reintroduce them.
 */

interface Msg {
  role: "user" | "assistant";
  body: string;
}

type Mood = "idle" | "think" | "alert";

const OPENERS = [
  "What needs me most right now?",
  "Why is the mail queue stuck?",
  "What changed on the site this week?",
];

/**
 * The admin's side-eye binoculars, alive.
 *
 * Three moods: idle blinks and glances around, think squints and scans, alert
 * throws the lids wide open. All of it stops under prefers-reduced-motion.
 */
function Scoutie({ mood, className }: { mood: Mood; className?: string }) {
  return (
    <svg
      viewBox="0 0 26 20"
      className={cn("scoutie", `scoutie-${mood}`, className)}
      fill="none"
      aria-hidden="true"
    >
      <g className="scoutie-body">
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

@keyframes scout-blink {
  0%, 88%, 100% { transform: translateY(0); }
  92%, 95%      { transform: translateY(3.8px); }
}
@keyframes scout-glance {
  0%, 30%, 100% { transform: translateX(0); }
  40%, 52%      { transform: translateX(1.5px); }
  62%, 74%      { transform: translateX(-1.5px); }
}
@keyframes scout-squint {
  0%, 100% { transform: translateY(2.1px); }
  50%      { transform: translateY(2.9px); }
}
@keyframes scout-scan {
  0%, 100% { transform: translateX(-1.6px); }
  50%      { transform: translateX(1.6px); }
}
@keyframes scout-pop {
  0%, 100%  { transform: translateY(0); }
  8%, 26%   { transform: translateY(-2.2px); }
}

.scout-nudge { animation: scout-nudge 4.5s ease-in-out infinite; }
@keyframes scout-nudge {
  0%, 82%, 100%   { transform: translateY(0) rotate(0deg); }
  86%             { transform: translateY(-4px) rotate(-3deg); }
  90%             { transform: translateY(0) rotate(2deg); }
  94%             { transform: translateY(-2px) rotate(-1deg); }
}

.scout-pop-in { animation: scout-pop-in 220ms cubic-bezier(0.22, 1.2, 0.36, 1) both; }
@keyframes scout-pop-in {
  from { opacity: 0; transform: translateY(10px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.scout-bubble-in { animation: scout-bubble-in 260ms cubic-bezier(0.22, 1.2, 0.36, 1) both; }
@keyframes scout-bubble-in {
  from { opacity: 0; transform: translateY(6px) scale(0.94); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.scout-dots span { display: inline-block; animation: scout-dot 1.1s ease-in-out infinite; }
.scout-dots span:nth-child(2) { animation-delay: 0.15s; }
.scout-dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes scout-dot {
  0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
  30%           { opacity: 1;    transform: translateY(-2px); }
}

@media (prefers-reduced-motion: reduce) {
  .scoutie-lids, .scoutie-eyes, .scout-nudge,
  .scout-pop-in, .scout-bubble-in, .scout-dots span { animation: none !important; }
}
`;

export function Scout() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [bubble, setBubble] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // How much is actually waiting - drives whether Scout sits still or fidgets.
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
  }, [msgs, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useCallback(
    async (body: string) => {
      const asked = body.trim();
      if (!asked || busy) return;

      setMsgs((m) => [...m, { role: "user", body: asked }]);
      setText("");
      setBusy(true);

      const { data, error } = await supabase.functions.invoke("admin-chat", {
        body: { body: asked, thread_id: threadId },
      });

      const reply = error
        ? `I couldn't reach the server: ${error.message}`
        : (data as { reply?: string })?.reply || "Done.";

      if (!error && (data as { thread_id?: string })?.thread_id) {
        setThreadId((data as { thread_id: string }).thread_id);
      }

      setMsgs((m) => [...m, { role: "assistant", body: reply }]);
      setBusy(false);
      inputRef.current?.focus();
    },
    [busy, threadId],
  );

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
            {waiting === 1
              ? "One thing needs you. Want the detail?"
              : `${waiting} things need you. Want the detail?`}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Scout"
          className={cn(
            "fixed bottom-5 right-5 z-40 flex items-center gap-2.5 rounded-full",
            "px-4 py-2.5 text-sm font-semibold shadow-lg transition-transform hover:scale-105",
            "bg-white text-black",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            waiting > 0 && "scout-nudge",
          )}
        >
          <Scoutie mood={mood} className="h-[1.15rem] w-[1.55rem]" />
          Scout
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
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
          <Scoutie mood={mood} className="h-[1.15rem] w-[1.55rem] text-white" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">Scout</p>
            <p className="text-[0.6875rem] text-white/50">
              {busy ? "thinking it through" : "reads the data, changes the site"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label="Close Scout"
            className="h-8 w-8 border-0 text-white/50 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {msgs.length === 0 && (
            <>
              <p className="text-sm text-white/80">
                I can read anything in the database and change the site. What do you need?
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

          {msgs.map((m, i) =>
            m.role === "user" ? (
              <p
                key={i}
                className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-white px-3 py-2 text-sm text-black"
              >
                {m.body}
              </p>
            ) : (
              <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">
                {m.body}
              </p>
            ),
          )}

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

        <div className="flex items-end gap-2 border-t border-white/[0.06] p-3">
          <textarea
            ref={inputRef}
            id="scout-input"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder="Ask, or say what to change..."
            className="max-h-28 min-h-[2.375rem] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            size="icon"
            onClick={() => send(text)}
            disabled={busy || !text.trim()}
            aria-label="Send to Scout"
            className="h-[2.375rem] w-[2.375rem] shrink-0 bg-white text-black hover:bg-white/90"
          >
            <CornerDownLeft className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </>
  );
}

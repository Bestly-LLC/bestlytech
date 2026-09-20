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
 * It renders plain text on purpose - the function is told not to write markdown,
 * so there is no renderer here to go wrong.
 */

interface Msg {
  role: "user" | "assistant";
  body: string;
}

const OPENERS = [
  "What needs me most right now?",
  "Why is the mail queue stuck?",
  "What changed on the site this week?",
];

/** The admin's side-eye binoculars, at button size. */
function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 18" className={className} fill="none" aria-hidden="true">
      <rect x="10.4" y="6.2" width="5.2" height="3" rx="1.2" fill="currentColor" />
      <circle cx="6.6" cy="9.4" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="19.4" cy="9.4" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.5" cy="9.9" r="2.1" fill="currentColor" />
      <circle cx="21.3" cy="9.9" r="2.1" fill="currentColor" />
      <path d="M0 8.2 h13.2 v-4 a6.6 6.6 0 0 0 -13.2 0 z" fill="currentColor" />
      <path d="M12.8 8.2 h13.2 v-4 a6.6 6.6 0 0 0 -13.2 0 z" fill="currentColor" />
    </svg>
  );
}

export function Scout() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Scout"
        className={cn(
          "fixed bottom-5 right-5 z-40 flex items-center gap-2.5 rounded-full",
          "px-4 py-2.5 text-sm font-semibold shadow-lg transition-colors",
          "bg-white text-black hover:bg-white/90",
          "bento:bg-black bento:text-white bento:hover:bg-black/85",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        )}
      >
        <Mark className="h-4 w-[1.55rem]" />
        Scout
      </button>
    );
  }

  return (
    <section
      aria-label="Scout"
      className={cn(
        "fixed bottom-5 right-5 z-40 flex flex-col overflow-hidden rounded-2xl shadow-2xl",
        "w-[min(25rem,calc(100vw-2.5rem))] max-h-[min(38rem,calc(100vh-6rem))]",
        "border border-white/[0.08] bg-[#0b0b0d]/95 backdrop-blur-xl",
        "bento:border-black/10 bento:bg-white",
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3 bento:border-black/10">
        <Mark className="h-4 w-[1.55rem] text-white bento:text-black" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white bento:text-black">Scout</p>
          <p className="text-[0.6875rem] text-white/50 bento:text-black/50">
            reads the data, changes the site
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(false)}
          aria-label="Close Scout"
          className="h-8 w-8 border-0 text-white/50 hover:bg-white/5 hover:text-white bento:text-black/50 bento:hover:bg-black/5 bento:hover:text-black"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && (
          <>
            <p className="text-sm text-white/75 bento:text-black/75">
              I can read anything in the database and change the site. What do you need?
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {OPENERS.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => send(o)}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/25 hover:text-white bento:border-black/10 bento:text-black/70 bento:hover:border-black/25 bento:hover:text-black"
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
              className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-white px-3 py-2 text-sm text-black bento:bg-black bento:text-white"
            >
              {m.body}
            </p>
          ) : (
            <p
              key={i}
              className="whitespace-pre-wrap text-sm leading-relaxed text-white/90 bento:text-black/90"
            >
              {m.body}
            </p>
          ),
        )}

        {busy && (
          <p className="text-sm text-white/45 bento:text-black/45" aria-live="polite">
            Scout is working...
          </p>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-white/[0.06] p-3 bento:border-black/10">
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
          className="max-h-28 min-h-[2.375rem] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 bento:border-black/10 bento:bg-black/[0.03] bento:text-black bento:placeholder:text-black/35"
        />
        <Button
          size="icon"
          onClick={() => send(text)}
          disabled={busy || !text.trim()}
          aria-label="Send to Scout"
          className="h-[2.375rem] w-[2.375rem] shrink-0 bg-white text-black hover:bg-white/90 bento:bg-black bento:text-white bento:hover:bg-black/85"
        >
          <CornerDownLeft className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

/**
 * "Where did this to-do come from?" Tap a call to-do (admin Today › From your calls, or the
 * partner portal's Your to-dos) and this sheet shows the call it came from, what was agreed,
 * and the moment in the transcript, highlighted, with who said it and when.
 *
 * Data: rpc todo_call_context(p_id) (security definer). Admin sees any call to-do; a partner
 * only gets calls he was on. The matched line is stored on first look, so the moment is stable.
 */
import { useEffect, useState } from "react";
import { Loader2, MessageSquareQuote } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface CtxLine { at: string; secs: number; who: string; sure: boolean; text: string; hit: boolean }
interface Ctx {
  ok: boolean;
  error?: string;
  why?: "no_recording" | "no_transcript" | "not_found" | null;
  title?: string;
  note?: string | null;
  commitment?: { task?: string; owner?: string; due?: string | null } | null;
  meeting?: { id: string; name: string; started_at: string | null; stopped_at: string | null; people: string[]; summary: string | null };
  hit_at?: string | null;
  hit_secs?: number | null;
  lines?: CtxLine[];
}

const PT = { timeZone: "America/Los_Angeles" } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "meeting-20261006-0900" -> a Date (Pacific wall time read as local; only the day is used). */
function nameDate(name: string | undefined | null) {
  const k = String(name ?? "").match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  return k ? new Date(Number(k[1]), Number(k[2]) - 1, Number(k[3]), Number(k[4]), Number(k[5])) : null;
}

/** Short label for a to-do's call, for the row under the title: "Oct 6 call". */
export function callLabel(meeting: unknown) {
  const d = nameDate(String(meeting ?? ""));
  return d ? `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} call` : "the call";
}

const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, ...PT });
const shortDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...PT });
const longDay = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...PT });
const dueDay = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
function joinNames(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
/** 6298 -> "1:44:58" */
function offset(secs: number) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function TodoContextSheet({ todoId, title, viewer, onClose, onOpenCall }: {
  /** scout_daily id; null closes the sheet. */
  todoId: string | null;
  /** Shown while loading. */
  title?: string;
  /** Roster name of whoever is looking ("jared" in admin), left out of "with …". */
  viewer: string;
  onClose: () => void;
  /** Optional: open the whole call (partner portal Calls tab). */
  onOpenCall?: (meetingId: string) => void;
}) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!todoId) return;
    let live = true;
    setCtx(null);
    setFailed(false);
    supabase.rpc("todo_call_context" as never, { p_id: todoId } as never).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) { setFailed(true); return; }
      setCtx(data as unknown as Ctx);
    });
    return () => { live = false; };
  }, [todoId]);

  const m = ctx?.meeting;
  const started = m?.started_at ? new Date(m.started_at) : nameDate(m?.name);
  const people = (m?.people ?? []).filter((p) => p && p.toLowerCase() !== viewer.toLowerCase()).map(cap);
  // Jared first when someone else is looking: "with Jared and Elizabeth".
  people.sort((a, b) => Number(b === "Jared") - Number(a === "Jared") || a.localeCompare(b));
  const heading = started
    ? `From the ${shortDay(started)} call${people.length ? ` with ${joinNames(people)}` : ""}`
    : "Where this came from";
  const atClock = (secs: number) => (m?.started_at ? clock(new Date(Date.parse(m.started_at) + secs * 1000)) : offset(secs));
  const lines = ctx?.lines ?? [];
  const com = ctx?.commitment;

  return (
    <Sheet open={!!todoId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-lg bento:bg-[#F2F2F7]">
        <div className="border-b border-white/[0.06] px-5 pb-4 pt-6 pr-12">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#0A84FF] bento:text-[#007AFF]">
            <MessageSquareQuote className="h-4 w-4 shrink-0" aria-hidden />
            {ctx ? heading : "Where this came from"}
          </p>
          <SheetTitle className="mt-1.5 text-[20px] font-semibold leading-snug text-white">{ctx?.title ?? title ?? "To-do"}</SheetTitle>
          <SheetDescription className="mt-1 text-[13px] leading-snug text-white/60">
            {started ? `${longDay(started)}, ${clock(started)}` : ctx?.note ?? "The call and the moment it was agreed"}
          </SheetDescription>
        </div>

        <div className="flex-1 space-y-6 px-5 py-5">
          {!ctx && !failed && (
            <p className="flex items-center gap-2 text-[15px] text-white/60"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Finding the moment in the call</p>
          )}
          {(failed || (ctx && !ctx.ok)) && (
            <p className="text-[15px] text-white/70">This one isn't from a call you were on, or the recording is gone.</p>
          )}

          {ctx?.ok && com?.task && (
            <section aria-labelledby="ctx-agreed">
              <h3 id="ctx-agreed" className="px-1 text-[13px] font-semibold uppercase tracking-wide text-white/50">What was agreed</h3>
              <div className="mt-1.5 rounded-2xl bg-white/[0.05] px-4 py-3 bento:bg-[#fff]">
                <p className="text-[15px] leading-snug text-white">{com.task}</p>
                <p className="mt-1 text-[13px] text-white/60">
                  {com.owner ?? "Jared"}
                  {com.due ? <> · <span className="whitespace-nowrap">due {dueDay(com.due)}</span></> : null}
                </p>
              </div>
            </section>
          )}

          {ctx?.ok && lines.length > 0 && (
            <section aria-labelledby="ctx-moment">
              <h3 id="ctx-moment" className="flex flex-wrap items-baseline justify-between gap-x-3 px-1 text-[13px] font-semibold uppercase tracking-wide text-white/50">
                <span>The moment</span>
                {ctx.hit_secs != null && (
                  <span className="font-normal normal-case tracking-normal text-white/50">
                    <span className="whitespace-nowrap">{atClock(ctx.hit_secs)}</span>
                    {m?.started_at ? <> · <span className="whitespace-nowrap">{offset(ctx.hit_secs)} in</span></> : null}
                  </span>
                )}
              </h3>
              <ol className="mt-1.5 overflow-hidden rounded-2xl bg-white/[0.05] bento:bg-[#fff]">
                {lines.map((l, i) => (
                  <li
                    key={`${l.at}-${i}`}
                    aria-current={l.hit ? "true" : undefined}
                    className={cn(
                      "relative px-4 py-2.5",
                      i > 0 && "border-t border-white/[0.06]",
                      l.hit && "bg-[#0A84FF]/[0.14] bento:bg-[#007AFF]/[0.09]",
                    )}
                  >
                    {l.hit && <span className="absolute inset-y-0 left-0 w-[3px] bg-[#0A84FF] bento:bg-[#007AFF]" aria-hidden />}
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                      <span className={cn("font-semibold", l.who.toLowerCase() === viewer.toLowerCase() ? "text-[#0A84FF] bento:text-[#007AFF]" : "text-white/85")}>
                        {l.who || "Someone"}{!l.sure && <span className="font-normal text-white/50"> (best guess)</span>}
                      </span>
                      <span className="whitespace-nowrap tabular-nums text-white/50">{atClock(l.secs)}</span>
                      {l.hit && <span className="whitespace-nowrap text-[12px] font-semibold text-[#0A84FF] bento:text-[#007AFF]">This is it</span>}
                    </p>
                    <p className={cn("mt-0.5 text-[15px] leading-snug", l.hit ? "text-white" : "text-white/75")}>{l.text}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {ctx?.ok && lines.length === 0 && (
            <p className="rounded-2xl bg-white/[0.05] px-4 py-3 text-[15px] text-white/70 bento:bg-[#fff]">
              {ctx.why === "no_recording" ? "No recording is linked to this to-do." : "Couldn't find the exact moment in the transcript. It came from this call's list of who does what."}
            </p>
          )}

          {ctx?.ok && m?.summary && (
            <section aria-labelledby="ctx-call">
              <h3 id="ctx-call" className="px-1 text-[13px] font-semibold uppercase tracking-wide text-white/50">About the call</h3>
              <p className="mt-1.5 rounded-2xl bg-white/[0.05] px-4 py-3 text-[15px] leading-snug text-white/80 bento:bg-[#fff]">{m.summary}</p>
            </section>
          )}

          {ctx?.ok && m?.id && onOpenCall && (
            <button
              onClick={() => { onOpenCall(m.id); onClose(); }}
              className="min-h-[44px] w-full rounded-2xl bg-white/[0.05] px-4 text-[15px] font-medium text-[#0A84FF] transition active:scale-[0.99] bento:bg-[#fff] bento:text-[#007AFF]"
            >
              Open the whole call
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

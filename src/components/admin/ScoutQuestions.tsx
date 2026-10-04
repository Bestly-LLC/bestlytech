import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ask User Questions (admin-chat v32). When Scout is unsure, it ends its reply with one line:
 *
 *   QUESTIONS: {"questions":[{"question":"...","header":"...","options":[{"label":"...","description":"..."}],"multi_select":false}]}
 *
 * The window lifts that line out and shows this card above the composer: one question at a time (ADHD-friendly),
 * tappable answers, "Other…" to type your own, Back to change an answer. The last answer sends everything back as one
 * message, exactly as if Jared had typed it. The composer stays live, so he can ignore the card and just type.
 */
export type ScoutQuestion = {
  question: string;
  header?: string;
  multi_select?: boolean;
  options: { label: string; description?: string }[];
};

const QUESTION_LINE = /\n?^\s*QUESTIONS\s*:\s*(\{.*\})\s*$/m;

export function splitQuestions(body: string): { text: string; questions: ScoutQuestion[] } {
  const m = body.match(QUESTION_LINE);
  if (!m) return { text: body, questions: [] };
  try {
    const parsed = JSON.parse(m[1]) as { questions?: ScoutQuestion[] };
    const questions = (parsed.questions ?? [])
      .filter((q) => q && typeof q.question === "string" && Array.isArray(q.options) && q.options.length >= 2)
      .slice(0, 4);
    return { text: body.replace(QUESTION_LINE, "").trimEnd(), questions };
  } catch {
    return { text: body.replace(QUESTION_LINE, "").trimEnd(), questions: [] };
  }
}

/** The answers as one plain message Scout reads like anything he types. */
export function answersMessage(questions: ScoutQuestion[], answers: string[]): string {
  if (questions.length === 1) return answers[0] ?? "";
  return ["My answers:", ...questions.map((q, i) => `${i + 1}. ${q.header || q.question}: ${answers[i] ?? "(skipped)"}`)].join("\n");
}

export function QuestionCard({ questions, onSubmit, disabled }: {
  questions: ScoutQuestion[];
  onSubmit: (message: string) => void;
  disabled?: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [other, setOther] = useState<string | null>(null);   // null = closed; string = typing
  const otherRef = useRef<HTMLInputElement>(null);
  const q = questions[idx];
  const last = idx === questions.length - 1;

  // a new set of questions starts over
  const key = JSON.stringify(questions);
  useEffect(() => { setIdx(0); setAnswers([]); setPicked(new Set()); setOther(null); }, [key]);
  useEffect(() => { if (other !== null) otherRef.current?.focus(); }, [other]);

  if (!q) return null;

  const commit = (answer: string) => {
    const next = [...answers];
    next[idx] = answer;
    setAnswers(next);
    setPicked(new Set());
    setOther(null);
    if (last) onSubmit(answersMessage(questions, next));
    else setIdx(idx + 1);
  };
  const back = () => {
    if (idx === 0) return;
    setIdx(idx - 1);
    setPicked(new Set());
    setOther(null);
  };
  const toggle = (label: string) => {
    const s = new Set(picked);
    if (s.has(label)) s.delete(label); else s.add(label);
    setPicked(s);
  };
  const multiAnswer = () => {
    const parts = [...picked];
    if (other?.trim()) parts.push(other.trim());
    if (parts.length) commit(parts.join(", "));
  };

  return (
    <div className="scout-chip mb-2 space-y-2 rounded-2xl border border-white/10 bg-white/[0.05] p-3" role="group" aria-label="Scout's questions">
      <div className="flex items-center gap-2">
        {idx > 0 && (
          <button type="button" onClick={back} aria-label="Back to the previous question"
            className="-ml-1 grid h-8 w-8 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white">
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        {q.header && (
          <span className="rounded-full bg-[#0A84FF26] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.03em] text-[#64B5FF]">{q.header}</span>
        )}
        {questions.length > 1 && (
          <span className="ml-auto whitespace-nowrap text-xs text-white/50">{idx + 1} of {questions.length}</span>
        )}
      </div>

      <p className="text-[0.9375rem] font-medium leading-snug text-white sm:text-sm">{q.question}</p>
      {q.multi_select && <p className="-mt-1 text-xs text-white/50">Pick all that apply.</p>}

      <div className="space-y-1.5">
        {q.options.map((o) => {
          const on = picked.has(o.label);
          return (
            <button
              key={o.label}
              type="button"
              disabled={disabled}
              onClick={() => (q.multi_select ? toggle(o.label) : commit(o.label))}
              aria-pressed={q.multi_select ? on : undefined}
              className={cn(
                "flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition active:scale-[0.99] disabled:opacity-50",
                on ? "border-[#0A84FF] bg-[#0A84FF1f]" : "border-white/12 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.08]",
              )}
            >
              {q.multi_select && (
                <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-md border", on ? "border-[#0A84FF] bg-[#0A84FF] text-white" : "border-white/30")}>
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-white">{o.label}</span>
                {o.description && <span className="block text-xs leading-snug text-white/55">{o.description}</span>}
              </span>
            </button>
          );
        })}

        {other === null ? (
          <button type="button" disabled={disabled} onClick={() => setOther("")}
            className="flex min-h-11 w-full items-center rounded-xl border border-dashed border-white/20 px-3 text-left text-sm text-white/65 transition hover:border-white/35 hover:text-white disabled:opacity-50">
            Other…
          </button>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.multi_select) multiAnswer();
              else if (other.trim()) commit(other.trim());
            }}
          >
            <input
              ref={otherRef}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="Type your answer"
              aria-label="Your own answer"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/20 bg-black/30 px-3 text-base text-white placeholder:text-white/35 focus:border-[#0A84FF] focus:outline-none sm:text-sm"
            />
            {!q.multi_select && (
              <button type="submit" disabled={disabled || !other.trim()}
                className="min-h-11 shrink-0 rounded-xl bg-[#0A84FF] px-4 text-sm font-semibold text-white disabled:opacity-40">
                {last ? "Send" : "Next"}
              </button>
            )}
          </form>
        )}

        {q.multi_select && (
          <button type="button" disabled={disabled || (!picked.size && !other?.trim())} onClick={multiAnswer}
            className="min-h-11 w-full rounded-xl bg-[#0A84FF] text-sm font-semibold text-white transition disabled:opacity-40">
            {last ? "Send" : "Next"}
          </button>
        )}
      </div>
    </div>
  );
}

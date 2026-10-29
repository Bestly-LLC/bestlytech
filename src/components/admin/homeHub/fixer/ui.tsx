import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Wand2, AlertTriangle } from "lucide-react";

/* Small shared pieces for Tinker's fixer tabs (docs/ha-fixer-opusplan.md). Same look as the Automation Maker. */

/** Times, percentages and numbers with a unit stay on one line: "6:02 AM", "100%", "6 min", "72 °F", "Oct 29". */
const TOKEN = new RegExp(
  "(\\d{1,2}:\\d{2}(?::\\d{2})?\\s?[AP]M" +
  "|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s\\d{1,2}" +
  "|\\d+(?:\\.\\d+)?\\s?(?:%|°\\s?[FC]?)" +
  "|\\d+(?:\\.\\d+)?\\s(?:sec|seconds?|min|minutes?|hrs?|hours?|ft|feet|mi|miles?|mph|K)\\b)",
  "g",
);
const SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"“(¿¡])/;

function tokens(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(s.slice(last, i));
    out.push(<span key={i} className="whitespace-nowrap">{m[0]}</span>);
    last = i + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** House copy rule: a sentence that fits on a line is never split; it moves down whole. Numbers keep their unit. */
export function Prose({ children }: { children: string }) {
  const sentences = String(children ?? "").split(/\n/).flatMap((p) => p.split(SPLIT)).filter((s) => s.trim());
  return (
    <>
      {sentences.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="inline-block max-w-full">{tokens(s.trim())}</span>
        </Fragment>
      ))}
    </>
  );
}

/** "6:02 AM today", "Yesterday, 9:30 PM", "Oct 27, 6:02 AM". */
export function whenLong(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `${time} today`;
  const y = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

export function Banner({ tone, title, children }: { tone: "amber" | "red" | "green"; title: string; children: string }) {
  const c = tone === "amber" ? "border-amber-500/30 bg-amber-500/[0.07] text-amber-100"
    : tone === "green" ? "border-green-500/30 bg-green-500/[0.07] text-green-100"
    : "border-red-500/30 bg-red-500/[0.07] text-red-100";
  return (
    <div role={tone === "red" ? "alert" : undefined} className={`flex gap-3 rounded-xl border px-3.5 py-3 text-sm ${c}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold"><Prose>{title}</Prose></p>
        <p className="mt-0.5 opacity-90"><Prose>{children}</Prose></p>
      </div>
    </div>
  );
}

/** A soft glowing orb plus one line that rotates through the real steps. Feathered gradient, still under reduced motion. */
export function Working({ steps, label = "Tinker" }: { steps: string[]; label?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (steps.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % steps.length), 2800);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="flex min-h-[44px] items-center gap-3" role="status" aria-live="polite">
      <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden>
        <span className="absolute -inset-3 rounded-full bg-[radial-gradient(closest-side,rgba(251,191,36,0.45),rgba(251,191,36,0.12)_55%,transparent)] blur-md motion-safe:animate-pulse" />
        <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-300/90 to-orange-500/80 shadow-[0_0_18px_rgba(251,191,36,0.35)]">
          <Wand2 className="h-3.5 w-3.5 text-black/75" />
        </span>
      </span>
      <p className="min-w-0 text-sm text-white/85">
        <span className="text-white/60">{label}: </span>
        <span key={i} className="inline-block motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500"><Prose>{steps[i % steps.length]}</Prose></span>
      </p>
    </div>
  );
}

/** Segmented control in the iOS manner: a soft thumb slides under the label. Targets are 44 px tall. */
export function Segmented<T extends string>({
  value, onChange, items, label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; badge?: number }[];
  label: string;
}) {
  const idx = Math.max(0, items.findIndex((x) => x.id === value));
  return (
    <div role="tablist" aria-label={label} className="relative grid rounded-full border border-white/[0.08] bg-white/[0.04] p-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-white/[0.13] shadow-[0_1px_10px_rgba(0,0,0,0.35)] motion-safe:transition-transform motion-safe:duration-300 motion-safe:[transition-timing-function:cubic-bezier(0.32,0.72,0,1)]"
        style={{ width: `calc((100% - 0.5rem) / ${items.length})`, transform: `translateX(${idx * 100}%)` }}
      />
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.id)}
            className={`relative z-10 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-medium whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 motion-safe:transition-colors sm:px-4 sm:text-sm ${on ? "text-white" : "text-white/65 hover:text-white/90"}`}
          >
            {it.label}
            {it.badge ? (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-400/90 px-1.5 text-[11px] font-semibold leading-none text-black tabular-nums">{it.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

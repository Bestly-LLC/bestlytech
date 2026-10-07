import { useEffect, useRef, useState } from "react";
import { AdminMark } from "@/components/AdminMark";
import { ScoutBuddy, SCOUT_MOOD_INFO, type ScoutMood } from "@/components/admin/scout/ScoutBuddy";
import {
  BIG_ONE_LINE, NEEDS_LINE, REACTION_LINES, ROTATE_MS, TOOL_LINES, WORKING_LINES, greeting, makeBag, pageOffer, progressLine,
  replyBubble, welcomeBack,
} from "@/components/admin/scout/scoutLines";
import { cn } from "@/lib/utils";

/**
 * Scout Lab (admin only, not in the sidebar): every face Scout can make, at every size, on the dark admin surface and on the
 * white launcher pill, with a Replay for each and a reduced-motion preview, plus every line he can say. This is how the
 * character gets reviewed by eye after a deploy.
 */

const SIZES = ["sm", "md", "lg"] as const;

function Rotating() {
  const bag = useRef(makeBag());
  const [line, setLine] = useState(() => bag.current());
  useEffect(() => {
    const h = window.setInterval(() => setLine(bag.current()), ROTATE_MS);
    return () => window.clearInterval(h);
  }, []);
  return <span className="scout-dots scout-shimmer">{line}<span>.</span><span>.</span><span>.</span></span>;
}

function MoodCard({ mood, looks, trigger, oneShot, calm }: { mood: ScoutMood; looks: string; trigger: string; oneShot: boolean; calm: boolean }) {
  const [replay, setReplay] = useState(0);
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-label={mood}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold capitalize text-white">{mood}</h2>
          <p className="mt-0.5 text-sm text-white/65">{looks}</p>
          <p className="mt-1 text-xs text-white/45">Triggered by: {trigger}</p>
        </div>
        <button
          type="button"
          onClick={() => setReplay((n) => n + 1)}
          className="scout-press min-h-11 shrink-0 rounded-lg border border-white/15 px-3 text-sm font-medium text-white hover:bg-white/10"
        >
          Replay
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        {SIZES.map((size) => (
          <div key={size} className="flex flex-col items-center gap-1">
            <ScoutBuddy mood={mood} size={size} replay={replay} calm={calm} watchCursor={!calm} className="text-white" />
            <span className="text-[0.6875rem] text-white/40">{size}</span>
          </div>
        ))}
        <div className="ml-auto flex flex-col items-center gap-1">
          <div className="inline-flex items-center gap-2.5 rounded-full bg-[#fff] px-4 py-2.5 text-sm font-semibold text-[#000] shadow-lg">
            <ScoutBuddy mood={mood} size="sm" replay={replay} calm={calm} watchCursor={!calm} />
            Scout
          </div>
          <span className="text-[0.6875rem] text-white/40">launcher</span>
        </div>
      </div>
      {oneShot && <p className="mt-2 text-xs text-white/40">One-shot: tap Replay to watch it from the first frame.</p>}
    </section>
  );
}

export default function ScoutLab() {
  const [calm, setCalm] = useState(false);
  const sample = new Date();
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Scout Lab</h1>
          <p className="mt-1 max-w-xl text-sm text-white/60">
            Every face Scout can make, at every size, and every line he can say. At rest he matches the top-left logo
            and glances in time with it.
          </p>
        </div>
        <button
          type="button"
          aria-pressed={calm}
          onClick={() => setCalm((c) => !c)}
          className={cn(
            "scout-press min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors",
            calm ? "border-white bg-white text-black" : "border-white/20 text-white hover:bg-white/10",
          )}
        >
          Reduced motion preview: {calm ? "on" : "off"}
        </button>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-label="Logo comparison">
        <h2 className="text-base font-semibold text-white">Next to the logo</h2>
        <p className="mt-0.5 text-sm text-white/65">The logo on the left, idle Scout on the right. They should glance and blink together.</p>
        <div className="mt-4 flex items-center gap-8">
          <div className="flex flex-col items-center gap-1"><AdminMark className="h-20 w-20" /><span className="text-[0.6875rem] text-white/40">logo</span></div>
          <div className="flex flex-col items-center gap-1"><ScoutBuddy mood="idle" size="lg" calm={calm} className="text-white" /><span className="text-[0.6875rem] text-white/40">Scout</span></div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {SCOUT_MOOD_INFO.map((m) => <MoodCard key={m.mood} {...m} calm={calm} />)}
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-label="What he says">
        <h2 className="text-base font-semibold text-white">What he says</h2>
        <div className="mt-3 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-white/80">While working, by tool</h3>
            <ul className="mt-2 space-y-1 text-sm text-white/65">
              {Object.entries(TOOL_LINES).map(([tool, line]) => (
                <li key={tool} className="flex justify-between gap-3"><code className="text-white/45">{tool}</code><span className="text-right">{line}</span></li>
              ))}
            </ul>
            <h3 className="mt-4 text-sm font-medium text-white/80">No tool known yet (rotates every 3.5 seconds)</h3>
            <p className="mt-2 min-h-6 text-sm text-white/65"><Rotating /></p>
            <p className="mt-1 text-xs text-white/40">The bag: {WORKING_LINES.join(", ")}.</p>
            <h3 className="mt-4 text-sm font-medium text-white/80">Overrides</h3>
            <p className="mt-2 text-sm text-white/65">Past 45 seconds: {BIG_ONE_LINE}. With a free-AI progress note: {progressLine({ step: 23, min: 4 })}.</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-white/80">Bubble beside the launcher (panel closed)</h3>
            <ul className="mt-2 space-y-1 text-sm text-white/65">
              {(Object.keys(REACTION_LINES) as (keyof typeof REACTION_LINES)[]).map((k) => (
                <li key={k} className="flex justify-between gap-3"><span className="text-white/45 capitalize">{k}</span><span className="text-right">{REACTION_LINES[k]}</span></li>
              ))}
              <li className="flex justify-between gap-3"><span className="text-white/45">Proud, from his own words</span><span className="text-right">{replyBubble("proud", "Done with the Pi ports.\nMore detail below.")}</span></li>
              <li className="flex justify-between gap-3"><span className="text-white/45">Needs you</span><span className="text-right">{NEEDS_LINE}</span></li>
              <li className="flex justify-between gap-3"><span className="text-white/45">Back after 2 hours</span><span className="text-right">{welcomeBack(3)}</span></li>
            </ul>
            <h3 className="mt-4 text-sm font-medium text-white/80">Empty state greeting (Pacific time)</h3>
            <p className="mt-2 text-sm text-white/65">Right now: {greeting(sample)}</p>
            <h3 className="mt-4 text-sm font-medium text-white/80">Page offers</h3>
            <ul className="mt-2 space-y-1 text-sm text-white/65">
              {["/admin/turo", "/admin/security"].map((p) => (
                <li key={p} className="flex justify-between gap-3"><code className="text-white/45">{p}</code><span className="text-right">{pageOffer(p)?.line}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

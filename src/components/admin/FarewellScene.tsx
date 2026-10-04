import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Package } from "lucide-react";
import { AdminMark } from "@/components/AdminMark";
import { BotMascot } from "@/components/admin/BotMascot";
import { cn } from "@/lib/utils";

/**
 * The reorg farewell: Scout and The Recruiter (HR) let one or more bots go. About 3.5 seconds, skippable.
 *   1. stage springs in, Scout says thanks
 *   2. The Recruiter hands each departing bot a box (it arcs over from HR)
 *   3. the bot closes its eyes for a beat (a little sigh), then hops off stage right carrying its box
 *   4. caption: who left and where the work went, with Done and Undo
 * Reduced motion: the final caption only. Interruptible: Skip jumps to the end at any time (Apple HIG).
 */
export type Leaver = {
  id: string; slug: string; name: string; icon: string | null; intoName?: string | null;
  /** who takes over what */
  duties?: { duty: string; toName: string | null }[];
};

const SPRING = { type: "spring", stiffness: 380, damping: 26 } as const;

export function FarewellScene({ leavers, onDone, onUndo, preview = false }: {
  leavers: Leaver[];
  onDone: () => void;
  onUndo: () => void;
  /** play the scene without anyone actually leaving */
  preview?: boolean;
}) {
  const reduce = useReducedMotion();
  // 0 enter · 1 thanks · 2 box · 3 sigh · 4 walk out · 5 caption
  const [step, setStep] = useState(reduce ? 5 : 0);

  useEffect(() => {
    if (reduce) return;
    const at = [350, 1000, 1500, 2000, 3200];
    const timers = at.map((ms, i) => window.setTimeout(() => setStep((s) => Math.max(s, i + 1)), ms));
    return () => timers.forEach(clearTimeout);
  }, [reduce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") (step >= 5 ? onDone() : setStep(5));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onDone]);

  const one = leavers.length === 1;
  const shown = leavers.slice(0, 5);
  const heirs = [...new Set(leavers.flatMap((l) => (l.duties?.length ? l.duties.map((d) => d.toName) : [l.intoName])).filter(Boolean))] as string[];
  const oneDuties = one ? leavers[0].duties ?? [] : [];
  const title = one ? `${leavers[0].name} has left the crew` : `${leavers.length} bots left the crew`;
  const detail = one
    ? oneDuties.length ? (heirs.length ? "Here's who takes over what:" : "Its job wasn't needed any more.")
      : leavers[0].intoName ? `${leavers[0].intoName} picks up its work.` : "Its job wasn't needed any more."
    : heirs.length ? `Their work moves to ${heirs.join(", ")}.` : "Their jobs weren't needed any more.";

  return (
    <motion.div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      role="dialog" aria-modal="true" aria-label={title}
    >
      <motion.div
        className="relative w-full max-w-[420px] overflow-hidden rounded-[28px] bg-[#1C1C1E] p-5 text-white shadow-2xl bento:bg-white bento:text-[#1d1d1f]"
        initial={{ scale: reduce ? 1 : 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING}
      >
        {/* stage */}
        <div className="relative h-[150px]" aria-hidden>
          {/* Scout + HR, stage left */}
          <div className="absolute bottom-3 left-2 flex items-end gap-1">
            <div className="grid h-[60px] w-[60px] place-items-center rounded-[18px] bg-[#0A84FF1f]">
              <AdminMark className="h-11 w-11 text-[#fff] bento:text-[#000]" watchCursor={false} />
            </div>
            <div className="grid h-[52px] w-[52px] place-items-center rounded-[16px] bg-[#BF5AF226] text-[#BF5AF2] bento:text-[#8944AB]">
              <BotMascot icon="user-plus" seed="hr" watchCursor={false} className="h-9 w-9" />
            </div>
          </div>

          {/* Scout's line */}
          <AnimatePresence>
            {step >= 1 && step < 5 && (
              <motion.div
                className="absolute left-4 top-1 max-w-[210px] rounded-[16px] rounded-bl-[4px] bg-[#2C2C2E] px-3 py-2 text-[13px] font-medium leading-snug bento:bg-[#F2F2F7]"
                initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={SPRING}
              >
                {one ? `Thanks for everything, ${leavers[0].name}.` : "Thanks for everything, crew."}{" "}
                <span className="opacity-70">We're simplifying.</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* the leavers, stage right */}
          <div className="absolute bottom-3 right-2 flex items-end gap-1.5">
            {shown.map((l, i) => (
              <motion.div
                key={l.id}
                className="relative flex flex-col items-center"
                animate={
                  step >= 4
                    ? { x: [0, 60, 120, 260], y: [0, -10, 0, -8], opacity: [1, 1, 1, 0] }
                    : step >= 3 ? { y: 3 } : { x: 0, y: 0, opacity: 1 }
                }
                transition={step >= 4 ? { duration: 1.1, delay: i * 0.12, ease: "easeIn" } : SPRING}
              >
                <div className={cn("grid place-items-center rounded-[16px] bg-[#0A84FF1f] text-[#409CFF] bento:bg-[#007AFF14] bento:text-[#007AFF]",
                  shown.length > 2 ? "h-[44px] w-[44px]" : "h-[56px] w-[56px]")}>
                  <BotMascot icon={l.icon ?? "bot"} seed={l.slug} watchCursor={false} asleep={step === 3}
                    className={shown.length > 2 ? "h-8 w-8" : "h-10 w-10"} />
                </div>
                {/* the box */}
                <AnimatePresence>
                  {step >= 2 && (
                    <motion.div
                      className="-mt-2 text-[#C8A26B]"
                      // The Recruiter hands each one a box: it flies over from HR (stage left) in a little arc
                      initial={{ x: -230 + i * 40, y: -10, opacity: 0, rotate: -25 }}
                      animate={{ x: [-230 + i * 40, -110, 0], y: [-10, -46, 0], opacity: [0, 1, 1], rotate: [-25, -8, 0] }}
                      transition={{ duration: 0.55, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <Package className={shown.length > 2 ? "h-6 w-6" : "h-7 w-7"} strokeWidth={2.2} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
            {leavers.length > shown.length && (
              <span className="mb-4 text-[13px] opacity-70">+{leavers.length - shown.length}</span>
            )}
          </div>
        </div>

        {/* caption */}
        <AnimatePresence mode="wait">
          {step >= 5 ? (
            <motion.div key="cap" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} className="space-y-1 pt-1">
              <p className="text-[20px] font-semibold leading-tight">{title}</p>
              <p className="text-[15px] leading-snug opacity-80">{detail}</p>
              {one && heirs.length > 0 && oneDuties.length > 0 && (
                <ul className="space-y-1 py-1">
                  {oneDuties.slice(0, 4).map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-[14px] leading-snug">
                      <span className="min-w-0 flex-1 opacity-80">{d.duty}</span>
                      <span className={cn("shrink-0 whitespace-nowrap font-semibold", d.toName ? "text-[#409CFF] bento:text-[#007AFF]" : "opacity-50 font-normal")}>
                        {d.toName ? `→ ${d.toName}` : "Dropped"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!one && (
                <ul className="space-y-1 py-1">
                  {leavers.slice(0, 5).map((l) => {
                    const to = [...new Set((l.duties ?? []).map((d) => d.toName).filter(Boolean))] as string[];
                    const heir = to.length ? to.join(", ") : l.intoName;
                    return (
                      <li key={l.id} className="flex items-start gap-2 text-[14px] leading-snug">
                        <span className="min-w-0 flex-1 opacity-80">{l.name}</span>
                        <span className={cn("shrink-0 whitespace-nowrap font-semibold", heir ? "text-[#409CFF] bento:text-[#007AFF]" : "opacity-50 font-normal")}>
                          {heir ? `→ ${heir}` : "Not needed"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="pt-1 text-[13px] leading-snug opacity-60">
                {preview ? "Just a preview. Nobody actually left." : `Scout has the plan to switch ${one ? "its job" : "their jobs"} off and waits for your yes.`}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-3">
                <button type="button" autoFocus onClick={onDone}
                  className="min-h-[44px] rounded-full bg-[#0A84FF] px-5 text-[15px] font-semibold text-white active:opacity-80">
                  Done
                </button>
                {preview ? (
                  <button type="button" onClick={onUndo}
                    className="min-h-[44px] rounded-full px-4 text-[15px] font-medium text-[#409CFF] active:opacity-70 bento:text-[#007AFF]">
                    Play again
                  </button>
                ) : (
                  <button type="button" onClick={onUndo}
                    className="min-h-[44px] rounded-full px-4 text-[15px] font-medium text-[#409CFF] active:opacity-70 bento:text-[#007AFF]">
                    Undo
                  </button>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div key="skip" exit={{ opacity: 0 }} className="flex justify-end pt-1">
              <button type="button" onClick={() => setStep(5)}
                className="min-h-[44px] rounded-full px-4 text-[15px] font-medium opacity-70 active:opacity-50">
                Skip
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

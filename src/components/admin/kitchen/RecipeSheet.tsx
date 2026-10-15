import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { Segmented, TAP } from "./Segmented";
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Clock, CookingPot, Info, Loader2, Pause, Play, RotateCcw,
  Timer as TimerIcon, Users, X,
} from "lucide-react";

// Recipe view + cook mode for Basil's dinner ideas (basil_kitchen_recipe). Steps mark ingredients as {k} or {k|amount};
// cook mode bolds each one with its amount right next to it. Recipes with omni_steps get an Omni Cook / Stovetop switch
// (Omni Cook first: Jared wants to use it more) and a settings card per step.

type Status = "have" | "low" | "out" | "arriving";
interface Ing {
  k: string; name: string; amt: string; omni_amt?: string | null; m?: string; opt?: boolean;
  item?: string | null; item_id?: string | null; status?: Status | null;
}
interface Omni { mode: string; f?: number; c?: number; min: number; speed?: string; rev?: boolean }
interface Step { t: string; timer?: number; omni?: Omni }
interface Recipe {
  name: string; how: string; serves: number | null; minutes: number | null; omni_note: string | null;
  steps: Step[]; omni_steps: Step[] | null; ingredients: Ing[];
}

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;
const TOKEN = /\{(\w+)(?:\|([^}]*))?\}/g;
const NB = " ";

/** "rotisserie chicken, shredded" reads as "rotisserie chicken" inside a sentence. */
const shortName = (n: string) => n.split(",")[0].trim();
const amountFor = (ing: Ing, omni: boolean) => (omni && ing.omni_amt) || ing.amt;
const fmtMin = (m: number) => (m < 1 ? `${Math.round(m * 60)}${NB}sec` : `${m}${NB}min`);
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

export function RecipeSheet({ name, onClose, onReopen, wide, onPantryChanged }: {
  name: string | null; onClose: () => void; onReopen: (name: string) => void; wide: boolean; onPantryChanged: () => void;
}) {
  const open = !!name;
  const title = name ?? "Recipe";
  // The timer lives here, not in the sheet, so closing the sheet mid-recipe never loses it.
  const timer = useStepTimer();
  const resume = timer.meta && timer.meta.recipe === name ? timer.meta : null;
  const body = name ? (
    <RecipeBody key={name} name={name} onClose={onClose} onPantryChanged={onPantryChanged} wide={wide} timer={timer} resume={resume} />
  ) : null;
  const pill = !open && timer.meta && (timer.running || timer.done) ? (
    <button
      type="button" onClick={() => onReopen(timer.meta!.recipe)}
      className={cn(
        "fixed right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full border border-white/10 bg-[#1c1c1e]/95 px-4 shadow-[0_10px_30px_rgba(0,0,0,.45)] backdrop-blur-xl",
        "bottom-[calc(env(safe-area-inset-bottom)+6rem)] md:bottom-6 md:right-6 bento:bg-white/95 bento:border-black/10",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-4 motion-safe:duration-300", TAP,
      )}
      aria-label={`${timer.meta.recipe}: ${timer.done ? "timer done" : `${fmtClock(timer.left)} left`}. Open the recipe.`}
    >
      <TimerIcon className={cn("h-4 w-4", timer.done ? "text-emerald-300" : "text-amber-200")} aria-hidden />
      <span className="max-w-[11rem] text-sm font-medium text-white sm:max-w-none">{timer.meta.recipe.split(" ").slice(0, 3).join(" ")}</span>
      <span className={cn("text-sm font-semibold tabular-nums", timer.done ? "text-emerald-300" : "text-amber-100")}>{timer.done ? "Done" : fmtClock(timer.left)}</span>
    </button>
  ) : null;

  if (wide) {
    return (
      <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <SheetDescription className="sr-only">Recipe and step-by-step cooking</SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
      {pill}
      </>
    );
  }
  return (
    <>
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent className="h-[94dvh] max-h-[94dvh]">
        <DrawerTitle className="sr-only">{title}</DrawerTitle>
        <DrawerDescription className="sr-only">Recipe and step-by-step cooking</DrawerDescription>
        {body}
      </DrawerContent>
    </Drawer>
    {pill}
    </>
  );
}

type View = "overview" | "cook" | "done";

function RecipeBody({ name, onClose, onPantryChanged, wide, timer, resume }: {
  name: string; onClose: () => void; onPantryChanged: () => void; wide: boolean; timer: TimerState; resume: TimerMeta | null;
}) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [omni, setOmni] = useState(resume?.omni ?? true);
  const [view, setView] = useState<View>(resume ? "cook" : "overview");
  const [idx, setIdx] = useState(resume?.step ?? 0);
  const [dir, setDir] = useState<1 | -1>(1);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: e } = await rpc("basil_kitchen_recipe", { p_name: name });
    if (e) { setError(e.message); return; }
    const r = data as Recipe;
    setRecipe(r);
    setOmni((o) => (resume ? resume.omni : o) && !!r.omni_steps?.length);
  }, [name, resume]);
  useEffect(() => { load(); }, [load]);

  const steps = (omni && recipe?.omni_steps?.length ? recipe.omni_steps : recipe?.steps) ?? [];
  const byKey = useMemo(() => new Map((recipe?.ingredients ?? []).map((i) => [i.k, i])), [recipe]);
  const go = useCallback((to: number) => {
    setDir(to > idx ? 1 : -1);
    setIdx(Math.max(0, Math.min(steps.length - 1, to)));
  }, [idx, steps.length]);

  useWakeLock(view === "cook");

  // Desktop keyboard in cook mode: arrows move between steps.
  useEffect(() => {
    if (view !== "cook") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") { e.preventDefault(); if (idx < steps.length - 1) go(idx + 1); else setView("done"); }
      if (e.key === "ArrowLeft") { e.preventDefault(); if (idx > 0) go(idx - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, idx, steps.length, go]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-start gap-3 p-6">
        <p role="alert" className="text-sm text-red-200">Couldn't open the recipe. {error}</p>
        <Button variant="outline" onClick={load}>Retry</Button>
      </div>
    );
  }
  if (!recipe) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-2/3 bg-white/[0.06]" />
        <Skeleton className="h-4 w-1/3 bg-white/[0.06]" />
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-11 bg-white/[0.04]" />)}
      </div>
    );
  }

  if (view === "cook") {
    const step = steps[idx];
    const last = idx === steps.length - 1;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <CookHeader
          name={recipe.name} idx={idx} total={steps.length} wide={wide}
          onBack={() => setView("overview")} onClose={onClose} timer={timer} onJump={(i) => go(i)}
        />
        <p className="sr-only" aria-live="polite">Step {idx + 1} of {steps.length}</p>
        <Swipe
          key={`${omni}-${idx}`} dir={dir}
          onNext={() => (last ? setView("done") : go(idx + 1))} onPrev={() => idx > 0 && go(idx - 1)}
        >
          <p className="text-[1.375rem] leading-[1.45] tracking-[-0.01em] text-white/85 text-pretty sm:text-2xl sm:leading-[1.4]">
            <StepText text={step.t} byKey={byKey} omni={omni} />
          </p>
          {omni && step.omni && <OmniCard o={step.omni} />}
          {step.timer ? <StepTimer minutes={step.timer} stepIdx={idx} timer={timer} meta={{ recipe: recipe.name, omni, step: idx }} /> : null}
        </Swipe>
        <div className="flex gap-3 border-t border-white/[0.06] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <Button
            variant="outline" className={cn("h-12 flex-1 text-base sm:h-11", TAP)} disabled={idx === 0}
            onClick={() => go(idx - 1)}
          >
            <ChevronLeft className="mr-1 h-5 w-5" aria-hidden />Back
          </Button>
          <Button className={cn("h-12 flex-[2] text-base sm:h-11", TAP)} onClick={() => (last ? setView("done") : go(idx + 1))}>
            {last ? "Finish" : "Next step"}
            {!last && <ChevronRight className="ml-1 h-5 w-5" aria-hidden />}
          </Button>
        </div>
      </div>
    );
  }

  if (view === "done") {
    return <Finish recipe={recipe} onBack={() => setView("cook")} onClose={onClose} onPantryChanged={onPantryChanged} />;
  }

  // Overview
  const need = recipe.ingredients.filter((i) => !i.opt && i.m && (!i.status || i.status === "out"));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-5 sm:px-6 sm:pt-8">
        <h2 className="pr-10 text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-white text-balance">{recipe.name}</h2>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/65">
          {recipe.minutes != null && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Clock className="h-4 w-4" aria-hidden />{recipe.minutes}{NB}min</span>
          )}
          {recipe.serves != null && (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Users className="h-4 w-4" aria-hidden />Serves {recipe.serves}</span>
          )}
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{steps.length} steps</span>
        </p>

        {!!recipe.omni_steps?.length && (
          <div className="mt-5">
            <Segmented
              label="How to cook it" value={omni ? "omni" : "stove"} onChange={(v) => setOmni(v === "omni")}
              className="w-full sm:w-auto"
              options={[
                { key: "omni", label: <span className="inline-flex items-center gap-1.5"><CookingPot className="h-4 w-4" aria-hidden />Omni Cook</span> },
                { key: "stove", label: "Stovetop" },
              ]}
            />
            {omni && recipe.omni_note && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-white/55">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{recipe.omni_note}
              </p>
            )}
          </div>
        )}

        <h3 className="mt-7 text-xs font-semibold uppercase tracking-wide text-white/55">Ingredients</h3>
        <ul className="mt-2 divide-y divide-white/[0.06]">
          {recipe.ingredients.map((i) => <IngredientRow key={i.k} ing={i} omni={omni} />)}
        </ul>
        <p className={cn("mt-3 text-sm", need.length ? "text-amber-200" : "text-white/60")}>
          {need.length === 0 ? "You have everything for this." : `Not in your kitchen: ${need.map((n) => shortName(n.name)).join(", ")}.`}
        </p>
      </div>
      <div className="border-t border-white/[0.06] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <Button className={cn("h-12 w-full text-base sm:h-11", TAP)} onClick={() => { setIdx(0); setDir(1); setView("cook"); }}>
          <Play className="mr-2 h-4 w-4" aria-hidden />Start cooking
        </Button>
      </div>
    </div>
  );
}

function IngredientRow({ ing, omni }: { ing: Ing; omni: boolean }) {
  const s = ing.status;
  const tracked = !!ing.m;
  const state = !tracked ? null
    : s === "have" || s === "arriving" ? { icon: Check, label: s === "arriving" ? "On the way" : "In your kitchen", tone: "text-emerald-300" }
    : s === "low" ? { icon: AlertTriangle, label: "Running low", tone: "text-amber-200" }
    : ing.opt ? { icon: null, label: "Optional", tone: "text-white/50" }
    : { icon: X, label: s === "out" ? "Used up" : "Not in your kitchen", tone: "text-red-200" };
  const Icon = state?.icon;
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <span className="min-w-0 text-[0.9375rem] leading-snug text-white/80">
        <strong className="font-semibold text-white">{ing.name.charAt(0).toUpperCase() + ing.name.slice(1)}</strong>
        {ing.opt && tracked && s && s !== "out" ? <span className="text-white/50"> (optional)</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Amount>{amountFor(ing, omni)}</Amount>
        {/* Same slot on every row so the amounts line up, even for untracked staples like water. */}
        <span className={cn("inline-flex w-5 justify-center", state?.tone)} title={state?.label}>
          {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
          {state && <span className="sr-only">{state.label}</span>}
        </span>
      </span>
    </li>
  );
}

/** The amount chip that sits right after a bolded ingredient. Never wraps away from its unit. */
function Amount({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-md bg-amber-500/15 px-1.5 py-px align-[0.06em] text-[0.82em] font-medium tabular-nums text-amber-100">
      {children}
    </span>
  );
}

function StepText({ text, byKey, omni }: { text: string; byKey: Map<string, Ing>; omni: boolean }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const ing = byKey.get(m[1]);
    if (ing) {
      parts.push(
        <span key={at}>
          <strong className="font-semibold text-white">{shortName(ing.name)}</strong>{NB}<Amount>{m[2] ?? amountFor(ing, omni)}</Amount>
        </span>,
      );
    } else {
      parts.push(m[0]);
    }
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function OmniCard({ o }: { o: Omni }) {
  const cells: { label: string; value: string; sub?: string }[] = [{ label: "Mode", value: o.mode === "Saute" ? "Sauté" : o.mode }];
  if (o.f != null) cells.push({ label: "Temp", value: `${o.f}°F`, sub: o.c != null ? `${o.c}°C` : undefined });
  cells.push({ label: "Time", value: fmtMin(o.min) });
  if (o.speed) cells.push({ label: "Speed", value: o.speed, sub: o.rev ? "Reverse" : undefined });
  return (
    <section aria-label="Omni Cook settings" className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/60">
        <CookingPot className="h-3.5 w-3.5" aria-hidden />Set the Omni Cook
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label}>
            <dt className="text-xs text-white/55">{c.label}</dt>
            <dd className="whitespace-nowrap text-xl font-semibold tabular-nums tracking-[-0.01em] text-white">{c.value}</dd>
            {c.sub && <dd className="text-xs text-white/55">{c.sub}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------- Cook mode chrome ---------- */

function CookHeader({ name, idx, total, wide, onBack, onClose, timer, onJump }: {
  name: string; idx: number; total: number; wide: boolean; onBack: () => void; onClose: () => void;
  timer: TimerState; onJump: (i: number) => void;
}) {
  return (
    <div className="border-b border-white/[0.06] px-4 pb-3 pt-3 sm:px-6 sm:pt-5">
      <div className={cn("flex items-center gap-2", wide && "pr-8")}>
        <button type="button" onClick={onBack} className={cn("-ml-2 inline-flex min-h-11 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-white/70 hover:text-white", TAP)}>
          <ChevronLeft className="h-5 w-5" aria-hidden />Recipe
        </button>
        <p className="min-w-0 flex-1 text-center text-sm font-medium text-white/60">
          <span className="sr-only">{name}, </span>Step {idx + 1} of {total}
        </p>
        {timer.meta?.recipe === name && timer.step != null && timer.step !== idx ? (
          <button
            type="button" onClick={() => onJump(timer.step!)}
            className={cn("inline-flex min-h-11 items-center gap-1 rounded-full bg-amber-500/15 px-3 text-sm font-medium tabular-nums text-amber-100", TAP)}
            aria-label={`Timer for step ${timer.step + 1}: ${fmtClock(timer.left)} left. Go to that step.`}
          >
            <TimerIcon className="h-4 w-4" aria-hidden />{fmtClock(timer.left)}
          </button>
        ) : !wide ? (
          <button type="button" onClick={onClose} aria-label="Close recipe" className={cn("inline-flex h-11 w-11 items-center justify-center rounded-full text-white/60 hover:text-white", TAP)}>
            <X className="h-5 w-5" aria-hidden />
          </button>
        ) : <span className="w-11" aria-hidden />}
      </div>
      <div className="mt-2 flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full motion-safe:transition-colors motion-safe:duration-300", i <= idx ? "bg-white/80" : "bg-white/15")} />
        ))}
      </div>
    </div>
  );
}

/** One step's content. Horizontal swipe moves between steps (vertical scroll still works); the new step slides in
 * from the side you swiped toward, so the motion matches the gesture. */
function Swipe({ children, dir, onNext, onPrev }: { children: ReactNode; dir: 1 | -1; onNext: () => void; onPrev: () => void }) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  return (
    <div
      className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 py-6 sm:px-6 sm:py-8"
      onPointerDown={(e) => { start.current = { x: e.clientX, y: e.clientY, t: performance.now() }; }}
      onPointerUp={(e) => {
        const s = start.current; start.current = null;
        if (!s) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        const v = Math.abs(dx) / Math.max(1, performance.now() - s.t); // px per ms
        if (Math.abs(dx) > Math.abs(dy) * 1.5 && (Math.abs(dx) > 70 || (Math.abs(dx) > 30 && v > 0.5))) {
          if (dx < 0) onNext(); else onPrev();
        }
      }}
    >
      <div
        className={cn(
          "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300 motion-safe:ease-out",
          dir > 0 ? "motion-safe:slide-in-from-right-8" : "motion-safe:slide-in-from-left-8",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------- Timer ---------- */

interface TimerMeta { recipe: string; omni: boolean; step: number }
interface TimerState {
  step: number | null; total: number; left: number; running: boolean; done: boolean; meta: TimerMeta | null;
  start: (meta: TimerMeta, minutes: number) => void; pause: () => void; resume: () => void; reset: () => void;
}

/** One kitchen timer for the whole recipe. It keeps counting while you move between steps. */
function useStepTimer(): TimerState {
  const [step, setStep] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [done, setDone] = useState(false);
  const [meta, setMeta] = useState<TimerMeta | null>(null);

  useEffect(() => {
    if (endsAt == null) return;
    const tick = () => {
      const s = Math.ceil((endsAt - Date.now()) / 1000);
      if (s <= 0) {
        setLeft(0); setEndsAt(null); setDone(true);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        chime();
        toast.success(`Timer done${step != null ? ` for step ${step + 1}` : ""}${meta ? ` of ${meta.recipe}` : ""}`, { duration: 10000 });
      } else setLeft(s);
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [endsAt, step, meta]);

  return {
    step, total, left, running: endsAt != null, done, meta,
    start: (m, minutes) => { const secs = Math.round(minutes * 60); setMeta(m); setStep(m.step); setTotal(secs); setLeft(secs); setDone(false); setEndsAt(Date.now() + secs * 1000); },
    pause: () => { setEndsAt(null); },
    resume: () => { if (left > 0) setEndsAt(Date.now() + left * 1000); },
    reset: () => { setEndsAt(null); setStep(null); setLeft(0); setTotal(0); setDone(false); setMeta(null); },
  };
}

function StepTimer({ minutes, stepIdx, timer, meta }: { minutes: number; stepIdx: number; timer: TimerState; meta: TimerMeta }) {
  const mine = timer.step === stepIdx && timer.meta?.recipe === meta.recipe;
  if (!mine || (!timer.running && timer.left === 0 && !timer.done)) {
    return (
      <Button
        variant="outline" className={cn("mt-6 h-12 w-full justify-center text-base sm:w-auto sm:px-5", TAP)}
        onClick={() => timer.start(meta, minutes)}
      >
        <TimerIcon className="mr-2 h-4 w-4" aria-hidden />
        Start {fmtMin(minutes)} timer
      </Button>
    );
  }
  const pct = timer.total ? 1 - timer.left / timer.total : 1;
  return (
    <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4" role="timer" aria-live="off">
      <div className="flex items-center gap-4">
        <span className={cn("text-[2.5rem] font-semibold leading-none tabular-nums tracking-[-0.02em]", timer.done ? "text-emerald-300" : "text-white")}>
          {timer.done ? "Done" : fmtClock(timer.left)}
        </span>
        <span className="ml-auto flex gap-2">
          {!timer.done && (
            <Button
              variant="outline" size="icon" className={cn("h-11 w-11", TAP)}
              aria-label={timer.running ? "Pause timer" : "Resume timer"}
              onClick={() => (timer.running ? timer.pause() : timer.resume())}
            >
              {timer.running ? <Pause className="h-5 w-5" aria-hidden /> : <Play className="h-5 w-5" aria-hidden />}
            </Button>
          )}
          <Button variant="outline" size="icon" className={cn("h-11 w-11", TAP)} aria-label="Reset timer" onClick={timer.reset}>
            <RotateCcw className="h-5 w-5" aria-hidden />
          </Button>
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <div className="h-full origin-left rounded-full bg-amber-300 motion-safe:transition-transform motion-safe:duration-300" style={{ transform: `scaleX(${pct})` }} />
      </div>
    </div>
  );
}

/** Two soft notes when a timer ends (the one sound on this page, because something happened). */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.65);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* no audio, the toast and vibration still fire */ }
}

/** Keep the phone screen on while cooking. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    let alive = true;
    const get = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lock = await (navigator as any).wakeLock.request("screen");
        if (!alive) lock?.release();
      } catch { /* not allowed (battery saver); cooking still works */ }
    };
    get();
    const onVis = () => { if (document.visibilityState === "visible") get(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVis); lock?.release().catch(() => {}); };
  }, [on]);
}

/* ---------- Finish: tell Basil what ran out ---------- */

function Finish({ recipe, onBack, onClose, onPantryChanged }: { recipe: Recipe; onBack: () => void; onClose: () => void; onPantryChanged: () => void }) {
  const items = useMemo(() => {
    const seen = new Set<string>();
    return recipe.ingredients.filter((i) => {
      if (!i.item_id || !i.status || i.status === "out" || seen.has(i.item_id)) return false;
      seen.add(i.item_id); return true;
    });
  }, [recipe]);
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.item_id!, i.status === "arriving" ? "have" : i.status!])));
  const [saving, setSaving] = useState(false);

  const changed = items.filter((i) => picks[i.item_id!] !== (i.status === "arriving" ? "have" : i.status));
  const save = async () => {
    if (!changed.length) { onClose(); return; }
    setSaving(true);
    const results = await Promise.all(changed.map((i) => rpc("basil_kitchen_set", { p_id: i.item_id, p_status: picks[i.item_id!] })));
    setSaving(false);
    const failed = results.filter((r) => r.error).length;
    if (failed) toast.error(`${failed} of ${changed.length} didn't save. Try again from the list.`);
    else toast.success(changed.length === 1 ? "Updated 1 item" : `Updated ${changed.length} items`);
    onPantryChanged();
    onClose();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-5 sm:px-6 sm:pt-8">
        <button type="button" onClick={onBack} className={cn("-ml-2 inline-flex min-h-11 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-white/70 hover:text-white", TAP)}>
          <ChevronLeft className="h-5 w-5" aria-hidden />Last step
        </button>
        <h2 className="mt-2 text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-white">Enjoy it.</h2>
        <p className="mt-1 text-[0.9375rem] text-white/65">Did anything run low or run out? Basil updates the list.</p>
        {items.length === 0 ? (
          <p className="mt-6 text-sm text-white/60">None of these come from your kitchen list.</p>
        ) : (
          <ul className="mt-5 divide-y divide-white/[0.06]">
            {items.map((i) => (
              <li key={i.item_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
                <span className="min-w-0 font-medium text-white">{i.item}</span>
                <Segmented
                  label={`${i.item} after cooking`} value={picks[i.item_id!]}
                  onChange={(v) => setPicks((p) => ({ ...p, [i.item_id!]: v }))}
                  options={[
                    { key: "have", label: "Have" },
                    { key: "low", label: "Low", thumb: "bg-amber-500/25", ink: "text-amber-200" },
                    { key: "out", label: "Out", thumb: "bg-red-500/25", ink: "text-red-200" },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-white/[0.06] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <Button className={cn("h-12 w-full text-base sm:h-11", TAP)} onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {changed.length ? `Save ${changed.length === 1 ? "1 change" : `${changed.length} changes`}` : "Done"}
        </Button>
      </div>
    </div>
  );
}

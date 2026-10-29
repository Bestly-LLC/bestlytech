import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react";
import "./agent-demo.css";
import { APPS } from "./apps";
import { DesktopWindow } from "./DesktopWindow";
import { MayaCallPanel } from "./MayaCallPanel";
import { BRANDS, preloadPerson } from "./brand";
import { BizLogo } from "./appKit";
import { Glued } from "./RevealText";
import { Transport } from "./Transport";
import { SCENARIOS } from "./scenarios";
import { allEvents, captionAt, firedCount, toolMarks } from "./timeline";
import { useDemoClock } from "./useDemoClock";

export type DemoStageHandle = {
  /** Load a call. With `play`, start it right away (call this from a click, so sound is allowed). */
  select: (id: string, play?: boolean) => void;
  /** Play the call that is on screen now: resume it if paused, start it over if it has ended. Call from a click. */
  playCurrent: () => void;
};

/** The call in the address bar (?call=dental), or the first call when it is missing or not one of ours. */
function callFromUrl(): number {
  if (typeof window === "undefined") return 0;
  try {
    const id = new URLSearchParams(window.location.search).get("call");
    const i = id ? SCENARIOS.findIndex((s) => s.id === id) : -1;
    return i > 0 ? i : 0;
  } catch {
    return 0;
  }
}

/**
 * Keep the chosen call in the address bar so a reload or a shared link lands on it. replaceState on purpose: no router
 * navigation (nothing remounts, the page does not scroll) and no extra history entries. The router's own history state
 * is passed back in so Back and Forward keep working. The first call is the default, so it leaves the bar clean.
 */
function rememberCall(id: string, first: boolean) {
  try {
    const url = new URL(window.location.href);
    if (first) url.searchParams.delete("call");
    else url.searchParams.set("call", id);
    const next = url.pathname + url.search + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, "", next);
    }
  } catch {
    /* the address bar just will not remember it */
  }
}

/**
 * The demo stage: pick a business, press play, and watch the call and the software side by side. Maya's call (left)
 * and the mock desktop window (right) are both drawn from one clock, see useDemoClock.
 */
export const DemoStage = forwardRef<DemoStageHandle, { onTalk: () => void }>(function DemoStage({ onTalk }, ref) {
  const [idx, setIdx] = useState(callFromUrl);
  const scenario = SCENARIOS[idx];
  const clock = useDemoClock(scenario);
  const { timeline, t } = clock;
  const clockRef = useRef(clock); // the clock object changes every frame; handlers read it through this instead
  clockRef.current = clock;
  const [nudge, setNudge] = useState(false);
  const root = useRef<HTMLElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const pendingPlay = useRef(false);
  const chosenByVisitor = useRef(false);
  const nudged = useRef(false);

  const events = useMemo(() => allEvents(scenario, timeline), [scenario, timeline]);
  const count = firedCount(events, t);
  const fired = useMemo(() => events.slice(0, count), [events, count]);
  const marks = useMemo(() => toolMarks(scenario, timeline), [scenario, timeline]);
  const toasts = useMemo(
    () => fired.filter((e) => e.do === "toast").map((e) => ({ at: e.t, text: String(e.text ?? "") })),
    [fired],
  );
  const caption = useMemo(() => captionAt(scenario, timeline, t), [scenario, timeline, t]);
  const tq = Math.floor(t * 10) / 10; // apps re-draw ten times a second, not every frame

  const app = APPS[scenario.app];
  const brand = BRANDS[scenario.id];
  const App = app.Component;

  const choose = useCallback(
    (i: number, play: boolean) => {
      if (i === idx) {
        if (play) clockRef.current.replay();
        return;
      }
      pendingPlay.current = play;
      chosenByVisitor.current = true;
      setIdx(i);
    },
    [idx],
  );

  // The caller's photo starts loading the moment a chip is chosen, so it never pops in mid-call.
  useEffect(() => {
    preloadPerson(scenario.caller.name);
  }, [scenario.caller.name]);

  useEffect(() => {
    rememberCall(scenario.id, idx === 0);
  }, [scenario.id, idx]);

  // A new call has just loaded (the clock reset itself first): warm its audio, and start it if asked to. A call that
  // came from the address bar waits for the first press of Play instead, so a shared link never downloads audio unasked.
  useEffect(() => {
    const c = clockRef.current;
    if (chosenByVisitor.current || pendingPlay.current) c.prime();
    if (pendingPlay.current) {
      pendingPlay.current = false;
      c.play();
    }
  }, [scenario.id]);

  useImperativeHandle(
    ref,
    () => ({
      select: (id, play = false) => {
        const i = SCENARIOS.findIndex((s) => s.id === id);
        if (i >= 0) choose(i, play);
      },
      playCurrent: () => clockRef.current.play(),
    }),
    [choose],
  );

  // First time the stage scrolls into view, the Play button gets one gentle pulse. Never autoplay.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !nudged.current) {
          nudged.current = true;
          setNudge(true);
          window.setTimeout(() => setNudge(false), 2600);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // While the demo itself is on screen, the site's floating Maya pill and scroll-to-top button step aside (html.maya-yield,
  // see maya-widget.css) so they never sit on top of the call, the window or the transport. They come straight back when
  // the demo leaves view. Only the bottom 10% of the screen counts, because that is the corner they live in.
  useEffect(() => {
    const el = root.current;
    const html = document.documentElement;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const live = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) live.add(e.target);
          else live.delete(e.target);
        }
        html.classList.toggle("maya-yield", live.size > 0);
      },
      { rootMargin: "-90% 0px 0px 0px" },
    );
    el.querySelectorAll(".ad-grid, .ad-dock").forEach((n) => io.observe(n));
    return () => {
      io.disconnect();
      html.classList.remove("maya-yield");
    };
  }, []);

  // When the real Maya opens or starts a live call, this scripted one stops talking.
  const pauseRef = useRef(clock.pause);
  pauseRef.current = clock.pause;
  useEffect(() => {
    const stop = () => pauseRef.current();
    window.addEventListener("maya:open", stop);
    window.addEventListener("maya:call-start", stop);
    return () => {
      window.removeEventListener("maya:open", stop);
      window.removeEventListener("maya:call-start", stop);
    };
  }, []);

  // Keep the chosen chip in view in the phone's scrolling row (horizontal only, so the page never jumps).
  useEffect(() => {
    const row = chipsRef.current;
    const el = row?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!row || !el || row.scrollWidth <= row.clientWidth + 1) return;
    const target = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [idx]);

  const onChipKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const n = (idx + dir + SCENARIOS.length) % SCENARIOS.length;
    choose(n, false);
    requestAnimationFrame(() => chipsRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus());
  };

  const onStageKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== " " && e.code !== "Space") return;
    if (e.repeat) return;
    const el = e.target as HTMLElement;
    if (el.closest("button, a, input, textarea, select")) return; // those handle Space themselves
    e.preventDefault();
    clock.toggle();
  };

  const next = SCENARIOS[(idx + 1) % SCENARIOS.length];

  return (
    <section
      id="demo"
      ref={root}
      className="ad-stage"
      data-nudge={nudge && !clock.started ? "1" : "0"}
      data-playing={clock.playing ? "1" : "0"}
      data-busy={clock.playing ? "true" : undefined}
      aria-labelledby="demo-title"
      onKeyDown={onStageKey}
    >
      <div className="ad-band">
        <div className="ad-inner">
          <div className="ad-intro">
            <p className="ad-eyebrow">Sample calls</p>
            <h2 id="demo-title" className="font-modern">Watch Maya take a call</h2>
            <p>
              Pick a kind of business and press play. On one side, the call. On the other, the software Maya updates while she talks.
            </p>
          </div>

          <div id="demo-chips" ref={chipsRef} className="ad-chips" role="radiogroup" aria-label="Pick a kind of business">
            {SCENARIOS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={i === idx}
                tabIndex={i === idx ? 0 : -1}
                className="ad-chip"
                onClick={() => choose(i, false)}
                onKeyDown={onChipKey}
              >
                <BizLogo slug={BRANDS[s.id].logo} size={18} />
                <span className="whitespace-nowrap">{s.chip}</span>
              </button>
            ))}
          </div>

          <p id="demo-scene" className="ad-scene" aria-live="polite">
            <Glued text={scenario.hook} />
          </p>

          <div className="ad-grid">
            <MayaCallPanel
              scenario={scenario}
              timeline={timeline}
              events={events}
              t={t}
              started={clock.started}
              playing={clock.playing}
              buffering={clock.buffering}
              ended={clock.ended}
              level={clock.level}
              onNext={() => choose((idx + 1) % SCENARIOS.length, true)}
              onTalk={onTalk}
              nextLabel={`Play ${next.chip.toLowerCase()} call`}
            />
            <DesktopWindow
              appName={scenario.appName}
              logo={brand.logo}
              brand={brand.short}
              clock={scenario.clock}
              accent={app.accent}
              sidebar={app.sidebar}
              current={app.current}
              toasts={toasts}
              t={tq}
              bodyHeight={app.bodyHeight}
              bodyHeightNarrow={app.bodyHeightNarrow}
            >
              <App key={scenario.id} events={fired} t={tq} caller={scenario.caller} ended={clock.ended} />
            </DesktopWindow>
          </div>

          <Transport clock={clock} marks={marks} caption={caption} captionWho={scenario.caller.name.split(" ")[0]} />

          <p className="ad-fine">
            Sample calls with made-up businesses and callers. The calls are scripted and the software window is a mock-up, so you can see how it works.
          </p>
        </div>
      </div>
      <audio ref={clock.audioRef} preload="none" className="hidden" />
    </section>
  );
});

/**
 * Mini Leo (delivery trip page, 2026-10-12). When the big orb at the top scrolls out of view, a small copy of it springs into the
 * bottom-right corner with a speech bubble beside it. Tapping either opens Leo right there (no scrolling back up): a floating panel
 * anchored to the bottom that uses the SAME session (one Leo at a time) and the same transcript, mic and typing parts as the hero.
 *
 * The bubble:
 *  - starts with "Need help? Tap me!", then changes every ~5s to the next relevant line (leoNudges.ts) with a soft crossfade;
 *  - holds still while the guest is touching the screen or scrolling fast, and while Leo is in use;
 *  - tucks itself away after 4 changes without a tap, and comes back with a fresh line when the guest reaches a new section
 *    or the lines themselves change (so it never nags).
 * Tapping a bubble sends that bubble's question to Leo as the guest's first message (text mode: quiet and instant).
 *
 * Motion: springs (apple-design: damping 0.8, response 0.42) in, a quick ease-in out, opacity only with Reduce Motion.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Mic } from "lucide-react";
import type { useLeoSession } from "./useLeoSession";
import { Composer, Transcript, UnlockAudio, VoiceRow } from "./DeliveryLeo";
import { OrbFace, OrbGlow, springEase, springMs, useOrbReact, useStaged } from "./LeoOrb";
import type { NudgeItem } from "./leoNudges";
import { track } from "./track";

type Sess = ReturnType<typeof useLeoSession>;

const ROTATE_MS = 5000;
const TUCK_AFTER = 4;        // changes without a tap, then the bubble tucks away
const FAST_PX_PER_MS = 1.0;  // scrolling faster than this holds the bubble still
const SPRING = { damping: 0.8, response: 0.42 };

/** The bubble's rotation: which line is showing, and whether it has tucked itself away. */
function useNudgeRotation(items: NudgeItem[], section: string | null, docked: boolean, quiet: boolean) {
  const [idx, setIdx] = useState(0);
  const [tucked, setTucked] = useState(false);
  const rounds = useRef(0);
  const holdUntil = useRef(0);   // timestamp: don't change the line before this
  const dockedAt = useRef(0);
  const len = items.length;
  const ctxKey = useMemo(() => items.map((i) => i.text).join("|"), [items]);

  // Finger down or scrolling fast: hold still.
  useEffect(() => {
    let lastY = window.scrollY, lastT = performance.now();
    const down = () => { holdUntil.current = Infinity; };
    const up = () => { holdUntil.current = Date.now() + 1500; };
    const scroll = () => {
      const t = performance.now(), y = window.scrollY, v = Math.abs(y - lastY) / Math.max(1, t - lastT);
      lastY = y; lastT = t;
      if (v > FAST_PX_PER_MS && holdUntil.current !== Infinity) holdUntil.current = Date.now() + 1200;
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", up, { passive: true });
    window.addEventListener("scroll", scroll, { passive: true });
    return () => { window.removeEventListener("touchstart", down); window.removeEventListener("touchend", up); window.removeEventListener("touchcancel", up); window.removeEventListener("scroll", scroll); };
  }, []);

  // Docking again starts over with the opener.
  useEffect(() => { if (docked) { setIdx(0); setTucked(false); rounds.current = 0; holdUntil.current = 0; dockedAt.current = Date.now(); } }, [docked]);

  // A new section or new lines: back with a fresh line (the best one for where the guest is).
  const seen = useRef({ section, ctxKey });
  useEffect(() => {
    if (seen.current.section === section && seen.current.ctxKey === ctxKey) return;
    seen.current = { section, ctxKey };
    if (Date.now() - dockedAt.current < 2500) return; // it just docked: the opener goes first, the section's line follows it
    rounds.current = 0; setTucked(false); setIdx(len > 1 ? 1 : 0);
  }, [section, ctxKey, len]);

  // Leo in use (panel open or a session running): the bubble steps aside and stays tucked afterwards.
  useEffect(() => { if (quiet) setTucked(true); }, [quiet]);

  useEffect(() => {
    if (!docked || quiet || tucked) return;
    const id = window.setInterval(() => {
      if (Date.now() < holdUntil.current) return;
      rounds.current += 1;
      if (rounds.current > TUCK_AFTER) { setTucked(true); return; }
      setIdx((i) => (i + 1) % Math.max(1, len));
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [docked, quiet, tucked, len]);

  return { idx: Math.min(idx, Math.max(0, len - 1)), tucked };
}

/** The bubble text with a soft crossfade: the old line fades out over the new one, in the same spot. */
function NudgeText({ text }: { text: string }) {
  const [prev, setPrev] = useState<string | null>(null);
  const last = useRef(text);
  useEffect(() => {
    if (last.current === text) return;
    setPrev(last.current); last.current = text;
    const t = window.setTimeout(() => setPrev(null), 520);
    return () => window.clearTimeout(t);
  }, [text]);
  return (
    <span className="dl-nudge-txt">
      {prev && <span key={`p-${prev}`} aria-hidden className="dl-nudge-line dl-line-out">{prev}</span>}
      <span key={`c-${text}`} className={`dl-nudge-line ${prev ? "dl-line-in" : ""}`}>{text}</span>
    </span>
  );
}

/** Raises the panel above the on-screen keyboard (iOS keeps fixed elements behind it). */
function useKeyboardInset(on: boolean) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!on || !vv) { setInset(0); return; }
    const f = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    f(); vv.addEventListener("resize", f); vv.addEventListener("scroll", f);
    return () => { vv.removeEventListener("resize", f); vv.removeEventListener("scroll", f); };
  }, [on]);
  return inset;
}

export function LeoDock({ sess, token, heroVisible, nudges, section, onAct }: { sess: Sess; token: string; heroVisible: boolean; nudges: NudgeItem[]; section: string | null; onAct?: (a: "honk") => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const inUse = sess.phase === "live" || sess.phase === "connecting";
  const miniShow = !heroVisible && !open;
  const mini = useStaged(miniShow, 260);
  const panel = useStaged(open, 300);
  const rot = useNudgeRotation(nudges, section, miniShow, open || inUse);
  const bubbleShow = miniShow && !rot.tucked && !inUse;
  const bubble = useStaged(bubbleShow, 240);
  const spring = useMemo(() => ({ ["--dl-spring" as string]: springEase(SPRING.damping, SPRING.response), ["--dl-spring-ms" as string]: `${springMs(SPRING.damping, SPRING.response)}ms` }), []);
  const kb = useKeyboardInset(open);

  const orb = useRef<HTMLButtonElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const live = sess.phase === "live", wait = sess.phase === "connecting";
  useOrbReact(sess, orb, glow, live && mini.mounted, 0.7);

  const panelEl = useRef<HTMLDivElement>(null);
  const openPanel = useCallback(() => { setOpen(true); window.setTimeout(() => panelEl.current?.focus({ preventScroll: true }), 60); }, []);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [open]);

  const current = nudges[rot.idx] ?? nudges[0];
  const tapOrb = () => { track(token, "leo_mini_open", { section }); openPanel(); };
  const tapBubble = () => {
    if (!current) return;
    track(token, "leo_nudge_tap", { text: current.text, section });
    const ask = () => { openPanel(); void sess.send(current.send); };
    if (current.act && onAct) { void onAct(current.act).then((ok) => { if (!ok) ask(); }, ask); return; }
    ask();
  };

  const status = wait ? "Connecting" : live ? (sess.voice ? (sess.speaking ? "Leo is talking" : sess.muted ? "Muted" : "Listening") : "Chatting") : "Your trip helper";
  const empty = sess.items.length <= 1 && !sess.working;

  return (
    <>
      {mini.mounted && (
        <div className="dl-dock" style={spring as React.CSSProperties}>
          {bubble.mounted && current && (
            <button type="button" className="dl-nudge" data-in={bubble.entered && bubbleShow} onClick={tapBubble} aria-label={`${current.text} Open Leo.`}>
              <NudgeText text={current.text} />
            </button>
          )}
          <div className="dl-mini" data-in={mini.entered && miniShow}>
            <OrbGlow glowRef={glow} mode={live ? "live" : wait ? "wait" : "idle"} mini />
            <button ref={orb} type="button" className="dl-orb dl-orb-mini" data-live={live} onClick={tapOrb} aria-label={live ? "Open Leo" : "Talk to Leo"}>
              <OrbFace />
            </button>
          </div>
        </div>
      )}

      {panel.mounted && (
        <div ref={panelEl} tabIndex={-1} role="dialog" aria-label="Leo, your trip helper" className="dl-panel" data-in={panel.entered && open}
          style={{ ...(spring as React.CSSProperties), ["--dl-kb" as string]: `${kb}px` }}>
          <div className="flex items-center gap-3">
            <span className="dl-orb dl-orb-sm shrink-0" aria-hidden><OrbFace /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[20px] font-bold leading-tight" style={{ fontFamily: "var(--trip-title-font)", color: "var(--d-ink)" }}>Leo</p>
              <p className="text-[14px] leading-tight" style={{ color: "var(--d-body)" }} aria-live="polite">{status}</p>
            </div>
            <button type="button" onClick={close} aria-label="Minimize Leo" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[rgba(19,40,42,0.07)] active:scale-95" style={{ color: "var(--d-ink)" }}>
              <ChevronDown className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="dl-panel-body mt-2">
            {empty && <p className="px-1 py-2 text-[16px] leading-snug" style={{ color: "var(--d-body)" }}>Ask me anything about your trip, or tap the mic and talk.</p>}
            <Transcript sess={sess} className="mt-1" last={8} />
          </div>

          <div className="mt-2 grid gap-2">
            <UnlockAudio sess={sess} />
            {live && sess.voice ? <VoiceRow sess={sess} /> : (
              <button type="button" disabled={wait} onClick={() => (live ? void sess.toggleMic() : void sess.start(true))}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#E2733A] px-3 text-[16px] font-bold text-[#13282A] shadow-md shadow-[rgba(143,77,18,0.25)] active:scale-[0.99] disabled:opacity-60">
                <Mic className="h-5 w-5" aria-hidden />{wait ? "Connecting" : "Talk to Leo"}
              </button>
            )}
            <Composer sess={sess} inputId="leo-dock-type" className="" />
          </div>
        </div>
      )}
    </>
  );
}

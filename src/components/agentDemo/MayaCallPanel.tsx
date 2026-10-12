import { useEffect, useMemo, useRef } from "react";
import { Check, Mic, PhoneCall, RotateCcw } from "lucide-react";
import "@/components/maya/maya-widget.css";
import { Avatar, BizLogo, useReducedMotion } from "./appKit";
import { BRANDS } from "./brand";
import { Glued, RevealText, segments } from "./RevealText";
import type { Scenario } from "./scenarios";
import {
  callerKnownAt,
  formatClock,
  lastStartedLine,
  speakingLine,
  toolTime,
  wordsRevealed,
  type FiredEvent,
  type Timeline,
} from "./timeline";

const ORB_BG =
  "radial-gradient(circle at 32% 28%, rgba(255,255,255,.85), rgba(255,255,255,0) 45%), conic-gradient(from 210deg, #8E9BFF, #E59CFF, #8E9BFF, #6CD3FF, #8E9BFF)";

/** Maya's side of the stage: who is on the call, the transcript as it is spoken, and what she got done. */
export function MayaCallPanel({
  scenario,
  timeline,
  events,
  t,
  started,
  playing,
  buffering,
  ended,
  onNext,
  onTalk,
  nextLabel,
}: {
  scenario: Scenario;
  timeline: Timeline;
  events: FiredEvent[];
  t: number;
  started: boolean;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
  onNext: () => void;
  onTalk: () => void;
  nextLabel: string;
}) {
  const reduce = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const last = lastStartedLine(timeline, t);
  const talking = speakingLine(timeline, t);
  const who = talking >= 0 ? scenario.lines[talking].who : null;

  const knownAt = callerKnownAt(events);
  const known = knownAt != null && t >= knownAt;
  const ringing = started && playing && !ended && t < (timeline.lines[0]?.start ?? 0) + 0.9;

  const toolsShown = scenario.lines.reduce((n, _l, i) => {
    const tt = toolTime(scenario, timeline, i);
    return n + (tt != null && t >= tt ? 1 : 0);
  }, 0);

  const done = useMemo(
    () => scenario.lines.filter((_l, i) => timeline.lines[i] && t >= timeline.lines[i].end),
    [scenario, timeline, t],
  );

  // Keep the newest line and chip in view. The bubble is laid out in full when a line starts, so this only moves on a new line.
  const scrollKey = `${scenario.id}:${last}:${toolsShown}:${ended}`;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [scrollKey, reduce]);

  const pill = !started
    ? { cls: "is-idle", text: "Ready" }
    : ended
      ? { cls: "is-ended", text: `Call ended, ${formatClock(timeline.duration)}` }
      : !playing
        ? { cls: "is-idle", text: `Paused, ${formatClock(t)}` }
        : buffering
          ? { cls: "is-ring", text: t < 1 ? "Connecting" : "Buffering" }
          : ringing
          ? { cls: "is-ring", text: "Ringing" }
          : { cls: "is-live", text: `On a call, ${formatClock(t)}` };

  return (
    <section className="ad-maya" aria-label={`Maya on a call with ${scenario.caller.name}`}>
      <header className="ad-maya-head">
        <span
          aria-hidden="true"
          className={`ad-orb block h-11 w-11 shrink-0 rounded-full ${who === "agent" ? "maya-orb-live" : ""}`}
          style={{ background: ORB_BG, boxShadow: "0 0 26px -2px #8E9BFFAA" }}
        />
        <div className="ad-maya-id">
          <b>
            Maya <span className="ad-badge">AI agent</span>
          </b>
          <span className="ad-biz">
            <BizLogo slug={BRANDS[scenario.id].logo} size={16} />
            <span>{scenario.business}</span>
          </span>
        </div>
        <span className={`ad-callpill ${pill.cls}`}>
          <i aria-hidden="true" />
          <span className="whitespace-nowrap">{pill.text}</span>
        </span>
      </header>

      <div className="ad-caller">
        <span className={`ad-caller-av ${who === "caller" ? "is-talking" : ""}`}>
          {known ? (
            <Avatar name={scenario.caller.name} size={36} />
          ) : (
            <span className="ad-caller-ph" aria-hidden="true">
              <PhoneCall size={16} />
            </span>
          )}
        </span>
        <div className="ad-caller-id">
          <b className="whitespace-nowrap">{known ? scenario.caller.name : scenario.caller.phone}</b>
          <span>Caller{known ? <> · <span className="whitespace-nowrap">{scenario.caller.phone}</span></> : null}</span>
        </div>
      </div>

      <div className="ad-tx-wrap">
        <div ref={scroller} className="ad-tx" data-testid="agent-transcript">
          {!started && last < 0 ? (
            <p className="ad-tx-empty">
              Press play. The call shows up here as it happens, and the software on the right changes while Maya talks.
            </p>
          ) : null}
          {scenario.lines.map((l, i) => {
            if (i > last || !timeline.lines[i]) return null;
            const n = segments(l.text).count;
            const shown = wordsRevealed(timeline.lines[i], n, t);
            const tt = toolTime(scenario, timeline, i);
            return (
              <div key={i} className={`ad-msg ${l.who === "agent" ? "is-agent" : "is-caller"}`}>
                <div className="ad-bubble">
                  <RevealText text={l.text} shown={shown} />
                </div>
                {l.tool && tt != null && t >= tt ? (
                  <div className="ad-tool">
                    <Check size={13} aria-hidden="true" />
                    <span>{l.tool}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
          {ended ? (
            <div className="ad-outcome">
              <b>
                Call handled in <span className="whitespace-nowrap">{formatClock(timeline.duration)}</span>
              </b>
              <ul>
                {scenario.outcome.map((o) => (
                  <li key={o}>
                    <Check size={14} aria-hidden="true" />
                    <span>
                      <Glued text={o} />
                    </span>
                  </li>
                ))}
              </ul>
              <div className="ad-outcome-btns">
                <button type="button" className="ad-btn ad-btn-solid" onClick={onNext}>
                  <RotateCcw size={16} aria-hidden="true" />
                  <span className="whitespace-nowrap">{nextLabel}</span>
                </button>
                <button type="button" className="ad-btn ad-btn-ghost" onClick={onTalk}>
                  <Mic size={16} aria-hidden="true" />
                  <span className="whitespace-nowrap">Talk to Maya live</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Screen readers hear finished lines only, never the word-by-word typing. */}
      <div className="sr-only" role="log" aria-live="polite" aria-relevant="additions">
        {done.map((l, i) => (
          <p key={`${scenario.id}-${i}`}>
            {l.who === "agent" ? "Maya" : scenario.caller.name}: {l.text}
            {l.tool ? ` (${l.tool})` : ""}
          </p>
        ))}
      </div>
    </section>
  );
}

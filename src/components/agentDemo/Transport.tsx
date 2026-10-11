import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import type { DemoClock } from "./useDemoClock";
import { formatClock, type Caption, type ToolMark } from "./timeline";
import { RevealText } from "./RevealText";

/** Play or pause, replay, sound on or off, the time, and a progress bar with one dot per thing Maya does. */
export function Transport({ clock, marks, caption, captionWho }: { clock: DemoClock; marks: ToolMark[]; caption: Caption | null; captionWho: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const { t, duration, playing, ended, soundOn, audioFailed } = clock;
  const pct = duration > 0 ? Math.min(100, (t / duration) * 100) : 0;

  const seekFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    clock.seek(((e.clientX - r.left) / r.width) * duration);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromPointer(e);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) seekFromPointer(e);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "PageUp" || e.key === "PageDown" ? 15 : 5;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "PageUp") next = t + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "PageDown") next = t - step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = duration;
    if (next == null) return;
    e.preventDefault();
    clock.seek(next);
  };

  return (
    <div className="ad-dock">
    <div className="ad-transport">
      {/* Phone only: the line being spoken, so you can watch the window and still follow along. The transcript above is the accessible copy. */}
      <div className="ad-caption" aria-hidden="true">
        {caption ? (
          <>
            <span className="ad-caption-who">{caption.who === "agent" ? "Maya" : captionWho}</span>
            <p>
              <RevealText text={caption.text} shown={caption.shown} />
            </p>
          </>
        ) : (
          <p className="ad-caption-idle">Press play to start the call.</p>
        )}
      </div>
      <button
        type="button"
        className="ad-play"
        onClick={clock.toggle}
        aria-label={playing ? "Pause the call" : ended ? "Play the call again" : "Play the call"}
      >
        {playing ? <Pause size={22} fill="currentColor" aria-hidden="true" /> : <Play size={22} fill="currentColor" aria-hidden="true" className="ml-0.5" />}
      </button>
      <button type="button" className="ad-iconbtn" onClick={clock.replay} aria-label="Replay from the start">
        <RotateCcw size={18} aria-hidden="true" />
      </button>

      {/* Phone: one line, "0:40 / 1:01". Wider screens: elapsed on the left of the scrubber and time remaining on the right, like Apple's players. */}
      <span className="ad-time ad-time-c" aria-hidden="true">
        {formatClock(t)} / {formatClock(duration)}
      </span>
      <span className="ad-time ad-time-l" aria-hidden="true">
        {formatClock(t)}
      </span>

      <div
        ref={bar}
        className="ad-seek"
        role="slider"
        tabIndex={0}
        aria-label="Position in the call"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(t)}
        aria-valuetext={`${formatClock(t)} of ${formatClock(duration)}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        <div className="ad-seek-track">
          <div className="ad-seek-fill" style={{ width: `${pct}%` }} />
        </div>
        {marks.map((m) => (
          <i
            key={m.line}
            aria-hidden="true"
            className={`ad-seek-dot ${t >= m.t ? "is-on" : ""}`}
            style={{ left: `${(m.t / duration) * 100}%` }}
          />
        ))}
        <span className="ad-seek-thumb" aria-hidden="true" style={{ left: `${pct}%` }} />
      </div>

      <span className="ad-time ad-time-r" aria-hidden="true">
        -{formatClock(Math.max(0, duration - t))}
      </span>

      <button
        type="button"
        className="ad-sound"
        onClick={() => clock.setSoundOn(!soundOn)}
        aria-pressed={soundOn}
        aria-label={soundOn ? "Sound on. Turn sound off for captions only" : "Sound off, captions only. Turn sound on"}
      >
        {soundOn ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
        <span className="whitespace-nowrap">{soundOn ? (audioFailed ? "Captions only" : "Sound on") : "Sound off"}</span>
      </button>
    </div>
    </div>
  );
}

/**
 * The clock behind the /agent demo. One number, `t` (seconds into the call), drives everything on screen.
 *
 * - Sound on: t follows the <audio> element's currentTime.
 * - Sound off, or the audio will not load: a requestAnimationFrame clock runs the same timeline (captions only).
 *   A failed or blocked audio file never stops the demo; it falls back silently and reports once to Maya's watchdog.
 * - Seeking just sets t. Nothing here accumulates state, so scrubbing backwards is always right.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mayaDiag } from "@/components/maya/mayaSession";
import type { Scenario } from "./scenarios";
import { estimateTimeline, parseTimeline, type Timeline } from "./timeline";

const SOUND_KEY = "agent-demo:sound";
const FRAME_MS = 1000 / 30;

function readSoundPref(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export type DemoClock = {
  audioRef: (el: HTMLAudioElement | null) => void;
  timeline: Timeline;
  t: number;
  duration: number;
  playing: boolean;
  started: boolean;
  ended: boolean;
  soundOn: boolean;
  /** True when sound is wanted but the file would not load, so captions are carrying the call. */
  audioFailed: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  replay: () => void;
  seek: (sec: number) => void;
  setSoundOn: (on: boolean) => void;
  /** Warm the audio for this call (chip chosen) without playing it. */
  prime: () => void;
};

export function useDemoClock(scenario: Scenario): DemoClock {
  const [loaded, setTimeline] = useState<Timeline>(() => estimateTimeline(scenario));
  // The first render after a chip change still holds the previous call's timeline; never hand that out.
  const fallback = useMemo(() => estimateTimeline(scenario), [scenario]);
  const timeline = loaded.id === scenario.id ? loaded : fallback;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [soundOn, setSoundOnState] = useState(readSoundPref);
  const [audioFailed, setAudioFailed] = useState(false);

  const audio = useRef<HTMLAudioElement | null>(null);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const soundRef = useRef(soundOn);
  const failedRef = useRef(false);
  const reported = useRef(new Set<string>());
  const durationRef = useRef(timeline.duration);
  const idRef = useRef(scenario.id);
  const lastFrame = useRef(0);
  const lastPush = useRef(0);
  const raf = useRef(0);

  durationRef.current = timeline.duration;
  idRef.current = scenario.id;
  soundRef.current = soundOn;
  failedRef.current = audioFailed;

  const setTime = useCallback((v: number) => {
    tRef.current = v;
    setT(v);
  }, []);

  // New call: stop everything, estimate right away, then upgrade to the recorded timings if they are there.
  useEffect(() => {
    let alive = true;
    cancelAnimationFrame(raf.current);
    playingRef.current = false;
    setPlaying(false);
    setStarted(false);
    setAudioFailed(false);
    failedRef.current = false;
    setTime(0);
    const a = audio.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.preload = "none";
      a.load();
    }
    const est = estimateTimeline(scenario);
    setTimeline(est);
    fetch(`/agent-demo/${scenario.id}.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`timeline ${r.status}`))))
      .then((raw) => {
        const tl = alive ? parseTimeline(raw, scenario) : null;
        if (tl) setTimeline(tl);
      })
      .catch(() => {
        /* no recording yet: the estimate keeps the page working */
      });
    return () => {
      alive = false;
    };
  }, [scenario, setTime]);

  const reportFailure = useCallback((error: string) => {
    failedRef.current = true;
    setAudioFailed(true);
    const id = idRef.current;
    if (reported.current.has(id)) return;
    reported.current.add(id);
    mayaDiag("agent-demo-audio", { id, error: error.slice(0, 120) });
  }, []);

  const wireAudio = useCallback(
    (el: HTMLAudioElement | null) => {
      audio.current = el;
      if (!el) return;
      el.preload = "none";
      el.onerror = () => reportFailure(el.error?.message || `media error ${el.error?.code ?? ""}`.trim());
      el.onended = () => {
        if (!playingRef.current) return;
        playingRef.current = false;
        setPlaying(false);
        setTime(durationRef.current);
      };
    },
    [reportFailure, setTime],
  );

  const wantsAudio = () => soundRef.current && !failedRef.current && !!audio.current;

  const loadAudio = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    const want = `/agent-demo/${idRef.current}.mp3`;
    if (!a.getAttribute("src")?.endsWith(want)) {
      a.src = want;
      a.preload = "auto";
    }
  }, []);

  const stopLoop = () => cancelAnimationFrame(raf.current);

  const loop = useCallback(
    (now: number) => {
      if (!playingRef.current) return;
      const dt = Math.min(0.1, Math.max(0, (now - lastFrame.current) / 1000));
      lastFrame.current = now;
      const a = audio.current;
      let next: number;
      if (a && soundRef.current && !failedRef.current && a.getAttribute("src")) {
        next = a.currentTime;
      } else {
        next = tRef.current + dt;
      }
      const end = durationRef.current;
      if (next >= end) {
        playingRef.current = false;
        a?.pause();
        setPlaying(false);
        setTime(end);
        return;
      }
      tRef.current = next;
      if (now - lastPush.current >= FRAME_MS) {
        lastPush.current = now;
        setT(next);
      }
      raf.current = requestAnimationFrame(loop);
    },
    [setTime],
  );

  const startLoop = useCallback(() => {
    stopLoop();
    lastFrame.current = performance.now();
    lastPush.current = 0;
    raf.current = requestAnimationFrame(loop);
  }, [loop]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = useCallback(() => {
    if (playingRef.current) return;
    if (tRef.current >= durationRef.current - 0.05) setTime(0);
    playingRef.current = true;
    setPlaying(true);
    setStarted(true);
    if (wantsAudio()) {
      loadAudio();
      const a = audio.current as HTMLAudioElement;
      try {
        a.currentTime = tRef.current;
      } catch {
        /* metadata not ready yet: it starts from 0 and the clock follows the audio */
      }
      a.play().catch((e: unknown) => {
        // Blocked or undecodable: keep the call going on the virtual clock.
        reportFailure(e instanceof Error ? `${e.name}: ${e.message}` : "play failed");
      });
    }
    startLoop();
  }, [loadAudio, reportFailure, setTime, startLoop]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    stopLoop();
    audio.current?.pause();
    setT(tRef.current);
  }, []);

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);

  const seek = useCallback(
    (sec: number) => {
      const v = Math.min(durationRef.current, Math.max(0, sec));
      setTime(v);
      const a = audio.current;
      if (a && a.getAttribute("src")) {
        try {
          a.currentTime = v;
        } catch {
          /* not ready: the next play() sets it */
        }
      }
      if (v > 0) setStarted(true);
      if (v < durationRef.current && !playingRef.current) {
        /* paused seek: nothing else to do, the view recomputes from t */
      }
    },
    [setTime],
  );

  const replay = useCallback(() => {
    pause();
    setTime(0);
    const a = audio.current;
    if (a && a.getAttribute("src")) {
      try {
        a.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    play();
  }, [pause, play, setTime]);

  const setSoundOn = useCallback(
    (on: boolean) => {
      setSoundOnState(on);
      soundRef.current = on;
      try {
        localStorage.setItem(SOUND_KEY, on ? "on" : "off");
      } catch {
        /* preference just won't stick */
      }
      const a = audio.current;
      if (!a) return;
      if (!on) {
        a.pause(); // the virtual clock carries on from tRef
        return;
      }
      if (playingRef.current && !failedRef.current) {
        loadAudio();
        try {
          a.currentTime = tRef.current;
        } catch {
          /* ignore */
        }
        a.play().catch((e: unknown) => reportFailure(e instanceof Error ? `${e.name}: ${e.message}` : "play failed"));
      }
    },
    [loadAudio, reportFailure],
  );

  const prime = useCallback(() => {
    if (soundRef.current && !failedRef.current) loadAudio();
  }, [loadAudio]);

  // If the file fails while a call is running, the loop already switches to the virtual clock because failedRef flips.
  const ended = t >= timeline.duration - 0.01;

  return useMemo(
    () => ({
      audioRef: wireAudio,
      timeline,
      t,
      duration: timeline.duration,
      playing,
      started,
      ended,
      soundOn,
      audioFailed,
      play,
      pause,
      toggle,
      replay,
      seek,
      setSoundOn,
      prime,
    }),
    [wireAudio, timeline, t, playing, started, ended, soundOn, audioFailed, play, pause, toggle, replay, seek, setSoundOn, prime],
  );
}

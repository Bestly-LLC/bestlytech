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
/** Sound is on but the audio has not moved for this long: stop waiting and let the captions carry the call. */
const STALL_MS = 8000;
/** Audio that has been short of data this long shows "Buffering" instead of looking frozen. */
const BUFFER_SHOW_MS = 500;

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
  /** The call is playing with sound but the audio is waiting on the network. */
  buffering: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  replay: () => void;
  seek: (sec: number) => void;
  setSoundOn: (on: boolean) => void;
  /** Warm the audio for this call (chip chosen) without playing it. */
  prime: () => void;
  /** Loudness of the call audio right now, 0 to 1; null when it cannot be read (sound off, failed, no analyser). */
  level: () => number | null;
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
  const [buffering, setBuffering] = useState(false);

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
  const audioSeen = useRef({ t: -1, at: 0 }); // last audio position we saw move, and when
  const waitSince = useRef(0); // when the audio first ran short of data (0 = it has not)
  const bufRef = useRef(false);

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
    waitSince.current = 0;
    bufRef.current = false;
    setBuffering(false);
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

  /**
   * A play() that was cancelled by our own pause(), a chip change or a seek rejects with AbortError. That is not a broken
   * file, and treating it as one used to flip the NEXT call to captions only after a quick pause or chip switch.
   */
  const playFailed = useCallback((e: unknown, forId: string) => {
    if (e instanceof DOMException && e.name === "AbortError") return;
    if (forId !== idRef.current) return;
    reportFailure(e instanceof Error ? `${e.name}: ${e.message}` : "play failed");
  }, [reportFailure]);

  const wireAudio = useCallback(
    (el: HTMLAudioElement | null) => {
      audio.current = el;
      if (!el) return;
      el.preload = "none";
      el.onerror = () => {
        // Clearing the previous call's file can raise a late error; only a file we asked for counts.
        if (!el.getAttribute("src")) return;
        reportFailure(el.error?.message || `media error ${el.error?.code ?? ""}`.trim());
      };
      // The system stopped the audio (a phone call, the screen locking, another tab taking over): show it as paused
      // instead of a running call whose clock has frozen. Our own pauses clear playingRef or turn sound off first.
      el.onpause = () => {
        if (!el.paused || !playingRef.current || !soundRef.current || failedRef.current || el.ended) return; // el.paused: a late event from our own pause()
        playingRef.current = false;
        setPlaying(false);
        cancelAnimationFrame(raf.current);
        bufRef.current = false;
        setBuffering(false);
        setT(tRef.current);
      };
      el.onended = () => {
        if (!playingRef.current) return;
        playingRef.current = false;
        setPlaying(false);
        setTime(durationRef.current);
      };
    },
    [reportFailure, setTime],
  );

  // Loudness for the speaking orb. One AnalyserNode on the <audio> element, built on the first press of Play (it needs a
  // user gesture, and an element can only be wrapped once). The mp3 is same-origin, so the analyser is not silenced by CORS.
  const analyser = useRef<{ ctx: AudioContext; node: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null>(null);
  const analyserTried = useRef(false);
  const ensureAnalyser = useCallback(() => {
    const el = audio.current;
    if (analyser.current || analyserTried.current || !el) return;
    // Wrapping routes the sound through the context; a context made outside a gesture starts suspended and would mute it.
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (ua && !ua.isActive) return;
    analyserTried.current = true;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const node = ctx.createAnalyser();
      node.fftSize = 1024;
      ctx.createMediaElementSource(el).connect(node);
      node.connect(ctx.destination);
      void ctx.resume();
      analyser.current = { ctx, node, buf: new Float32Array(node.fftSize) };
    } catch {
      /* no Web Audio: the orb falls back to its own syllable rhythm */
    }
  }, []);

  const level = useCallback((): number | null => {
    const g = analyser.current;
    const a = audio.current;
    if (!g || !a || a.paused || !soundRef.current || failedRef.current) return null;
    if (g.ctx.state === "suspended") void g.ctx.resume();
    if (g.ctx.state !== "running") return null;
    g.node.getFloatTimeDomainData(g.buf);
    let sum = 0;
    for (let i = 0; i < g.buf.length; i++) sum += g.buf[i] * g.buf[i];
    return Math.min(1, Math.sqrt(sum / g.buf.length) * 2.2);
  }, []);

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
        if (next !== audioSeen.current.t) audioSeen.current = { t: next, at: now };
        const short = a.readyState < 3 && !a.ended;
        if (!short) waitSince.current = 0;
        else if (!waitSince.current) waitSince.current = now;
        const show = short && now - waitSince.current > BUFFER_SHOW_MS;
        if (show !== bufRef.current) {
          bufRef.current = show;
          setBuffering(show);
        }
        if (now - audioSeen.current.at > STALL_MS) {
          // The sound never started, or stopped for good (a dead connection): carry on with captions, from here.
          reportFailure("stalled");
          a.pause();
          bufRef.current = false;
          setBuffering(false);
          next = tRef.current + dt;
        }
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
    [setTime, reportFailure],
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
    audioSeen.current = { t: -1, at: performance.now() };
    waitSince.current = 0;
    if (wantsAudio()) {
      loadAudio();
      ensureAnalyser();
      const a = audio.current as HTMLAudioElement;
      try {
        a.currentTime = tRef.current;
      } catch {
        /* metadata not ready yet: it starts from 0 and the clock follows the audio */
      }
      const forId = idRef.current;
      // Blocked or undecodable: keep the call going on the virtual clock.
      a.play().catch((e: unknown) => playFailed(e, forId));
    }
    startLoop();
  }, [loadAudio, ensureAnalyser, playFailed, setTime, startLoop]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    stopLoop();
    audio.current?.pause();
    bufRef.current = false;
    setBuffering(false);
    setT(tRef.current);
  }, []);

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);

  const seek = useCallback(
    (sec: number) => {
      const v = Math.min(durationRef.current, Math.max(0, sec));
      setTime(v);
      audioSeen.current = { t: -1, at: performance.now() };
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
        bufRef.current = false;
        setBuffering(false);
        return;
      }
      if (playingRef.current && !failedRef.current) {
        audioSeen.current = { t: -1, at: performance.now() };
        loadAudio();
        ensureAnalyser();
        try {
          a.currentTime = tRef.current;
        } catch {
          /* ignore */
        }
        const forId = idRef.current;
        a.play().catch((e: unknown) => playFailed(e, forId));
      }
    },
    [loadAudio, ensureAnalyser, playFailed],
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
      buffering,
      play,
      pause,
      toggle,
      replay,
      seek,
      setSoundOn,
      prime,
      level,
    }),
    [wireAudio, timeline, t, playing, started, ended, soundOn, audioFailed, buffering, play, pause, toggle, replay, seek, setSoundOn, prime, level],
  );
}

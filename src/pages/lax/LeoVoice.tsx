/**
 * "Talk to Leo": the voice trip helper, at the top of the Ask sheet on guest trip pages.
 *
 * Tapping trades the page's trip token for a short-lived signed session (trip-voice edge function), then opens a
 * voice call with Leo (ElevenLabs). Only an opaque session key reaches the voice platform, never the trip token.
 * Leo's tools can check and fix this trip's key, the same way the text helper does. The SDK loads on tap, so the
 * page pays nothing until a guest wants to talk.
 *
 * Quiet at rest: the orb only moves while a call is live, and then only with Leo's voice.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, PhoneOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { track } from "./track";

type Phase = "idle" | "connecting" | "live" | "error";
type Session = { endSession: () => Promise<void>; getOutputVolume: () => number };

const PEACH = "var(--trip-accent, #FFB878)";

function friendly(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  const m = `${e?.name ?? ""} ${e?.message ?? (typeof err === "string" ? err : "")}`;
  if (/permission|notallowed|denied/i.test(m)) return "Leo needs your microphone. Allow it in your browser, or type your question below.";
  if (/notfound|no.*device/i.test(m)) return "No microphone found on this device. Type your question below instead.";
  return "Couldn't reach Leo. Type your question below, or try again in a minute.";
}

export function LeoVoice({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [line, setLine] = useState("");
  const [err, setErr] = useState("");
  const conv = useRef<Session | null>(null);
  const orb = useRef<HTMLSpanElement>(null);
  const raf = useRef<number | null>(null);
  const fixed = useRef(false);

  // The orb follows Leo's voice level while he talks. Nothing loops at rest.
  useEffect(() => {
    if (phase !== "live") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      const v = conv.current?.getOutputVolume() ?? 0;
      if (orb.current && !reduce) orb.current.style.transform = `scale(${1 + Math.min(v, 1) * 0.35})`;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); if (orb.current) orb.current.style.transform = ""; };
  }, [phase]);

  // Hang up if the guest leaves the page mid-call.
  useEffect(() => () => { void conv.current?.endSession().catch(() => {}); }, []);

  const reloadTrip = () => {
    window.dispatchEvent(new Event("trip-reload"));
    window.setTimeout(() => window.dispatchEvent(new Event("trip-reload")), 30000);
  };

  const start = async () => {
    if (phase === "connecting" || phase === "live") return;
    setErr(""); setLine(""); setPhase("connecting"); fixed.current = false;
    track(token, "ask", { via: "leo-voice" });
    try {
      // Ask for the mic first, on the tap, so the browser prompt is tied to the guest's gesture.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((t) => t.stop());
      const { data, error } = await supabase.functions.invoke("trip-voice", { body: { op: "session", token } });
      const r = data as { ok?: boolean; signed_url?: string; key?: string; error?: string } | null;
      if (error || !r?.ok || !r.signed_url || !r.key) {
        // The server's own words are written for guests (inactive link, short break); show them as is.
        setErr(r?.error ?? "Couldn't reach Leo. Type your question below, or try again in a minute.");
        setPhase("error");
        return;
      }
      const { Conversation } = await import("@elevenlabs/client");
      conv.current = await Conversation.startSession({
        signedUrl: r.signed_url,
        connectionType: "websocket",
        dynamicVariables: { trip_key: r.key },
        // Self-hosted (public/vendor/elevenlabs, from @elevenlabs/client 1.27.0 and libsamplerate-js 2.1.2): the trip
        // pages' CSP blocks blob: worklets and the jsDelivr CDN the SDK would use otherwise. Update them with the SDK.
        workletPaths: { rawAudioProcessor: "/vendor/elevenlabs/rawAudioProcessor.js", audioConcatProcessor: "/vendor/elevenlabs/audioConcatProcessor.js" },
        libsampleratePath: "/vendor/elevenlabs/libsamplerate.worklet.js",
        onConnect: () => setPhase("live"),
        onDisconnect: () => { conv.current = null; setPhase((p) => (p === "error" ? p : "idle")); setSpeaking(false); if (fixed.current) reloadTrip(); },
        onError: (m) => { setErr(friendly(m)); setPhase("error"); },
        onModeChange: ({ mode }) => setSpeaking(mode === "speaking"),
        onMessage: ({ message, role }) => { if (role === "agent" && message) setLine(message); },
        onAgentToolResponse: (t) => { if (/key_fix|extra_driver/.test(String((t as { tool_name?: string })?.tool_name ?? ""))) fixed.current = true; },
      }) as unknown as Session;
    } catch (e) {
      setErr(friendly(e));
      setPhase("error");
    }
  };

  const stop = async () => {
    const c = conv.current;
    conv.current = null;
    setPhase("idle"); setSpeaking(false);
    await c?.endSession().catch(() => {});
    if (fixed.current) reloadTrip();
  };

  const live = phase === "live";
  return (
    <section aria-label="Talk to Leo" className="mb-4 rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10">
      <div className="flex items-center gap-3">
        <span className="relative grid h-11 w-11 shrink-0 place-items-center" aria-hidden>
          <span ref={orb} className="absolute inset-0 rounded-full transition-transform duration-75 motion-reduce:transition-none"
            style={{ background: `radial-gradient(circle at 35% 30%, ${PEACH}, rgba(139,92,246,.85))`, opacity: live ? 1 : 0.85 }} />
          <Mic className="relative h-5 w-5 text-[#1A1140]" strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-tight text-white" aria-live="polite">{live ? (speaking ? "Leo is talking" : "Leo is listening") : "Talk to Leo"}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-white/70">
            {live ? "Speak normally. You can interrupt him." : "Voice helper. He can check your key and send a fresh one."}
          </p>
        </div>
        {live ? (
          <button type="button" onClick={stop} aria-label="End the call with Leo"
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-[#E4527A] px-4 text-[15px] font-semibold text-white transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
            <PhoneOff className="h-4 w-4" aria-hidden />End
          </button>
        ) : (
          <button type="button" onClick={start} disabled={phase === "connecting"} aria-label="Start a voice call with Leo"
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] font-bold text-[#1A1140] transition active:scale-95 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            style={{ background: PEACH }}>
            {phase === "connecting" ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Connecting</> : "Talk"}
          </button>
        )}
      </div>
      {live && line && <p className="mt-3 rounded-xl bg-white/[0.06] px-3 py-2 text-[14px] leading-relaxed text-white/90" aria-live="polite">{line}</p>}
      {phase === "error" && err && <p className="mt-2.5 text-[13px] leading-snug text-[#FFB3C6]" role="alert">{err}</p>}
      <p className="mt-2 text-[12px] leading-snug text-white/65">AI voice. Calls are recorded so your host can help. Free for you.</p>
    </section>
  );
}

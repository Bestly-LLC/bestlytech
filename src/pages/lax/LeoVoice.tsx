/**
 * "Call Leo": the voice trip helper at the top of the trip helper sheet on guest trip pages. Styled after the
 * ElevenLabs widget (white card, gradient orb, black call pill), with two suggested questions from the trip's context.
 *
 * Tapping trades the page's trip token for a short-lived signed session (trip-voice edge function), then opens a
 * voice call with Leo (ElevenLabs). Only an opaque session key reaches the voice platform, never the trip token.
 * Leo's tools can check and fix this trip's key, the same way the text helper does.
 *
 * Audio on iPhone: iOS only plays sound from an AudioContext unlocked inside a tap. The SDK arms that unlock when it
 * is imported, so it is imported as soon as the sheet opens (never on page load), before the guest can tap Call.
 * Closing the sheet hangs up.
 *
 * Quiet at rest: the orb only moves while a call is live, and then only with Leo's voice.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { track } from "./track";

type Phase = "idle" | "connecting" | "live" | "error";
type Line = { id: number; role: "user" | "agent"; text: string };
type Session = {
  endSession: () => Promise<void>;
  getOutputVolume: () => number;
  setMicMuted: (m: boolean) => void;
  sendUserMessage: (t: string) => void;
};

// The voice model writes stage directions like "[sad]" or "[laughs]"; they are for the voice, not for reading.
const clean = (s: string) => s.replace(/\[[a-z][a-z \-']{0,24}\]\s*/gi, "").trim();

function friendly(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  const m = `${e?.name ?? ""} ${e?.message ?? (typeof err === "string" ? err : "")}`;
  if (/permission|notallowed|denied/i.test(m)) return "Leo needs your microphone. Allow it in your browser settings, or type your question below.";
  if (/notfound|no.*device/i.test(m)) return "No microphone found on this device. Type your question below instead.";
  return "Couldn't reach Leo. Type your question below, or try again in a minute.";
}

let sdk: Promise<typeof import("@elevenlabs/client")> | null = null;
const loadSdk = () => (sdk ??= import("@elevenlabs/client"));

export function LeoVoice({ token, open, suggestions }: { token: string; open: boolean; suggestions: string[] }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState("");
  const conv = useRef<Session | null>(null);
  const orb = useRef<HTMLSpanElement>(null);
  const raf = useRef<number | null>(null);
  const fixed = useRef(false);
  const firstAsk = useRef<string | null>(null);
  const transcript = useRef<HTMLDivElement>(null);

  // Load the SDK when the sheet opens, so its iPhone audio unlock is armed before the guest taps Call.
  useEffect(() => { if (open) void loadSdk().catch(() => { sdk = null; }); }, [open]);

  // The orb follows Leo's voice while he talks. Nothing loops at rest.
  useEffect(() => {
    if (phase !== "live") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      const v = conv.current?.getOutputVolume() ?? 0;
      if (orb.current && !reduce) orb.current.style.transform = `scale(${1 + Math.min(v, 1) * 0.3})`;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); if (orb.current) orb.current.style.transform = ""; };
  }, [phase]);

  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" }); }, [lines]);

  const reloadTrip = () => {
    window.dispatchEvent(new Event("trip-reload"));
    window.setTimeout(() => window.dispatchEvent(new Event("trip-reload")), 30000);
  };

  const stop = async () => {
    const c = conv.current;
    conv.current = null;
    setPhase("idle"); setSpeaking(false); setMuted(false);
    await c?.endSession().catch(() => {});
    if (fixed.current) reloadTrip();
  };

  // Closing the sheet or leaving the page hangs up.
  useEffect(() => { if (!open && conv.current) void stop(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { void conv.current?.endSession().catch(() => {}); }, []);

  const start = async (ask?: string) => {
    if (phase === "connecting" || phase === "live") return;
    setErr(""); setLines([]); setMuted(false); setPhase("connecting");
    fixed.current = false; firstAsk.current = ask ?? null;
    track(token, "ask", { via: "leo-voice" });
    try {
      const [{ Conversation }, res] = await Promise.all([
        loadSdk(),
        supabase.functions.invoke("trip-voice", { body: { op: "session", token } }),
      ]);
      const r = res.data as { ok?: boolean; signed_url?: string; key?: string; error?: string } | null;
      if (res.error || !r?.ok || !r.signed_url || !r.key) {
        // The server's own words are written for guests (inactive link, short break); show them as is.
        setErr(r?.error ?? "Couldn't reach Leo. Type your question below, or try again in a minute.");
        setPhase("error");
        return;
      }
      let n = 0;
      conv.current = await Conversation.startSession({
        signedUrl: r.signed_url,
        connectionType: "websocket",
        dynamicVariables: { trip_key: r.key },
        // Self-hosted (public/vendor/elevenlabs, from @elevenlabs/client 1.27.0 and libsamplerate-js 2.1.2): the trip
        // pages' CSP blocks blob: worklets and the jsDelivr CDN the SDK would use otherwise. Update them with the SDK.
        workletPaths: { rawAudioProcessor: "/vendor/elevenlabs/rawAudioProcessor.js", audioConcatProcessor: "/vendor/elevenlabs/audioConcatProcessor.js" },
        libsampleratePath: "/vendor/elevenlabs/libsamplerate.worklet.js",
        onConnect: () => {
          setPhase("live");
          // A suggested question was tapped: ask it as soon as the line is open.
          const q = firstAsk.current;
          if (q) { firstAsk.current = null; window.setTimeout(() => conv.current?.sendUserMessage(q), 300); }
        },
        onDisconnect: () => { conv.current = null; setPhase((p) => (p === "error" ? p : "idle")); setSpeaking(false); if (fixed.current) reloadTrip(); },
        onError: (m) => { setErr(friendly(m)); setPhase("error"); },
        onModeChange: ({ mode }) => setSpeaking(mode === "speaking"),
        onMessage: ({ message, role }) => {
          const text = clean(message ?? "");
          if (text) setLines((xs): Line[] => [...xs, { id: ++n, role: role === "agent" ? "agent" : "user", text } as Line].slice(-6));
        },
        onAgentToolResponse: (t) => { if (/key_fix|extra_driver/.test(String((t as { tool_name?: string })?.tool_name ?? ""))) fixed.current = true; },
      }) as unknown as Session;
    } catch (e) {
      setErr(friendly(e));
      setPhase("error");
    }
  };

  const toggleMute = () => {
    const m = !muted;
    conv.current?.setMicMuted(m);
    setMuted(m);
  };

  const live = phase === "live";
  const busy = phase === "connecting";
  const status = live ? (muted ? "Muted. Tap the mic to talk." : speaking ? "Leo is talking" : "Listening") : busy ? "Connecting" : "Trip helper, any time of day";
  const picks = suggestions.slice(0, 2);

  return (
    <section aria-label="Call Leo" className="mb-4 overflow-hidden rounded-[28px] bg-white text-[#0B0B0F] shadow-xl shadow-black/30">
      <div className="flex items-center gap-3 p-3 pr-3.5">
        <span className="relative h-12 w-12 shrink-0" aria-hidden>
          <span ref={orb} className="absolute inset-0 rounded-full transition-transform duration-75 motion-reduce:transition-none"
            style={{ background: "radial-gradient(circle at 30% 28%, #FFE1C2 0%, #FFB878 28%, #A78BFA 62%, #5B3FD6 100%)",
              boxShadow: "inset 0 -6px 14px rgba(40,20,120,.35), inset 0 4px 10px rgba(255,255,255,.55)" }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold leading-tight tracking-[-0.01em]">Leo</p>
          <p className="mt-0.5 text-[13px] leading-snug text-[#5B5B66]" aria-live="polite">{status}</p>
        </div>
        {live ? (
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute your microphone" : "Mute your microphone"}
              className="grid h-11 w-11 place-items-center rounded-full bg-[#F1F1F4] text-[#0B0B0F] transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3FD6]">
              {muted ? <MicOff className="h-5 w-5" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
            </button>
            <button type="button" onClick={stop} aria-label="End the call with Leo"
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[#E5484D] px-4 text-[15px] font-semibold text-white transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3FD6]">
              <PhoneOff className="h-4 w-4" aria-hidden />End
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => start()} disabled={busy} aria-label="Start a voice call with Leo"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-[#0B0B0F] px-4 text-[15px] font-semibold text-white transition active:scale-95 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3FD6]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Phone className="h-4 w-4" aria-hidden />}
            {busy ? "Calling" : "Call Leo"}
          </button>
        )}
      </div>

      {live && lines.length > 0 && (
        <div ref={transcript} className="max-h-56 space-y-2 overflow-y-auto border-t border-[#EDEDF1] px-3 py-3" aria-live="polite" aria-label="What you and Leo said">
          {lines.map((l) => (
            <div key={l.id} className={l.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <p className={`max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-snug ${l.role === "user" ? "rounded-br-md bg-[#0B0B0F] text-white" : "rounded-bl-md bg-[#F1F1F4] text-[#0B0B0F]"}`}>{l.text}</p>
            </div>
          ))}
        </div>
      )}

      {!live && !busy && picks.length > 0 && (
        <div className="border-t border-[#EDEDF1] px-3 pb-3 pt-2.5">
          <p className="px-1 text-[12px] font-medium text-[#5B5B66]">Ask Leo out loud</p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {picks.map((q) => (
              <button key={q} type="button" onClick={() => start(q)}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-2xl bg-[#F4F4F7] px-3.5 py-2 text-left text-[15px] font-medium text-[#0B0B0F] transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B3FD6]">
                <Phone className="h-4 w-4 shrink-0 text-[#5B3FD6]" aria-hidden /><span>{q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === "error" && err && <p className="border-t border-[#EDEDF1] px-4 py-3 text-[14px] leading-snug text-[#B4232A]" role="alert">{err}</p>}
      <p className="px-4 pb-3 text-[12px] leading-snug text-[#6B6B76]">AI voice. Calls are recorded so your host can help.</p>
    </section>
  );
}

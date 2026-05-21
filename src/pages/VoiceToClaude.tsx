import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * /voice-to-claude — record audio in the browser, send to a Supabase edge
 * function that pipes it through Whisper for transcription and Claude (via
 * OpenRouter) for the reply. Zero Pi dependency.
 *
 * Set OPENROUTER_API_KEY in the Supabase function env to use this page.
 * Optionally set VOICE_TO_CLAUDE_SHARED_TOKEN and add ?t=<token> to the URL
 * to gate public access until we wire real auth.
 */

type Turn = {
  id: string;
  ts: number;
  transcript: string;
  response: string;
  model: string;
  ms_total: number;
};

const MODELS = [
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5 (default)" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5 (fast)" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
];

export default function VoiceToClaude() {
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [model, setModel] = useState(MODELS[0].id);
  const [prefixPrompt, setPrefixPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const tickRef = useRef<number | null>(null);

  function teardown() {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }

  useEffect(() => () => teardown(), []);

  async function startRecording() {
    setError(null);
    setSeconds(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // Audio level meter
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setAudioLevel(Math.min(1, rms * 3));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();

      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = handleStop;
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);

      tickRef.current = window.setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Couldn't access microphone: ${msg}`);
      teardown();
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function handleStop() {
    teardown();
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    if (blob.size === 0) {
      setError("No audio captured. Try again.");
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      form.append("model", model);
      if (prefixPrompt.trim()) form.append("prompt", prefixPrompt.trim());

      const sharedToken = new URLSearchParams(window.location.search).get("t");
      const headers: Record<string, string> = {};
      if (sharedToken) headers["x-bestly-token"] = sharedToken;

      const { data, error: invokeErr } = await supabase.functions.invoke(
        "voice-to-claude",
        { body: form, headers },
      );
      if (invokeErr) throw invokeErr;
      if (!data?.ok) throw new Error(data?.error || "unknown error");

      const turn: Turn = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        transcript: data.transcript,
        response: data.response,
        model: data.model,
        ms_total: data.ms_total,
      };
      setTurns((t) => [turn, ...t]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setSending(false);
    }
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Voice → Claude</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Hold the button, talk, release. Audio is transcribed via Whisper and
            sent to Claude. No login. Audio is not stored on Bestly servers — it
            only round-trips through the edge function.
          </p>
        </header>

        <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Model
            </span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={recording || sending}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Optional prompt prefix
            </span>
            <input
              value={prefixPrompt}
              onChange={(e) => setPrefixPrompt(e.target.value)}
              disabled={recording || sending}
              placeholder="e.g. Reply in one paragraph as a calm advisor"
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </label>
        </section>

        <section className="mb-8 flex flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 py-10">
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={sending}
            className={`flex h-32 w-32 items-center justify-center rounded-full text-white shadow-lg transition-all ${
              recording
                ? "bg-red-600 hover:bg-red-700 animate-pulse"
                : sending
                  ? "bg-neutral-400"
                  : "bg-orange-600 hover:bg-orange-700"
            }`}
            aria-label={recording ? "Stop recording" : "Start recording"}
          >
            {sending ? (
              <span className="text-sm">Thinking…</span>
            ) : recording ? (
              <span className="text-2xl tabular-nums">{mmss}</span>
            ) : (
              <span className="text-base">Tap to talk</span>
            )}
          </button>

          {recording && (
            <div className="mt-6 h-2 w-48 overflow-hidden rounded bg-neutral-200">
              <div
                className="h-full bg-red-500 transition-all"
                style={{ width: `${Math.round(audioLevel * 100)}%` }}
              />
            </div>
          )}

          {error && (
            <p className="mt-4 max-w-md text-center text-sm text-red-600">{error}</p>
          )}
        </section>

        <section className="space-y-4">
          {turns.map((t) => (
            <article
              key={t.id}
              className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-2 flex items-baseline justify-between text-xs text-neutral-500">
                <span>{new Date(t.ts).toLocaleTimeString()}</span>
                <span>{t.model} · {(t.ms_total / 1000).toFixed(1)}s</span>
              </div>
              <p className="mb-3 text-sm italic text-neutral-700">
                <span className="font-medium not-italic text-neutral-500">You:</span> {t.transcript}
              </p>
              <p className="whitespace-pre-wrap text-sm text-neutral-900">
                <span className="font-medium text-neutral-500">Claude:</span> {t.response}
              </p>
            </article>
          ))}
          {turns.length === 0 && !recording && !sending && (
            <p className="text-center text-sm text-neutral-400">
              No conversation yet. Tap the button to start.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

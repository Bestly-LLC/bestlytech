/**
 * voice-to-claude — browser MediaRecorder upload → Whisper transcription → Claude reply.
 *
 * POST multipart/form-data with:
 *   audio       file blob  (required)  webm/opus or m4a/wav
 *   prompt      string     (optional)  prefixed to the transcript before sending to Claude
 *   model       string     (optional)  defaults to anthropic/claude-sonnet-4.5
 *
 * Returns: { ok: true, transcript: string, response: string, model: string, ms_total: number }
 *
 * Env:
 *   OPENROUTER_API_KEY   required — used for both Whisper STT and the Claude chat completion
 *   VOICE_TO_CLAUDE_SHARED_TOKEN  optional — if set, requires X-Bestly-Token header to match
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bestly-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";
const STT_MODEL = "openai/whisper-1"; // OpenRouter exposes Whisper under the OpenAI namespace
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB matches OpenAI's audio limit

function ok(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function bad(reason: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: reason }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return bad("method not allowed", 405);
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return bad("server misconfigured: OPENROUTER_API_KEY not set", 500);

  // Optional shared-token gate to avoid drive-by abuse before we wire real auth
  const sharedTok = Deno.env.get("VOICE_TO_CLAUDE_SHARED_TOKEN");
  if (sharedTok && req.headers.get("x-bestly-token") !== sharedTok) {
    return bad("unauthorized", 401);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (_e) {
    return bad("expected multipart/form-data body");
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return bad("missing 'audio' file field");
  }
  if (audio.size === 0) return bad("audio file is empty");
  if (audio.size > MAX_AUDIO_BYTES) {
    return bad(`audio too large (max ${MAX_AUDIO_BYTES} bytes)`);
  }

  const userPrompt = (form.get("prompt") as string) || "";
  const model = (form.get("model") as string) || DEFAULT_MODEL;

  const tStart = Date.now();

  // 1) Transcribe via OpenRouter's OpenAI-compatible /audio/transcriptions
  const sttForm = new FormData();
  sttForm.append("file", audio, audio.name || "recording.webm");
  sttForm.append("model", STT_MODEL);
  sttForm.append("response_format", "json");

  const sttRes = await fetch(`${OPENROUTER_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://bestly.tech",
      "X-Title": "Bestly Voice-to-Claude",
    },
    body: sttForm,
  });

  if (!sttRes.ok) {
    const text = await sttRes.text();
    return bad(`transcription failed: ${sttRes.status} ${text.slice(0, 400)}`, 502);
  }

  const sttJson = (await sttRes.json()) as { text?: string };
  const transcript = (sttJson.text || "").trim();
  if (!transcript) return bad("transcription returned empty text", 502);

  // 2) Send to Claude (or chosen model) with the user's optional prefix prompt
  const composedUserMessage = userPrompt
    ? `${userPrompt}\n\n--- Spoken input ---\n${transcript}`
    : transcript;

  const chatRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://bestly.tech",
      "X-Title": "Bestly Voice-to-Claude",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are Claude responding to a spoken message that was transcribed by Whisper. Reply naturally and concisely (≤200 words unless the question demands more). If the transcript looks garbled or incomplete, ask one short clarifying question.",
        },
        { role: "user", content: composedUserMessage },
      ],
      max_tokens: 1024,
    }),
  });

  if (!chatRes.ok) {
    const text = await chatRes.text();
    return bad(`chat completion failed: ${chatRes.status} ${text.slice(0, 400)}`, 502);
  }

  const chatJson = (await chatRes.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };
  const response =
    chatJson.choices?.[0]?.message?.content?.trim() || "(no response)";

  return ok({
    ok: true,
    transcript,
    response,
    model,
    ms_total: Date.now() - tStart,
    usage: chatJson.usage ?? null,
  });
});

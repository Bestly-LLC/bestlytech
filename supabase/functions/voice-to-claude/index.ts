/**
 * voice-to-claude — browser MediaRecorder upload → Whisper transcription → Claude reply.
 *
 * POST multipart/form-data with:
 *   audio       file blob  (required)  webm/opus or m4a/wav
 *   prompt      string     (optional)  prefixed to the transcript before sending to Claude
 *
 * Returns: { ok: true, transcript: string, response: string, model: string, ms_total: number }
 *
 * Env:
 *   OPENROUTER_API_KEY   required — used for both Whisper STT and the Claude chat completion
 *   VOICE_TO_CLAUDE_SHARED_TOKEN  optional — X-Bestly-Token header that also lets a caller in
 *
 * v5 (2026-09-23 spend audit): it used to be open to anyone when the token secret was unset, and the
 * caller could pick any model. Now: an admin session or the shared token, the model is fixed, and
 * every call passes ai_gate (ai_caps: 50 a day, 20 an hour) and is logged in ai_spend.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bestly-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MODEL = "anthropic/claude-sonnet-4.5";
const STT_MODEL = "openai/whisper-1"; // OpenRouter exposes Whisper under the OpenAI namespace
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB matches OpenAI's audio limit

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

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

async function whoIsAllowed(req: Request): Promise<string | null> {
  const sharedTok = Deno.env.get("VOICE_TO_CLAUDE_SHARED_TOKEN");
  if (sharedTok && req.headers.get("x-bestly-token") === sharedTok) return "token";
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: isAdmin } = await db.rpc("has_role", { _user_id: uid, _role: "admin" });
  return isAdmin ? `user:${uid}` : null;
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

  const who = await whoIsAllowed(req);
  if (!who) return bad("sign in to the Bestly admin to use this", 401);

  const { data: gate, error: gateErr } = await db.rpc("ai_gate", { p_fn: "voice-to-claude", p_who: who });
  if (gateErr || (gate as any)?.ok !== true) {
    return bad(`paused: ${(gate as any)?.reason ?? "spend limit"} (resets at midnight Pacific)`, 429);
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

  const userPrompt = String(form.get("prompt") ?? "").slice(0, 4000);

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

  // 2) Send to Claude with the user's optional prefix prompt
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
      model: MODEL,
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
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  const response =
    chatJson.choices?.[0]?.message?.content?.trim() || "(no response)";

  const i = Number(chatJson.usage?.prompt_tokens ?? 0), o = Number(chatJson.usage?.completion_tokens ?? 0);
  await db.from("ai_spend").insert({
    fn: "voice-to-claude", scope: "public", job: "voice", model: MODEL, input_tokens: i, output_tokens: o,
    cost_usd: typeof chatJson.usage?.cost === "number" ? chatJson.usage.cost : (i * 3 + o * 15) / 1e6, ref: who,
  });

  return ok({
    ok: true,
    transcript,
    response,
    model: MODEL,
    ms_total: Date.now() - tStart,
    usage: chatJson.usage ?? null,
  });
});

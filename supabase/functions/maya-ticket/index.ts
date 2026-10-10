// Maya's file_ticket webhook. No shared secret: every request must carry an
// ElevenLabs conversation_id that ElevenLabs confirms belongs to Maya and is
// from the last 2 hours. Max 3 tickets per conversation. Phone falls back to caller ID.
import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_ID = "agent_3701m4jbjnyef6ga4ys73xtbz37s";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const conv = String(p.conversation_id ?? "");
  if (!/^conv_[A-Za-z0-9]+$/.test(conv)) return json({ ok: false, error: "no conversation" }, 401);

  const { data: elKey } = await sb.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conv}`, { headers: { "xi-api-key": String(elKey) } });
  if (!r.ok) return json({ ok: false, error: "unknown conversation" }, 401);
  const c = await r.json();
  const started = Number(c?.metadata?.start_time_unix_secs ?? 0) * 1000;
  if (c?.agent_id !== AGENT_ID || !started || Date.now() - started > 2 * 3600 * 1000) return json({ ok: false, error: "not a live Maya call" }, 401);

  const { count } = await sb.from("support_tickets").select("id", { count: "exact", head: true }).eq("conversation_id", conv);
  if ((count ?? 0) >= 3) return json({ ok: false, error: "too many tickets on this call" }, 429);

  const said = String(p.phone ?? "").replace(/\D/g, "");
  const callerId = String(p.caller_number ?? "").trim();
  const phone = said.length >= 10 ? said : (/^\+?\d{7,15}$/.test(callerId) ? callerId : (said || null));
  const { caller_number: _drop, ...rest } = p;

  const { data, error } = await sb.rpc("maya_file_ticket", { p: { ...rest, phone, conversation_id: conv } });
  if (error) {
    await sb.rpc("bestly_raise", { p_key: "maya.ticket", p_kind: "problem", p_severity: "warning", p_title: "Maya: I couldn't save a caller's ticket", p_body: error.message.slice(0, 300), p_area: "maya" });
    return json({ ok: false, error: "could not save" }, 500);
  }
  return json(data);
});

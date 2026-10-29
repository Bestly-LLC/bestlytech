// ava-texts: texts that reach Ava's line (816) 429-9495, so the Claims Closer can read what insurers text (Jared 2026-10-29).
// Inbound only: this never sends a text.
//   Telnyx webhook:  POST ?op=in&t=<ava_texts_in_token>   (the token lives in Vault). The body is never trusted: the message is
//                    re-read from Telnyx's own API by id (our API key) and must be an inbound text to Ava's number.
//   Service ops (x-proxy-key or service_role JWT): {op:"status"} reads the number's messaging setup; {op:"heal"} makes sure the
//                    number sits on the "Ava texts (inbound)" profile whose webhook points here, then reports to ava_texts_health_put.
// Codes in texts are blanked in Postgres (ava_text_in) before they are stored. Nothing here or anywhere types them.
import { createClient } from "jsr:@supabase/supabase-js@2";

type Any = Record<string, unknown>;
const AVA_FROM = "+18164299495";
const PROFILE_NAME = "Ava texts (inbound)";
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const tEq = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

function b64urlJson(seg: string): Any | null {
  try { const s = seg.replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(s + "=".repeat((4 - (s.length % 4)) % 4))); } catch { return null; }
}
async function callerAuthorized(req: Request): Promise<boolean> {
  const k = req.headers.get("x-proxy-key");
  if (k) for (const n of ["edge_proxy_key_sha256", "edge_proxy_key_prev_sha256"]) {
    const { data } = await sb.rpc("edge_key_ok", { p_name: n, p_key: k }); if (data === true) return true;
  }
  const parts = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").split(".");
  if (parts.length === 3) { const p = b64urlJson(parts[1]); if (p && p.role === "service_role") return true; }
  return false;
}

async function tx(path: string, init: RequestInit = {}): Promise<{ status: number; j: Any }> {
  const { data: key } = await sb.rpc("ava_secret", { p_name: "telnyx_api_key" });
  if (typeof key !== "string" || !key) return { status: 412, j: { error: "telnyx_api_key missing" } };
  const r = await fetch(`https://api.telnyx.com/v2${path}`, {
    ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let j: Any = {};
  try { j = await r.json(); } catch (_e) { /* empty */ }
  return { status: r.status, j };
}
async function webhookUrl(): Promise<string | null> {
  const { data: tok } = await sb.rpc("ava_texts_token");
  return typeof tok === "string" && tok ? `${Deno.env.get("SUPABASE_URL")}/functions/v1/ava-texts?op=in&t=${tok}` : null;
}
const enc = encodeURIComponent(AVA_FROM);

async function status(): Promise<Any> {
  const n = await tx(`/phone_numbers/${enc}/messaging`);
  const d = (n.j.data ?? {}) as Any;
  let profile: Any | null = null;
  if (d.messaging_profile_id) {
    const p = await tx(`/messaging_profiles/${d.messaging_profile_id}`);
    const pd = (p.j.data ?? {}) as Any;
    profile = { id: pd.id, name: pd.name, webhook_ok: !!pd.webhook_url && String(pd.webhook_url).includes("/functions/v1/ava-texts?op=in"), enabled: pd.enabled };
  }
  return { number_status: n.status, profile_id: d.messaging_profile_id ?? null, features: d.features ?? null, profile, errors: n.j.errors ?? null };
}

async function heal(): Promise<Any> {
  const want = await webhookUrl();
  if (!want) return { ok: false, why: "could not make the webhook token" };
  const before = await status();
  if (before.number_status !== 200) return { ok: false, why: `Telnyx number lookup ${before.number_status}`, before };
  const cur = before.profile as Any | null;
  // the number is already on some other profile (someone set Ava's line up for texting on purpose): never steal it, report instead
  if (before.profile_id && cur && cur.name !== PROFILE_NAME) {
    if (cur.webhook_ok) return { ok: true, note: "number is on another profile that already points here", before };
    return { ok: false, why: `Ava's line is on the "${cur.name}" texting profile, whose texts go elsewhere. Not moved automatically.`, before };
  }
  const healed: string[] = [];
  let pid: string | null = null;
  const list = await tx(`/messaging_profiles?filter[name]=${encodeURIComponent(PROFILE_NAME)}&page[size]=5`);
  for (const p of ((list.j.data ?? []) as Any[])) {
    if (p.name !== PROFILE_NAME) continue;
    pid = String(p.id);
    if (p.webhook_url !== want) {
      const u = await tx(`/messaging_profiles/${pid}`, { method: "PATCH", body: JSON.stringify({ webhook_url: want, webhook_api_version: "2", enabled: true }) });
      if (u.status < 300) healed.push("re-pointed the webhook"); else return { ok: false, why: `could not update the profile (${u.status})`, errors: u.j.errors };
    }
    break;
  }
  if (!pid) {
    const c = await tx(`/messaging_profiles`, { method: "POST", body: JSON.stringify({ name: PROFILE_NAME, webhook_url: want, webhook_api_version: "2", enabled: true, whitelisted_destinations: ["US"] }) });
    if (c.status >= 300) return { ok: false, why: `could not create the texting profile (${c.status})`, errors: c.j.errors };
    pid = String(((c.j.data ?? {}) as Any).id);
    healed.push("made the texting profile");
  }
  if (before.profile_id !== pid) {
    const a = await tx(`/phone_numbers/${enc}/messaging`, { method: "PATCH", body: JSON.stringify({ messaging_profile_id: pid }) });
    if (a.status >= 300) return { ok: false, why: `could not attach Ava's number (${a.status})`, errors: a.j.errors };
    healed.push("attached Ava's number");
  }
  return { ok: true, healed, profile_id: pid };
}

const b64 = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function inbound(req: Request, u: URL): Promise<Response> {
  const { data: tok } = await sb.rpc("ava_texts_token");
  if (typeof tok !== "string" || !tEq(u.searchParams.get("t") ?? "", tok)) return json({ ok: false, error: "unauthorized" }, 401);
  const raw = await req.text();
  // Telnyx signs webhooks (ed25519). The public key is only in the Telnyx portal: once it is saved to Vault as telnyx_public_key,
  // every text must carry a valid signature. Until then the secret URL is the only check, so an unsigned text may never change a
  // claim (no claim number is saved from it); it only shows on the card.
  const { data: pub } = await sb.rpc("leo_sms_in_secret", { p_name: "telnyx_public_key" });
  let verified = false;
  if (typeof pub === "string" && pub) {
    const sig = req.headers.get("telnyx-signature-ed25519") ?? "", ts = req.headers.get("telnyx-timestamp") ?? "";
    try {
      if (!sig || !ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return json({ ok: false, error: "bad signature" }, 401);
      const k = await crypto.subtle.importKey("raw", b64(pub), { name: "Ed25519" }, false, ["verify"]);
      if (!(await crypto.subtle.verify({ name: "Ed25519" }, k, b64(sig), new TextEncoder().encode(`${ts}|${raw}`)))) return json({ ok: false, error: "bad signature" }, 401);
      verified = true;
    } catch (_e) { return json({ ok: false, error: "bad signature" }, 401); }
  }
  let ev: Any = {};
  try { ev = JSON.parse(raw); } catch (_e) { return json({ ok: true, ignored: "no body" }); }
  const d = (ev.data ?? {}) as Any, p = (d.payload ?? {}) as Any;
  if (d.event_type !== "message.received" || p.direction === "outbound") return json({ ok: true, ignored: d.event_type ?? "not a text" });
  const id = String(p.id ?? "");
  const to = String((((p.to as Any[]) ?? [])[0] as Any)?.phone_number ?? "");
  if (to !== AVA_FROM) { console.log(JSON.stringify({ op: "in", ignored: "other number", to_last4: to.slice(-4) })); return json({ ok: true, ignored: "not for Ava's line" }); }
  const from = String((p.from as Any)?.phone_number ?? "");
  const text = String(p.text ?? "");
  const { data, error } = await sb.rpc("ava_text_in", { p_telnyx_id: id || crypto.randomUUID(), p_from: from, p_to: to, p_text: text, p_at: (p.received_at as string) ?? new Date().toISOString(), p_verified: verified });
  console.log(JSON.stringify({ op: "in", from_last4: from.slice(-4), verified, kind: (data as Any)?.kind ?? null, error: error?.message ?? null }));
  return error ? json({ ok: false, error: "store failed" }, 500) : json({ ok: true });
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("op") === "in") return inbound(req, u);
  if (!(await callerAuthorized(req))) return json({ error: "unauthorized" }, 401);
  let b: Any = {};
  try { b = await req.json(); } catch (_e) { /* none */ }
  if (b.op === "status") return json(await status());
  if (b.op === "msg" && /^[0-9a-f-]{20,64}$/i.test(String(b.id ?? ""))) {   // delivery check for a self-test text (no text body returned)
    const m = await tx(`/messages/${encodeURIComponent(String(b.id))}`);
    const md = (m.j.data ?? {}) as Any;
    return json({ status: m.status, direction: md.direction ?? null, to: ((md.to as Any[]) ?? []).map((t) => ({ status: (t as Any).status, carrier: (t as Any).carrier })), errors: md.errors ?? m.j.errors ?? null });
  }
  if (b.op === "heal") {
    let r: Any;
    try { r = await heal(); } catch (e) { r = { ok: false, why: String(e).slice(0, 160) }; }
    await sb.rpc("ava_texts_health_put", { p_ok: r.ok === true, p_detail: r });
    return json(r, r.ok ? 200 : 502);
  }
  return json({ error: "unknown_op" }, 400);
});

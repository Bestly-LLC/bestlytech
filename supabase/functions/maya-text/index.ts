// maya-text: Maya's (213) line texting tools. Service role only (verify_jwt true).
// ops: status (read number messaging settings), attach (put the number on the "Maya texts" profile), send {to, text}.
// Bestly has no 10DLC campaign, so US carriers may block sends; the Telnyx error comes back as-is.
import { createClient } from "jsr:@supabase/supabase-js@2";

type Any = Record<string, unknown>;
const MAYA_FROM = "+12136410074";
const MAYA_PROFILE = "4001a13d-2643-4a7f-8cc3-27dedff35dc0"; // Telnyx messaging profile "Maya texts" ($1/day cap)
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

// same caller check as bestly-yt-poster: x-proxy-key (hashed in Vault) or a service_role JWT
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
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function tx(path: string, init: RequestInit = {}): Promise<{ status: number; j: Any }> {
  const { data: key } = await sb.rpc("ava_secret", { p_name: "telnyx_api_key" });
  if (typeof key !== "string" || !key) return { status: 412, j: { error: "telnyx_api_key missing" } };
  const r = await fetch(`https://api.telnyx.com/v2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  let j: Any = {};
  try { j = await r.json(); } catch (_e) { /* empty body */ }
  return { status: r.status, j };
}

const strip = (j: Any) => {
  const d = (j.data ?? {}) as Any;
  return { profile: d.messaging_profile_id ?? null, type: d.type ?? null, product: d.messaging_product ?? null, features: d.features ?? null, errors: j.errors ?? null };
};

Deno.serve(async (req) => {
  if (!(await callerAuthorized(req))) return json({ error: "unauthorized" }, 401);
  let b: Any = {};
  try { b = await req.json(); } catch (_e) { /* no body */ }
  const enc = encodeURIComponent(MAYA_FROM);

  if (b.op === "status") {
    const r = await tx(`/phone_numbers/${enc}/messaging`);
    return json({ status: r.status, ...strip(r.j) });
  }
  if (b.op === "attach") {
    const r = await tx(`/phone_numbers/${enc}/messaging`, { method: "PATCH", body: JSON.stringify({ messaging_profile_id: MAYA_PROFILE }) });
    return json({ status: r.status, ...strip(r.j) }, r.status < 300 ? 200 : 502);
  }
  if (b.op === "send") {
    const to = String(b.to ?? "").replace(/[^\d+]/g, "");
    const text = String(b.text ?? "");
    if (!/^\+?\d{5,15}$/.test(to) || !text || text.length > 300) return json({ error: "bad_to_or_text" }, 400);
    // short codes stay as-is; 10 digits = US; otherwise E.164
    const dest = to.startsWith("+") || to.length <= 6 ? to : to.length === 10 ? `+1${to}` : `+${to}`;
    const r = await tx(`/messages`, { method: "POST", body: JSON.stringify({ from: MAYA_FROM, to: dest, text, messaging_profile_id: MAYA_PROFILE }) });
    const d = (r.j.data ?? {}) as Any;
    const toInfo = ((d.to as Any[]) ?? [])[0] as Any | undefined;
    console.log(JSON.stringify({ op: "send", to_last4: to.slice(-4), status: r.status, id: d.id ?? null, errors: r.j.errors ?? null }));
    return json({ status: r.status, id: d.id ?? null, delivery: toInfo?.status ?? null, errors: r.j.errors ?? null }, r.status < 300 ? 200 : 502);
  }
  return json({ error: "unknown_op" }, 400);
});

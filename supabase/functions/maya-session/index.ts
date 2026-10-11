// maya-session - the only door to Maya from bestly.tech (verify_jwt = false).
//
// Maya's ElevenLabs agent is private (enable_auth = true), so her public agent id alone no longer starts a
// conversation. The site asks here instead:
//
//   POST {op:"session", page}   -> {ok, signed_url}   a short-lived signed URL (about 15 minutes to start a call)
//   POST {op:"diag", kind, detail}                     what a visitor's browser hit when Maya failed to start
//   POST {op:"health"}  (service role only)            used by Maya's Line Check (maya-watch)
//
// Guards, cheapest first:
//   1. Origin must be bestly.tech, www.bestly.tech, or a bestlytech preview on vercel.app.
//   2. Maya not paused in voice_agents.
//   3. Per visitor (peppered IP hash): 10 sessions an hour, 20 a day.
//   4. Site-wide: 150 sessions a day (her ElevenLabs daily cap of 300 also covers the phone line).
// Every refusal is logged, so Line Check can tell abuse from a broken site. No emails or phones are stored.
import { createClient } from "npm:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const XI = "https://api.elevenlabs.io/v1";
const PER_IP_HOUR = 10;
const PER_IP_DAY = 20;
const SITE_DAY = 150;
const BUSY = "Maya is busy right now. Call (213) 641-0074, or try again in a few minutes.";
const DOWN = "Maya isn't available right now. Call (213) 641-0074, or try again in a minute.";

type Any = Record<string, unknown>;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

function originOk(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return h === "bestly.tech" || h === "www.bestly.tech" || /^bestlytech(-[a-z0-9-]+)?-bestly\.vercel\.app$/.test(h);
  } catch {
    return false;
  }
}

async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const data = new TextEncoder().encode(`maya:${ip}:${SB_SECRET.slice(-24)}`);
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function agentId(): Promise<string | null> {
  const { data } = await sb.from("voice_agents").select("elevenlabs_agent_id, status").eq("slug", "maya").maybeSingle();
  return data && data.status !== "paused" ? (data.elevenlabs_agent_id as string | null) : null;
}

async function xiKey(): Promise<string | null> {
  const { data, error } = await sb.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  return error || typeof data !== "string" || !data ? null : data;
}

async function count(filter: { ip?: string; sinceMs: number }): Promise<number> {
  let q = sb.from("maya_web_sessions").select("id", { count: "exact", head: true })
    .eq("kind", "session").gte("created_at", new Date(Date.now() - filter.sinceMs).toISOString());
  if (filter.ip) q = q.eq("ip_hash", filter.ip);
  const { count: c } = await q;
  return c ?? 0;
}

async function log(kind: "session" | "refused" | "diag", ip: string, origin: string, page: string, detail: Any | null) {
  await sb.from("maya_web_sessions").insert({ kind, ip_hash: ip, origin: clip(origin, 120), page: clip(page, 80), detail });
  // Prune on the way out (about 1 in 20 inserts), so this table needs no cron of its own.
  if (Math.random() < 0.05) {
    await sb.from("maya_web_sessions").delete().lt("created_at", new Date(Date.now() - 3 * 86400_000).toISOString());
  }
}

async function mint(): Promise<{ url?: string; status: number }> {
  const [aid, key] = await Promise.all([agentId(), xiKey()]);
  if (!aid || !key) return { status: 503 };
  const r = await fetch(`${XI}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(aid)}`, { headers: { "xi-api-key": key } });
  const j = await r.json().catch(() => ({}));
  return r.ok && j.signed_url ? { url: String(j.signed_url), status: 200 } : { status: r.status || 502 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const b = (await req.json().catch(() => ({}))) as Any;
  const op = clip(b.op, 20);

  // Line Check: proves the whole path works (key, agent, ElevenLabs) without counting against any visitor.
  if (op === "health") {
    const auth = req.headers.get("authorization") ?? "";
    if (!SB_SECRET || auth !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) return json({ ok: false }, 401);
    const m = await mint();
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count: refused } = await sb.from("maya_web_sessions").select("id", { count: "exact", head: true })
      .eq("kind", "refused").gte("created_at", since);
    const { count: diags } = await sb.from("maya_web_sessions").select("id", { count: "exact", head: true })
      .eq("kind", "diag").gte("created_at", since);
    return json({ ok: !!m.url, mint_status: m.status, refused_last_hour: refused ?? 0, diag_last_hour: diags ?? 0,
      sessions_today: await count({ sinceMs: 86400_000 }) });
  }

  const origin = req.headers.get("origin") ?? "";
  const ip = await ipHash(req);
  const page = clip(b.page, 80);

  if (op === "diag") {
    if (!originOk(origin)) return json({ ok: false }, 403);
    // A visitor can only write a handful of these; anything more is noise.
    const { count: recent } = await sb.from("maya_web_sessions").select("id", { count: "exact", head: true })
      .eq("ip_hash", ip).eq("kind", "diag").gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((recent ?? 0) >= 10) return json({ ok: true });
    const d = (b.detail && typeof b.detail === "object" ? b.detail : {}) as Any;
    const detail: Any = { what: clip(b.kind, 40) };
    for (const k of Object.keys(d).slice(0, 8)) detail[clip(k, 30)] = clip(d[k], 300);
    detail.ua = clip(req.headers.get("user-agent"), 160);
    await log("diag", ip, origin, page, detail);
    return json({ ok: true });
  }

  if (op !== "session") return json({ ok: false, error: "unknown op" }, 400);

  if (!originOk(origin)) {
    await log("refused", ip, origin, page, { why: "origin" });
    return json({ ok: false, error: DOWN }, 403);
  }
  const [hour, day, site] = await Promise.all([
    count({ ip, sinceMs: 3600_000 }), count({ ip, sinceMs: 86400_000 }), count({ sinceMs: 86400_000 }),
  ]);
  if (hour >= PER_IP_HOUR || day >= PER_IP_DAY || site >= SITE_DAY) {
    const why = site >= SITE_DAY ? "site_day" : hour >= PER_IP_HOUR ? "ip_hour" : "ip_day";
    await log("refused", ip, origin, page, { why });
    return json({ ok: false, error: BUSY }, 429);
  }

  const m = await mint();
  if (!m.url) {
    await log("refused", ip, origin, page, { why: "mint", status: m.status });
    await sb.rpc("bestly_raise", { p_key: "maya.site.session", p_kind: "problem", p_severity: "warning",
      p_title: "Maya: website visitors can't start a chat", p_body: `ElevenLabs refused a signed session (${m.status}).`, p_area: "maya" })
      .then(() => {}, () => {});
    return json({ ok: false, error: DOWN }, 502);
  }
  await log("session", ip, origin, page, null);
  return json({ ok: true, signed_url: m.url });
});

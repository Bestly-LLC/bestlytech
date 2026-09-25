// trip-health — the web half of the Turo trip apps watchdog (the DB half is trip_health_run()).
// Checks what guests actually load: the trip pages, their pictures, Apple weather, the page data RPC,
// and that the helper / key / reminder / TezLab functions answer. A failing check is retried once after
// 20 s (self-heal for blips); only what is still failing is written as 'fail', which reports to Scout.
//   POST {} → runs all checks, records them via trip_health_web().
import { createClient } from "npm:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(SB_URL, SB_SECRET, { auth: { persistSession: false } });
const SITE = "https://www.bestly.tech";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

type Check = { name: string; run: () => Promise<string | null> }; // null = ok, string = what's wrong

const get = async (url: string, init?: RequestInit) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try { return await fetch(url, { ...init, signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) BestlyTripHealth/1.0", ...(init?.headers ?? {}) } }); }
  finally { clearTimeout(t); }
};

async function checks(): Promise<Check[]> {
  const { data: link } = await sb.from("lax_guest_links").select("token, reservation_id, turo_trips!inner(ends_at, airport_code)").gt("turo_trips.ends_at", new Date().toISOString()).gt("reservation_id", 0).limit(1).maybeSingle();
  const { data: pass } = await sb.from("lax_pass_settings").select("slug").eq("id", 1).maybeSingle();
  const token = (link as { token?: string } | null)?.token;
  const page = (path: string, must: string) => async () => {
    const r = await get(`${SITE}${path}`);
    if (!r.ok) return `${path} returned ${r.status}`;
    const html = await r.text();
    if (!html.includes(must)) return `${path} loaded the wrong page (no "${must}")`;
    if (!/<script[^>]+type="module"/.test(html)) return `${path} has no app script`;
    return null;
  };
  const asset = (path: string) => async () => { const r = await get(`${SITE}${path}`, { method: "GET" }); await r.body?.cancel(); return r.ok ? null : `${path} returned ${r.status}`; };
  const fn = (slug: string) => async () => { const r = await get(`${SB_URL}/functions/v1/${slug}`, { method: "OPTIONS" }); await r.body?.cancel(); return r.status < 500 ? null : `${slug} function is down (${r.status})`; };
  const list: Check[] = [
    { name: "trip page", run: token ? page(`/t/${token}`, "Your Turo trip") : async () => null },
    { name: "LAX page", run: pass?.slug ? page(`/lax/${pass.slug}`, "LAX") : async () => null },
    { name: "home picture", run: asset("/wallet/home/hero-mcm.svg") },
    { name: "home loader", run: asset("/wallet/home/loader-mcm.svg") },
    { name: "link preview", run: asset("/wallet/home/og.png") },
    { name: "LAX picture", run: asset("/wallet/lax/hero.svg") },
    { name: "weather", run: async () => {
      const r = await get(`${SB_URL}/functions/v1/weatherkit-proxy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: 34.0838, lon: -118.3708, dataSets: "currentWeather" }) });
      const j = await r.json().catch(() => null);
      return j?.currentWeather ? null : `weather returned ${r.status}${j?.error ? `: ${String(j.error).slice(0, 80)}` : ""}`;
    } },
    { name: "page data", run: async () => {
      if (!token) return null;
      const { data, error } = await sb.rpc("lax_guest_public", { p_token: token });
      return error ? `page data error: ${error.message}` : (data as { ok?: boolean })?.ok ? null : "page data says the link isn't working";
    } },
    { name: "helper", run: fn("lax-ask") },
    { name: "reminders", run: fn("trip-remind") },
    { name: "TezLab", run: fn("tezlab") },
    { name: "Wallet pass", run: fn("wallet-pass") },
  ];
  return list;
}

Deno.serve(async () => {
  try {
    const list = await checks();
    const run = async () => (await Promise.all(list.map(async (c) => { try { const e = await c.run(); return e ? `${c.name}: ${e}` : null; } catch (e) { return `${c.name}: ${String(e).slice(0, 100)}`; } }))).filter(Boolean) as string[];
    let bad = await run();
    if (bad.length) { await new Promise((r) => setTimeout(r, 20000)); bad = await run(); } // self-heal blips: re-check before reporting
    await sb.rpc("trip_health_web", { p_status: bad.length ? "fail" : "ok", p_detail: bad.length ? bad.join("; ") : null });
    return json({ ok: !bad.length, bad });
  } catch (e) {
    await sb.rpc("trip_health_web", { p_status: "fail", p_detail: `health check crashed: ${String(e).slice(0, 200)}` });
    return json({ ok: false, error: String(e) }, 500);
  }
});

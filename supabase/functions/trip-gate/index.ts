// trip-gate — JSON API behind the host's confirm page (bestly.tech/g/<token>, opened from the Turo pick-up Live Activity).
//   GET  ?g=<token>                     -> {state}
//   POST ?g=<token> {do: license|checkin|undo_license|undo_checkin|send_nav} -> {state}  (send_nav also returns state.nav_msg)
// The token is unguessable and per trip; it only ever flips the two host confirmations, or sends that trip's drop-off to the car's map.
import { createClient } from "npm:@supabase/supabase-js@2";
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const KEY = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, KEY, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const g = (new URL(req.url).searchParams.get("g") ?? "").trim();
  if (!/^[a-f0-9]{8}$/.test(g)) return json({ state: null }, 404);
  try {
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const d = String(b.do ?? "");
      if (!["license", "checkin", "undo_license", "undo_checkin", "send_nav"].includes(d)) return json({ error: "bad request" }, 400);
      const { data } = await sb.rpc("host_gate_apply", { p_g: g, p_do: d });
      return json({ state: data ?? null });
    }
    const { data } = await sb.rpc("host_gate_state", { p_g: g });
    return json({ state: data ?? null });
  } catch (e) {
    console.error(e);
    return json({ error: "try again" }, 500);
  }
});

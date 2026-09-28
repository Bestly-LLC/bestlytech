// wall-turo-ping (W5 round 4) - the iPhone's Turo shortcut calls this the moment Turo's push arrives, so the wall strip
// pops the new-booking card at the same time as the phone + HomePod (our own trips feed only sees it minutes later).
//   www.bestly.tech/wp/<key>  (Vercel rewrite)  ->  here ?k=<key>
//   GET or POST; optional text = the Turo notification ("Maria booked your Tesla Model 3 ...") as ?text=, JSON {text}, or plain body.
// The key is checked in the database (Vault secret wall_turo_ping_key); nothing else is exposed.
import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const key = (u.searchParams.get("k") ?? u.pathname.split("/").pop() ?? "").trim();
  let text = u.searchParams.get("text") ?? "";
  if (req.method === "POST") {
    try {
      const raw = await req.text();
      if (raw) {
        try {
          const j = JSON.parse(raw);
          text = String(typeof j === "string" ? j : (j.text ?? j.body ?? j.message ?? j.notification ?? text));
        } catch {
          text = raw;
        }
      }
    } catch { /* no body */ }
  }
  if (!key || key.length > 64) return J({ ok: false, error: "missing key" }, 401);
  const { data, error } = await db.rpc("wall_turo_ping", { p_key: key, p_text: text.slice(0, 500) });
  if (error) return J({ ok: false, error: error.message.includes("bad key") ? "bad key" : "failed" }, error.message.includes("bad key") ? 401 : 500);
  return J(data);
});

// vault-intake — the machine end of the clipboard intake slot.
//
// A secret that has to reach the vault should never pass through a chat transcript.
// The Mac mini reads the file off disk and posts it here; this writes it straight to
// the vault via store_bestly_secret (allowlisted names only) and answers with nothing
// but created/updated. The value is never echoed, never logged, never returned.
//
//   POST { secrets: { "<name>": "<value>", ... } }
//   headers: x-worker-key
//   -> { ok, results: { "<name>": "created" | "updated" | "<error>" } }

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-worker-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  // The Mac mini worker key, or an admin's own session. Nothing else.
  const wk = req.headers.get("x-worker-key") ?? "";
  let allowed = !!wk && !!(await db.rpc("partner_ai_key_ok", { p_key: wk })).data;
  if (!allowed) {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(jwt);
    if (u?.user) {
      const { data: isAdmin } = await db.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
      allowed = !!isAdmin;
    }
  }
  if (!allowed) return J({ ok: false, error: "unauthorized" }, 401);

  let body: { secrets?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return J({ ok: false, error: "expected JSON" }, 400);
  }

  const entries = Object.entries(body.secrets ?? {});
  if (!entries.length) return J({ ok: false, error: "no secrets given" }, 400);
  if (entries.length > 12) return J({ ok: false, error: "too many at once" }, 400);

  const results: Record<string, string> = {};
  for (const [name, raw] of entries) {
    const value = typeof raw === "string" ? raw : "";
    if (!value.trim()) {
      results[name] = "skipped: empty";
      continue;
    }
    const { data, error } = await db.rpc("store_bestly_secret", { p_name: name, p_value: value });
    // The error text can quote the name but never the value, so it is safe to pass back.
    results[name] = error ? `failed: ${error.message}` : String(data);
  }

  return J({ ok: Object.values(results).every((r) => r === "created" || r === "updated"), results });
});

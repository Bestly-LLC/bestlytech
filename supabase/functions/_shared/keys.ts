// Supabase API keys for edge functions, new-first with the legacy keys as fallback (key switch
// phase 2, 2026-09-24). Supabase ends the legacy anon/service_role JWT keys at the end of 2026.
//
//   SECRET_KEY        sb_secret_... (SUPABASE_SECRET_KEYS.default), else the legacy service_role JWT
//   PUBLISHABLE_KEY   sb_publishable_... (SUPABASE_PUBLISHABLE_KEYS.default), else the legacy anon JWT
//   keyHeaders(k)     headers that carry a key correctly: new keys ONLY on `apikey` (a new key on
//                     `Authorization: Bearer` is rejected as "Invalid JWT"); legacy keys on both
//   isServiceRequest  true when a request carries a server key (new on apikey or Bearer, or legacy
//                     Bearer), including a key from Vault that isn't byte-identical to this env copy
//
// supabase-js (jsr @2 / esm.sh @2 latest) already sends new keys on `apikey` only, so
// createClient(URL, SECRET_KEY) needs nothing else.

import { createClient } from "jsr:@supabase/supabase-js@2";

const parse = (name: string): Record<string, string> => {
  try { return JSON.parse(Deno.env.get(name) ?? "{}") ?? {}; } catch { return {}; }
};
const SECRETS = parse("SUPABASE_SECRET_KEYS");
const PUBLISHABLES = parse("SUPABASE_PUBLISHABLE_KEYS");

export const SECRET_KEY: string = SECRETS.default ?? Object.values(SECRETS)[0] ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const PUBLISHABLE_KEY: string = PUBLISHABLES.default ?? Object.values(PUBLISHABLES)[0] ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const KNOWN_SECRETS = new Set([...Object.values(SECRETS), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));

export const isNewKey = (k: string) => k.startsWith("sb_secret_") || k.startsWith("sb_publishable_");

/** Headers to send a key with: new keys on apikey only, legacy JWT keys on apikey + Bearer. */
export function keyHeaders(key: string = SECRET_KEY): Record<string, string> {
  return isNewKey(key) ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

const probed = new Map<string, boolean>();
/** A key we don't hold ourselves (e.g. the Vault copy the cron sends): can it use the admin API? */
async function worksAsSecret(key: string): Promise<boolean> {
  if (probed.has(key)) return probed.get(key)!;
  let ok = false;
  try {
    const c = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
    const { error } = await c.auth.admin.listUsers({ page: 1, perPage: 1 });
    ok = !error;
  } catch { ok = false; }
  probed.set(key, ok);
  return ok;
}

/** True when the request carries a server (service/secret) key, new or legacy, on apikey or Bearer. */
export async function isServiceRequest(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();
  for (const k of [bearer, apikey]) {
    if (!k) continue;
    if (KNOWN_SECRETS.has(k)) return true;
  }
  // a secret key we don't hold (rotated, or the Vault copy): prove it against the admin API
  for (const k of [apikey, bearer]) {
    if (k.startsWith("sb_secret_") && (await worksAsSecret(k))) return true;
    if (k.split(".").length === 3) {
      try {
        const role = JSON.parse(atob(k.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role;
        if (role === "service_role" && (await worksAsSecret(k))) return true;
      } catch { /* not a JWT */ }
    }
  }
  return false;
}

// social-card-intake - reopened 2026-09-05 for HOKU, now that its cards are set
// in Poppins to match hoku-clean.com rather than Inter.
//
// HOKU's queued media sits under uuid-prefixed object names, which are opaque to
// anything that wants to match a card to a post. The new set goes to a clean
// versioned prefix (hoku/v5/<slug>.jpg) and the rows are repointed, so the
// filename says which card it is.
//
// Same narrow door: no key is ever returned, only per-path upload tokens that
// write one object each and expire within hours. Retire when the batch is up.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Inbound key (2026-09-24): no key literal in this file. Vault holds only sha256
// fingerprints (social_card_intake_key_sha256, plus _prev_sha256 while callers
// move over); edge_key_ok() (service-role only) checks them.
const OWN_KEY_NAMES = ["social_card_intake_key_sha256", "social_card_intake_key_prev_sha256"];

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = SB_SECRET;

const ALLOW: Record<string, string[]> = {
  "ig-staging": ["social/cookieyeti/"],
  "inventoryproof-social": ["social/inventoryproof/"],
  "social-media": ["hoku/"],
};

const sameSecret = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

const keyDb = createClient(URL_, SRK, { auth: { persistSession: false } });
async function keyOk(k: string): Promise<boolean> {
  if (!k) return false;
  for (const n of OWN_KEY_NAMES) {
    const { data } = await keyDb.rpc("edge_key_ok", { p_name: n, p_key: k });
    if (data === true) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  const J = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  if (!(await keyOk(req.headers.get("x-intake-key") ?? ""))) {
    return J({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return J({ error: "bad json" }, 400); }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length) return J({ error: "items[] required" }, 400);
  if (items.length > 140) return J({ error: "too many" }, 400);

  const db = createClient(URL_, SRK);
  const out: unknown[] = [];

  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const bucket = String(it.bucket ?? "");
    const path = String(it.path ?? "");
    const prefixes = ALLOW[bucket];
    if (!prefixes) return J({ error: "bucket not allowed", bucket }, 403);
    if (!prefixes.some((p) => path.startsWith(p))) {
      return J({ error: "path outside allowed prefixes", path, prefixes }, 403);
    }
    if (path.includes("..")) return J({ error: "bad path", path }, 403);
    if (!path.toLowerCase().endsWith(".jpg")) return J({ error: "jpg only", path }, 403);

    const { data, error } = await db.storage.from(bucket)
      .createSignedUploadUrl(path, { upsert: true });
    if (error) return J({ error: error.message, path }, 500);
    out.push({ p: path, t: data.token });
  }

  return J({ ok: true, n: out.length, items: out });
});

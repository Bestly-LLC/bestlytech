// bestly-secret-intake — a one-way slot for a credential to reach the vault.
//
// Reopened 2026-09-03 for the GitHub token. A secret shown once in a browser has to
// get into the vault somehow, and pasting it into a chat would park it in a model's
// context permanently. This lets it go clipboard → vault directly. Values go in;
// nothing but a word comes out.
//
// Narrow by construction: one random token gates it, and the underlying SQL function
// refuses any name outside a four-item allowlist. Retire it once the value is in.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const INTAKE_TOKEN = "xL88Fm9DgX147tx3LzqIoKsDu8oigTiB";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, x-intake-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const t = req.headers.get("x-intake-token") ?? "";
  if (!sameSecret(t, INTAKE_TOKEN)) return J({ error: "not found" }, 404);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return J({ error: "bad json" }, 400); }

  const name = String(body.name ?? "");
  const value = String(body.value ?? "").trim();
  if (!name || !value) return J({ error: "name and value required" }, 400);

  const { data, error } = await db.rpc("store_bestly_secret", { p_name: name, p_value: value });
  if (error) return J({ error: error.message }, 400);

  // Never echo the value. Length and a prefix shape are enough to confirm the right
  // thing arrived without revealing it.
  return J({
    ok: true,
    name,
    result: data,
    length: value.length,
    looksLikeGithubToken: /^github_pat_/.test(value),
  });
});

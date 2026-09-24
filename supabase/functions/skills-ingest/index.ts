// skills-ingest — push a snapshot of the account's Claude skills into bestly_skills.
//
// Why this exists rather than a pile of INSERT statements: a session that types the
// rows into SQL has to carry every byte of every SKILL.md through its own context,
// which is slow and expensive and gets worse as the skills grow. Posting a JSON file
// straight from the sandbox costs nothing to read. Same reason git.sh exists.
//
// Skills on disk in a session are a READ-ONLY CACHE. This backs them up; it cannot
// restore them. Restoring is re-proposing the SKILL.md through the skill review card.
//
// Own key, deliberately not the shared proxy key: worst case here is junk rows in one
// table, and the shared key unlocks far more than that.
// v2 (2026-09-23): the key is no longer in this file. Vault holds its sha256 as
// skills_ingest_key_sha256 and edge_key_ok() (service-role only) does the check.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-skills-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

async function keyOk(k: string): Promise<boolean> {
  if (!k) return false;
  const { data } = await db.rpc("edge_key_ok", { p_name: "skills_ingest_key_sha256", p_key: k });
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const k = req.headers.get("x-skills-key") || "";
  const ok = isSvc(req) || await keyOk(k);
  if (!ok) return J({ error: "unauthorized" }, 401);

  try {
    const body = await req.json();
    const action = String(body.action ?? "ingest");

    if (action === "list") {
      const { data, error } = await db.from("bestly_skills")
        .select("skill,path,is_entrypoint,name,description,bytes,sha256,custom,captured_at")
        .order("skill").order("path");
      if (error) return J({ error: error.message }, 500);
      return J({ ok: true, count: data?.length ?? 0, files: data });
    }

    if (action === "ingest") {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) return J({ error: "rows required" }, 400);

      // Only the columns the table knows about; anything else the caller sends is dropped
      // rather than trusted.
      const clean = rows.map((r: Record<string, unknown>) => ({
        skill: String(r.skill ?? ""),
        path: String(r.path ?? ""),
        is_entrypoint: !!r.is_entrypoint,
        name: r.name ?? null,
        description: r.description ?? null,
        content: String(r.content ?? ""),
        bytes: Number(r.bytes ?? 0),
        sha256: String(r.sha256 ?? ""),
        custom: !!r.custom,
        captured_at: new Date().toISOString(),
      })).filter((r) => r.skill && r.path && r.content);

      if (!clean.length) return J({ error: "no usable rows" }, 400);

      const { error } = await db.from("bestly_skills")
        .upsert(clean, { onConflict: "skill,path" });
      if (error) return J({ error: error.message }, 500);

      // What the caller did NOT send is as interesting as what it did: a skill that
      // disappears upstream should not quietly linger here looking current.
      const sent = new Set(clean.map((r) => `${r.skill}\u0000${r.path}`));
      const { data: all } = await db.from("bestly_skills").select("skill,path");
      const stale = (all ?? []).filter((r) => !sent.has(`${r.skill}\u0000${r.path}`));

      return J({
        ok: true,
        upserted: clean.length,
        skills: [...new Set(clean.map((r) => r.skill))].length,
        bytes: clean.reduce((n, r) => n + r.bytes, 0),
        not_in_this_snapshot: stale.map((r) => `${r.skill}/${r.path}`),
      });
    }

    return J({ error: `unknown action "${action}"` }, 400);
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});

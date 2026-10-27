// skill-inbox-mcp: the Bestly Skill Inbox as a remote MCP connector for Meta's Muse (Radar, 2026-10-27). STAGED, not deployed.
//
// Connector URL (once deployed):   https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/skill-inbox-mcp/<key>
// The key is the Vault secret `skill_inbox_mcp_key` (Jared creates it at deploy; never in git, never in a chat).
// Also accepted: `Authorization: Bearer <key>` for clients that can set a header.
//
// Needs `verify_jwt = false` in supabase/config.toml (Muse sends no Supabase JWT); the key is the auth.
// Tools: save_instagram_post(url, caption, saved_at, creator_handle?, media_url?) and known_posts(). Write-only, rate limited.
// Every database call is a service-role-only RPC (skill_inbox_key_ok / _ingest / _known). See handler.ts for the rules.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handle } from "./handler.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback (same as studio-mcp).
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

Deno.serve((req) =>
  handle(req, {
    keyOk: async (key) => {
      const { data, error } = await db.rpc("skill_inbox_key_ok", { p_key: key });
      return !error && data === true;
    },
    ingest: async (p) => {
      const { data, error } = await db.rpc("skill_inbox_ingest", { p });
      if (error) return { ok: false, error: "db_error" };
      return data as { ok: boolean; duplicate?: boolean; error?: string };
    },
    known: async (limit) => {
      const { data, error } = await db.rpc("skill_inbox_known", { p_limit: limit });
      if (error) throw new Error("db_error");
      return (data ?? []) as string[];
    },
  }),
);

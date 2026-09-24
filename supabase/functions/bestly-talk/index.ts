// bestly-talk - read-only view of Nextcloud Talk conversations.
//
// bestly-files speaks WebDAV; Talk lives on the OCS API, so it needs its own
// door. Read-only on purpose: listing rooms and reading their share state is
// useful, creating or deleting conversations is not something to automate.
//
// Same vault credentials and same proxy key as bestly-files.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PROXY_KEY = "40go6-gkP2s_X_UzPcDF7tt5WTPW6wfzI7ocMNWXSwkk19AD";

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

// Talk conversation types, per the spreed API.
const ROOM_TYPE: Record<number, string> = {
  1: "one-to-one",
  2: "group",
  3: "public",
  4: "changelog",
  5: "former one-to-one",
  6: "note to self",
};

Deno.serve(async (req) => {
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o, null, 2), { status: s, headers: { "Content-Type": "application/json" } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* defaults below */ }

  const k = req.headers.get("x-proxy-key") ?? String(body.proxyKey ?? "");
  if (!k || !sameSecret(k, PROXY_KEY)) return J({ error: "unauthorized" }, 401);

  try {
    const { data, error } = await db.rpc("get_nextcloud_credentials");
    if (error) return J({ error: `vault: ${error.message}` }, 500);
    const row = Array.isArray(data) ? data[0] : data;
    const base = String(row?.base_url ?? "").replace(/\/+$/, "");
    const user = String(row?.username ?? "");
    const pass = String(row?.app_password ?? "");
    if (!base || !user || !pass) return J({ error: "nextcloud credentials incomplete" }, 500);

    const headers = {
      Authorization: "Basic " + btoa(`${user}:${pass}`),
      "OCS-APIRequest": "true",
      Accept: "application/json",
    };

    const action = String(body.action ?? "rooms");

    if (action === "rooms") {
      const r = await fetch(`${base}/ocs/v2.php/apps/spreed/api/v4/room`, { headers });
      if (!r.ok) return J({ error: `talk api ${r.status}`, detail: (await r.text()).slice(0, 300) }, r.status);
      const j = await r.json();
      const rooms = (j?.ocs?.data ?? []).map((c: Record<string, unknown>) => ({
        token: c.token,
        name: c.displayName,
        type: ROOM_TYPE[Number(c.type)] ?? String(c.type),
        // type 3 is publicly linkable; anything else needs an account on the server
        guests_can_join: Number(c.type) === 3,
        has_password: !!c.hasPassword,
        participants: c.participantType,
        unread: c.unreadMessages,
        last_activity: c.lastActivity
          ? new Date(Number(c.lastActivity) * 1000).toISOString() : null,
        description: c.description || null,
        url: `${base}/call/${c.token}`,
      }));
      return J({ ok: true, base, rooms });
    }

    if (action === "participants") {
      const token = String(body.token ?? "");
      if (!token) return J({ error: "token required" }, 400);
      const r = await fetch(
        `${base}/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(token)}/participants`,
        { headers });
      if (!r.ok) return J({ error: `talk api ${r.status}`, detail: (await r.text()).slice(0, 300) }, r.status);
      const j = await r.json();
      const people = (j?.ocs?.data ?? []).map((p: Record<string, unknown>) => ({
        id: p.actorId, name: p.displayName, type: p.actorType,
        last_seen: p.lastPing ? new Date(Number(p.lastPing) * 1000).toISOString() : null,
      }));
      return J({ ok: true, token, people });
    }

    return J({ error: "unknown action" }, 400);
  } catch (e) {
    return J({ error: (e as Error).message }, 500);
  }
});

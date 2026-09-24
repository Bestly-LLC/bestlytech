// talk-hook — Nextcloud Talk, proxied for Studio and for a client's board.
//
// The browser cannot call Nextcloud directly: Talk's OCS endpoints carry no
// CORS attribute, so no Access-Control-Allow-Origin is ever sent. A server
// side proxy is the only shape that works, not a preference.
//
// Who is speaking. Each person who talks from here has a *seat*: their own
// Nextcloud account, whose app password sits in Vault (nextcloud_seats). The
// caller's Studio token (staff) or board token (client) resolves to their
// seat, and everything they do — read, send, react — happens as them. So
// Eli's messages are Eli's, Elizabeth's are hers, and presence is real.
// Nobody logs in to Nextcloud: the seat is minted once by `seat` below, using
// the admin credential already in Vault, and the person never sees it.
//
// Without a seat, a staff member falls back to the house account with their
// name written into the text — the old behaviour, kept so nothing breaks the
// day a new producer is added, and gone the moment they get a seat.
//
// Doors: staff_token (Studio) or client_token (her board). A client can only
// see their own room; a staff member sees whatever their account is in.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

type Cred = { base: string; auth: string; user: string; seat: boolean; display?: string };

let HOUSE: Cred | null = null;
async function house(): Promise<Cred> {
  if (HOUSE) return HOUSE;
  const { data, error } = await db.rpc("nextcloud_cred");
  if (error || !data) throw new Error("vault: " + (error?.message ?? "no rows"));
  const m = data as Record<string, string>;
  const base = String(m.nextcloud_base_url ?? "").replace(/\/+$/, "");
  const user = String(m.nextcloud_user ?? ""), pw = String(m.nextcloud_app_password ?? "");
  if (!base || !user || !pw) throw new Error("vault: nextcloud credentials incomplete");
  HOUSE = { base, user, auth: "Basic " + btoa(`${user}:${pw}`), seat: false };
  return HOUSE;
}

// the caller's own seat if they have one, else the house account
async function credFor(who: { staff_id?: string; client_id?: string }): Promise<Cred> {
  const h = await house();
  const { data } = await db.rpc("nextcloud_seat_cred", { p_staff: who.staff_id ?? null, p_client: who.client_id ?? null });
  if (!data) return h;
  const s = data as { uid: string; display?: string; app_password: string };
  return { base: h.base, user: s.uid, auth: "Basic " + btoa(`${s.uid}:${s.app_password}`), seat: true, display: s.display };
}

async function ocs(c: Cred, path: string, init: RequestInit = {}) {
  return await fetch(c.base + path, {
    ...init,
    headers: {
      "OCS-APIRequest": "true",
      "Accept": "application/json",
      "Authorization": c.auth,
      ...(init.body && !(init.body instanceof URLSearchParams) ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

const msgOut = (m: any) => ({
  id: m.id,
  actor_id: m.actorId,
  actor_name: m.actorDisplayName,
  actor_type: m.actorType,
  body: m.message,
  params: m.messageParameters ?? null,
  system: m.systemMessage ?? null,
  parent: m.parent ? { id: m.parent.id, actor_name: m.parent.actorDisplayName, body: m.parent.message } : null,
  reactions: m.reactions ?? null,
  sent_at: new Date((m.timestamp ?? 0) * 1000).toISOString(),
});

const rand = (n = 32) => {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, (b) => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 56]).join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "bad_json" }, 400); }
  const action = String(body.action ?? "");

  // ── who is asking ─────────────────────────────────────────────────────────
  let staff: any = null, client: any = null;
  if (body.client_token) {
    const { data } = await db.rpc("client_talk_ctx", { p_token: String(body.client_token) });
    if (!data?.ok) return J({ ok: false, error: "not_found" }, 401);
    client = data;
  } else {
    const { data: s } = await db.rpc("studio_resolve_staff", { p_token: String(body.staff_token ?? "") });
    staff = Array.isArray(s) ? s[0] : s;
    if (!staff?.id) return J({ ok: false, error: "not_found" }, 401);
  }
  // a client sees one room and one room only
  const roomOf = (want: string) => client ? String(client.room ?? "") : want;
  if (client && !client.room) return J({ ok: false, error: "no_room" }, 404);

  try {
    const c = await credFor(client ? { client_id: client.client_id } : { staff_id: staff.id });

    // ── the conversations we can see ────────────────────────────────────
    if (action === "rooms") {
      const r = await ocs(c, "/ocs/v2.php/apps/spreed/api/v4/room?noStatusUpdate=1");
      if (!r.ok) return J({ ok: false, error: "nextcloud_" + r.status }, 502);
      const j = await r.json();
      let rooms = (j?.ocs?.data ?? []).map((x: any) => ({
        token: x.token, label: x.displayName, type: x.type,
        unread: x.unreadMessages ?? 0, mention: !!x.unreadMention,
        last_read: x.lastReadMessage ?? 0, common_read: x.lastCommonReadMessage ?? 0,
        last_at: x.lastActivity ? new Date(x.lastActivity * 1000).toISOString() : null,
      }));
      if (client) rooms = rooms.filter((x: any) => x.token === client.room);
      return J({ ok: true, rooms, me: c.user, seat: c.seat });
    }

    // ── history, or wait for the next message ─────────────────────────────
    if (action === "sync") {
      const room = roomOf(String(body.room ?? ""));
      if (!room) return J({ ok: false, error: "room required" }, 400);
      const since = Number(body.since ?? 0);
      const wait = !!body.wait && since > 0;
      const q = new URLSearchParams({
        lookIntoFuture: wait ? "1" : "0",
        limit: String(Math.min(Number(body.limit ?? 60), 200)),
        noStatusUpdate: "1",
        setReadMarker: "0",
        includeLastKnown: "0",
      });
      if (since) q.set("lastKnownMessageId", String(since));
      if (wait) q.set("timeout", "25");
      const r = await ocs(c, `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(room)}?${q}`);
      if (r.status === 304) return J({ ok: true, messages: [], cursor: since, quiet: true });
      if (!r.ok) return J({ ok: false, error: "nextcloud_" + r.status }, 502);
      const j = await r.json();
      const raw = j?.ocs?.data ?? [];
      const messages = raw.map(msgOut).sort((a: any, b: any) => a.id - b.id);
      const given = Number(r.headers.get("x-chat-last-given") ?? 0);
      const common = Number(r.headers.get("x-chat-last-common-read") ?? 0);
      return J({ ok: true, messages, cursor: given || (messages.length ? messages[messages.length - 1].id : since), common_read: common, me: c.user });
    }

    // ── say something ─────────────────────────────────────────────────────
    if (action === "send") {
      const room = roomOf(String(body.room ?? "")), message = String(body.message ?? "").trim();
      if (!room || !message) return J({ ok: false, error: "room and message required" }, 400);
      if (message.length > 3000) return J({ ok: false, error: "too_long" }, 400);
      // With a seat the message is simply theirs. Without one it goes out on
      // the house account, so the text says who typed it.
      const who = client ? String(client.name) : String(staff.name);
      const text = c.seat || who === c.user ? message : `${who}: ${message}`;
      const payload: Record<string, unknown> = { message: text, referenceId: crypto.randomUUID().replace(/-/g, "") };
      if (body.reply_to) payload.replyTo = Number(body.reply_to);
      const r = await ocs(c, `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(room)}`, {
        method: "POST", body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const why = await r.text();
        console.error("talk send", r.status, why.slice(0, 200));
        return J({ ok: false, error: r.status === 429 ? "rate_limited" : "nextcloud_" + r.status }, 502);
      }
      const j = await r.json();
      return J({ ok: true, message: j?.ocs?.data ? msgOut(j.ocs.data) : null });
    }

    // ── I have read up to here ─────────────────────────────────────────────
    if (action === "read") {
      const room = roomOf(String(body.room ?? "")); const id = Number(body.id ?? 0);
      if (!room || !id) return J({ ok: false, error: "room and id required" }, 400);
      const r = await ocs(c, `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(room)}/read`, {
        method: "POST", body: JSON.stringify({ lastReadMessage: id }),
      });
      return J({ ok: r.ok });
    }

    // ── a reaction ────────────────────────────────────────────────────────
    if (action === "react") {
      const room = roomOf(String(body.room ?? "")); const id = Number(body.id ?? 0); const emoji = String(body.emoji ?? "");
      if (!room || !id || !emoji) return J({ ok: false, error: "room, id, emoji required" }, 400);
      const r = await ocs(c, `/ocs/v2.php/apps/spreed/api/v1/reaction/${encodeURIComponent(room)}/${id}`, {
        method: body.remove ? "DELETE" : "POST", body: JSON.stringify({ reaction: emoji }),
      });
      return J({ ok: r.ok, error: r.ok ? undefined : "nextcloud_" + r.status });
    }

    // ── who is on Nextcloud ─────────────────────────────────────────────────
    if (action === "presence") {
      const r = await ocs(c, "/ocs/v2.php/apps/user_status/api/v1/statuses?limit=100");
      if (!r.ok) return J({ ok: false, error: "nextcloud_" + r.status }, 502);
      const j = await r.json();
      const people = (j?.ocs?.data ?? []).map((x: any) => ({
        user: x.userId, status: x.status, message: x.message ?? null,
        icon: x.icon ?? null, clear_at: x.clearAt ?? null,
      }));
      return J({ ok: true, people });
    }

    // ── mint a seat: a Nextcloud account and app password for one person ──
    // Staff with can_promote only. Creates the account with a throwaway
    // password, trades that password for an app password, stores the app
    // password in Vault, and puts the account in the rooms asked for. The
    // throwaway password is never kept: nobody logs in to Nextcloud, the seat
    // is used only from here.
    if (action === "seat") {
      if (!staff?.can_promote) return J({ ok: false, error: "not_permitted" }, 403);
      const kind = String(body.kind ?? ""), slug = String(body.slug ?? ""), uid = String(body.uid ?? "").toLowerCase();
      const display = String(body.display ?? "").trim();
      const rooms: string[] = Array.isArray(body.rooms) ? body.rooms.map(String) : [];
      if (!["staff", "client"].includes(kind) || !slug || !/^[a-z][a-z0-9_.-]{1,30}$/.test(uid) || !display)
        return J({ ok: false, error: "kind, slug, uid, display required" }, 400);
      const admin = await house();
      // exists already?
      // OCS v1 answers HTTP 200 even when it means "no such user"; the
      // verdict is meta.statuscode (100 = found, 998 = not found)
      const g = await ocs(admin, `/ocs/v1.php/cloud/users/${encodeURIComponent(uid)}?format=json`);
      const gj = await g.json().catch(() => ({}));
      const existed = g.ok && gj?.ocs?.meta?.statuscode === 100;
      const pw = rand(32);
      if (!existed) {
        const f = new URLSearchParams({ userid: uid, password: pw, displayName: display });
        const r = await ocs(admin, "/ocs/v1.php/cloud/users?format=json", { method: "POST", body: f });
        const j = await r.json().catch(() => ({}));
        const code = j?.ocs?.meta?.statuscode;
        if (!r.ok || (code && code !== 100)) return J({ ok: false, error: "create_failed", detail: j?.ocs?.meta?.message ?? r.status }, 502);
      } else {
        // an account we did not make: refuse to touch its password unless it already has a seat row of ours
        const { data: mine } = await db.from("nextcloud_seats").select("uid").eq("uid", uid).maybeSingle();
        if (!mine) return J({ ok: false, error: "exists_not_ours", hint: "that Nextcloud account was not created here; pick another uid or delete it first" }, 409);
        const f = new URLSearchParams({ key: "password", value: pw });
        const r = await ocs(admin, `/ocs/v1.php/cloud/users/${encodeURIComponent(uid)}?format=json`, { method: "PUT", body: f });
        if (!r.ok) return J({ ok: false, error: "reset_failed", detail: r.status }, 502);
      }
      // trade the password for an app password, as the new user
      const asUser: Cred = { base: admin.base, user: uid, auth: "Basic " + btoa(`${uid}:${pw}`), seat: true };
      const ap = await ocs(asUser, "/ocs/v2.php/core/getapppassword?format=json");
      const aj = await ap.json().catch(() => ({}));
      const app = aj?.ocs?.data?.apppassword;
      if (!ap.ok || !app) return J({ ok: false, error: "apppassword_failed", detail: aj?.ocs?.meta?.message ?? ap.status }, 502);
      const { data: put, error } = await db.rpc("nextcloud_seat_put", { p_kind: kind, p_slug: slug, p_uid: uid, p_display: display, p_app_password: app });
      if (error || !put?.ok) return J({ ok: false, error: "store_failed", detail: error?.message ?? put?.error }, 500);
      // into the rooms
      const joined: Record<string, boolean> = {};
      for (const t of rooms) {
        const r = await ocs(admin, `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(t)}/participants`, {
          method: "POST", body: JSON.stringify({ newParticipant: uid, source: "users" }),
        });
        joined[t] = r.ok;
      }
      return J({ ok: true, uid, display, created: !existed, rooms: joined });
    }

    // ── a seat minted on the server itself ────────────────────────────────
    // Nextcloud will not let an app password create accounts ("password
    // confirmation is required"), so the account and its token are made with
    // occ on the server, and the token comes straight here — piped from the
    // occ output into curl, never shown to anyone. Same gate as `seat`.
    if (action === "seat_store") {
      if (!staff?.can_promote) return J({ ok: false, error: "not_permitted" }, 403);
      const kind = String(body.kind ?? ""), slug = String(body.slug ?? ""), uid = String(body.uid ?? "").toLowerCase();
      const display = String(body.display ?? "").trim(), app = String(body.app_password ?? "").trim();
      const rooms: string[] = Array.isArray(body.rooms) ? body.rooms.map(String) : [];
      if (!["staff", "client"].includes(kind) || !slug || !/^[a-z][a-z0-9_.-]{1,30}$/.test(uid) || !display || app.length < 20)
        return J({ ok: false, error: "kind, slug, uid, display, app_password required" }, 400);
      const admin = await house();
      // prove the token works before keeping it
      const me: Cred = { base: admin.base, user: uid, auth: "Basic " + btoa(`${uid}:${app}`), seat: true };
      const t = await ocs(me, "/ocs/v2.php/cloud/user?format=json");
      const tj = await t.json().catch(() => ({}));
      if (!t.ok || String(tj?.ocs?.data?.id ?? "").toLowerCase() !== uid)
        return J({ ok: false, error: "token_rejected", detail: t.status }, 401);
      const { data: put, error } = await db.rpc("nextcloud_seat_put", { p_kind: kind, p_slug: slug, p_uid: uid, p_display: display, p_app_password: app });
      if (error || !put?.ok) return J({ ok: false, error: "store_failed", detail: error?.message ?? put?.error }, 500);
      const joined: Record<string, boolean> = {};
      for (const r of rooms) {
        const x = await ocs(admin, `/ocs/v2.php/apps/spreed/api/v4/room/${encodeURIComponent(r)}/participants`, {
          method: "POST", body: JSON.stringify({ newParticipant: uid, source: "users" }),
        });
        joined[r] = x.ok;
      }
      return J({ ok: true, uid, display, rooms: joined });
    }

    return J({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    console.error("talk-hook", e instanceof Error ? e.message : String(e));
    return J({ ok: false, error: "upstream" }, 502);
  }
});

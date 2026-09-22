// partner-nc: the partner's Nextcloud, inside /partner, with no Nextcloud login.
//
// Eli has a Nextcloud "seat" (account `eli`, app password in Vault via nextcloud_seats) that he has
// never been given a password for, and never needs one. This function signs in AS his seat on the
// server side, so chat messages are his, and the portal shows Talk, the Ops board and his cloud
// files in-page. Nothing here ever returns the app password.
//
//   rooms               his Talk conversations (not the changelog / note-to-self)
//   sync   {room,since,wait}   messages (long-poll when wait)
//   send   {room,message}
//   read   {room,id}
//   deck   {board}      the Ops board: stacks and cards (as him; read-only via the house account if
//                       the board is not shared with him)
//   files  {path}       list a folder in his cloud files
//   file   {path}       one file's bytes (for the in-page previewer)
//   probe               what his seat can reach (admin / worker only)
//
// Auth: the partner's own Supabase session; or an admin session with {as: "eli"}; or the Mac mini
// worker key with {as}. verify_jwt = false (checked here, CORS preflight carries no auth).
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });
const URL_ = Deno.env.get("SUPABASE_URL")!;
const svc = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const OPS_BOARD = 2;

type Cred = { base: string; user: string; auth: string };

async function house(): Promise<Cred> {
  const { data } = await svc.rpc("get_nextcloud_credentials");
  const r = Array.isArray(data) ? data[0] : data;
  const base = String(r?.base_url ?? "https://cloud.bestly.tech").replace(/\/+$/, "");
  return { base, user: String(r?.username ?? ""), auth: "Basic " + btoa(`${r?.username}:${r?.app_password}`) };
}
async function seat(staffId: string): Promise<Cred | null> {
  const { data } = await svc.rpc("nextcloud_seat_cred", { p_staff: staffId, p_client: null });
  if (!data) return null;
  const s = data as { uid: string; app_password: string };
  const h = await house();
  return { base: h.base, user: s.uid, auth: "Basic " + btoa(`${s.uid}:${s.app_password}`) };
}
const ocs = (c: Cred, path: string, init: RequestInit = {}) => fetch(c.base + path, {
  ...init,
  headers: { "OCS-APIRequest": "true", Accept: "application/json", Authorization: c.auth,
    ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
});
const msgOut = (m: any) => ({
  id: m.id, actor_id: m.actorId, actor_name: m.actorDisplayName, actor_type: m.actorType,
  body: m.message, params: m.messageParameters ?? null, system: m.systemMessage || null,
  parent: m.parent ? { id: m.parent.id, actor_name: m.parent.actorDisplayName, body: m.parent.message } : null,
  sent_at: new Date((m.timestamp ?? 0) * 1000).toISOString(),
});
const cleanPath = (p: unknown) => {
  const s = String(p ?? "/").replace(/\\/g, "/");
  if (s.split("/").some((x) => x === "..")) throw new Error("bad path");
  return ("/" + s).replace(/\/+/g, "/");
};
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "bad_json" }, 400); }
  const action = String(body.action ?? "");

  // who is asking, and whose seat
  let admin = false, partner: { roster_name: string; staff_id: string | null; call_url: string | null } | null = null;
  const wk = req.headers.get("x-worker-key");
  if (wk && (await svc.rpc("partner_ai_key_ok", { p_key: wk })).data) admin = true;
  else {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await svc.auth.getUser(jwt);
    if (!u?.user) return J({ ok: false, error: "unauthorized" }, 401);
    const [{ data: a }, { data: p }] = await Promise.all([
      svc.rpc("has_role", { _user_id: u.user.id, _role: "admin" }),
      svc.from("partners").select("roster_name, staff_id, call_url").eq("user_id", u.user.id).maybeSingle(),
    ]);
    admin = !!a; partner = p as typeof partner;
  }
  if (!partner && admin && body.as) {
    const { data: p } = await svc.from("partners").select("roster_name, staff_id, call_url").eq("roster_name", String(body.as).toLowerCase()).maybeSingle();
    partner = p as typeof partner;
  }
  if (!partner) return J({ ok: false, error: admin ? "pick a partner (as)" : "forbidden" }, admin ? 400 : 403);
  if (!partner.staff_id) return J({ ok: false, error: "no_seat", hint: "This partner has no Studio staff link yet." }, 404);

  try {
    const me = await seat(partner.staff_id);
    if (!me) return J({ ok: false, error: "no_seat", hint: "No Nextcloud seat for this partner yet." }, 404);

    // only rooms he is actually in (and not the changelog / note to self)
    const myRooms = async () => {
      const r = await ocs(me, "/ocs/v2.php/apps/spreed/api/v4/room?noStatusUpdate=1");
      if (!r.ok) throw new Error("nextcloud_" + r.status);
      const j = await r.json();
      return (j?.ocs?.data ?? []).filter((x: any) => ![4, 6].includes(Number(x.type))).map((x: any) => ({
        token: x.token, label: x.displayName, type: x.type, unread: x.unreadMessages ?? 0, mention: !!x.unreadMention,
        last_read: x.lastReadMessage ?? 0, last_at: x.lastActivity ? new Date(x.lastActivity * 1000).toISOString() : null,
        preview: x.lastMessage?.message ? String(x.lastMessage.message).slice(0, 140) : null,
      }));
    };
    const allowed = async (room: string) => (await myRooms()).some((x: any) => x.token === room);

    if (action === "rooms") {
      const rooms = await myRooms();
      // his standing call room first
      const call = partner.call_url?.match(/\/call\/([a-z0-9]+)/i)?.[1];
      rooms.sort((a: any, b: any) => (a.token === call ? -1 : b.token === call ? 1 : String(b.last_at).localeCompare(String(a.last_at))));
      return J({ ok: true, rooms, me: me.user, call_room: call ?? null });
    }

    if (action === "sync") {
      const room = String(body.room ?? "");
      if (!room || !(await allowed(room))) return J({ ok: false, error: "no such room" }, 404);
      const since = Number(body.since ?? 0), wait = !!body.wait && since > 0;
      const q = new URLSearchParams({ lookIntoFuture: wait ? "1" : "0", limit: String(Math.min(Number(body.limit ?? 80), 200)),
        noStatusUpdate: "1", setReadMarker: "0", includeLastKnown: "0" });
      if (since) q.set("lastKnownMessageId", String(since));
      if (wait) q.set("timeout", "25");
      const r = await ocs(me, `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(room)}?${q}`);
      if (r.status === 304) return J({ ok: true, messages: [], cursor: since });
      if (!r.ok) return J({ ok: false, error: "nextcloud_" + r.status }, 502);
      const j = await r.json();
      const messages = (j?.ocs?.data ?? []).map(msgOut).sort((a: any, b: any) => a.id - b.id);
      const given = Number(r.headers.get("x-chat-last-given") ?? 0);
      return J({ ok: true, messages, cursor: given || (messages.length ? messages[messages.length - 1].id : since), me: me.user });
    }

    if (action === "send") {
      const room = String(body.room ?? ""), message = String(body.message ?? "").trim();
      if (!room || !message) return J({ ok: false, error: "room and message required" }, 400);
      if (message.length > 3000) return J({ ok: false, error: "too_long" }, 400);
      if (!(await allowed(room))) return J({ ok: false, error: "no such room" }, 404);
      const payload: Record<string, unknown> = { message, referenceId: crypto.randomUUID().replace(/-/g, "") };
      if (body.reply_to) payload.replyTo = Number(body.reply_to);
      const r = await ocs(me, `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(room)}`, { method: "POST", body: JSON.stringify(payload) });
      if (!r.ok) return J({ ok: false, error: r.status === 429 ? "rate_limited" : "nextcloud_" + r.status }, 502);
      const j = await r.json();
      return J({ ok: true, message: j?.ocs?.data ? msgOut(j.ocs.data) : null });
    }

    if (action === "read") {
      const room = String(body.room ?? ""), id = Number(body.id ?? 0);
      if (!room || !id) return J({ ok: false, error: "room and id required" }, 400);
      const r = await ocs(me, `/ocs/v2.php/apps/spreed/api/v1/chat/${encodeURIComponent(room)}/read`, { method: "POST", body: JSON.stringify({ lastReadMessage: id }) });
      return J({ ok: r.ok });
    }

    if (action === "deck") {
      const board = Number(body.board ?? OPS_BOARD);
      if (board !== OPS_BOARD) return J({ ok: false, error: "not shared here" }, 403);
      let c = me, via = "you";
      let r = await ocs(c, `/index.php/apps/deck/api/v1.0/boards/${board}/stacks`);
      if (r.status === 403 || r.status === 404) { c = await house(); via = "shared"; r = await ocs(c, `/index.php/apps/deck/api/v1.0/boards/${board}/stacks`); }
      if (!r.ok) return J({ ok: false, error: "nextcloud_" + r.status }, 502);
      const stacks = ((await r.json()) ?? []).sort((a: any, b: any) => a.order - b.order).map((s: any) => ({
        id: s.id, title: s.title,
        cards: (s.cards ?? []).filter((x: any) => !x.archived && !x.deletedAt).sort((a: any, b: any) => a.order - b.order).map((x: any) => ({
          id: x.id, title: x.title, description: x.description ? String(x.description).slice(0, 600) : "",
          due: x.duedate ?? null, done: x.done ?? null, labels: (x.labels ?? []).map((l: any) => ({ title: l.title, color: l.color })),
          people: (x.assignedUsers ?? []).map((u: any) => u.participant?.displayname ?? u.participant?.uid).filter(Boolean),
          updated_at: x.lastModified ? new Date(x.lastModified * 1000).toISOString() : null,
        })),
      }));
      return J({ ok: true, board, stacks, via });
    }

    if (action === "files") {
      const path = cleanPath(body.path);
      const r = await fetch(`${me.base}/remote.php/dav/files/${encodeURIComponent(me.user)}${enc(path)}`, {
        method: "PROPFIND", headers: { Authorization: me.auth, Depth: "1", "Content-Type": "application/xml" },
        body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><d:displayname/><d:getcontenttype/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/><oc:size/></d:prop></d:propfind>`,
      });
      if (r.status === 404) return J({ ok: false, error: "not found" }, 404);
      if (!r.ok) return J({ ok: false, error: "nextcloud_" + r.status }, 502);
      const xml = await r.text();
      const root = `/remote.php/dav/files/${encodeURIComponent(me.user)}`;
      const items = [...xml.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)].map((m) => {
        const x = m[1];
        const href = decodeURIComponent(x.match(/<d:href>([^<]+)<\/d:href>/)?.[1] ?? "");
        const rel = href.slice(href.indexOf(root) + root.length) || "/";
        const dir = /<d:collection\s*\/>/.test(x);
        return {
          path: dir ? rel.replace(/\/$/, "") || "/" : rel, name: rel.replace(/\/$/, "").split("/").pop() || "/", dir,
          type: dir ? null : (x.match(/<d:getcontenttype>([^<]*)</)?.[1] ?? null),
          size: Number(x.match(/<oc:size>(\d+)</)?.[1] ?? x.match(/<d:getcontentlength>(\d+)</)?.[1] ?? 0),
          modified: x.match(/<d:getlastmodified>([^<]*)</)?.[1] ?? null,
        };
      }).filter((i) => i.path.replace(/\/$/, "") !== path.replace(/\/$/, "") && i.path !== path);
      items.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
      return J({ ok: true, path, items });
    }

    if (action === "file") {
      const path = cleanPath(body.path);
      const r = await fetch(`${me.base}/remote.php/dav/files/${encodeURIComponent(me.user)}${enc(path)}`, { headers: { Authorization: me.auth } });
      if (!r.ok) return J({ ok: false, error: "nextcloud_" + r.status }, r.status === 404 ? 404 : 502);
      const len = Number(r.headers.get("content-length") ?? 0);
      if (len > 40 * 1024 * 1024) return J({ ok: false, error: "too_large" }, 413);
      return new Response(r.body, { headers: { ...CORS, "content-type": r.headers.get("content-type") ?? "application/octet-stream", "cache-control": "private, max-age=300" } });
    }

    if (action === "probe" && admin) {
      const rooms = await myRooms().catch((e) => String(e));
      const d = await ocs(me, `/index.php/apps/deck/api/v1.0/boards`);
      const boards = d.ok ? ((await d.json()) ?? []).map((b: any) => ({ id: b.id, title: b.title })) : `deck ${d.status}`;
      const f = await fetch(`${me.base}/remote.php/dav/files/${encodeURIComponent(me.user)}/`, { method: "PROPFIND", headers: { Authorization: me.auth, Depth: "1" } });
      return J({ ok: true, seat: me.user, rooms, boards, files_root: f.status });
    }

    return J({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    return J({ ok: false, error: (e as Error).message.slice(0, 200) }, 500);
  }
});

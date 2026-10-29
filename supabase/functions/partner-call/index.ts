// partner-call: the Bestly call window inside the partner portal (/partner), 2026-10-27.
//
// The portal's BestlyDock (public/partner/bestly-dock.js) asks this function what Studio's asks talk-hook:
//   call_state {}  call_ticket {}  chat_list {after_id?,wait?}  chat_send {text}  chat_seen {last_id}
// The caller is the partner's own Supabase session. The room is NEVER taken from the request: it is the
// room in the caller's own partners.call_url. The seat is the partner's own Studio staff link
// (partners.staff_id -> Nextcloud account, e.g. eli). An admin (Jared) with no partner row uses his own
// seat and the room of the partner named in body.as (default eli); he joins with his own Nextcloud
// session, so he never needs a ticket (call_ticket is refused for him by calls.ts: not eli/elizabeth).
// calls.ts is a copy of talk-hook's with one change (ctx.room). No secret is returned or logged.
// verify_jwt = false: the session is checked here (a CORS pre-flight carries no auth).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { callOp } from "./calls.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
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

const OPS = ["call_state", "chat_list", "chat_send", "chat_seen", "call_ticket"];
type P = { roster_name: string; staff_id: string | null; call_url: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "bad_json" }, 400); }
  const action = String(body.action ?? "");
  if (!OPS.includes(action)) return J({ ok: false, error: "forbidden" }, 403);

  // who is asking
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return J({ ok: false, error: "unauthorized" }, 401);
  const [{ data: adm }, { data: mine }] = await Promise.all([
    db.rpc("has_role", { _user_id: u.user.id, _role: "admin" }),
    db.from("partners").select("roster_name, staff_id, call_url").eq("user_id", u.user.id).maybeSingle(),
  ]);

  // whose seat, whose room
  let partner = mine as P | null, staffSel: { id?: string; slug?: string };
  if (partner) staffSel = partner.staff_id ? { id: partner.staff_id } : { slug: partner.roster_name };
  else if (adm) {
    const as = String(body.as ?? "eli").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "eli";
    const { data: p } = await db.from("partners").select("roster_name, staff_id, call_url").eq("roster_name", as).maybeSingle();
    partner = p as P | null;
    staffSel = { slug: "jared" };
  } else return J({ ok: false, error: "forbidden" }, 403);
  const m = /\/call\/([A-Za-z0-9]{4,32})(?:[/?#]|$)/.exec(String(partner?.call_url ?? ""));
  if (!partner || !m) return J({ ok: false, error: "no_room" }, 404);
  const q = db.from("approval_staff").select("id, slug, name").eq("active", true);
  const { data: staff } = await (staffSel.id ? q.eq("id", staffSel.id) : q.eq("slug", String(staffSel.slug))).maybeSingle();
  if (!staff?.id) return J({ ok: false, error: "no_seat" }, 404);

  try {
    const c = await credFor({ staff_id: staff.id });
    return await callOp(action, { body, staff, client: null, watch: false, db, c, ocs, credFor, J, room: m[1] });
  } catch (e) {
    console.error("partner-call", e instanceof Error ? e.message : String(e));
    return J({ ok: false, error: "upstream" }, 502);
  }
});

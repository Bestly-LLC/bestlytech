// admin-device-login — sign in to /admin on a browser that can't show passkey or
// Apple sign-in prompts (the Claude app's built-in browser, a TV, a kiosk).
//
//   new browser                          Jared's phone / Chrome (already signed in)
//   op start  -> code + secret           op lookup {code}  -> where the request came from
//   op poll {id, secret} every 2s        op decide {code, approve}
//   ... approved -> one-time token_hash -> supabase.auth.verifyOtp() -> signed in
//
// The code alone is worthless: only the browser holding the secret can collect
// the session, only once, within 5 minutes, and only after an admin approved it
// with their own session. Same token_hash handoff webauthn-authenticate uses.
// verify_jwt is off (the new browser has no session yet); admin ops check the JWT here.

import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
function makeCode() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  const c = [...r].map((x) => ALPHA[x % ALPHA.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
const normCode = (c: unknown) => {
  const s = String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : "";
};

async function adminFrom(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: ok } = await db.rpc("has_role", { _user_id: uid, _role: "admin" });
  return ok ? data.user : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }
  const op = String(body.op ?? "");
  const now = new Date();

  try {
    if (op === "start") {
      // Keep the table small and stop anyone from spraying requests.
      await db.from("admin_device_logins").update({ status: "expired" }).eq("status", "pending").lt("expires_at", now.toISOString());
      const { count } = await db.from("admin_device_logins").select("id", { count: "exact", head: true })
        .gte("created_at", new Date(now.getTime() - 10 * 60_000).toISOString());
      if ((count ?? 0) >= 20) return J({ ok: false, error: "Too many sign-in requests. Try again in a few minutes." }, 429);
      const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
      for (let i = 0; i < 5; i++) {
        const code = makeCode();
        const { data, error } = await db.from("admin_device_logins").insert({
          code, secret_sha256: await sha256(secret),
          user_agent: String(req.headers.get("user-agent") ?? "").slice(0, 300), ip,
        }).select("id, code, expires_at").single();
        if (!error) {
          // One phone push per burst, so a stranger can't spam it. The approve page still needs the code.
          if (!body.silent && (count ?? 0) < 3) await db.rpc("admin_login_push");
          return J({ ok: true, id: data.id, code: data.code, secret, expires_at: data.expires_at });
        }
      }
      return J({ ok: false, error: "Could not make a code. Try again." }, 500);
    }

    if (op === "poll") {
      const { data: row } = await db.from("admin_device_logins").select("*").eq("id", String(body.id ?? "")).maybeSingle();
      if (!row || row.secret_sha256 !== (await sha256(String(body.secret ?? "")))) return J({ ok: false, error: "unknown request" }, 404);
      if (row.status === "pending" && new Date(row.expires_at) < now) {
        await db.from("admin_device_logins").update({ status: "expired" }).eq("id", row.id);
        return J({ ok: true, status: "expired" });
      }
      if (row.status !== "approved") return J({ ok: true, status: row.status });
      // Hand over exactly once.
      const { data: claimed } = await db.from("admin_device_logins").update({ status: "used", used_at: now.toISOString() })
        .eq("id", row.id).eq("status", "approved").select("approved_by");
      if (!claimed?.length) return J({ ok: true, status: "used" });
      const { data: u } = await db.auth.admin.getUserById(claimed[0].approved_by);
      if (!u?.user?.email) return J({ ok: false, error: "approver has no email" }, 500);
      const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
      if (error || !link) return J({ ok: false, error: "could not create the session" }, 500);
      const action = link.properties?.action_link ?? "";
      const token_hash = link.properties?.hashed_token || (action ? new URL(action).searchParams.get("token") : "") || "";
      return J({ ok: true, status: "approved", token_hash });
    }

    if (op === "lookup" || op === "decide") {
      const admin = await adminFrom(req);
      if (!admin) return J({ ok: false, error: "Sign in on this device first." }, 401);
      const code = normCode(body.code);
      if (!code) return J({ ok: false, error: "That code should be 8 letters and numbers." }, 400);
      const { data: row } = await db.from("admin_device_logins").select("id, code, status, created_at, expires_at, user_agent, ip")
        .eq("code", code).maybeSingle();
      if (!row) return J({ ok: false, error: "No sign-in request with that code." }, 404);
      const live = row.status === "pending" && new Date(row.expires_at) > now;
      if (op === "lookup") return J({ ok: true, request: { ...row, live } });
      if (!live) return J({ ok: false, error: `That request is ${row.status === "pending" ? "expired" : row.status}. Start again on the other browser.` }, 409);
      const approve = !!body.approve;
      await db.from("admin_device_logins").update({
        status: approve ? "approved" : "denied", approved_by: approve ? admin.id : null, approved_at: now.toISOString(),
      }).eq("id", row.id).eq("status", "pending");
      if (approve) {
        await db.rpc("admin_notify", {
          p_kind: "security", p_title: "New admin sign-in approved",
          p_body: `Approved from your device for: ${String(row.user_agent ?? "unknown browser").slice(0, 120)}`,
          p_url: "/admin/settings", p_entity_key: "device-login", p_severity: "info", p_dedupe_key: `device-login.${row.id}`,
        });
      }
      return J({ ok: true, status: approve ? "approved" : "denied" });
    }

    return J({ ok: false, error: `unknown op ${op}` }, 400);
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 500);
  }
});

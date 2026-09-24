// nc-sign — authenticated reach into cloud.bestly.tech from any session.
//
// Why this exists: the Nextcloud app password lives in Supabase Vault and must stay
// there, but a session needs to do two things the existing functions cannot:
//   * PUT a BINARY file (bestly-files 'write' takes a string and corrupts bytes,
//     and nc-asset-put always mints a PUBLIC share link, which is wrong for a contract)
//   * talk to an app's OCS API — LibreSign — not just WebDAV
//
// So this is a narrow authenticated proxy. Paths are restricted to /ocs/... and this
// user's own WebDAV root; nothing else is reachable through it.
//
// Actions
//   probe   — is LibreSign installed, and who are we
//   put     — raw request body -> WebDAV path. ?path=&ctype=. No share link, ever.
//   ocs     — { method, path, json? } against /ocs/..., OCS-APIRequest set for you
//   dav     — { method, path, headers? } against this user's WebDAV root

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PROXY_KEY = "WymtRea6BSdO9eUCTdIaTxdz5BMWHwxksO_0__GeqRgrk6Qr";

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

interface Creds { base: string; user: string; pass: string }

async function creds(): Promise<Creds> {
  const { data, error } = await db.rpc("get_nextcloud_credentials");
  if (error) throw new Error(`vault: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  const base = String(row?.base_url ?? "").replace(/\/+$/, "");
  const user = String(row?.username ?? "");
  const pass = String(row?.app_password ?? "");
  if (!base || !user || !pass) throw new Error("nextcloud creds incomplete in vault");
  return { base, user, pass };
}

const basic = (u: string, p: string) => "Basic " + btoa(`${u}:${p}`);
const encPath = (p: string) =>
  String(p || "").replace(/^\/+/, "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
const davUrl = (c: Creds, p: string) =>
  `${c.base}/remote.php/dav/files/${encodeURIComponent(c.user)}/${encPath(p)}`;

Deno.serve(async (req) => {
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o, null, 2), { status: s, headers: { "Content-Type": "application/json" } });

  const url = new URL(req.url);
  const key = req.headers.get("x-proxy-key") ?? "";
  if (!key || !sameSecret(key, PROXY_KEY)) return J({ error: "unauthorized" }, 401);

  let c: Creds;
  try { c = await creds(); } catch (e) { return J({ error: String(e) }, 500); }
  const auth = basic(c.user, c.pass);

  const action = url.searchParams.get("action") ?? "probe";

  // ---- probe ---------------------------------------------------------------
  if (action === "probe") {
    const who = await fetch(`${c.base}/ocs/v1.php/cloud/user?format=json`, {
      headers: { Authorization: auth, "OCS-APIRequest": "true" },
    });
    let userId: string | null = null;
    try { userId = (await who.json())?.ocs?.data?.id ?? null; } catch { /* ignore */ }

    const app = await fetch(`${c.base}/index.php/apps/libresign/`, {
      headers: { Authorization: auth },
      redirect: "manual",
    });

    const api = await fetch(`${c.base}/ocs/v2.php/apps/libresign/api/v1/setting/has-root-cert?format=json`, {
      headers: { Authorization: auth, "OCS-APIRequest": "true" },
    });
    const apiBody = (await api.text()).slice(0, 600);

    return J({
      ok: who.ok, base: c.base, user: c.user, userId,
      libresign_web_status: app.status,
      libresign_api_status: api.status,
      libresign_api_body: apiBody,
      libresign_installed: app.status !== 404 && api.status !== 404,
    });
  }

  // ---- put: raw bytes -> WebDAV, no share link -----------------------------
  if (action === "put") {
    const path = url.searchParams.get("path");
    if (!path) return J({ error: "?path= required" }, 400);
    const ctype = url.searchParams.get("ctype") ?? "application/octet-stream";

    const parts = path.replace(/^\/+/, "").split("/").filter(Boolean);
    parts.pop();
    let acc = "";
    const made: string[] = [];
    for (const seg of parts) {
      acc = acc ? `${acc}/${seg}` : seg;
      const r = await fetch(davUrl(c, acc), { method: "MKCOL", headers: { Authorization: auth } });
      if (r.ok) made.push(acc);
    }

    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length) return J({ error: "empty body" }, 400);
    const put = await fetch(davUrl(c, path), {
      method: "PUT",
      headers: { Authorization: auth, "Content-Type": ctype },
      body,
    });
    if (put.status >= 300) {
      return J({ ok: false, status: put.status, detail: (await put.text()).slice(0, 400) }, 502);
    }
    return J({ ok: true, path, bytes: body.length, created: made, status: put.status });
  }

  // ---- ocs / dav passthrough ----------------------------------------------
  if (action === "ocs" || action === "dav") {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* allow empty */ }

    const method = String(body.method ?? "GET").toUpperCase();
    const path = String(body.path ?? "");
    if (!path.startsWith("/")) return J({ error: "path must start with /" }, 400);

    let target: string;
    if (action === "ocs") {
      if (!path.startsWith("/ocs/")) return J({ error: "ocs paths must start with /ocs/" }, 400);
      target = `${c.base}${path}`;
    } else {
      target = davUrl(c, path);
    }

    const headers: Record<string, string> = {
      Authorization: auth,
      "OCS-APIRequest": "true",
      Accept: "application/json",
      ...(body.headers as Record<string, string> ?? {}),
    };
    let payload: string | undefined;
    if (body.json !== undefined) {
      payload = JSON.stringify(body.json);
      headers["Content-Type"] = "application/json";
    }

    const r = await fetch(target, { method, headers, body: payload });
    const text = await r.text();
    return J({ ok: r.ok, status: r.status, target, body: text.slice(0, 6000) });
  }

  return J({ error: "unknown action" }, 400);
});

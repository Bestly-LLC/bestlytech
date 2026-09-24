// bestly-pull — move a URL straight into Nextcloud, server side.
//
// The whole Centering YOU asset library has to end up in Nextcloud, and it is
// about 2 GB. Routing it through the sandbox would mean downloading and
// re-uploading every byte, and bestly-files can only write text — base64 would
// inflate it by a third and a base64 payload silently produced a 0-byte file.
//
// So this streams: fetch the source, hand its body straight to WebDAV PUT.
// Nothing is buffered, nothing crosses the workspace. Then it asks Nextcloud
// how big the file actually is and compares, so a short write is caught here
// rather than discovered later.
//
// v2: the size check uses PROPFIND, not HEAD. Nextcloud answers HEAD without a
// content-length, so every verify came back -1 and every transfer was reported
// as a size mismatch even though the bytes were right.
//
//   POST { items: [{ url, to, bytes? }, ...] }   40 per call
//   POST { action: "check", items: [{ to, bytes }] }   verify only
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

async function creds() {
  const { data, error } = await db.rpc("get_nextcloud_credentials");
  if (error) throw new Error(`vault: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  const base = String(row?.base_url ?? "").replace(/\/+$/, "");
  const pass = String(row?.app_password ?? "");
  const user = String(row?.username ?? "");
  if (!base || !pass || !user) throw new Error("nextcloud creds incomplete in vault");
  return { base, user, pass };
}

const basic = (u: string, p: string) => "Basic " + btoa(`${u}:${p}`);
const davUrl = (c: { base: string; user: string }, path: string) =>
  `${c.base}/remote.php/dav/files/${encodeURIComponent(c.user)}/` +
  String(path || "").replace(/^\/+/, "").split("/").filter(Boolean).map(encodeURIComponent).join("/");

const extOf = (p: string) => (/\.([A-Za-z0-9]{1,5})$/.exec(p)?.[1] ?? "bin").toLowerCase();
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", svg: "image/svg+xml", pdf: "application/pdf", ttf: "font/ttf",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg",
  json: "application/json", md: "text/markdown", html: "text/html", js: "text/javascript",
  css: "text/css", txt: "text/plain", ico: "image/x-icon", webmanifest: "application/manifest+json",
};

Deno.serve(async (req) => {
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o, null, 2), { status: s, headers: { "Content-Type": "application/json" } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const k = req.headers.get("x-proxy-key") ?? String(body.proxyKey ?? "");
  if (!k || !sameSecret(k, PROXY_KEY)) return J({ error: "unauthorized" }, 401);

  let c;
  try { c = await creds(); } catch (e) { return J({ error: String(e) }, 500); }
  const auth = { Authorization: basic(c.user, c.pass) };

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return J({ error: "items[] required" }, 400);
  if (items.length > 40) return J({ error: "too many; 40 max per call" }, 400);

  // Nextcloud answers HEAD with no content-length, so ask properly.
  const sizeOf = async (to: string) => {
    const r = await fetch(davUrl(c, to), {
      method: "PROPFIND",
      headers: { ...auth, Depth: "0", "Content-Type": "application/xml" },
    });
    if (!r.ok) return -1;
    const xml = await r.text();
    const m = /<d:getcontentlength>(\d+)<\/d:getcontentlength>/i.exec(xml);
    return m ? Number(m[1]) : -1;
  };

  if (String(body.action ?? "") === "check") {
    const out = [];
    for (const raw of items) {
      const it = raw as Record<string, unknown>;
      const to = String(it.to ?? ""), want = Number(it.bytes ?? 0);
      const got = await sizeOf(to);
      out.push(got < 0 ? { to, error: "missing" }
             : (want && got !== want) ? { to, bytes: got, expected: want, error: "size mismatch" }
             : { to, bytes: got, ok: true });
    }
    const failed = out.filter((o) => (o as Record<string, unknown>).error).length;
    return J({ ok: failed === 0, checked: out.length, failed, items: out });
  }

  const made = new Set<string>();
  const out = [];
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const url = String(it.url ?? ""), to = String(it.to ?? "");
    if (!url || !to) { out.push({ to, error: "url and to required" }); continue; }
    try {
      const want0 = Number(it.bytes ?? 0);
      if (want0) {
        const has = await sizeOf(to);
        if (has === want0) { out.push({ to, bytes: has, skipped: true, ok: true }); continue; }
      }

      const src = await fetch(url);
      if (!src.ok || !src.body) { out.push({ to, url, error: `GET ${src.status}` }); continue; }
      const want = Number(src.headers.get("content-length") ?? want0 ?? 0);

      let acc = "";
      for (const p of to.split("/").slice(0, -1).filter(Boolean)) {
        acc = acc ? `${acc}/${p}` : p;
        if (made.has(acc)) continue;
        await fetch(davUrl(c, acc), { method: "MKCOL", headers: auth });
        made.add(acc);
      }

      const put = await fetch(davUrl(c, to), {
        method: "PUT",
        headers: { ...auth, "Content-Type": MIME[extOf(to)] ?? "application/octet-stream" },
        body: src.body,
      });
      if (!put.ok) { out.push({ to, url, error: `PUT ${put.status}` }); continue; }

      const got = await sizeOf(to);
      out.push(want && got !== want
        ? { to, url, bytes: got, expected: want, error: "size mismatch" }
        : { to, url, bytes: got, ok: true });
    } catch (e) {
      out.push({ to, url, error: String(e).slice(0, 160) });
    }
  }
  const failed = out.filter((o) => (o as Record<string, unknown>).error).length;
  return J({ ok: failed === 0, pulled: out.filter((o) => (o as Record<string, unknown>).ok).length, failed, items: out });
});

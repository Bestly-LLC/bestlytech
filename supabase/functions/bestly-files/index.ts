// bestly-files - Nextcloud file access for the sandbox, without the password.
//
// cloud.bestly.tech speaks plain HTTPS, so unlike mail there is no port problem and
// no need for anything to run on Jared's Mac. The only reason this function exists
// rather than curling WebDAV directly is secret hygiene: the app password lives in
// Supabase Vault and is read here, server side, so it never enters a chat context
// and never has to be re-pasted when a sandbox is recycled.
//
// Actions: whoami, discover, list, read, stage, write, mkdir, move, move_many,
// copy, delete. 'delete' moves to a trash folder and is recoverable, not a purge.
//
// v2 adds what the asset-library work needed:
//   * 'stage' copies binary files into Supabase storage, so images reach the
//     workspace as bytes rather than as base64 through a conversation
//   * 'move_many' renames a whole library in one call
//   * 'copy' for reorganising without risking the original

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PROXY_KEY = "40go6-gkP2s_X_UzPcDF7tt5WTPW6wfzI7ocMNWXSwkk19AD";

const CANDIDATES = ["jared", "jaredbest", "admin", "Jared", "jaredbest@icloud.com", "jared@bestly.tech"];

// Where 'stage' may put things: a public bucket with no mime restriction, under a
// prefix that is obviously scratch so it is easy to see and easy to clear.
const STAGE_BUCKET = "email-assets";
const STAGE_PREFIX = "nc-stage/";

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
  const pass = String(row?.app_password ?? "");
  if (!base) throw new Error("nextcloud_base_url missing from vault");
  if (!pass) throw new Error("nextcloud_app_password missing from vault");
  return { base, user: String(row?.username ?? ""), pass };
}

function basic(user: string, pass: string): string {
  return "Basic " + btoa(`${user}:${pass}`);
}

async function ocsWhoami(c: Creds, user: string): Promise<string | null> {
  const r = await fetch(`${c.base}/ocs/v1.php/cloud/user?format=json`, {
    headers: { Authorization: basic(user, c.pass), "OCS-APIRequest": "true" },
  });
  if (!r.ok) return null;
  try {
    const j = await r.json();
    return j?.ocs?.data?.id ?? null;
  } catch { return null; }
}

function davUrl(c: Creds, user: string, path: string): string {
  const clean = String(path || "").replace(/^\/+/, "");
  const encoded = clean.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${c.base}/remote.php/dav/files/${encodeURIComponent(user)}/${encoded}`;
}

const extOf = (p: string) => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(p);
  return m ? m[1].toLowerCase() : "bin";
};
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", svg: "image/svg+xml", pdf: "application/pdf",
  mp4: "video/mp4", mov: "video/quicktime", json: "application/json",
};

Deno.serve(async (req) => {
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o, null, 2), { status: s, headers: { "Content-Type": "application/json" } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* whoami takes no body */ }

  const k = req.headers.get("x-proxy-key") ?? String(body.proxyKey ?? "");
  if (!k || !sameSecret(k, PROXY_KEY)) return J({ error: "unauthorized" }, 401);

  const action = String(body.action ?? "whoami");

  let c: Creds;
  try { c = await creds(); } catch (e) { return J({ error: String(e) }, 500); }

  if (action === "discover") {
    const tried: Record<string, boolean> = {};
    for (const cand of CANDIDATES) {
      const id = await ocsWhoami(c, cand);
      tried[cand] = !!id;
      if (id) {
        await db.rpc("store_bestly_secret", { p_name: "nextcloud_user", p_value: cand });
        return J({ ok: true, username: cand, userId: id, tried });
      }
    }
    return J({ ok: false, error: "no candidate login name worked", tried }, 404);
  }

  if (!c.user) return J({ error: "nextcloud_user not set - run action 'discover' first" }, 400);

  if (action === "whoami") {
    const id = await ocsWhoami(c, c.user);
    return id
      ? J({ ok: true, username: c.user, userId: id, base: c.base })
      : J({ ok: false, error: "credentials rejected", username: c.user }, 401);
  }

  const path = String(body.path ?? "");
  const auth = { Authorization: basic(c.user, c.pass) };

  if (action === "list") {
    const r = await fetch(davUrl(c, c.user, path), {
      method: "PROPFIND",
      headers: { ...auth, Depth: String(body.depth ?? "1"), "Content-Type": "application/xml" },
    });
    const xml = await r.text();
    if (!r.ok) return J({ error: `PROPFIND ${r.status}`, detail: xml.slice(0, 500) }, r.status);

    const prefix = `/remote.php/dav/files/${encodeURIComponent(c.user)}`;
    const entries: unknown[] = [];
    const re = /<d:response>([\s\S]*?)<\/d:response>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const blk = m[1];
      const href = /<d:href>([\s\S]*?)<\/d:href>/i.exec(blk)?.[1] ?? "";
      const size = /<d:getcontentlength>(\d+)<\/d:getcontentlength>/i.exec(blk)?.[1];
      const mod = /<d:getlastmodified>([\s\S]*?)<\/d:getlastmodified>/i.exec(blk)?.[1];
      const isDir = /<d:collection\s*\/>/i.test(blk);
      const rel = decodeURIComponent(href).replace(decodeURIComponent(prefix), "") || "/";
      entries.push({ path: rel, dir: isDir, bytes: size ? Number(size) : null, modified: mod ?? null });
    }
    return J({ ok: true, path: path || "/", count: entries.length, entries });
  }

  if (action === "read") {
    const r = await fetch(davUrl(c, c.user, path), { headers: auth });
    if (!r.ok) return J({ error: `GET ${r.status}` }, r.status);
    const text = await r.text();
    return J({ ok: true, path, bytes: text.length, content: text });
  }

  // ---- stage: Nextcloud -> Supabase storage, as bytes ----------------------
  // Binary files cannot come back through 'read', and base64 through a chat is
  // wasteful and lossy. This copies them somewhere the workspace can download.
  if (action === "stage") {
    const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
    if (!paths.length) return J({ error: "paths[] required" }, 400);
    if (paths.length > 60) return J({ error: "too many; 60 max per call" }, 400);

    const out: unknown[] = [];
    for (const p of paths) {
      const r = await fetch(davUrl(c, c.user, p), { headers: auth });
      if (!r.ok) { out.push({ path: p, error: `GET ${r.status}` }); continue; }
      const buf = new Uint8Array(await r.arrayBuffer());
      const ext = extOf(p);
      const safe = p.replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "_");
      const key = `${STAGE_PREFIX}${safe}`;
      const { error } = await db.storage.from(STAGE_BUCKET)
        .upload(key, buf, { contentType: MIME[ext] ?? "application/octet-stream", upsert: true });
      if (error) { out.push({ path: p, error: error.message }); continue; }
      out.push({
        path: p, bytes: buf.length,
        url: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${STAGE_BUCKET}/${key}`,
      });
    }
    return J({ ok: true, staged: out.length, items: out });
  }

  if (action === "write") {
    const content = String(body.content ?? "");
    const r = await fetch(davUrl(c, c.user, path), {
      method: "PUT",
      headers: { ...auth, "Content-Type": String(body.contentType ?? "text/plain; charset=utf-8") },
      body: content,
    });
    if (!r.ok) return J({ error: `PUT ${r.status}`, detail: (await r.text()).slice(0, 300) }, r.status);
    return J({ ok: true, path, bytes: content.length });
  }

  if (action === "mkdir") {
    const parts = String(path).split("/").filter(Boolean);
    const made: string[] = [];
    let acc = "";
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      const r = await fetch(davUrl(c, c.user, acc), { method: "MKCOL", headers: auth });
      if (r.ok) made.push(acc);
      else if (r.status !== 405) {
        return J({ error: `MKCOL ${acc} -> ${r.status}` }, r.status);
      }
    }
    return J({ ok: true, path, created: made });
  }

  // Batch rename, so relabelling a whole library is one call.
  if (action === "move_many") {
    const pairs = Array.isArray(body.pairs) ? body.pairs : [];
    if (!pairs.length) return J({ error: "pairs[] required" }, 400);
    if (pairs.length > 200) return J({ error: "too many; 200 max" }, 400);
    const out: unknown[] = [];
    for (const raw of pairs) {
      const pr = raw as Record<string, unknown>;
      const from = String(pr.from ?? ""), to = String(pr.to ?? "");
      if (!from || !to) { out.push({ from, to, error: "from and to required" }); continue; }
      const r = await fetch(davUrl(c, c.user, from), {
        method: "MOVE",
        headers: { ...auth, Destination: davUrl(c, c.user, to), Overwrite: "F" },
      });
      out.push(r.ok ? { from, to, ok: true } : { from, to, error: `MOVE ${r.status}` });
    }
    const failed = out.filter((o) => (o as Record<string, unknown>).error).length;
    return J({ ok: failed === 0, moved: out.length - failed, failed, items: out });
  }

  if (action === "copy") {
    const to = String(body.to ?? "");
    if (!to) return J({ error: "to required" }, 400);
    const r = await fetch(davUrl(c, c.user, path), {
      method: "COPY",
      headers: { ...auth, Destination: davUrl(c, c.user, to), Overwrite: "F" },
    });
    if (!r.ok) return J({ error: `COPY ${r.status}` }, r.status);
    return J({ ok: true, from: path, to });
  }

  if (action === "move" || action === "delete") {
    const dest = action === "delete"
      ? `_trash/${Date.now()}-${String(path).split("/").filter(Boolean).pop() ?? "item"}`
      : String(body.to ?? "");
    if (!dest) return J({ error: "to required" }, 400);

    if (action === "delete") {
      await fetch(davUrl(c, c.user, "_trash"), { method: "MKCOL", headers: auth });
    }
    const r = await fetch(davUrl(c, c.user, path), {
      method: "MOVE",
      headers: { ...auth, Destination: davUrl(c, c.user, dest), Overwrite: "F" },
    });
    if (!r.ok) return J({ error: `MOVE ${r.status}`, detail: (await r.text()).slice(0, 300) }, r.status);
    return J({ ok: true, from: path, to: dest });
  }

  return J({ error: "unknown action" }, 400);
});

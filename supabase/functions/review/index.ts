// review - serves the client content-approval page.
//
// Public on purpose: this is the page a client opens from a link, so it cannot
// require an Authorization header. It serves HTML only. Nothing here reads or
// writes client data - the page itself calls approval_board / approval_review,
// both of which validate the per-client token server side, so a visitor with no
// token sees an empty shell.
//
// The page source lives on Nextcloud at Bestly/_apps/review/index.html, which is
// the single source of truth. Updating the page means re-uploading that file;
// this function does not need redeploying. Responses are cached briefly so a
// normal load does not hit WebDAV every time.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const NC_PATH = "Bestly/_apps/review/index.html";
const TTL_MS = 60_000;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

let cached: { html: string; at: number } | null = null;

async function fetchPage(): Promise<string> {
  const { data, error } = await db.rpc("get_nextcloud_credentials");
  if (error) throw new Error(`vault: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;

  const base = String(row?.base_url ?? "").replace(/\/+$/, "");
  const user = String(row?.username ?? "");
  const pass = String(row?.app_password ?? "");
  if (!base || !user || !pass) throw new Error("nextcloud credentials incomplete");

  const encoded = NC_PATH.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const url = `${base}/remote.php/dav/files/${encodeURIComponent(user)}/${encoded}`;

  const r = await fetch(url, {
    headers: { Authorization: "Basic " + btoa(`${user}:${pass}`) },
  });
  if (!r.ok) throw new Error(`webdav ${r.status}`);
  return await r.text();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed", { status: 405 });
  }

  try {
    const now = Date.now();
    if (!cached || now - cached.at > TTL_MS) {
      cached = { html: await fetchPage(), at: now };
    }
    return new Response(req.method === "HEAD" ? null : cached.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return new Response(
      "<!doctype html><meta charset=utf-8><title>Unavailable</title>" +
      "<body style=\"font-family:system-ui;padding:60px;text-align:center;color:#555\">" +
      "<h1 style=\"font-weight:500\">Temporarily unavailable</h1>" +
      "<p>Please try again in a moment.</p></body>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
});

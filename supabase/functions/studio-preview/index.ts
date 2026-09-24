// Studio preview host.
//
// Studio opens a preview with the staff session in the URL fragment
// (previewHref: url + "#s=" + TOKEN). A fragment never reaches a server, so this
// answers a GET with a small shell that reads the fragment in the browser and
// posts it straight back. The document itself is only handed over against a
// session that studio_resolve_staff still recognises — the page bytes are never
// sitting on a public URL.
//
// verify_jwt is off on purpose: the token in the fragment is the authentication,
// checked below, and a Supabase JWT is not what Studio issues.

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = (k: string): Record<string, string> => k.startsWith("sb_") ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` };

const SB = Deno.env.get("SUPABASE_URL")!;
const SR = SB_SECRET;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization, apikey",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const SHELL = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Preview — Bestly Studio</title>
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark light">
<style>
  html,body{margin:0;height:100%;background:#0F1413;color:#ECF2F1;
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Inter,system-ui,sans-serif}
  #f{border:0;width:100%;height:100%;display:block}
  .msg{display:grid;place-items:center;height:100%;text-align:center;padding:24px}
  .msg b{display:block;font:500 17px/1.3 ui-serif,"New York","Iowan Old Style",Georgia,serif;margin-bottom:6px}
  .msg span{color:#9BAAA7}
  .dot{width:7px;height:7px;border-radius:50%;background:#5FC0B6;
    animation:p 1s ease-in-out infinite;margin:0 auto 12px}
  @keyframes p{0%,100%{opacity:.25}50%{opacity:1}}
</style>
</head><body>
<div class="msg" id="m"><div><div class="dot"></div><span>Checking your Studio session…</span></div></div>
<script>
(async () => {
  const m = document.getElementById("m");
  const say = (t, s) => { m.innerHTML = "<div><b>" + t + "</b><span>" + s + "</span></div>"; };
  const slug = new URLSearchParams(location.search).get("slug") || "";
  let token = null;
  const h = location.hash || "";
  if (/^#s=/.test(h)) {
    token = decodeURIComponent(h.slice(3));
    try { localStorage.setItem("bestly.studio.session", token); } catch {}
    history.replaceState(null, "", location.pathname + location.search);
  } else {
    try { token = localStorage.getItem("bestly.studio.session"); } catch {}
  }
  if (!token) return say("Open this from Studio", "This preview needs a Studio staff session. Use Open preview inside the app.");
  let r;
  try {
    r = await fetch(location.pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, slug }),
    }).then((x) => x.json());
  } catch (e) { return say("Could not reach the studio", "Try again in a moment."); }
  if (!r || !r.ok) {
    if (r && r.error === "not_found") return say("Nothing here", "No preview is filed under that name.");
    return say("That session is not current", "Sign in to Studio again, then use Open preview.");
  }
  document.title = r.title || "Preview";
  const f = document.createElement("iframe");
  f.id = "f";
  f.src = URL.createObjectURL(new Blob([r.html], { type: "text/html" }));
  m.replaceWith(f);
})();
<\/script>
</body></html>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (req.method === "GET") {
    return new Response(SHELL, {
      headers: {
        ...CORS,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }

  if (req.method !== "POST") return new Response("method", { status: 405, headers: CORS });

  let body: { token?: string; slug?: string };
  try { body = await req.json(); } catch { body = {}; }
  const token = (body.token || "").trim();
  const slug = (body.slug || "").trim();
  if (!token || !slug) {
    return new Response(JSON.stringify({ ok: false, error: "no_session" }), {
      status: 200, headers: { ...CORS, "content-type": "application/json" },
    });
  }

  // studio_preview_doc does the session check itself, in the database, against
  // the same resolver the rest of Studio uses.
  const r = await fetch(SB + "/rest/v1/rpc/studio_preview_doc", {
    method: "POST",
    headers: { ...sbHeaders(SR), "content-type": "application/json" },
    body: JSON.stringify({ p_token: token, p_slug: slug }),
  });
  if (!r.ok) {
    return new Response(JSON.stringify({ ok: false, error: "upstream" }), {
      status: 200, headers: { ...CORS, "content-type": "application/json" },
    });
  }
  const out = await r.text();
  return new Response(out, {
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
});

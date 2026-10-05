/**
 * bestly-site-outage-splash
 *
 * Sits in front of bestly.tech and www.bestly.tech (Cloudflare proxies them; Vercel is the origin).
 * Healthy responses pass through untouched. When the origin is down or failing - Vercel unreachable,
 * a 5xx from the platform - browsers get Scout's "We'll be right back" page instead of a raw error.
 *
 * The page is fully self-contained (no assets from the site, which is the thing that is down) and
 * shows the last known reason from the watchdog log (get_outage_note RPC), cached at the edge so it
 * still works if Supabase is down too. It re-checks every 15 seconds and reloads itself when the
 * site is back.
 *
 * Sister of cloudflare-workers/maintenance-splash (cloud.bestly.tech). Same rules: never touch
 * WebSockets, never mask real application errors, never splash non-browser clients.
 *
 * Fail open: any bug in this Worker must leave the site working. Everything that can throw is wrapped.
 */

// Platform-level failures. Plain 500 is only intercepted when Vercel itself says it failed
// (x-vercel-error), so real application bugs are never hidden.
const INTERCEPT = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);
const NOTE_CACHE_KEY = "https://bestly.tech/__outage-note-cache";

export default {
  async fetch(request, env, ctx) {
    try {
      // WebSocket / Upgrade requests must pass through untouched.
      if (request.headers.get("Upgrade")) return fetch(request);

      const url = new URL(request.url);
      const wantsHtml = (request.headers.get("accept") || "").includes("text/html");

      // Preview hook: https://bestly.tech/anything?__splash=1 renders the page (harmless, static).
      if (url.searchParams.get("__splash") === "1" && wantsHtml) {
        return splash(env, ctx, { kind: "preview" });
      }

      let response;
      try {
        response = await fetch(request);
      } catch (e) {
        if (!wantsHtml) return jsonDown(502);
        return splash(env, ctx, { kind: "unreachable" });
      }

      const platformFailure =
        INTERCEPT.has(response.status) ||
        (response.status === 500 && response.headers.has("x-vercel-error"));
      if (!platformFailure) return response;

      if (!wantsHtml) return jsonDown(response.status);
      return splash(env, ctx, { kind: "status", status: response.status });
    } catch (e) {
      // Fail open.
      return fetch(request);
    }
  },
};

function jsonDown(status) {
  return new Response(
    JSON.stringify({ status, message: "bestly.tech is temporarily unavailable. Retry shortly." }),
    { status, headers: { "Content-Type": "application/json", "Retry-After": "15", "Cache-Control": "no-store" } },
  );
}

/** What Scout can see from the edge right now, in plain words. */
function seenNow(ctx) {
  if (ctx.kind === "unreachable") return "The web host isn’t answering.";
  if (ctx.kind === "status") {
    if ([502, 503, 504].includes(ctx.status)) return "The web host is restarting or overloaded.";
    if (ctx.status >= 520) return "The connection to the web host is failing.";
    return "The web host is having trouble.";
  }
  return "";
}

const NBSP = " ";

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tz = "America/Los_Angeles";
  const time = d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz })
    .replace(/[\s ]+/g, NBSP);
  const day = (x) => x.toLocaleDateString("en-US", { timeZone: tz });
  if (day(d) === day(new Date())) return time;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz }).replace(" ", NBSP);
  return `${date} at${NBSP}${time}`;
}

function reasonLines(n) {
  if (!n || !n.started_at) {
    return { head: "I don’t have a recent incident on record.", detail: "" };
  }
  const what = n.what || "one of our systems";
  const how = n.how || "had a problem";
  const started = fmtTime(n.started_at);
  if (n.ongoing) {
    return { head: `${what.charAt(0).toUpperCase() + what.slice(1)} ${how} at${NBSP}${started}.`, detail: "That’s still going." };
  }
  const ended = fmtTime(n.ended_at);
  const fixed = n.fixed_by ? `Fixed by ${n.fixed_by}` : "Fixed";
  return { head: `Last incident: ${what} ${how} at${NBSP}${started}.`, detail: `${fixed}${ended ? ` at${NBSP}${ended}` : ""}.` };
}

/** Last known reason: live from Supabase (2s cap), else the edge-cached copy, else null. */
async function loadNote(env) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2000);
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_outage_note`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: "{}",
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (r.ok) {
      const note = await r.json();
      if (cache) {
        try {
          await cache.put(
            new Request(NOTE_CACHE_KEY),
            new Response(JSON.stringify(note), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=604800" } }),
          );
        } catch { /* cache is best effort */ }
      }
      return { note, stale: false };
    }
  } catch { /* fall through to the cached copy */ }
  if (cache) {
    try {
      const hit = await cache.match(new Request(NOTE_CACHE_KEY));
      if (hit) return { note: await hit.json(), stale: true };
    } catch { /* nothing cached */ }
  }
  return { note: null, stale: false };
}

async function splash(env, ctx, info) {
  const { note, stale } = await loadNote(env);
  const html = renderSplash({ seen: seenNow(info), reason: note ? reasonLines(note) : null, stale });
  return new Response(html, {
    status: info.kind === "preview" ? 200 : 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "Retry-After": "15",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Scout's mark: the same drawing and animation as the admin boot splash (index.html).
const MARK = `<svg viewBox="0 0 72 72" class="mark" role="img" aria-label="Scout"><defs><mask id="bm" maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="72"><rect width="72" height="72" fill="#fff"/><circle cx="19" cy="44" r="10.3"/><circle cx="53" cy="44" r="10.3"/></mask><clipPath id="bcl"><circle cx="19" cy="44" r="10.7"/></clipPath><clipPath id="bcr"><circle cx="53" cy="44" r="10.7"/></clipPath><mask id="bpm" maskUnits="userSpaceOnUse" x="0" y="0" width="72" height="72"><rect width="72" height="72" fill="#fff"/><g class="am-lidL"><rect x="0" y="10" width="40" height="34.8"/></g><g class="am-lidR"><rect x="32" y="10" width="40" height="34.8"/></g></mask></defs><g mask="url(#bm)"><path class="am-st" d="M9 37L13.5 21Q14 18 17 18H21Q24 18 24.5 21L29 37M43 37L47.5 21Q48 18 51 18H55Q58 18 58.5 21L63 37"/><path class="am-st" d="M25.5 27H46.5M30 42H42"/></g><circle class="am-st" cx="19" cy="44" r="13"/><circle class="am-st" cx="53" cy="44" r="13"/><g mask="url(#bpm)"><g class="am-look"><circle class="am-fl" cx="19" cy="44" r="4.8"/><circle class="am-fl" cx="53" cy="44" r="4.8"/></g></g><g clip-path="url(#bcl)"><g class="am-lidL"><rect class="am-fl" x="0" y="10" width="40" height="32"/></g></g><g clip-path="url(#bcr)"><g class="am-lidR"><rect class="am-fl" x="32" y="10" width="40" height="32"/></g></g></svg>`;

function renderSplash({ seen, reason, stale }) {
  const reasonBlock = reason
    ? `<p class="big">${esc(reason.head)}</p>${reason.detail ? `<p class="small">${esc(reason.detail)}</p>` : ""}${stale ? `<p class="small">From my last good check.</p>` : ""}`
    : `<p class="small">I can’t reach my status log right now. I’ll keep checking.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="dark">
<title>Bestly — we’ll be right back</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:#000;color:#fff}
body{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:2.5rem 1rem;font:17px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:28rem;text-align:center}
.mark{width:6rem;height:6rem;color:#fff}
h1{margin:1.5rem 0 0;font-size:2.125rem;line-height:1.15;font-weight:700;letter-spacing:-.015em;text-wrap:balance}
.lede{margin:.5rem 0 0;color:rgba(255,255,255,.7)}
.card{margin-top:2rem;padding:1.25rem;text-align:left;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:1rem}
.card h2{margin:0;font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.55)}
.seen{margin:.5rem 0 0;font-weight:500}
.big{margin:.5rem 0 0;font-weight:500;text-wrap:pretty}
.small{margin:.25rem 0 0;font-size:.9rem;color:rgba(255,255,255,.7);text-wrap:pretty}
hr{border:0;border-top:1px solid rgba(255,255,255,.1);margin:.9rem 0 .4rem}
button{margin-top:1.5rem;min-height:2.75rem;padding:0 1.5rem;border:0;border-radius:.75rem;background:#fff;color:#000;font:600 1rem -apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;cursor:pointer}
button:active{opacity:.7}
button:focus-visible{outline:3px solid #fff;outline-offset:2px}
.foot{margin-top:1.5rem;font-size:.8rem;color:rgba(255,255,255,.55);white-space:nowrap}
/* Scout's side-eye mark, same drawing and 3.2s glance as the admin boot splash */
.am-st{fill:none;stroke:currentColor;stroke-width:5.5;stroke-linecap:round;stroke-linejoin:round}
.am-fl{fill:currentColor}
.am-look,.am-lidL,.am-lidR{transform-box:view-box;animation-duration:3.2s;animation-iteration-count:infinite}
.am-look{animation-name:am-look;animation-timing-function:cubic-bezier(.45,1.5,.5,1)}
.am-lidL,.am-lidR{animation-name:am-lid;animation-timing-function:cubic-bezier(.4,1.35,.5,1)}
.am-lidL{transform-origin:19px 42px}.am-lidR{transform-origin:53px 42px}
@keyframes am-look{0%,8%{transform:translate(0,0)}14%{transform:translate(0,1.5px)}22%,42%{transform:translate(-5.4px,3px)}52%,72%{transform:translate(5.4px,3px)}82%,100%{transform:translate(0,0)}}
@keyframes am-lid{0%,6%{transform:translateY(-13px) rotate(0)}14%,18%{transform:translateY(-2.5px) rotate(0)}24%,42%{transform:translateY(-.8px) rotate(-9deg)}52%{transform:translateY(-2.5px) rotate(0)}58%,72%{transform:translateY(-.8px) rotate(9deg)}82%{transform:translateY(-15px) rotate(0)}87%{transform:translateY(-13px) rotate(0)}91%{transform:translateY(14px) rotate(0)}95%,100%{transform:translateY(-13px) rotate(0)}}
@media (prefers-reduced-motion:reduce){.am-look,.am-lidL,.am-lidR{animation:none}.am-lidL,.am-lidR{transform:translateY(-.8px) rotate(-9deg)}.am-look{transform:translate(-5.4px,3px)}}
</style>
</head>
<body>
<main>
${MARK}
<h1>We’ll be right back</h1>
<p class="lede">Scout here. The site is down and I’m on it.</p>
<section class="card" aria-labelledby="r" aria-live="polite">
<h2 id="r">What I know</h2>
${seen ? `<p class="seen">${esc(seen)}</p><hr>` : ""}
${reasonBlock}
</section>
<button type="button" id="again">Try again</button>
<p class="foot">Checking again every 15${NBSP}seconds.</p>
</main>
<script>
(function(){
  function back(){fetch("/",{cache:"no-store",headers:{accept:"text/html"}}).then(function(r){if(r.ok)location.reload()}).catch(function(){})}
  document.getElementById("again").addEventListener("click",function(){location.reload()});
  setInterval(function(){if(!document.hidden)back()},15000);
})();
</script>
</body>
</html>`;
}

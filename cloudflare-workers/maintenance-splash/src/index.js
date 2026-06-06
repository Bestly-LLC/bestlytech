/**
 * bestly-cloud-maintenance-splash
 *
 * Wraps every request to cloud.bestly.tech. Pass-through for healthy responses;
 * for any 5xx from origin, serve a Bestly-branded "back in a moment" splash
 * page instead of Cloudflare's raw 502 page. The splash auto-refreshes when
 * origin comes back.
 *
 * See docs/nextcloud-502-recovery-opusplan.md for why we need this.
 */

export default {
  async fetch(request, env, ctx) {
    // CRITICAL: WebSocket upgrades must pass through untouched. Wrapping them
    // in `await fetch(request)` then inspecting `response.status` consumes the
    // upgrade handshake and the client gets 400. This breaks Nextcloud Talk's
    // /standalone-signaling/spreed WebSocket — i.e. "Connection failed" in Talk.
    //
    // Same applies to any other Upgrade: header (h2c, etc.). Short-circuit.
    const upgrade = request.headers.get('Upgrade');
    if (upgrade) {
      const resp = await fetch(request);
      // Add diagnostic header so we can confirm this branch ran.
      // Browsers can see this in DevTools. Safe to remove later.
      const newHeaders = new Headers(resp.headers);
      newHeaders.set('x-bestly-worker', 'ws-passthrough-v2');
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: newHeaders,
        webSocket: resp.webSocket,
      });
    }

    let response;
    try {
      response = await fetch(request);
    } catch (e) {
      // Network-level failure (origin unreachable from the colo). Render splash.
      return splashResponse(env, 502, `fetch error: ${String(e).slice(0, 200)}`);
    }

    // Pass through anything that ISN'T an infrastructure failure.
    // We splash for:
    //   502 Bad Gateway              — origin returned 5xx / cloudflared can't reach origin
    //   503 Service Unavailable      — origin overloaded
    //   504 Gateway Timeout          — origin didn't respond in time
    //   520 Unknown error            — cloudflared got something nonsensical
    //   521 Web server is down       — origin TCP refused
    //   522 Connection timed out     — origin didn't accept the TCP handshake
    //   523 Origin is unreachable    — route to origin broken
    //   524 Origin took too long     — origin TCP accepted but didn't respond
    //   525 SSL handshake failed     — origin TLS broken
    //   526 Invalid SSL certificate  — origin cert expired/invalid
    //   530 Cloudflare 1xxx wrapper  — including 1033 (tunnel down) — TODAY'S "I killed cloudflared" case
    // We explicitly do NOT splash 500 (real PHP application errors) — that
    // would mask legitimate bugs the user/operator needs to see.
    const INTERCEPT = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 530]);
    if (!INTERCEPT.has(response.status)) {
      return response;
    }

    // Don't splash for non-HTML clients (Nextcloud desktop/mobile sync, WebDAV,
    // mobile apps). They need to see the real error so they back off and retry.
    const accept = request.headers.get('accept') || '';
    const ua = request.headers.get('user-agent') || '';
    const isBrowser = accept.includes('text/html') && !ua.toLowerCase().includes('mirall');

    if (!isBrowser) {
      // Pass the 5xx through to the client (Nextcloud desktop client will retry
      // with its own backoff). Add a friendlier body though.
      return new Response(
        JSON.stringify({
          status: response.status,
          message: 'Bestly Cloud origin is temporarily unreachable. Retry shortly.',
        }),
        {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '15',
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    return splashResponse(env, response.status, `origin returned ${response.status}`);
  },
};

function splashResponse(env, originStatus, reason) {
  const brand = env?.BRAND_NAME || 'Bestly Cloud';
  const support = env?.SUPPORT_LINK || 'https://bestly.tech/contact';

  return new Response(renderSplash(brand, support, originStatus, reason), {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Retry-After': '15',
      // Stop Cloudflare and intermediate caches from holding the splash:
      'CDN-Cache-Control': 'no-store',
      'Cloudflare-CDN-Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function renderSplash(brand, support, originStatus, reason) {
  // Single self-contained HTML page — no external assets, no analytics, no
  // surveillance. Renders in <100ms on any device.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(brand)} — back in a moment</title>
<style>
  *,*::before,*::after { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background:
      radial-gradient(1200px 600px at 50% -10%, rgba(200,77,43,0.18), transparent 70%),
      linear-gradient(180deg, #0a0a0a 0%, #141414 100%);
    color: #e8e6e3;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif;
    font-feature-settings: "ss01", "cv11";
    -webkit-font-smoothing: antialiased;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 520px;
    padding: 48px 40px 36px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 18px;
    box-shadow: 0 30px 80px rgba(0,0,0,0.55);
    backdrop-filter: blur(10px);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 32px;
    font-size: 13px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #a0998f;
  }
  .brand-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #c84d2b;
    box-shadow: 0 0 12px rgba(200,77,43,0.55);
  }
  h1 {
    font-size: 26px;
    line-height: 1.25;
    font-weight: 600;
    margin: 0 0 14px;
    color: #f5f3ef;
    letter-spacing: -0.01em;
  }
  p {
    font-size: 15px;
    line-height: 1.55;
    margin: 0 0 24px;
    color: #b8b3ab;
  }
  .pulse {
    display: flex;
    gap: 6px;
    margin: 24px 0 16px;
  }
  .pulse span {
    width: 9px; height: 9px;
    border-radius: 50%;
    background: #c84d2b;
    opacity: 0.35;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .pulse span:nth-child(2) { animation-delay: 0.18s; }
  .pulse span:nth-child(3) { animation-delay: 0.36s; }
  @keyframes pulse {
    0%, 80%, 100% { opacity: 0.25; transform: scale(0.85); }
    40% { opacity: 1; transform: scale(1.05); }
  }
  .status {
    font-size: 13px;
    color: #87827a;
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .meta {
    margin-top: 32px;
    padding-top: 20px;
    border-top: 1px solid rgba(255,255,255,0.06);
    font-size: 12px;
    color: #6e6960;
    line-height: 1.6;
  }
  .meta a {
    color: #c84d2b;
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }
  .meta a:hover { border-bottom-color: rgba(200,77,43,0.4); }
  .extra-help {
    margin-top: 14px;
    padding: 14px 16px;
    background: rgba(200,77,43,0.07);
    border: 1px solid rgba(200,77,43,0.18);
    border-radius: 10px;
    color: #d9c6bc;
    font-size: 13px;
    line-height: 1.5;
    display: none;
  }
  .extra-help.visible { display: block; }
  @media (prefers-reduced-motion: reduce) {
    .pulse span { animation: none; opacity: 0.6; }
  }
  @media (max-width: 480px) {
    .card { padding: 32px 24px 28px; }
    h1 { font-size: 22px; }
  }
</style>
</head>
<body>
  <main class="card" role="status" aria-live="polite">
    <div class="brand"><span class="brand-dot"></span>${escapeHtml(brand)}</div>
    <h1>We're back in a moment.</h1>
    <p>${escapeHtml(brand)} is updating or briefly restarting. Your files, vaults, and calls are safe — this page will refresh automatically when the system is ready.</p>
    <div class="pulse" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="status" id="status">Checking again in <span id="countdown">5</span>s…</p>
    <div class="extra-help" id="extra-help">
      This is taking longer than usual. We're aware and on it. If you need to reach Bestly support, <a href="${escapeHtml(support)}">get in touch</a>.
    </div>
    <div class="meta">
      Elapsed: <span id="elapsed">0s</span> · Origin status: ${originStatus} · <a href="javascript:location.reload()">retry now</a>
      <br><span style="opacity:0.55">${escapeHtml(reason)}</span>
    </div>
  </main>
<script>
  (function () {
    const POLL_MS = 5000;       // poll every 5s
    const PROBE_URL = '/status.php';
    const EXTRA_HELP_AFTER_MS = 60_000;   // show "taking longer" after 1 min
    const start = Date.now();
    const countdownEl = document.getElementById('countdown');
    const elapsedEl = document.getElementById('elapsed');
    const statusEl = document.getElementById('status');
    const extraHelp = document.getElementById('extra-help');
    let countdown = POLL_MS / 1000;

    function fmtElapsed(ms) {
      const s = Math.floor(ms / 1000);
      if (s < 60) return s + 's';
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return m + 'm ' + rem + 's';
    }

    function tick() {
      const elapsed = Date.now() - start;
      elapsedEl.textContent = fmtElapsed(elapsed);
      if (elapsed >= EXTRA_HELP_AFTER_MS) extraHelp.classList.add('visible');
      countdown -= 1;
      if (countdown < 0) countdown = 0;
      countdownEl.textContent = countdown;
    }
    setInterval(tick, 1000);

    async function probe() {
      try {
        const r = await fetch(PROBE_URL + '?t=' + Date.now(), {
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'manual',
        });
        // 200 from origin = back up. 302 = login redirect, also healthy.
        if (r.status === 200 || (r.status >= 300 && r.status < 400)) {
          statusEl.textContent = 'Back up — reloading…';
          setTimeout(function () { location.reload(); }, 400);
          return;
        }
      } catch (e) { /* network failure; keep polling */ }
      countdown = POLL_MS / 1000;
      setTimeout(probe, POLL_MS);
    }

    // First probe after 2s — give browser time to render
    setTimeout(probe, 2000);
  })();
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

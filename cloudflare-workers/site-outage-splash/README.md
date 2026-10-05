# site-outage-splash

Scout's "We'll be right back" page for **bestly.tech** and **www.bestly.tech** when the whole site is down
(Vercel origin unreachable or returning a platform 5xx). Sister of `maintenance-splash` (cloud.bestly.tech).
The in-app version for /admin crashes is `src/components/OutageScreen.tsx`.

## Behavior
- Healthy responses pass through untouched. Fails open: any bug here leaves the site working.
- Intercepts 502/503/504/520-526/530, a thrown origin fetch, and a 500 only when Vercel sets `x-vercel-error`.
  Real app 500s are never hidden.
- Browsers (`Accept: text/html`) get the splash (503, no-store, Retry-After 15). API clients get JSON.
- WebSocket/Upgrade requests are never touched.
- "Last known reason" comes from `get_outage_note()` (2s timeout), cached at the edge so it still shows if Supabase is down too.
- The page re-checks `/` every 15s and reloads itself when the site is back.
- Preview any time: `https://bestly.tech/?__splash=1` (in a browser).

## Deploy (from the Mac mini or any machine with wrangler logged in)
    cd cloudflare-workers/site-outage-splash
    npx wrangler deploy

Roll back: `npx wrangler rollback`, or delete the two routes in the Cloudflare dashboard (Workers Routes).
Note: every request to the site now runs through the Worker (free plan: 100k requests/day; use a paid plan if traffic nears that).

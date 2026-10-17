# The site check — what bestly.tech actually renders (2026-10-17)

Owner: **Ares** (Head of Security & IT). Runs as **Depth Check**
(`site-depth-check`), card on `/admin/team`, findings under the `site.` prefix in
`monitor_issues`.

This document exists because on 2026-10-17 two pages on bestly.tech had been
broken for months while every monitor on the estate was green.

## What was actually wrong

**`/status` returned "couldn't load" on most visits.** `get_public_status()`
built its 90-day per-day series by cross-joining the calendar to
`external_health_history` and filtering the range *in the join condition*, so
Postgres could not use the `(service, recorded_at)` index and hash-joined
everything — 12.3 million row pairs thrown away per call. Measured with
`EXPLAIN ANALYZE` over 137,763 rows: **2,910 ms**. The `anon` role has
`statement_timeout = 3s`, so PostgREST killed the statement with `57014` and the
page got a 500. It finished inside the cap often enough that it looked like a
fluke rather than a bug.

**`/cookie-yeti/transparency` had never shown live data.**
`get_cookie_yeti_public_stats()` exists in the repo in two migration files
(`20260529160000`, corrected by `20260530000000`) and **was never applied to the
project**. PostgREST answered `PGRST202` to every call, so the page fell through
to its second and third fallbacks and served hardcoded constants from May: "28
sites analyzed" when the real number was 866, "3 active patterns" when it was
727. It shipped like that.

Both are fixed in
`supabase/migrations/20261017190000_public_status_timeout_and_cookie_yeti_stats.sql`
— the status query rewritten as one aggregate per `(service, day)` then
left-joined onto the calendar (142 ms, 20× faster), and the Cookie Yeti function
re-applied at its latest definition. Both are registered in
`security_public_rpcs`, because Ares's Auto-Fixer revokes anon execute from
anything `SECURITY DEFINER` that is not on that allowlist.

## Why nothing noticed — three blind spots, and only one of them was the monitor

**1. Every monitor was checking something that cannot fail.** `probe-external`
runs every five minutes and fetches five homepages. bestly.tech is a Vite SPA:
it serves the same 13 KB of `index.html` with a `200` for a working page, a
broken page, and a URL that does not exist. A status-code check on this site can
only go red if Vercel itself goes down. It has no opinion about whether any page
works.

**2. The pages were built to hide the failure.** `/cookie-yeti/transparency` has
a deliberate three-level fallback — RPC, then direct table reads, then hardcoded
constants — documented in the component as "resilient by design so an investor
demo never shows zeros". The RPC 404'd and both direct table reads 401'd, so it
served the constants. A page showing last-known-good numbers renders *identically*
to a page showing live ones. Nothing looked wrong, so nobody looked.

**3. The repo is not the database.** Applied migrations are not in
`supabase/migrations/` and migrated files are not in the project:
`supabase migration list` shows **1,375 versions applied with no local file, 408
local files never applied, 37 that match**. A migration being committed to this
repo tells you nothing about whether it ran. Check before you assume:

```bash
supabase migration list --linked | tail -40
supabase db query --linked "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='the_function_you_just_wrote';"
```

## What runs now

| Piece | Where | When |
|---|---|---|
| `site-depth-check` | `supabase/functions/site-depth-check/` | cron `site-depth-check`, every 15 min |
| `site_depth_watch()` | `supabase/migrations/20261017200000_site_depth_check.sql` | cron `site-depth-watch`, every 30 min |
| Manual browser sweep | `scripts/site-audit/crawl.mjs` | by hand, after any marketing-site change |

`site-depth-check` asserts, from the outside, as a visitor's browser would:

- **Routes** (16 of them, the ones carrying revenue or a legal obligation): 200,
  HTML content type, the React root, a real script bundle, and the page's own
  title marker.
- **Assets**: every `/assets/` and `/models/` URL those routes reference still
  resolves. Catches a deploy that shipped HTML pointing at a file it did not
  upload.
- **Data paths**: each public RPC the site reads with no sign-in
  (`get_public_status`, `get_cookie_yeti_public_stats`) is called with the
  publishable key and its **shape is asserted** — 90 days in every service's
  series, non-zero counts, a non-empty offender list. This is the layer that did
  not exist before.
- **Sitemap**: every `<loc>` resolves.

Each result becomes a `monitor_issues` row. Passing checks call `bestly_raise`
with `resolved`, which is a no-op when nothing is open, so the checks are silent
when everything works. Failing checks land on Ares and climb the ordinary Fix
Ladder (`auto` → free AI → Scout → Needs you).

`site_depth_watch()` is the check on the check. If the beat in
`site_depth_beat` is more than 45 minutes old — the function stopped, the cron
got disabled, the deploy failed — it raises `site.depth-check.stale`. A checker
that dies quietly is the entire reason this file exists.

### Injection test (run this after touching the check)

A detector that never fires in testing is worth nothing. To prove it works,
break something on purpose and watch it go red, then put it back:

```bash
# open a finding
supabase db query --linked "revoke execute on function public.get_public_status() from anon;"
supabase db query --linked "select public.invoke_edge_function('site-depth-check','{}'::jsonb,60000);"
sleep 20
supabase db query --linked "select key,status,severity,title from monitor_issues where key like 'site.%';"
#  -> site.rpc:get_public_status | open | error | A public page's data call fails

# clear it
supabase db query --linked "grant execute on function public.get_public_status() to anon;"
supabase db query --linked "select public.invoke_edge_function('site-depth-check','{}'::jsonb,60000);"
sleep 20
#  -> resolved, fix_stage 'fixed'
```

Last run of that test: 2026-10-17, raised and cleared as above.

## What it cannot see, and what to do instead

A server-side fetch gets the shell. It cannot see a React error boundary, a
console error, a chart that drew zeroes, an image that fell back to a broken
icon, or a page that quietly served cached constants. **Anything that renders
numbers needs a real browser.** So after any change to the marketing site, run
the sweep:

```bash
node scripts/site-audit/crawl.mjs              # all public routes, desktop
node scripts/site-audit/crawl.mjs --mobile     # 390x844, also catches overflow
node scripts/site-audit/crawl.mjs --route /status
```

It attaches a real Chromium to each route with the console and the network
listening, and reports console errors, uncaught exceptions, any response ≥ 400,
requests that failed, images with no alt text, images that did not load, pages
still wearing the homepage's `<title>` or its `<link rel="canonical">`, dead
links (the SPA answers 200 and renders 404), and horizontal overflow at phone
width. It exits non-zero when something is wrong.

The canonical check is browser-only by necessity: `SEOHead` renders the tag at
runtime, so a server-side fetch of the HTML sees the static one and would pass a
broken page. Aliases are allowed to point at their primary (`/in-house-cloud` →
`/cloud`, `/terms` → `/terms-of-use`); `noindex` pages are allowed to skip it.

This is the tool that found all of the above. It is a script and not a cron job
on purpose: it needs Chrome, it is slow, and the cheap half of it is already
running every 15 minutes in `site-depth-check`.

## Is this page actually working? (the five-minute version)

1. `node scripts/site-audit/crawl.mjs --route <path>` — console, network, title.
2. Open the page in a real browser. Are the numbers plausible, or are they round
   and familiar? If they look like last month's, they are last month's.
3. `supabase db query --linked "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='<fn>';"` — does the function behind the page exist in the project, or only in the repo?
4. Call it yourself, the way the browser does, with the publishable key and no
   sign-in. A `401`/`42501` means the grant is missing; a `404`/`PGRST202` means
   the function does not exist; a `500`/`57014` means it is too slow for the
   `anon` role's 3-second cap.
5. If it passes, close the issue. If it fails, the page's fallback is the second
   bug — file that too.

## Adding a route or a dependency

Edit the `ROUTES` and `RPCS` arrays at the top of
`supabase/functions/site-depth-check/index.ts` and redeploy:

```bash
supabase functions deploy site-depth-check --project-ref rcqfqhguwpmaarseifqg
```

Keep the list to pages that carry money, a customer relationship, or a legal
obligation. A check nobody reads is worse than no check — which is where this
started.

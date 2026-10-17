-- 2026-10-17 (late) — the third wave: the edge itself was lying.
--
-- /neckpilot had already been fixed, and it still would not load in Chrome while
-- curl reported 200 for the same file. Vercel tags every /assets/* response
-- immutable with a one-year TTL, its own 404s included, and Cloudflare caches a
-- 404/410 for three minutes on its own even with no cache-control. A content
-- hashed filename is identical in every build, so no redeploy and no rollback
-- can clear it. Rechecked after the fix: the edge had a 200 cached for a URL the
-- origin now 404s, which is the same mechanism pointed the other way.
--
-- Nothing on the estate could see it: probe-external looks at homepages,
-- site-depth-check fetches server-side (HEAD, no browser), and the crawler was
-- pointed to localhost where there is no edge. The one tool that saw it was the
-- browser, which is where this lesson lives.

insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, source, evidence)
select 'site',
  'A 200 from curl does not mean a browser can load the page',
  'A page is reported broken by a person, or not loading somewhere you cannot reproduce, and you are about to say "it works for me".',
  'Fetch the file twice before believing either answer: once with no query string (the edge answers from its own copy, cf-cache-status: hit) and once with a cache-buster like ?__eg=1 (it goes to the origin, miss). If the plain request fails and the busted one succeeds, the cached answer is wrong and a deploy will never fix it — the filename is content-hashed and identical in every build. Cache rules phase http_request_cache_settings cannot test a response code in its expression; the 404 match belongs in edge_ttl.status_code_ttl with 404 -> no-store. Edge Guard enforces both the check and the rule now; docs/edge-guard.md carries the detail.',
  'Concluding "works for me" from curl, from a HEAD request, or from a server-side fetch. Not one of those three describes what the visitor''s browser receives, and on 2026-10-17 all three said 200 while every Chrome on the internet got a cached 404.',
  'reflect',
  jsonb_build_array(
    jsonb_build_object('incident', '/neckpilot', 'detail', 'The route imports a shared lucide icon chunk. The edge served a cached 404 for it; Chrome fell to the error boundary with a blank body and 10 console errors. curl on the same Mac got 200 for the identical URL, both cf-cache-status: hit.'),
    jsonb_build_object('incident', 'why nothing caught it', 'detail', 'probe-external checks homepages for a status code. site-depth-check fetches server-side. The Playwright crawler had been pointed at localhost, where there is no edge to poison. Cloudflare does not report a cached error response anywhere in the dashboard.')
  )
where not exists (select 1 from public.scout_lessons where scope = 'site' and title like 'A 200 from curl does not mean a browser can load%');

insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, source, evidence)
select 'ops',
  'Check what the credential can actually do before you promise a self-heal',
  'You are about to wire an automation to fix something by itself, using a login or token that already exists on the machine.',
  'Probe each permission you intend to use, with the real credential, before designing around it — a read succeeds where a write 403s, and the error text does not always say so ("Authentication error" is what a missing scope looks like). Then either scope the ask to the one permission that is missing, or make the automation degrade loudly: do the part it can, say what it could not verify, and never report a green heartbeat for a check it never ran.',
  'Assuming a broad "admin-ish" login can edit everything. The wrangler OAuth login has zone:read and no cache permission at all: purge answers 401 and cache rules 403. Half a day was spent in the assumption, which a two-line probe answered in seconds.',
  'reflect',
  jsonb_build_array(
    jsonb_build_object('incident', 'wrangler OAuth scopes', 'detail', 'Confirmed 2026-10-17: zone:read, workers:*, d1, pages, ssl_certs, ai, queues, email_* and friends — no cache purge, no cache rules, no zone settings. Detection was moved into Edge Guard instead, because it needs no permission; purge and the cache rule wait on a Keychain token (bestly-cf-cache).')
  )
where not exists (select 1 from public.scout_lessons where scope = 'ops' and title like 'Check what the credential can actually do%');

-- ------------------------------------------------------------------ Edge Guard answers for the edge's lies too

update public.bestly_agents
   set what_it_does = what_it_does || ' Also watches for the edge itself lying: every 5 minutes it loads the homepage, takes every file the page asks for, and fetches each one the way a browser does — no cache-buster — then again against the origin. A 404 from the edge for a file the origin serves is a cached lie: visitors get it, no deploy can clear it (the filename is content-hashed), and on 2026-10-17 that is what killed /neckpilot. It purges the URL when it has the token, alerts either way, and once a day confirms the rule that keeps a 404 out of the cache.',
       updated_at = now()
 where slug = 'edge-guard'
   and what_it_does not like '%cached lie%';

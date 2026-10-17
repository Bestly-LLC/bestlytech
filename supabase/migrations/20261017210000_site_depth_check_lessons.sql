-- 2026-10-17 — what the two month-long misses taught us, written down where the
-- next session will actually read it.
--
-- Both of these were live for months with every monitor green. The point of
-- these rows is not "a bug happened" — it is that the monitoring was answering a
-- question that cannot fail. `probe-external` fetched five homepages and looked
-- at the status code. bestly.tech is a Vite SPA: it answers 200 with the same
-- index.html for a working page, a broken page and a page that does not exist.
-- So the check could only ever go red if Vercel itself went down.
--
-- Full writeup: docs/site-depth-check.md.

-- ------------------------------------------------------------------ lessons

insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, source, evidence)
select 'site',
  'A 200 from an SPA proves nothing — test the data path, not the status code',
  'You are checking whether a page on bestly.tech is working, before closing an issue about it or after a deploy.',
  'Fetch the page, read the HTML, and then go one level deeper: find the RPCs and the assets the page actually depends on and call them yourself, the way the browser does (publishable key, no sign-in) — assert the shape, not just the status. Then for anything that renders numbers, open it in a real browser and confirm the numbers are live. CLAUDE.md and docs/site-depth-check.md carry the checklist; site-depth-check runs the first half every 15 minutes.',
  'Reporting a page as healthy because it returned 200, or because a screenshot looked right. Both were true of /status and /cookie-yeti/transparency the entire time they were broken.',
  'reflect',
  jsonb_build_array(
    jsonb_build_object('incident', '/status', 'detail', 'get_public_status() ran for 2,910 ms against the anon role''s 3s statement_timeout, so PostgREST killed it with 57014. It came back 200 often enough to look like a fluke. The page returned 200 every single time.'),
    jsonb_build_object('incident', '/cookie-yeti/transparency', 'detail', 'get_cookie_yeti_public_stats() is in the repo in two migration files and had never been applied to the project, so every call got PGRST202. The page has never shown live data since it shipped in May.')
  )
where not exists (select 1 from public.scout_lessons where scope = 'site' and title like 'A 200 from an SPA proves nothing%');

insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, source, evidence)
select 'site',
  'A fallback that hides a failure is the bug, not the fix',
  'You are writing or reviewing a page that has a "if the data does not load" branch, or a last-known-good constant.',
  'Let the degraded state be visible and specific: say which call failed, log it, and file it (bestly_raise) so it lands on an owner''s queue. Keep the fallback for the visitor if the page needs to stay pretty, but never let it be the only thing that knows the data stopped arriving.',
  'Hardcoded last-known-good numbers that render identically to live ones. /cookie-yeti/transparency served its May constants for months and the only sign was a one-line banner that nothing was checking.',
  'reflect',
  jsonb_build_array(
    jsonb_build_object('incident', '/cookie-yeti/transparency', 'detail', 'Three-level fallback (RPC -> direct table reads -> hardcoded constants). The RPC 404d and the two direct table reads 401d, so it silently served constants from May. Nobody had a reason to look, because the page never looked broken.')
  )
where not exists (select 1 from public.scout_lessons where scope = 'site' and title like 'A fallback that hides a failure%');

insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, source, evidence)
select 'repo',
  'Check the branch before you fix the repo',
  'You are about to edit this repository — especially when a task says "fix the site" and hands you a checkout path.',
  'Run git status and compare HEAD to origin/main before editing anything. Work from a fresh worktree or a fresh clone of origin/main, and leave other people''s uncommitted files alone. A fix written against a stale tree cannot deploy, and the deploy is the only thing that counts.',
  'Making the change in whatever checkout happened to be open. On 2026-10-17 the shared checkout at ~/Developer/bestlytech was 387 commits behind origin/main with 30 uncommitted files — work done there would have silently reverted five days of other people''s fixes.',
  'reflect',
  jsonb_build_array(
    jsonb_build_object('incident', 'stale checkout', 'detail', 'Local HEAD 520c757 (Oct 12), origin/main b81ae6e (Oct 16), 387 behind / 2 ahead, on an abandoned feature branch that nobody merged.')
  )
where not exists (select 1 from public.scout_lessons where scope = 'repo' and title like 'Check the branch before you fix%');

-- ------------------------------------------------------------------ Ares owns what the site actually renders

update public.bestly_agents
   set what_it_does = what_it_does || ' Also answers for what bestly.tech actually renders: Depth Check (site-depth-check) tests the pages, the files they load and every public data call they make with no sign-in, every 15 minutes. Added 2026-10-17 after /status and /cookie-yeti/transparency sat broken for months behind 200s.',
       updated_at = now()
 where slug = 'security-auditor'
   and what_it_does not like '%Depth Check (site-depth-check)%';

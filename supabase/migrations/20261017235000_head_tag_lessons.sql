-- 2026-10-17 — the second wave: found while verifying the first wave.
--
-- /neckpilot had come back clean, so it looked like a good page to spot-check.
-- It rendered perfectly and was telling Google it was the homepage. Two tags
-- with the same job, the wrong one first, on 14 of 32 pages, since launch.
--
-- Neither of these is a code bug anyone could see on screen, which is why
-- nothing caught them: the page looked right, the status was 200, the crawler
-- was not looking at the head, and a static tag in index.html looks exactly
-- like a sensible no-JS fallback until you learn Helmet's ownership rule.

insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, source, evidence)
select 'site',
  'A static head tag is not a fallback, it is a duplicate',
  'You are adding or changing a <title>, <link rel="canonical">, <meta property="og:*"> or <meta name="twitter:*"> — in index.html or in a page component.',
  'One owner per tag. index.html may carry defaults, but they only stay correct if react-helmet can replace them, which means data-rh="true" on every one. A page sets its own head with SEOHead (which now defaults `path` to the current route), never with a hand-rolled document.title — a hand-rolled one leaves the homepage canonical in place. Then verify in a browser: exactly one canonical, pointing at the route you are on. An alias (/in-house-cloud -> /cloud, /terms -> /terms-of-use) may canonicalise to its primary; a noindex page may have none.',
  'Adding a tag in both places and assuming the runtime one wins. Helmet only removes tags it owns, so the static homepage tag stays and sits FIRST in the head — it is the one search engines read.',
  'reflect',
  jsonb_build_array(
    jsonb_build_object('incident', 'canonical duplication', 'detail', 'index.html shipped canonical/og:url/twitter:url for https://www.bestly.tech/. SEOHead rendered a correct second canonical on 32 pages. 14 of them passed no `path` and defaulted to "", so their correct one also pointed at the homepage. Every marketing page declared itself a duplicate of /.'),
    jsonb_build_object('incident', 'detection', 'detail', 'A server-side fetch of the HTML cannot see it (SEOHead renders at runtime), so the edge check was blind by construction. scripts/site-audit/crawl.mjs reads the live head in Chromium and now fails a route with no canonical, the homepage canonical, or the homepage title.')
  )
where not exists (select 1 from public.scout_lessons where scope = 'site' and title like 'A static head tag is not a fallback%');

insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, source, evidence)
select 'repo',
  'React 18 drops props it does not know, silently, in production',
  'You are writing a newer HTML attribute (fetchPriority, popoverTarget, inert-style props) in JSX on this stack.',
  'Check the React version in package.json first. React 18 turns an unknown camelCase prop into a dev-only console warning and then writes NOTHING to the DOM, so the feature is simply absent in production and the warning only exists where you are not looking. Use the lowercase attribute via spread: {...{ fetchpriority: "high" }}. A dev-only warning is a real bug that has already shipped.',
  'Assuming the warning is cosmetic because the page looks fine. Production does not warn; it just ships without the feature.',
  'reflect',
  jsonb_build_array(
    jsonb_build_object('incident', 'fetchPriority', 'detail', 'React 18.3. Three images passed fetchPriority (React 19 spelling). Every route logged "React does not recognize the fetchPriority prop" in dev, and the priority hint had never reached the DOM.')
  )
where not exists (select 1 from public.scout_lessons where scope = 'repo' and title like 'React 18 drops props it does not know%');

-- ------------------------------------------------------------------ Ares answers for the head too

update public.bestly_agents
   set what_it_does = what_it_does || ' Also answers for the <head> the site renders: one canonical per page, pointing at the page, not at /. Fourteen pages declared themselves duplicates of the homepage from launch until 2026-10-17 and nothing on screen looked wrong.',
       updated_at = now()
 where slug = 'security-auditor'
   and what_it_does not like '%one canonical per page%';

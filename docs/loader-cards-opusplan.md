# Something worth reading while it loads (opusplan)

Jared, 2026-10-06 7:51 PM: "Have the loading pages have some sort of information for me to read in between loadings.
Something useful or helpful for me, mixed in with some inspirational quotes that we can pull from the wall."

Design pass: Apple HIG (never make him wait longer for content; quiet, legible, one thing at a time) checked against
ui-ux-pro-max (feedback for waits > 300 ms; no layout shift; crossfade for content replacement; reduced motion;
contrast ≥ 4.5:1). Planned by Opus, built by Sonnet. The Pi side (quote sync) is done by Opus separately.

---

## What he gets
Under the side-eye binoculars on every admin loader, one short card: either something useful from his own data,
or a quote/mantra from the wall's deck. One card per loader, a new one each time, so a day of navigating reads like
a feed instead of the same spinner.

- **Never slows anything down.** The card appears only if the loader has been up 400 ms (fast loads stay a clean
  mark, no flash). A loader never waits for the card, and the card never holds the page back once it's ready.
- **Long loads:** if still loading after 6 s, crossfade to the next card every 6 s (200 ms crossfade).
- **Placement:** centered under the mark, 16 px gap, max-width 22 rem, text left as centered body. Fact cards:
  one line of 15 px text at white/80 plus an optional 13 px secondary line at white/55. Quotes: 15 px text, then
  "— Author" at 13 px white/55. Measure ≤ 45 characters per line; nothing is ever truncated (cards are chosen to fit,
  see "lengths"). Reserve the card's height from the start (min-height) so the mark never jumps. Light admin theme
  (bento, `#F3F2EE`) uses the same layout with black at the same opacities.
- **Reduced motion:** no crossfade, swap instantly; still one card per loader.
- **Screen readers:** the loader keeps `role="status"` "Loading"; the card is `aria-hidden` (it's ambient, not status).

## Where it shows (and where it must not)
| Loader | What can show |
|---|---|
| `RouteFallback` / `BrandLoader tone="dark"` on `/admin/*`, after sign-in | facts + tips + quotes |
| Session check in `AdminRoute`, the login screen, and the pre-JS boot splash in index.html | quotes + tips only (no data before auth). The boot splash is plain HTML: leave it unchanged this round. |
| Partner portal (`/partner/*`, Eli's view) | quotes only. Never Jared's data. |
| Public site (`tone="light"`) | nothing, unchanged |

## The deck
New file `src/components/loader/loaderDeck.ts`.
- On admin load (once per session, after auth, in `AdminLayout` or wherever admin data first loads; idle-time via
  `requestIdleCallback` fallback `setTimeout 1500`), call RPC `admin_loader_cards()` and keep the result in memory
  (module-level). Refresh every 10 min while the admin is open. **Never write facts to localStorage** (money and mail
  stay off disk). Quotes may be cached in localStorage (`scout-quotes-v1`, try/catch) so pre-auth loaders have them.
- Order: interleave useful and quote cards: fact, quote, fact, tip, fact, quote... Facts in priority order (below).
  A per-session cursor (sessionStorage `loader-cursor`) advances each time a card is shown, so the next loader
  shows the next card. Shuffle quotes once per day (seeded by the Pacific date) so they don't repeat in a row.
- Bundled fallback: 8 short quotes from the current wall deck (copy them from the seed the migration inserts) for a
  first-ever load with nothing cached.

## Cards (all from real data; skip any card whose data is missing or stale > 24 h)
Built server-side in `admin_loader_cards()` so the client stays dumb. Each card: `{kind, text, sub?, author?}`.
Plain words, 12-hour times, US units, numbers keep their unit on the same line (`white-space: nowrap` on the
number+unit span), no emoji.
1. **The one thing** (`wall_one_thing.text`): text "Today's one thing", sub = the item (it is short).
2. **Needs you** (count from `admin_today()` rows with rank ≤ 1): "2 things need you" sub "Scout has the detail".
   Skip when 0. Then a happy alternative when 0 and nothing else urgent: "Nothing needs you right now."
3. **Turo** (`wall_feeds` kind `turo`): "Turo: $66 today, $252 this week" (round to dollars); if today's calendar has a
   booked car: sub "Blue Steel is out with Hanseung".
4. **Deliveries** (`deliveries`): "Home Chef order is on the way" (first item, status lowercased into the sentence).
5. **Mail** (`mail`): when `today > 0`: "2 pieces of mail today" sub first item ("Chase card statement").
6. **Air** (`air`): "Air quality 63, moderate" sub "UV 0". Only if AQI ≥ 51 or UV ≥ 6 (otherwise it's noise).
7. **Scout spend** (`claude`): "Scout's paid AI: $3.42 of $6.00 today". Only when pct ≥ 50.
8. **Leo** (`leo`): kind `quote`-styled, text = the line, author "Today's Leo". Max 1 per day.
9. **Tips** (static, in the RPC or the client): "Press ⌘J to open Scout from anywhere.", "Press ⌘K to jump to any
   page.", "Esc stops Scout mid-run.", "Say 'keep going' and Scout picks up where it stopped." Verify each shortcut
   exists in the code before including it; drop any that don't.
10. **Quotes** (`wall_quotes`, active only): text + author. Mantras (no author) render without the dash line.

**Lengths:** skip any quote over 140 characters and any fact sub over 60; never cut text.

## Database (one migration, applied with Supabase MCP `apply_migration`, saved under `supabase/migrations/`)
1. `create table public.wall_quotes (id text primary key, text text not null, author text, kind text not null default
   'quote' check (kind in ('quote','mantra')), active boolean not null default true, updated_at timestamptz not null
   default now());` RLS on; policy "Admins read wall quotes" `for select using (has_role(auth.uid(), 'admin'::app_role))`.
2. Seed it from the wall's current deck. The deck is `/opt/bestly/wall/quotes.json` on the Pi
   (`{"v":1,"note":...,"quotes":[{"t","a","id"},...], ...}`). Opus will paste the JSON into
   `docs/wall-quotes-seed.json` in the repo before you start; insert every entry (id = its `id`, text = `t`,
   author = `a`; when `a` is "Mantra", kind = 'mantra' and author = null). The Pi keeps it in sync
   after that (Opus).
3. `public.admin_loader_cards()` returns jsonb: SECURITY DEFINER, `set search_path = public`, first statement
   `perform public.admin_require_admin();`, `revoke all ... from public, anon; grant execute ... to authenticated;`.
   Returns `{facts:[...], quotes:[...], built_at}`.
4. `public.partner_loader_quotes()` returns jsonb array of quotes only, callable by any authenticated user
   (partner portal signs in). Same revoke-from-anon rule.

## Files
- `src/components/loader/loaderDeck.ts` (fetch, cache, order, cursor)
- `src/components/loader/LoaderCard.tsx` (the card UI, 400 ms reveal, 6 s rotation, crossfade, reduced motion)
- `BrandLoader.tsx`: new prop `cards?: "full" | "quotes" | "none"` (default `"none"`); render `<LoaderCard>` under the
  mark when not none. `RouteFallback`: `/admin` → "full" when signed in as admin else "quotes"; `/partner` → "quotes".
  `AdminRoute` session-check loader → "quotes".
- Prefetch hook call in the admin shell.

## Verify (Sonnet, before committing)
- `npx tsc --noEmit -p tsconfig.app.json` clean; `npm run build` passes.
- `select public.admin_loader_cards()` returns cards when called as service role with the admin check satisfied
  (or test the body as a plain query); `has_function_privilege('anon', ..., 'execute')` false for both RPCs.
- `select count(*) from wall_quotes` equals the number of entries in the seed file.
- Partner path can't reach `admin_loader_cards` (it isn't called there).

## Ship
Commit with the session attribution lines, `git fetch origin main && git rebase origin/main && git push origin HEAD:main`,
confirm origin/main == HEAD.

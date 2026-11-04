# Bestly Studio public site v2 — opusplan (2026-11-04)

Ask (Jared, 2026-11-04, from an Eli text): "Put together a link or a couple pages to sell the studio. Rohit is interested in finding
clients internationally." The /studio front end must represent ANY content use, not just one coach (Centering YOU) and realtors.
Opus planned, Sonnet executes. Apple design skill first, ui-ux-pro-max second pass.

## Hard rules (unchanged, from docs/studio-promo/claims.md)
- Copy is for the least-informed reader. First line says what it does: we make your social posts and short videos, you approve them
  on your phone, we post them.
- No prices, no results/numbers/growth, no client names/logos/testimonials, no "AI does everything" (a person checks every post),
  no speed/volume promises, no privacy/security/compliance claims, no "posts without your OK", no fake urgency.
- Real estate: photo-based only. Say "send listing photos and notes, we make swipe posts and image posts". NEVER promise listing
  videos, property tours, walkthroughs or AI footage.
- No mocked app screens. Only the real screenshots already in public/studio/. Idea lists are text, labeled "Ideas we might make".
- No emoji. A number never wraps from its unit (no-break space). No text truncated with "...". Multi-sentence prose in <Lines>.
- Every /studio page shows the Studio orb favicon (call useStudioFavicon()).

## Platform truth update (checked in social_posts, 2026-11-04)
Posted in the last 30 days: Instagram, Facebook, Threads, Bluesky, LinkedIn, Pinterest, TikTok (TikTok = the business reviews and
taps Post; TikTok's review still open). YouTube: nothing posted yet, do not name it. Update claims.md rule 8 + "Posting" to match.

## Pages
1. /studio (rewrite of src/pages/BestlyStudio.tsx)
2. /studio/for/:slug — one template (src/pages/StudioUseCase.tsx) fed by src/config/studioUseCases.ts. Unknown slug -> <Navigate to="/studio">.
   Slugs (short, sendable): coaches, real-estate, products, apps, local, creators, nonprofits.

## /studio sections, in order
1. Hero. Orb + "Bestly Studio". H1: "Social posts and short videos, made for your business." Sub: we make them, a person checks
   each one, you approve on your phone, we post. The one memorable thing: a "Made for" chip row under the sub (7 use cases + "Something
   else") — each chip is a Link to /studio/for/<slug>. CTAs: Book a free call; Or email studio@bestly.tech. Phone screenshots right.
2. "Whatever you do" grid: 7 cards (icon, title, one line, "See how it works ->" link) + an 8th "Something else?" card -> booking.
3. "What we can make": short vertical videos cut from clips you film (captions, music, graphics, cover image); scripts for you to
   film; swipe posts; image posts; recuts of videos you already have; a posting calendar planned around holidays and dates that
   matter to your customers.
4. How it works (3 steps, generalized; keep the existing step shape).
5. Your board (existing desktop screenshot + gets list).
6. Where we post: text chips Instagram, Facebook, Threads, Bluesky, LinkedIn, Pinterest, TikTok (footnote: TikTok — you tap Post;
   still in TikTok's review, test accounts only). You connect your own accounts on each platform's own login page.
7. "Wherever you are" (international, for Rohit's prospects): we work with businesses outside the US; everything happens online:
   a video call to start, your board on any phone or computer, material by email. No language/time-zone/currency claims.
8. FAQ (keep TikTok Q&As, update "Where do you post?", add "Do you work outside the US?", "Do I have to be on camera?" (no: swipe
   posts and image posts need no filming), "What kinds of businesses?").
9. Book a call CTA + "More from Bestly" row (Always sell): Bestly Agent (/agent), Bestly Cloud (/in-house-cloud), InventoryProof
   (https://inventoryproof.com). Footer line with Terms / Privacy.

## /studio/for/:slug template
Hero (eyebrow "Bestly Studio for <audience>", H1 in their words, sub, CTAs, back link "All uses") -> "What we make for you" (3–4 items)
-> "How it works for you" (3 steps tailored) -> "Ideas we might make" (4–6 plain-text idea lines) -> 2–3 FAQs -> shared CTA +
"Other uses" chips. SEOHead per page with path /studio/for/<slug>, image /studio/og-studio.jpg.

## Design (apple-design skill)
Light mode, existing tokens (font-modern, primary, border, card, secondary/20 alternating sections, AnimatedSection fade-ins).
Display type tight tracking (tracking-tight), body near 0. Quiet at rest: no loops, no marquees. Chips/targets >= 44 px tall,
:active scale 0.97. Any gradient/fade edge is feathered. Respect prefers-reduced-motion (AnimatedSection already does; check).
Cards: rounded-2xl border bg-card, hover lifts with shadow only (no layout shift). Grid 1 col phone, 2 tablet, 4 desktop for uses.

## Wiring + checks (watchdog)
- App.tsx: lazyPage import + routes /studio/for/:slug. sitemap.xml: add each slug. scripts/site-audit/crawl.mjs: add each route
  (Depth Check / Edge Guard then watch them, Scout owns alerts).
- npx tsc --noEmit -p tsconfig.app.json (ignore 2 WowButton errors); npm run build; Playwright screenshots of /studio and
  /studio/for/real-estate at 390x844 and 1440x900 (vite preview); look at them.
- Commit + pull --rebase + push main (repo rule).

# Bestly Homepage — "WOW that cost $10k" execution plan v3

**Builds on:** `homepage-redesign-plan.md` (April 28 strategy) + `homepage-wow-plan.md` (v2 execution).
**Adds in v3:** fixes from correctness audit (contrast, perf budget, modal pattern) + gaps audit (copy, mobile, site-wide consistency, A/B test, fallback paths, calendar reality).
**Constraint reaffirmed:** original work for Bestly. Premium-minimalist patterns are a category; specific executions belong to the people who made them.

---

## What "$10k feel" actually is (unchanged from v2)

1. Editorial typography. 2. Restraint over decoration. 3. One signature motion moment. 4. Real photography. 5. Micro-interactions. 6. Performance.

**v3 addition — concrete acceptance tests so "WOW" is operationalized:**
- (a) Blind comparison vs. a named premium agency homepage screenshot — Jared can't reliably tell which is which on hero alone.
- (b) One outside reviewer (peer, not friend) reacts with "what agency built this?" unprompted.
- (c) Lighthouse Performance ≥ 95 on desktop, ≥ 90 on mobile.

If (a)+(b) don't hit, the site isn't there yet, regardless of what (c) says.

---

## Phase 0 — Decisions, in order of reversibility (lighter than v2)

v2 stacked five ASKs before any visible work. Audit pass 2 flagged this as a workflow risk. v3 splits Phase 0 into things we need to lock NOW vs. things that can wait until we have something visible to react to.

### 0.1 Lock now (~5 min)

**Anchor positioning:** Keep current *"The cloud that lives in your office."* Default; ASK only if the user wants to revisit.

**Default palette:** Option A (premium neutral + ink accent), so we can ship Phase 1 immediately and iterate later. Phase 0.2 below pre-resolves the contrast bug.

**Photography budget commitment:** explicit Y/N + dollar number. ASK as a single yes/no so it doesn't stall.

### 0.2 Color tokens — corrected from v2

v2 said `#1a2766` "oxford navy" — pass 1 audit caught two issues:
- Real Oxford blue is `#002147`. `#1a2766` is more accurately *deep indigo*. Renamed.
- `#1a2766` against `#0a0a0a` background = 1.6:1 contrast ratio, fails WCAG AA. Unusable for accent-on-dark text/underlines.

v3 palette:

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0a0a0a` | Page background |
| `bg-elev` | `#141414` | Elevated cards |
| `fg` | `#fafafa` | Body text |
| `fg-muted` | `#a8a8a8` | Secondary text |
| `accent` | `#3a4a9c` | CTA fills, focus rings (4.7:1 vs `#0a0a0a` — passes AA large) |
| `accent-on-dark` | `#7a8be0` | Accent text/underlines on dark bg (8.4:1 — AAA) |
| `accent-on-light` | `#1a2766` | Accent on cream/light bg, if Phase 5 introduces a light section |

Two-tone accent system: deep indigo for fills (when behind white text), lifted indigo for accent text (when on dark background). Resolves the contrast bug without changing the brand feel.

### 0.3 Defer until end of Phase 1

Decisions that benefit from seeing the new type + color land first:
- Hero motion option (kinetic type / 3D / editorial reel)
- Whether to commit budget to a paid display face
- Whether founder portrait happens or fall-back illustration

Audit pass 2 was right: making these calls without anything visible to react to is gambling. We get visible momentum first.

### 0.4 Founder note — written before Phase 2 (NEW)

Audit pass 2 finding: a beautiful site with mediocre copy still feels mediocre. Before the visual work in Phase 2 starts, **Jared writes the founder note longhand in his own words.** No LLM polish, two paragraphs, signed. Ceiling 200 words. This becomes a constraint the design respects, not an afterthought.

### 0.5 Acceptance test pre-commit (NEW)

The user pre-commits to the three acceptance tests in the section above. This makes "is it WOW yet?" a falsifiable question instead of a vibe.

---

## Phase 1 — Foundations + copy + token audit (~1.5 days)

**1.1** Self-host Newsreader + Inter via `@fontsource/newsreader` and `@fontsource/inter`. The repo already uses `@fontsource/plus-jakarta-sans` so the pattern is proven. Preload the two weights actually used; `font-display: swap`.

**1.2** Type scale via CSS variables. Hero `clamp(40px, 7vw, 96px)` (capped lower than v2's 112px — at desktop ultrawide, 112px reads cartoonishly large). Body `clamp(16px, 1.05vw, 18px)`.

**1.3** Tailwind config token migration: replace `gradient-bg`, `GradientText`, `GlowCard`, `bg-mesh` with the new token set. **This is site-wide, not just Index.tsx.** Audit pass 2 caught: if the homepage feels premium and `/cloud` still has the old violet gradient, the magic dies on the first click. So:

  - Walk every file using the deprecated tokens (grep `gradient-bg|GradientText|GlowCard|bg-mesh|hsl\(var\(--gradient`).
  - Migrate each to v3 tokens.
  - Pages affected likely: `Index.tsx`, `CookieYeti.tsx`, `InHouseCloud.tsx`, `CookieYetiSuccess.tsx`, `CookieYetiCancel.tsx`, components consuming `GradientText`/`GlowCard`.

**1.4** Performance budget — softened per pass 1 audit:

| Metric | Desktop | Mobile |
|---|---|---|
| LCP | ≤ 2.5s | ≤ 3.0s |
| CLS | ≤ 0.05 | ≤ 0.05 |
| FID/INP | ≤ 200ms | ≤ 200ms |
| JS bundle (initial) | ≤ 200KB gzipped | same |
| Hero asset | ≤ 800KB (video) or ≤ 300KB JS + ≤ 500KB textures (3D) | downgrade to poster on `saveData` or `effectiveType ≤ 3g` |

**1.5** Install `framer-motion` (it is NOT in package.json today; April 28 plan was wrong about that). Wire `AnimatePresence` correctly with React Router v6: `<AnimatePresence mode="wait">` outside `<Routes>`, with `useLocation().key` as the routes wrapper key, otherwise exit animations don't fire.

**1.6** Copy critique gate (NEW from audit). Before Phase 2 begins:
- Re-read every section's copy with a 200-word cap.
- Cut adjectives ruthlessly.
- Founder note from 0.4 is in.
- One trusted reader does a 15-min red-pen pass.

**1.7** SEO regression check (NEW from audit). Capture current keywords ranking via Search Console export. After v3 trims sections, verify the trimmed copy still hits target keywords (private cloud, on-prem, in-house cloud, etc.). If gaps, add a hidden-but-crawlable FAQ component.

**Gate exit:** the site loads with new fonts and colors, micro-changes only. Visible difference, no new sections yet. Jared reviews.

---

## Phase 2 — Hero (~2 days, mid-build review built in)

**2.1** Layout per v2 (eyebrow / headline / subhead / two CTAs / four trust pills). Nothing else above the fold.

**2.2** Type rhythm per v2 — kinetic word-by-word reveal. Respects `prefers-reduced-motion`.

**2.3** Signature element — picked NOW after Phase 1 visible. ASK with three previews:
- Kinetic type only (lowest risk, ships fastest).
- Editorial reel (real product footage). iOS-safe spec: `playsinline muted autoplay loop preload="metadata"`, NO audio track encoded, AV1 + h.265 dual sources, ≤800KB. Static poster is the LCP element. Falls back to poster on Low Power Mode + reduced-motion.
- 3D scene (R3F + drei). Lazy-loaded via `React.lazy` + `Suspense`. ≤300KB JS gzipped + ≤500KB assets. Static SVG of the rack is the LCP element; 3D upgrades after viewport intersect.

Audit pass 2 added explicit iOS + bandwidth handling — incorporated above.

**2.4** CTAs. Primary CTA = filled `accent`. Audit pass 1 caught the modal-Cal.com pattern flaw: Cal.com's iframe height-recalc fights Radix Dialog focus traps. **v3 uses Cal.com's own floating-popup mode** (their `<Cal calLink="..." />` with `floating={true}`) or a full-page sheet; not a centered Radix Dialog.

**2.5** Reduced-motion path: zero animation, static rendering, equivalent visual hierarchy. The site has to feel premium even at zero motion.

**2.6** Mobile premium pass (NEW). Audit pass 2 was right that `clamp()` and BrowserStack-checking aren't a mobile design plan. Specifics:
- Hero scale capped at `min(7vw, 64px)` on viewports ≤ 480px.
- Vertical-orientation video crop (different source, not same source object-fit cover'd).
- Motion budget halved on mobile (no kinetic word reveal; static fade-in instead).
- Two CTAs stack vertically with full-width touch targets (≥48px).

**2.7** Mid-build verification (NEW). End of day 1 Phase 2: Loom screencast of hero on iPhone + MacBook + an old Android. Sent to Jared. Gate: explicit "yes this is wow" before Phase 3 starts. Audit pass 2 finding — surfaces trust-gap risk early.

---

## Phase 3 — Supporting sections (~2 days, with v2 cuts walked back per audit)

v2 cut from 10 sections to 6 for restraint. Audit pass 2 caught two casualties of that cut:
- **Numbers** carried enterprise-buyer trust signals; CTOs scan numerically.
- **Process** said "we know how to ship"; matters for cloud build engagements.

v3 keeps both, but as **compressed** elements rather than full sections:

1. Hero (Phase 2)
2. Trust strip — logo wall + compliance badges + ONE numbers row inline (`99.9% uptime · $0 per-seat · weeks-not-months`). Numbers pulled from real data.
3. The thesis pillars — three columns (On-prem · Owned · Branded). Custom SVG icons (NOT lucide).
4. Flagship: In-House Cloud — single large card with the 13-services swipe carousel. **Mid-page CTA stays here** ("See the math →") to address audit pass 2 CTA-visibility risk.
5. Process — compressed to a single horizontal 4-step strip (Discovery → Architecture → Build → Onboard). One line per step. Was its own section in v1; v3 makes it a strip.
6. Proof — three product cards. Real screenshots at 2x.
7. Founder note + final CTA — B&W portrait, the longhand-written 2 paragraphs from 0.4, signed. Inline Cal.com floating popup.

So 7 sections in v3, each tighter. Restraint without dropping load-bearing trust signals.

---

## Phase 4 — Micro-interactions polish (~1 day, unchanged from v2)

House easing `cubic-bezier(0.32, 0.72, 0, 1)`. Hard cap 400ms on any animation. No custom cursor. Per v2.

---

## Phase 5 — Photography or illustration (parallel; hard deadline NEW)

Audit pass 2 caught: "soft blocker" with no deadline = soft slip. v3 adds:

**5.0 Hard decision deadline:** End of Phase 1. If shoot is not booked + scheduled by then, automatic switch to illustration path. No more waffling.

**5.1** If shoot: half-day, Pi rack + workspace + Jared portrait. Portrait alternates pre-decided (audit pass 2 risk):
- Hands-on-rack with face partial.
- Profile silhouette.
- Signature-only treatment with handwritten text scan.

**5.2** Strict edit: 3-5 finals, single color treatment, consistent.

**5.3** Illustration fallback: ONE custom SVG/Lottie that anchors hero or pillars. Single beautiful illustration > many mediocre stock images.

**5.4** Image perf: AVIF + WebP fallback, `loading="lazy"` everywhere except hero, srcset for 1x/2x/3x, alt text.

---

## Phase 6 — Pre-launch hardening (~1 day)

**6.1** Lighthouse CI green: Perf ≥95 desktop / ≥90 mobile, A11y ≥95, Best Practices ≥95, SEO ≥100.

**6.2** Real-device check: iPhone, iPad, MacBook, old Android. **Plus** every secondary page that inherited new tokens from Phase 1.3 (the homepage feeling premium is necessary but not sufficient — `/cloud`, `/contact`, Cookie Yeti pages need to hold up too). Audit pass 2.

**6.3** A11y pass: keyboard nav on every interactive, focus states visible, semantic HTML, aria-labels on icon buttons, color contrast WCAG AA body / AAA hero. Tested with VoiceOver.

**6.4** Privacy pass: no third-party analytics that phone home. Self-hosted Plausible OR no analytics at all on this page. Bestly's brand IS privacy.

**6.5** Backup snapshot: deploy current site to a `legacy/` route. Hash-pin the bundle so it can't drift.

**6.5b Rollback drill (NEW).** Actually navigate to `legacy/`, click around, verify it works. Document the one-line revert command in a README.md inside the legacy dir. The user has stated trust gaps; an undocumented rollback is no rollback.

---

## Phase 7 — Post-launch + iteration (~ongoing)

**7.1 Conversion measurement — A/B test, not before/after** (NEW from audit).
- 50/50 split via edge routing (Cloudflare Workers in front of Vercel works well).
- 14-day window minimum.
- Booked-call rate is the primary metric; secondary: time-on-page, scroll depth, CTA click rate.
- Pre-committed revert criterion: if v3 booked-call rate < 80% of legacy after 14 days, revert via Phase 6.5b drill.

**7.2** Two-week iteration window: 5 trusted reviewers (peers/customers/advisors). Tight punch list, ship fixes.

**7.3 Quarterly content refresh — with actual ritual** (NEW).
- Recurring BusyCal event "Bestly homepage refresh" every 90 days, 60 min, with `/docs/homepage-refresh-checklist.md` as agenda.
- Checklist: founder note still current? metrics still accurate? proof products still live? hero copy still sharp?
- Without the calendar event + checklist, this section is aspirational. With them, it actually happens.

---

## Approval gates (final)

ASK before:
- Phase 0.1 anchor positioning lock (default: keep current).
- Phase 0.1 photography budget commitment (Y/N + $).
- Phase 0.4 founder note (Jared writes longhand; ASK for the text).
- Phase 0.5 acceptance test pre-commit.
- Phase 2.3 hero motion option (with three previews after Phase 1).
- Phase 6.5 production cutover.

Auto:
- All Phase 1 token + font + perf-budget plumbing.
- All Phase 2-4 implementation work after motion/palette is locked.
- All Phase 6 hardening.
- Phase 7 measurement scaffolding.

---

## Risks (v3, all known)

| # | Risk | Mitigation |
|---|---|---|
| 1 | Wrong palette / motion choice | Phase 0.3 deferred until visible; mid-Phase-2 Loom verification gate |
| 2 | Photo shoot doesn't land | Phase 5.0 hard deadline + illustration fallback |
| 3 | Performance budget unrealistic with rich hero | Phase 1.4 softened to ≤2.5s desktop; bandwidth-aware downgrade |
| 4 | Site-wide inconsistency after homepage launch | Phase 1.3 token migration covers all pages |
| 5 | Mediocre copy under-mining premium visuals | Phase 0.4 + 1.6 copy gates |
| 6 | Mobile feels like "responsive default" | Phase 2.6 explicit mobile design pass |
| 7 | iOS autoplay / Low Power Mode breaks video hero | Phase 2.3 spec covers playsinline + saveData fallback |
| 8 | CTA visibility loss with WOW restraint | Phase 3 keeps mid-page CTA; floating Cal.com popup as Phase 2.4 |
| 9 | Conversion regression | Phase 7.1 A/B with revert criterion |
| 10 | Quarterly refresh never happens | Phase 7.3 BusyCal event + checklist file |
| 11 | Founder uncomfortable with portrait | Phase 5.1 alternates pre-decided |
| 12 | "WOW" undefined → can't tell when we're done | Phase 0.5 acceptance tests pre-committed |
| 13 | SEO regression from section trim | Phase 1.7 keyword check |
| 14 | Time estimate vs. real calendar | Reframed: 6-8 working days = 3-5 elapsed weeks given concurrent work |
| 15 | Cal.com modal pattern breaks | v3 uses floating-popup, not Radix Dialog |
| 16 | Trust gap from "looks done but isn't" | Phase 2.7 Loom verification before late phases |

---

## Realistic timeline

Audit pass 2 was right: "6-8 focused days" is fictional given Cookie Yeti incidents, Minutes work, MemPalace setup, Turo, daily life. Reframed:

- 6-8 working days = 3-5 elapsed weeks at typical concurrency.
- Phase 1 (foundations) is the highest-leverage; ship that in week 1 even if Phase 2+ drags.
- Phase 7.1's A/B test gives 14 more days of measurement post-launch before any decision is final.

Expect ~6 elapsed weeks from kickoff to "we know if it converted."

---

## What changed from v2 → v3 (recap for review)

| Pass 1 (correctness) | Fix |
|---|---|
| Navy on black contrast 1.6:1 | Two-tone accent: `#3a4a9c` for fills, `#7a8be0` for accent-on-dark text |
| "Oxford navy" misnamed | Renamed to "deep indigo" |
| LCP <2.0s unrealistic | Softened to ≤2.5s desktop / ≤3.0s mobile |
| Cal.com in Radix Dialog conflicts | Switched to floating-popup pattern |
| AnimatePresence + RR6 keying | Documented `useLocation().key` requirement |
| `framer-motion` install assumption | Explicitly NOT installed; Phase 1.5 installs it |
| Hero clamp top of 112px too large | Capped at 96px |

| Pass 2 (gaps) | Fix |
|---|---|
| No copy review | Phases 0.4 (founder note longhand) + 1.6 (copy gate) |
| No mobile premium plan | Phase 2.6 explicit mobile pass |
| Site-wide inconsistency risk | Phase 1.3 token migration site-wide |
| No A/B test, just before/after | Phase 7.1 50/50 edge split with revert criterion |
| Phase 0 too many ASKs | Reordered: lock 0.1 now, defer 0.3-0.4 until Phase 1 visible |
| iOS autoplay restrictions | Phase 2.3 spec includes playsinline / no-audio / saveData fallback |
| No bandwidth caps | Phase 1.4 budget table |
| Photo deadline missing | Phase 5.0 hard deadline + auto-fallback |
| CTA visibility risk | Phase 3 keeps mid-page CTA; Phase 2.4 floating popup |
| Founder portrait risk | Phase 5.1 alternates pre-decided |
| No "WOW landed" gate | Phase 2.7 Loom verification |
| Quarterly refresh aspirational | Phase 7.3 BusyCal event + checklist file |
| 6-8 day estimate | Reframed to 3-5 elapsed weeks |
| No definition of WOW | Phase 0.5 three acceptance tests pre-committed |
| SEO regression risk | Phase 1.7 keyword check |
| Founder note not drafted | Phase 0.4 longhand before Phase 2 |
| Numbers + Process cut too aggressively | Phase 3 keeps both as compressed elements |
| Rollback drill not exercised | Phase 6.5b actually navigates and tests |

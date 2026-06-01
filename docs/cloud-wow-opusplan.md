# Cloud WOW Opusplan — client-facing animation + modern look-and-feel

**Owner:** Jared · **Drafted:** 2026-06-01 · **Status:** proposed
**Scope:** every surface a prospective Bestly In-House Cloud customer touches, from the marketing page through the live status portal.
**North star:** a private-cloud company whose *own site* feels more polished than the SaaS tools it replaces. The medium is the message — "we sweat the details" sells "let us run your infrastructure."

---

## 0. Where we are (baseline)

Shipped in commit `1fdf455`: the `/cloud` hero now has an animated aurora background, a perspective infrastructure grid, drifting light-motes, scroll parallax, a flowing gradient headline, and the **ServiceOrbit** — a glowing on-prem server core with the 13 replaced services orbiting in two counter-rotating rings. Calculator fixed in `40e7f44`.

What we already own and should reuse rather than reinvent:

- **Tokens:** indigo gradient (`--gradient-start/end`), `--glow-color`, `bg-mesh`, `gradient-bg`, `glow/-sm/-lg`, `gradient-border` (in `src/index.css`).
- **Motion engine:** Tailwind keyframes (`float`, `float-slow`, `pulse-glow`, `gradient-shift`, `shimmer`) + the new `cloud-*` keyframes (aurora drift, grid-pan, twinkle, orbit, ping-ring, core-glow, beam) — all `prefers-reduced-motion`-gated.
- **Libraries:** `framer-motion@12` (installed), `lucide-react`, shadcn/ui, `AnimatedSection`, `GlowCard`, `GradientText`, `AnimatedCounter`.
- **Fonts:** Inter (body) + Newsreader (display serif) + Plus Jakarta Sans available.

So the foundation exists. This plan extends it consistently instead of bolting on one-off effects.

---

## 1. Design direction (from UI/UX Pro Max)

Query run: `"cloud infrastructure private server SaaS premium immersive enterprise" --design-system`. Verdict to hold us honest:

- **Pattern — Enterprise Gateway:** trust signals prominent, clear path-selection, "talk to us" primary. Spectacle must never bury the conversion path.
- **Style — Soft UI Evolution:** subtle depth, improved shadows, WCAG AA+, full light/dark. Our indigo identity stays; we layer motion on top.
- **Typography — Plus Jakarta Sans** for headings is endorsed (already in our stack). Consider promoting it on display headings for a more modern, less generic feel than Inter-only.
- **Explicit anti-patterns flagged:** *excessive animation* and *dark-by-default*. Translation: go hard on the **hero/visual layer**, stay calm on **forms and conversion copy**. Every animation must encode meaning (cause→effect), respect reduced-motion, and never block input.

**House motion rules (apply everywhere):**

- Micro-interactions 150–300ms; section transitions ≤400ms; nothing >500ms.
- `transform`/`opacity` only — never animate width/height/top/left.
- Spring/physics curves for natural feel; ease-out entering, ease-in exiting; exits ~60–70% of enter duration.
- Stagger list/grid reveals 30–50ms per item.
- One shared easing token set, globally. Reduced-motion disables or simplifies — tested, not assumed.

---

## 2. Phases

Each phase is independently shippable and behind the existing component structure. Effort is rough dev-hours.

### Phase 1 — Motion foundation (consistency layer) · ~3h
Make the rest of the plan cheap and uniform.

- Add a `MotionProvider`/tokens file: shared `ease`, `duration`, and a `useReveal()` hook wrapping `framer-motion` `whileInView` + `useReducedMotion` so every section reveals identically (replaces ad-hoc `AnimatedSection` over time, no rip-and-replace required).
- Add a `Reveal` and `Stagger` wrapper component pair (parent staggers children 40ms).
- Promote Plus Jakarta Sans (or Newsreader for editorial moments) on h1/h2 display headings via a `.font-display` audit.
- **Acceptance:** one import gives any section scroll-reveal + reduced-motion safety; Lighthouse perf unchanged.

### Phase 2 — Marketing `/cloud` depth pass · ~5h
The hero is done; bring the rest of the page up to its level.

- **"Thirteen services" grid:** cards lift + gradient-border ignite on scroll-in with stagger; a faint connecting beam animates from each card toward the section title (echoes the orbit metaphor).
- **Pillars / Process / Objections:** `Stagger` reveals; number badges (`01–04`) count/draw in; on hover, GlowCard tilts subtly (3–4° max, spring).
- **Stats strip:** already counts up — add a one-time shimmer sweep across the numbers when they enter.
- **Calculator:** animate the savings figure with a rolling-number transition on change; pulse the "back in your pocket" pill when it appears.
- **Scroll-progress accent:** a thin gradient progress bar pinned to top (the `cloud-beam` palette).
- **Acceptance:** every section has intentional entrance motion; CLS < 0.1; reduced-motion renders fully static and readable.

### Phase 3 — "Living server" signature moment · ~6h
A reusable showpiece that becomes the brand's visual signature.

- Promote **ServiceOrbit** into a configurable `<LivingServer>` (ring count, speed, label set, size) reused on `/cloud`, `/get-started`, and the live-status portal.
- Add optional **WebGL-free 3D feel**: CSS 3D transforms + parallax-on-pointer (orbit tilts toward cursor), data-packet motes that travel along orbit paths into the core (sells "everything flows to your box").
- A "boot sequence" entrance: core powers on (glow ramp), rings spin up to speed, labels snap in staggered.
- **Acceptance:** 60fps on a 2020 MacBook Air; pointer-parallax disabled on touch + reduced-motion; one component, three placements.

### Phase 4 — Page transitions + funnel polish · ~5h
Make the *journey* feel like one product, not separate pages.

- Route transitions via `framer-motion` `AnimatePresence` (directional slide/fade, shared-element continuity on the logo/CTA). Forward = left/up, back = right/down.
- `/get-started`, `/brief/:token`, `/intake/:token`: inputs get focus-glow, inline validation animates in (no layout shift), multi-step progress bar with spring fill, success states with a check-draw animation.
- Buttons: unify on a single press-scale + glow token.
- **Acceptance:** no white flashes between routes; forms feel responsive (<100ms feedback); keyboard + screen-reader order preserved.

### Phase 5 — The live-status "wow" (retention/referral moment) · ~5h
`CustomerStatusView` is where a paying customer watches their cloud get built — highest emotional leverage, currently functional-only.

- Build-progress as an **animated pipeline** (the 8 stages as a glowing track that fills; current stage pulses; completed stages lock with a check-draw).
- Shipping ETA with a subtle moving-truck/route motif; install date as a calendar flip.
- **"You're live" celebration** at Stage 8: a tasteful one-shot confetti-of-light + the `<LivingServer>` doing a victory spin, fired once and remembered (no replay on every 60s refresh).
- **Acceptance:** celebration fires exactly once; auto-refresh never re-triggers animations; reduced-motion shows a calm static "Live" state.

### Phase 6 — QA, performance, accessibility gate · ~3h
Non-negotiable before each phase ships.

- Test at 375 / 768 / 1024 / 1440; portrait + landscape.
- Verify with reduced-motion ON and Dynamic Type at max.
- Lighthouse: Perf ≥ 90, CLS < 0.1, no long main-thread tasks from animation.
- Contrast AA in light *and* dark independently.
- Subagent verification pass + screenshot diffs on the three signature surfaces.

---

## 3. Guardrails (so spectacle doesn't cost us deals)

- **Conversion first:** CTAs, pricing, and form copy stay calm and instantly legible. Motion accents them, never competes.
- **Performance budget:** animation must not push the `/cloud` route's JS or main-thread budget into jank. Prefer CSS keyframes; reach for framer-motion only where it earns it.
- **Accessibility is a release gate, not a nice-to-have:** every effect ships with a reduced-motion path and AA contrast in both themes.
- **One vocabulary:** all new motion uses the shared tokens from Phase 1. No bespoke durations/easings per page.
- **Brand voice intact:** privacy-first, plain-spoken, anti-big-tech, no emoji on customer surfaces (per `CLAUDE.md`).

---

## 4. Sequencing & estimate

Recommended order: **1 → 2 → 3 → 5 → 4 → 6 per phase.** Phase 1 unblocks everything; Phase 2 is the fastest visible win; Phase 3 creates the reusable signature; Phase 5 is the highest-leverage emotional moment; Phase 4 ties the journey together.

Total: **~27 dev-hours** (~3–4 focused days). Each phase commits + pushes independently to `main` (Vercel auto-deploys), so value ships continuously and any phase can stand alone.

## 5. Open decisions for Jared

1. **Scope:** marketing `/cloud` only, or the full funnel (Brief / Intake / live status) as written here?
2. **Display font:** promote Plus Jakarta Sans / Newsreader on headings, or keep Inter-only?
3. **Pointer-parallax 3D** on the living server — tasteful signature, or one step past "boring `.com`"?
4. **Celebration intensity** on "you're live" — full light-confetti, or restrained glow-pulse?

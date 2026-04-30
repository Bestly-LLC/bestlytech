# bestly.tech homepage — blue-chip redesign plan

**Date:** April 28, 2026
**Target:** Enterprise / mid-market buyers (CTOs, COOs, IT leaders)
**Single conversion goal:** Book a 30-min discovery call
**Visual reference blend:** Anthropic / Apple / Brex (premium restraint) × Lovable / Cursor / Webflow (motion + interactivity)

---

## 1. Strategic positioning (the most important decision)

The current site claims many things at once: product studio, services consultancy, Tesla rentals, hiring page. For an enterprise buyer who lands on a sales-call homepage, that reads as unfocused. **Pick one anchor and let everything else become evidence for it.**

**Recommendation: Lead with In-House Cloud as the headline thesis.** It's the highest-ticket, most differentiated, most defensible offer. The other surfaces become *proof that we ship and run our own infrastructure*.

Three taglines worth A/B-ing:

1. **"The cloud that lives in your office."** *(concrete, memorable, on-message)*
2. **"Privacy-first infrastructure for teams that need it."** *(plain, enterprise-coded)*
3. **"Your stack. Your data. Your terms."** *(rhythmic, confident, slightly aggressive)*

Subhead establishes credibility:

> *Bestly is a product studio that builds and operates its own private cloud. We'll build yours.*

That single sentence resolves the studio-vs-cloud-vendor confusion and turns "multi-vertical studio" from a liability into proof.

---

## 2. Information architecture — single-page homepage

Section flow tuned for enterprise scan-then-scroll behavior:

1. **Hero** — Kinetic display type, scroll-tied 3D server / data illustration, primary CTA "Book a Discovery Call", secondary "Email jared@bestly.tech"
2. **Trust strip** — Logo wall (real customers if any; "trusted by teams at" framing), three compliance badges (GDPR / HIPAA / SOC 2 in progress / CCPA), small *"$X saved across Y deployments"* metric line
3. **The three pillars** — On-prem · Owned · Branded. Each with one icon, two-line claim, no fluff.
4. **The flagship: In-House Cloud** — Interactive section with a "swipe through 13 services" animated card stack (the same content from `/cloud` but presented as a more sophisticated explorer). Sticky CTA: "See the math →" links to `/cloud`.
5. **Proof we ship** — Three product cards: Cookie Yeti (privacy-first browser extension, 200K+ malicious domains blocked), InventoryProof (compliance), HOKU (consumer hardware). Framing: "We dogfood. These are ours."
6. **Numbers** — Animated counters that mean something: 99.9% uptime, $0 per-seat fees, weeks-not-months deployment. Pulled from real ops data, not aspirational.
7. **Process** — 4-step (Discovery → Architecture → Build → Onboard). Already exists at `/cloud`, condensed here.
8. **Founder note** — Real photo of Jared, two paragraphs, signed. Premium-brand convention; converts at higher rates than anonymous corporate copy on enterprise sites.
9. **Final CTA band** — Calendar embed (Cal.com or Calendly inline) + email fallback. No form gates.
10. **Footer** — Restrained: company info, three product links, two legal links, contact. No newsletter signup, no social spam.

What's missing on purpose: Tesla Rentals (brand-confusion for enterprise — moves to its own subdomain or a sub-nav). The general "Services" page (collapses into Cloud or removed). Hire Me (separate page, off main nav for enterprise). Press Kit (sub-nav).

---

## 3. Visual language

### Typography
- **Display:** Plus Jakarta Sans is fine for body but feels tech-modern, not premium. Pair with a **serif display face** for hero/section titles — *Tiempos Display*, *PP Editorial New*, or *Newsreader* (free). One serif × one geometric sans is the Anthropic / Brex move.
- **Type scale:** larger and more confident at the hero (clamp(48px, 7vw, 112px)). Tighter line-height than current.
- **Italic + serif as editorial accent** for pull-quotes and section eyebrows.

### Color
- Keep dark theme as default but lean cleaner: pure off-black `#0a0a0a` field, `#fafafa` text, restrained accent.
- Add a **premium accent**: deep oxford navy `#1a2766` for CTAs and underlines (warmer than the current generic violet gradient).
- Optional warm cream `#f5f1e8` for editorial moments (Anthropic ships in beige; works well).
- Drop the violet/pink gradient for hero text. Replace with a single tonal shift or solid-on-solid.

### Motion (the WOW lever)
- **Hero element:** Three.js or Spline scene of a stylized server / data flow that responds to scroll. As the visitor scrolls, the server "transforms" into the In-House Cloud network. ~30-45 sec of micro-storytelling, no narration needed.
- **Section transitions:** Framer Motion staggered children, 8% opacity fades, 12px translateY. Restrained, never bouncy.
- **Type reveal:** kinetic word-by-word reveal on hero title (Webflow/Cursor convention).
- **Cursor:** subtle blob-glow follow on the hero only. No site-wide cursor effects (overplayed).
- **Scroll progress:** keep the existing `<ScrollProgress />` but make it 1px and the brand accent.

### Imagery
- Replace stock with **real photography** of: the actual Pi server rack (intentionally crafted shot, not a candid), a clean office moment, a single signature product hero shot.
- One photo of Jared, B&W or warm tone, not a corporate headshot — editorial portrait.
- Custom illustrations for the three pillars (commission or generate; Lottie or static SVG).

---

## 4. Tech stack additions

The current Vite + React + TypeScript + Tailwind + shadcn base is correct for this. No framework change. Add:

| Need | Library | Notes |
|---|---|---|
| Section motion + scroll-tied animation | `framer-motion` | already installed in dependencies (verify); use it more liberally |
| 3D hero element | `@react-three/fiber` + `@react-three/drei` | OR import a Spline scene if we want WYSIWYG editing |
| Light Lottie accents | `lottie-react` | only if we have animated assets to ship |
| Calendly / Cal.com embed | `react-calendly` or `@calcom/embed-react` | for inline scheduler in final CTA |
| Better fonts | self-host Plus Jakarta Sans + chosen serif via `@fontsource` | drop Google Fonts CDN; faster + privacy-aligned |

Performance budget:
- LCP < 2.0s desktop, < 2.5s mobile
- CLS < 0.05
- The 3D hero must lazy-load and have a static SVG fallback for first paint

---

## 5. Phased delivery

### Phase 1 — Quick wins (1–2 days)
Goals: tighten the existing site so it feels intentional even before the WOW lift.

- New copy on hero ("The cloud that lives in your office." or chosen direction)
- Trust strip added (compliance badges + metric line)
- Footer restraint pass — drop bloat
- Remove Tesla Rentals from primary nav (not the route — just the nav)
- Self-host fonts; drop Google Fonts CDN
- Single CTA throughout: Calendar embed link
- Spacing + type-scale audit; loosen the dense sections

### Phase 2 — The redesign (3–5 days)
Goals: the WOW.

- Hero element built (Three.js or Spline)
- Editorial display serif paired in
- Color refresh (oxford navy accent)
- Animated counter numbers with real ops data plumbed in (uptime, savings)
- Founder section with real photo + signed paragraphs
- Three pillars with custom illustrations
- "Swipe through 13 services" interactive card stack
- Scroll-tied transitions across sections
- Inline calendar embed in final CTA

### Phase 3 — Stretch (1–2 days)
Goals: the depth that closes deals.

- Case study page or two (even one detailed deployment story is enough)
- Press kit page (downloadable assets, founder bio, brand colors)
- `/customers` page with logo grid + quotes
- Live "stack" demo interactive (drag services around, see the ROI calc update)

---

## 6. What I need from you to start

Required:
- **A real "book a call" URL.** Cal.com / Calendly / Savvycal — pick one and share the link.
- **Customer / partner logos**, even if we mark them "in trust" or anonymized. If there are zero customers, we say "Currently in private beta with N partners" and skip the wall.
- **Real metrics**: uptime %, $ saved (estimated is fine), team sizes deployed to. Even ranges.
- **Compliance status check**: GDPR/CCPA we know we're aligned with; what's our actual SOC 2 / HIPAA posture? Don't claim what we don't have.
- **Approved founder photo**.

Nice-to-have:
- **Press mentions** to feature.
- **Brand assets** if there's a brand book; otherwise we define a small one as we go.
- **Domain decision on Tesla Rentals** — keep on bestly.tech or move to its own subdomain?

---

## 7. What I'd push back on

- **"Build Different. Build Better."** as the hero — this is a generic studio tagline. Enterprise buyers want specificity (what you do, who you do it for, why it's defensible). Replace.
- **Tesla Rentals on the primary nav** — actively confusing for enterprise buyers. Move to subdomain or sub-nav.
- **Multiple products on the homepage as equals** — diffuses focus. Cookie Yeti / InventoryProof / HOKU become proof points, not headliners.
- **Violet-pink gradient on hero text** — feels 2023 SaaS-template. Drop for restrained tonal shift.
- **Cookie consent banner copy** — currently corporate-legal-flavored. A privacy-first brand should say less and mean more here. Two sentences max.

---

## 8. The single sentence that makes this work

If I had to compress the plan to one sentence: *Make the homepage feel like a confident enterprise vendor that happens to be a product studio, instead of a scrappy product studio that happens to also sell cloud.* Everything else flows from that.

---

*Next step: pick a tagline direction from §1, hand over the artifacts in §6, and I'll start Phase 1 in a fresh branch.*

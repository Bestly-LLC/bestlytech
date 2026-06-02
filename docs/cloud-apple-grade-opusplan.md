# Apple-grade /cloud Opusplan — "AirPods-page level"

**Owner:** Jared · **Drafted:** 2026-06-02 · **Status:** proposed
**Goal:** bring `bestly.tech/cloud` to the production quality of [apple.com/airpods-4](https://www.apple.com/airpods-4/) — scroll-cinematic, product-led, unmistakably premium.
**Reality check up front:** Apple ships that page with a film crew, a 3D/CGI studio, and a front-end team. We can get **90% of the feel** with a smart asset pipeline + the right libraries. This plan is staged so we ship an "Apple-lite" win fast, then deepen it.

---

## 0. What actually makes the AirPods page elite (from teardown)

Fetched and dissected the live page. The magic is five repeatable techniques, not one:

1. **Scroll-scrubbed hero video.** The hero is a video with a `startframe`/`endframe`; as you scroll, playback scrubs frame-by-frame (the product assembles/rotates on your scroll, not on a timer).
2. **A product film** ("Get the highlights" → an `.m3u8` stream) — a 30–60s cinematic the user can play.
3. **AR "View in your space."** A `.usdz` model lets you drop the actual product onto your desk via your phone.
4. **A bento close-up gallery** — tight, beautifully-lit macro shots of the product in an asymmetric grid.
5. **Pinned story sections.** Each capability gets a full-viewport scene: a big hero image/short video, one bold line, choreographed text reveals as you scroll through it. Generous negative space, big editorial type, scenes alternating dark/light.

Everything rides on **buttery smooth scroll** and **GPU-cheap transforms**.

---

## 1. Where we are vs. that bar

We're already strong on motion *systems* (framer-motion, the LivingServer, scroll progress, reveals). The gap is **content fidelity**: we have no photoreal product asset, no scroll-scrubbed sequence, no AR, no cinematic film. Apple's page is carried by **world-class renders of the object**. Our "small device" needs to look like a hero.

**The single highest-leverage thing we lack: a beautiful, controllable visual of the Bestly device.** Solve that and the rest is front-end choreography we can do.

---

## 2. The big decision — how we get the product visual

This is the fork everything hangs on. Three paths (recommend a hybrid):

| Path | What it is | Pros | Cons | Tools |
|---|---|---|---|---|
| **A. 3D render (Blender)** | Model the device once; render a turntable **image sequence** (120–180 frames) for scroll-rotation, hero beauty shots, bento macros, and export **USDZ/GLB** for AR. | Apple-authentic; total control; reusable; enables AR "view on your desk"; consistent geometry | Modeling + lighting effort; render time | **Blender MCP** (we have it) |
| **B. AI cinematic (Higgsfield / video-gen)** | Generate a cinematic hero film + lifestyle b-roll (device glowing on an office shelf, data motes, etc.) and AI product stills. | Fast; gorgeous, filmic; great for the "film" + lifestyle scenes | Hard to keep the *exact* device consistent shot-to-shot; no AR; less precise | **Higgsfield** (external) and/or our in-house media MCP (`generate_image` / `generate_video`) |
| **C. Real photography** | Photograph/video the actual hardware. | 100% authentic; cheapest | Needs a shoot + lighting; a small box may not read "premium"; no scroll-rotation/AR without rig | a camera + light tent |

**Recommendation — Hybrid (A for the product, B for the world):**
- **Blender** for the things that must be precise and reusable: the hero **turntable sequence** (scroll-scrubbed rotation), **bento macro** renders, and the **USDZ/GLB** for AR.
- **Higgsfield / AI video** for the **cinematic film** and **lifestyle scenes** (the device glowing on a clinic shelf, "your data coming home"), plus AI stills for environments/textures.
- This mirrors how Apple actually works: CGI product + filmed/comp'd world.

---

## 3. Tech stack we'd add

- **Lenis** — smooth, inertial scroll (the foundation of the Apple feel). ~3kb.
- **GSAP + ScrollTrigger** — the industry-standard for pinned sections + scroll scrubbing. (Now fully free, incl. ScrollTrigger.) We'll use it for pinning and frame-scrubbing; keep framer-motion for component-level motion.
- **Canvas frame-scrubber** — preload the Blender image sequence and `drawImage` the frame matched to scroll progress (exactly Apple's hero technique).
- **`<model-viewer>`** (Google, web component) — drop-in AR/3D viewer for the GLB/USDZ "View on your desk."
- **Responsive media pipeline** — AVIF/WebP, multiple resolutions, `loading="lazy"`, preload only the hero sequence; reduced-motion serves a single static hero frame.

All additive; none disturb the rest of the site.

---

## 4. Phased plan

### Phase 0 — Asset pipeline (unblocks everything) · ~1–2 days
- Model the Bestly device in **Blender** (clean, Apple-style studio lighting, soft shadows, indigo rim light).
- Render: (a) a **180-frame turntable** at 2–3 resolutions, (b) 4–6 **bento macro** hero stills, (c) export **GLB + USDZ** for AR.
- Generate, via **Higgsfield/AI**: a 20–40s **cinematic film** + 3–4 **lifestyle scenes**.
- **Acceptance:** a folder of production-ready, optimized assets.

### Phase 1 — Smooth-scroll + scroll-scrubbed hero · ~2 days
- Add Lenis + GSAP. Rebuild the hero as a **scroll-scrubbed turntable**: the device rotates/powers on as you scroll into the page; headline holds, then releases.
- **Acceptance:** 60fps scrub on a 2020 MacBook Air; reduced-motion shows a static hero; mobile falls back to fewer frames.

### Phase 2 — Pinned story scenes · ~3 days
Rebuild the core narrative as full-viewport pinned scenes, Apple-style:
- **"Your data comes home"** (privacy) — dark scene, device glows, data motes converge.
- **"Thirteen services. One small device."** — the convergence hub becomes a pinned, scroll-driven assembly.
- **"It runs itself."** — self-healing/uptime, calm light scene.
- **"Own it."** — pricing/ROI reveal.
- **Acceptance:** each scene pins + choreographs cleanly; no layout shift; reduced-motion degrades to stacked static sections.

### Phase 3 — Bento gallery + AR "View on your desk" · ~1.5 days
- Bento macro grid of the device (the Phase 0 renders), Apple-style asymmetric layout.
- `<model-viewer>` "View in your space" button → USDZ on iOS, GLB on Android. A dentist literally places the box on their counter.
- **Acceptance:** AR launches on iOS/Android; gallery is responsive and crisp.

### Phase 4 — The film + sound/polish · ~1.5 days
- "Watch the film" lightbox player with the Higgsfield/AI cinematic.
- Editorial type pass (bigger display scale, more negative space), scene-to-scene color rhythm (dark→light), final CTA moment.
- **Acceptance:** plays inline, captioned, lazy-loaded.

### Phase 5 — Perf / a11y / QA gate · ~1 day
- Lighthouse ≥ 90 (image sequences are the risk — budget, preload, responsive); CLS < 0.1.
- Full `prefers-reduced-motion` path (static frames, no pinning); keyboard + SR order; AA contrast in every scene.
- Test 375 / 768 / 1024 / 1440 + mid-tier Android.

**Total: ~10–11 focused days** (most of it Phase 0 assets + Phase 2 scenes). Each phase ships independently to `main`.

---

## 5. Guardrails & honest expectations

- **Performance is the #1 risk.** Scroll-scrubbed sequences are heavy. We hard-budget frame counts/resolutions and always ship a reduced-motion static fallback.
- **Product fidelity makes or breaks it.** If the device render isn't beautiful, no amount of scroll polish saves it — Phase 0 is where the money is.
- **Keep the conversion intact.** Apple still sells: clear CTAs, specs, compare. Our calculator + Get Started must stay first-class, not buried under cinema.
- **Brand stays Bestly** — privacy-first, plain-spoken, indigo. We borrow Apple's *technique*, not its look.
- **Scope honesty:** this is a 2-week-class effort, not an afternoon. Phase 1 alone (scrubbed hero) already reads as a huge jump — good place to prove it before committing the full arc.

---

## 6. Tools — what's in hand vs. what we'd add

- **In hand:** Blender MCP (modeling + render), in-house media MCP (`generate_image` / `generate_video`), framer-motion, the existing motion engine.
- **Add (free/open):** Lenis, GSAP+ScrollTrigger, `<model-viewer>`.
- **Optional external:** **Higgsfield** for the cinematic film/lifestyle b-roll (strongest filmic output); alternative is our in-house video-gen. Real photography if we'd rather shoot the actual unit.

---

## 7. Open decisions for Jared

1. **Product-visual path:** Hybrid (Blender product + AI/Higgsfield world) — approve, or prefer all-AI, or a real photo/video shoot?
2. **AR "View on your desk":** worth it? (High wow for "small device," moderate effort.)
3. **The film:** generate with Higgsfield, our in-house video-gen, or skip for v1?
4. **Start point:** want me to prove it with **Phase 1 (scroll-scrubbed hero)** on a placeholder render first, before committing to the full 2-week arc?

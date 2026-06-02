# /cloud Hero Device — Photo-Match Plan + Self-Audit Loop

**Goal:** the hero device render matches the reference product photo (finned aluminum Pi-class enclosure, lid lifting to reveal board/fan/GPIO) **near-perfectly**, then animates the lid-lift + rotation on scroll.
**Drafted:** 2026-06-02

---

## The honest constraint (why tool choice matters)

- **Real-time WebGL (what's live now) cannot match a photograph.** No textures/HDRI/ray-tracing → it always reads as clean CG. Iterating it forever still plateaus below "exactly like the photo."
- **The sandbox can't auto-screenshot the web render.** It's ARM64; the headless Chromium that downloaded is x86-64 and won't launch. So an autonomous *WebGL* audit loop isn't available here either.
- **The tool that BOTH reaches photoreal AND lets me see my output to self-audit is Blender** (Cycles render → I view the image via the MCP → compare → iterate). That's the only path that can satisfy "near-perfect match" *and* the "audit yourself, keep working" requirement.

So the recommended path is Blender. It needs the BlenderMCP add-on server started once (Blender → N-panel → BlenderMCP → Connect/Start, port 9876).

---

## Reference breakdown (the spec — captured regardless of tool)

**Form factor**
- Two-piece aluminum enclosure, **exploded**: finned heatsink **lid** floating above a **base tray**.
- Lid: tall block, **deep parallel fins** running front→back across the top; smooth side skirts; softly rounded top edges; **4 corner mounting ears** with screw holes at the top corners; an **embossed wordmark** on the front skirt.
- Base: stepped/tiered tray, slightly wider at the bottom lip; rounded corners.

**Internals visible when lid lifts**
- Dark/green **PCB**.
- **Black fan** (round, offset toward one side) with a fine blade/grille.
- A small **wire harness** (red/black) from fan to a board connector.
- **Gold GPIO pin header** (double row) along one edge.
- A secondary **fin/heatsink** block on the board.
- **USB-C** port + a slot on the right/front edge.

**Materials**
- Body: **dark gunmetal aluminum**, satin (not chrome) — mid metalness, soft anisotropic-ish specular.
- Fan: matte black plastic. Pins: polished **gold**. PCB: dark green, low gloss.

**Lighting / scene**
- Soft **studio key from upper-left**, gentle fill, large soft highlights along the fin edges.
- **Seamless near-white background**, soft contact shadow beneath the base.

**Camera**
- ~35mm, **3/4 view from front-left, slightly above**; device rotated ~25–30°.

---

## Self-audit loop (what "keep working until near-perfect" means)

1. Build/adjust the model (geometry → materials → lighting → camera) in Blender.
2. **Render** a still at the reference camera angle.
3. **View the render and score it** against the photo on: silhouette/proportions, fin count+spacing, corner ears, internals layout, material read, lighting, background. Note the top 3 deltas.
4. Fix the top deltas. Re-render. Repeat until the score stops improving (near-perfect).
5. Once the still matches: render the **lid-lift + rotation as an image sequence** (~120 frames).
6. Wire the sequence into the web hero as a **scroll frame-scrubber** (Apple's technique) → photoreal **and** the animation you already liked.

This loop is fully auditable because I can see each Blender render and compare it myself.

---

## Fallbacks if Blender stays unavailable

- **B — Autonomous WebGL polish:** I attempt a sandbox-native offscreen GL renderer (headless-gl) to self-audit and push the *stylized* device as close as real-time allows. Honest ceiling: clean CG, not photo-exact.
- **C — Licensed photo/asset:** use a real product photo or a purchased 3D model of the enclosure. Fastest path to "exact," but it's not our own render and has licensing considerations.

---

## Decision needed
1. **Path:** Blender photoreal (recommended) · WebGL polish loop · licensed photo/asset?
2. If Blender: start the MCP add-on and say go — then I run the loop autonomously until near-perfect, then ship the frame-scrubbed photoreal hero.

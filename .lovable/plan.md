
Fix the homepage icon system by replacing the current “What We Build” artwork with genuinely transparent, softer, Apple-style assets and lightly refining how they sit inside the cards.

1. What I found
- The glossy icons are currently only used in `src/pages/Index.tsx` inside the “What We Build” grid.
- The hero no longer renders the floating icon cluster, so this is now a focused homepage-grid asset problem.
- The current issue is mostly the image files themselves: they read as candy-like, too sharp, and likely include baked background/matte contamination instead of clean alpha.

2. Replace all 6 assets with new transparent masters
- Recreate:
  - `src/assets/glossy-apps.png`
  - `src/assets/glossy-ai.png`
  - `src/assets/glossy-extension.png`
  - `src/assets/glossy-consumer.png`
  - `src/assets/glossy-physical.png`
  - `src/assets/glossy-ecosystem.png`
- Use the uploaded reference as the strict visual target:
  - soft rounded edges
  - translucent resin/glass feel
  - subtle internal depth
  - restrained highlights
  - refined color glow
  - no candy coating
  - no sharp gem-like cuts
- Generate each icon individually, not as one generic set, so each one gets tighter art direction.
- Require true transparency: no dark backdrop, no vignette square, no gray/black matte halo around edges.

3. Improve the icon concepts so they feel intentional
- Apps & Platforms: rounded layered tile/grid form
- AI & Automation: soft luminous intelligence motif
- Browser Extensions: curved tab/ribbon-like object
- Consumer Tech: cleaner everyday-tech form, less toy-like
- Physical Products: complete redesign with softer volume and better silhouette
- Connected Ecosystems: interlocking rounded forms, not shards

4. Slightly refine how the icons are presented in code
- Keep the existing card layout and section structure in `src/pages/Index.tsx`.
- Adjust the image wrapper/classes only if needed so the new transparent assets read correctly:
  - cleaner sizing
  - softer shadow treatment
  - optional subtle radial glow behind the icon inside the card
- Do not re-add icons to the hero.

5. QA before finalizing
- Check every icon against both dark and light backgrounds to confirm the transparency is real.
- Reject any icon with edge fringing, boxed backgrounds, or muddy halos.
- Verify the six icons feel like one premium family: same lighting logic, softness, polish, and restraint.
- Pay extra attention to `glossy-physical.png`, since that is currently the weakest one.

Technical details
- Main code file: `src/pages/Index.tsx`
- Main work: replace the 6 `src/assets/glossy-*.png` files
- Optional polish: small wrapper/class adjustments around the `<img>` in the “What We Build” cards if the new transparent assets need cleaner staging

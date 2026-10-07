# Opusplan: one Studio UI for every project

Written 2026-10-06 9:30 PM PT (Opus) for a Sonnet agent. Owner: Spark.

Jared, 2026-10-06 9:22 PM: "there's some errors when trying to look at the HOKU section ... it keeps reverting to the
older UI. Can we just make it the new UI? the same one that we're using with Elizabeth ... standardize that and make
that the same for all projects, everything in the studio."

## What we know before starting
- Every route on studio.bestly.tech serves the same ~8 KB loader (checked /, /centering-you, /cy, /hoku,
  /inventoryproof, /cookie-yeti, /bestly-cloud, /bestly-studio, /listings, /re-demo, /demo-two). The loader boots the
  `studio_builds` row with status 'live' (studio_boot / studio_live_manifest). So the old UI is not an old deploy at a
  different URL: it is a code path INSIDE the live app (or a stale cache) that some projects take.
- The projects split by `approval_clients`: Centering YOU, bestly-test, demo-two, listings, re-demo are kind 'client',
  guide_only false. HOKU, InventoryProof, Cookie Yeti are kind 'house', guide_only TRUE. Bestly Cloud and Bestly Studio
  are kind 'house', guide_only false. HOKU, InventoryProof and Cookie Yeti have client_brand rows; the two Bestly ones
  don't. Prime suspects: branches on `kind === 'house'`, `guide_only`, a missing client_brand/theme, or posts made by the
  daily Pi writers (no slides/variants/version rows) falling back to a legacy renderer.
- Cookie Yeti and Centering YOU both use code_prefix 'CY'. Post numbers can collide (CY07 could be either). Fix it.
- Other Claude sessions ship Studio builds tonight (e.g. 83e95fa0 queue columns, 8:27 PM). Always build on the
  current live row and re-check it right before shipping.

## Read first (bestly_memory, area 'studio' and root keys)
`handoff`, `ship/protocol` (or `studio/protocol`), `studio/house-rules`, `builder-preview-branching`, the latest
`studio/*` build notes. Ship only by the protocol: new studio_builds row from the live base, preview, verify, flip.

## Steps
1. Reproduce. Open staff Studio as Jared would (staff token via the existing test/staff method the build notes use;
   never print tokens) with Playwright at desktop and phone sizes. For EVERY active project (centering-you, hoku,
   inventoryproof, cookie-yeti, bestly-cloud, bestly-studio, bestly-test, re-demo, demo-two): open the queue, open one
   post of each type it has (video, carousel, single image), screenshot, and capture console errors. Do the same for
   the client board route of each. Write down every place a project looks or behaves differently from Centering YOU,
   with the code line that causes it.
2. Fix at the root. One UI path for every project: the Centering YOU (new) layout for queue, post detail, Your call,
   notes, decisions, versions, asks, inbox. Remove or redirect the legacy branches instead of patching them per
   project. Keep real per-project BEHAVIOUR that is data, not looks (auto-post vs review, claim gates, sell-the-product
   rule only where product_terms exist): drive it from data on the one UI, never from a second layout.
   Missing data must not drop a project into old UI: give the new UI sensible defaults (theme, brand, no slides,
   no variants, no versions).
3. Any console error found in step 1 gets fixed or explained.
4. Code prefix: give Cookie Yeti its own prefix (e.g. 'CK'), renumber nothing that is already posted publicly unless
   safe; at minimum future posts stop colliding. Record migration.
5. Design pass: load the apple-design skill, then ui-ux-pro-max (CLAUDE.md rule). Jared's UI rules: nothing cut off
   with "...", a number never wraps away from its unit, no new emoji.
6. Verify on the preview: the step-1 screenshot matrix again, every project now matches Centering YOU's layout,
   zero page errors, client boards still work for Centering YOU (Elizabeth) exactly as before. Then ship (row flip),
   confirm exactly one live row and that all routes still serve the loader, and repeat a quick check on live.
7. Guard so it stays fixed: add a check to the existing UI contract (`studio_ui_contract_check`) or the drift watcher
   that loads one HOKU post and one Centering YOU post and fails if the layout markers differ. It reports to Scout,
   signed by its owner.
8. Write the build note to bestly_memory (area 'studio', new key 'studio/one-ui-2026-10-07'), with rollback = flip the
   previous live row back.

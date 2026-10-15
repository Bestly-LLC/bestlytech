# Studio take review (2026-10-15)
Plan: docs/studio-take-review-opusplan.md. `patch_index.py` / `patch_board.py` are exact-once patches on the live
`index.html` / `board.html` (usage: `python3 patch_X.py live.html new.html`). `qa_preview.mjs` is the Playwright check
used on the preview build (staff take card, her re-record card; needs a throwaway staff session and sandbox asks on bestly-test).

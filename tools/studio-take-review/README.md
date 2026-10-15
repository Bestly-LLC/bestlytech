# Studio take review (2026-10-15)
Plan: docs/studio-take-review-opusplan.md. `patch_index.py` / `patch_board.py` are exact-once patches on the live
`index.html` / `board.html` (usage: `python3 patch_X.py live.html new.html`). `qa_preview.mjs` is the Playwright check
used on the preview build (staff take card, her re-record card; needs a throwaway staff session and sandbox asks on bestly-test).

## Follow-up 2026-10-15: send back to her on any take, YouTube spelling
`patch_index2.py` / `patch_board2.py` are exact-once patches on the build that shipped take review
(index 916eb6141e, board bba91cdd14). Migration `20261015150000_studio_send_back_any_take.sql`.
Live row b3882262-b1f2-4d94-ae61-ecacecf99563; rollback row 61a79457-5806-44a3-abd9-c06ef2406a88.

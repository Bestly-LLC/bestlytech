# Studio take review (2026-10-15)
Plan: docs/studio-take-review-opusplan.md. `patch_index.py` / `patch_board.py` are exact-once patches on the live
`index.html` / `board.html` (usage: `python3 patch_X.py live.html new.html`). `qa_preview.mjs` is the Playwright check
used on the preview build (staff take card, her re-record card; needs a throwaway staff session and sandbox asks on bestly-test).

## Follow-up 2026-10-15: send back to her on any take, YouTube spelling
`patch_index2.py` / `patch_board2.py` are exact-once patches on the build that shipped take review
(index 916eb6141e, board bba91cdd14). Migration `20261015150000_studio_send_back_any_take.sql`.
Live row b3882262-b1f2-4d94-ae61-ecacecf99563; rollback row 61a79457-5806-44a3-abd9-c06ef2406a88.

## Follow-up 2026-10-15: Your call on a take + Production door
`patch_index3.py` (exact-once on index 72bba43e17). Migration `20261015170000_studio_take_decisions.sql`.
Live row cea68817-b0a9-48fb-aded-0531fceb8452; rollback row b3882262-b1f2-4d94-ae61-ecacecf99563.

## Follow-up 2026-10-15: sent-back posts parked off the Queue
`patch_index4.py` (exact-once on index 1b58a21a3b). Migration `20261015190000_studio_park_sent_back_posts.sql`.
Live row 36936e63-c6b8-4877-8145-7ff1ee2442a9; rollback row cea68817-b0a9-48fb-aded-0531fceb8452. Memory: studio/take-park-2026-10-15.

# Reconnect pop-up + YouTube unverified step (2026-10-16)
`patch_board.py` is the exact-once patch on live board app/board.09905e57b5.html (usage: `python3 patch_board.py live.html new.html`).
Migration `20261016120000_studio_reconnect_modal_yt_switch.sql` (applied statement by statement).
`qa_preview.mjs` / `qa_yt.mjs` are the Playwright checks (need the bestly-test client token in /tmp/w/bt.tok, never committed).
Live row 785a2533-c12b-4599-8de4-313244216da4; rollback row 7f49f9a9-40b5-4fba-9af9-4986e746469e (supersede the live row first, then set the old one live).
Turn the YouTube step off the day Google approves: `update public.studio_flags set value = true, updated_at = now() where key = 'yt_google_verified';`
Memory: studio/reconnect-modal-2026-10-16, studio/youtube-verified-switch.

# Studio mobile QA (2026-10-14)

Playwright checks for Studio on a phone-sized screen (390x844 and 430x932, touch), written for the mobile video pass.
Chromium has no H.264, so `lib.mjs` swaps every review/*.mp4 for a VP9 clip that still answers byte ranges.
It cannot prove what iPhone Safari does; it proves the page logic, the numbers of live video elements and the page errors.

- `lib.mjs`: opens the staff app (reads a staff session from `tok.txt`, 10 minute life) or a board; `build` swaps in a local index.html before shipping.
- `matrix2.mjs <slug> <width> <tag>`: theatre, scrub, background return, landscape, TikTok view, post switch.
- `tabs1.mjs`: every tab plus the bell, counting live video elements.
- `assets1.mjs`: scrolls the Assets library and reports the most video sources held at once (18 before the governor, 3 after).
- `board2.mjs`: opens the client board read-only through "Open their board".
- `probe.py`: HEAD/range check of every video URL and its colour range (yuvj420p full range is what the Apple decoder rejects).
- `patch_index_2026-10-14.py`: the exact-once patch applied to the live index.html that day, kept as a record.

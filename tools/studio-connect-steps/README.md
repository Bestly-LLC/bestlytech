# Connect steps: to-do = Settings tile (2026-10-16)
One source: `client_connect_tile(client, platform)`. `client_todos_board` returns it as `connect` on every open to-do with `source.connect_platform`
(and swaps a dead /c/ short link for the tile's live link). board.html draws it with the same `connListHTML` / `connTailHTML` the tile uses.
`studio_connect_todo_seed` now writes a neutral detail ("The steps are below.").
Migration `20261016180000_todo_connect_steps_one_source.sql` (applied statement by statement).
`patch_board.py live.html new.html` is the exact-once board patch. `qa_match.mjs <preview|live> <mob|desk> <platform>` is the Playwright check (needs /tmp/w/bt.tok, never committed).
Build: live row cc2a8c53-9367-4b17-a93b-de3058732d45 (board app/board.096e81211f.html). Rollback: supersede it, then set 785a2533-c12b-4599-8de4-313244216da4 live (board.64c7e89ea2.html).
DB rollback: re-apply the previous client_todos_board (same body without the `connect` key); the old board ignores `connect` anyway.

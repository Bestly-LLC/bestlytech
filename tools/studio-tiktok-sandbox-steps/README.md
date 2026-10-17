# TikTok sandbox pre-steps (2026-10-17)
client_connect_tile (TikTok) adds `pre`, `trouble`, `trouble_title` while studio_flags.tt_production_approved is false. board.html draws them via connPreLis/connStepsHTML/connTailHTML (shared by the Settings tile and the to-do).
Migration `20261017100000_studio_tiktok_sandbox_steps.sql`. `patch_board.py live.html new.html` is the exact-once patch on board app/board.096e81211f.html.
Build db0a4344-e507-4fec-8c0d-652bf3b946a4 (board app/board.db727832a4.html). Rollback: supersede it, set cc2a8c53-9367-4b17-a93b-de3058732d45 live.
Flip when TikTok approves: `update public.studio_flags set value = true, updated_at = now() where key = 'tt_production_approved';`
Memory: studio/tiktok-approved-switch.

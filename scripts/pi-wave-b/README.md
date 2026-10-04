# Pi Waves B + C (2026-10-03)

Claude scheduled tasks moved to Pi cron jobs on `bestly-pi` (`/opt/bestly/cron`, run via `run.sh <job>` → `runjob.py`,
reported to `pi_jobs`; `pi_jobs_watch` alerts Scout if a job goes quiet).

| Job | Cron (Pi local = Pacific) | Replaces | AI |
|---|---|---|---|
| `studio_ask` | `*/5 6-23 * * *` | "Studio change requests" x3 (Claude, hourly) | free ladder, coder model first; falls back to "Needs a person" |
| `studio_regen` | `33 * * * *` | "Bestly Studio — regen pass (hourly)" | free ladder, only when an item waits |
| `bestly_social daily` | `40 10 * * *` (skips Tuesday) | "Bestly — daily Instagram + Facebook post" | free ladder caption + rule checks in code |
| `bestly_social carousel` | `47 10 * * 2` | "Bestly — weekly Instagram carousel" | same |

Database side: `supabase/migrations/20261004000000_pi_wave_b_c.sql` (Spark sessions, `pi_http_result`,
`pi_bestly_ig_recent`, `bestly_social_history`).

## Safety
- studio_regen acts as **Spark** only (`pi_spark_session`, 1 hour, deleted at the end). Never a person, never stage=client,
  never promotes. Every rewrite goes through `claim_check`; blocked twice → left alone and reported.
  An item whose newest note is already Spark's is skipped (a person owns it now) — this stops the hourly loop on
  items Spark cannot move back to To review.
- bestly_social never holds a Meta token: it calls `invoke_edge_function` and reads answers with `pi_http_result`.
  It checks the Instagram feed first and skips if there is already a post from the last 20 hours, so it cannot
  double-post alongside the old Claude task or a manual post. Each channel is called once, never retried.
- Captions are checked in code: no emoji, hashtags, bait openers, links, statistics or numbered lists; "Bestly"
  exactly once, in the last paragraph. Three tries, else no post and a Scout alert.

## freellm.py changes (Pi)
- Plain-writing calls (no tools) try `gemini-3.5-flash`, `gpt-oss-120b`, `kimi-k2-instruct-0905` on FreeLLM before
  `auto`: FreeLLM `auto` was landing on a thinking model that dumped its reasoning into the reply.
- A FreeLLM 429/503 ("All models exhausted ... Soonest reset ~21h") benches that model for the stated time (max 1 hour)
  instead of sleeping 61 seconds.
- `</think>` blocks are stripped from replies.

## Findings
- The daily post rotation never advanced (history lived in a static prompt): 21 posts cycled 3-4 images.
- No Bestly post has gone out since Sep 28; the Claude task stopped publishing.
- Both carousels ran inside the last 8 weeks (software-bill twice), so Tuesdays post nothing until a new set is added.

## Rollback
`crontab -l` backups: `/home/pi/scripts/crontab.bak-20261003-waveB`. freellm.py backups:
`/opt/bestly/cron/freellm.py.bak-20261003-freellm`, `.bak-20261003-writer`.

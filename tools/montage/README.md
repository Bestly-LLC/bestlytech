# Montage: Spark's video crew (OpenMontage on the Pi)

Built 2026-10-06. Spark's main video tool (`make_montage` in `supabase/functions/studio-chat`).

- Runs as systemd `bestly-montage` on the Pi (`/opt/bestly/montage`, this folder). Restart=always.
- OpenMontage is pinned at commit `9327439` in `/mnt/ssd/apps/openmontage` (`make setup`; Remotion arm64; Piper).
  Never edit that tree (AGPL). `om_render.py` copies `comp/<brand>` to `remotion-composer/projects/bestly-<brand>`
  (git-excluded) and renders with OpenMontage's `VideoCompose` in atelier mode, adding the Pi's Chromium.
- Voices: `/mnt/ssd/montage/voices` (`python -m piper.download_voices en_US-hfc_female-medium --data-dir ...`).
- Jobs: `studio_video_jobs` (migration `20261006200000_montage_spark_ltx.sql`). Job files: `/mnt/ssd/montage/jobs/<id>`.

## Flow
1. `montage_claim` -> brand writer (`brands/<slug>.py`, free AI via `/opt/bestly/cron/freellm.py`, the brand's claim rules + fact check).
2. Piper voices each scene; scene lengths follow the voice; a quiet synthesized pad sits under it.
3. b-roll (optional): `montage_clip_request` orders vertical LTX clips and parks the job; `montage_claim` resumes it
   when no clip is still queued/rendering (or after 90 min, with plain cards for missing clips).
4. Render + OpenMontage review, then our checks (1080x1920, length, loudness, size), thumbnail, upload to `review`.
5. `montage_file` files to Studio > Drafts > To review (or updates the same item on a re-cut), posts to the Spark thread.
6. Changes with a note on a Montage item -> trigger `montage_recut` -> a re-cut job with the note.

## Brands
- `hoku`: reuses `/opt/bestly/cron/jobs/hoku_maker.py` (ABOUT facts, claim_check, fact check). Design: `comp/hoku`.
- Add a brand: `brands/<slug>.py` (write(), ASSETS, VOICE, COMPOSITION, SHOT_STYLE), `comp/<slug>/`, and allow the slug in
  `montage_quote` + `worker.brand_for`.

## Watchdogs
- cron `montage-watch` every 5 min (requeue stalled jobs 3x, then fail + push; push if work waits and the worker is quiet).
- `agent_beats` row `montage` every 2 min while idle, every minute while working (Team card pulse).

## Deploy
`scp -r worker.py om_render.py brands comp bestly-pi-lan:/opt/bestly/montage/ && ssh bestly-pi-lan sudo systemctl restart bestly-montage`

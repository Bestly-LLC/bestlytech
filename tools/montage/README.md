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
Allowed per client by `montage_brand_policy.montage_ok` (read by `montage_quote`, `montage_start` and `worker.brand_for`; the default for an unknown client is refuse).
`worker.brand_for(slug)` imports `brands/<slug with - as _>.py`.

| client | module | facts + claim rules | design |
|---|---|---|---|
| `hoku` | `brands/hoku.py` | `jobs/hoku_maker.py` (ABOUT, claim_check, fact check) | `comp/hoku` (HokuShort) |
| `inventoryproof` | `brands/inventoryproof.py` | `jobs/brand_maker.py` BRANDS['inventoryproof'], claim slug `inventoryproof` | `comp/brand` (BrandShort): Manrope, card grounds + accents, Proofy on the closing card |
| `cookie-yeti` | `brands/cookie_yeti.py` | `jobs/brand_maker.py` BRANDS['cookieyeti'], claim slug `cookie-yeti` | `comp/brand`: Inter Tight, plum/teal card grounds, app icon on the closing card |
| `bestly-cloud` | `brands/bestly_cloud.py` | `jobs/bestly_social.py` PRODUCT, `claim_check('bestly-cloud')` (severity `setup` = no rules yet = house rules only) | `comp/brand`: Bestly card kit colors/type, the real pill logo |

Never made by Montage: Centering YOU (`centering-you`, `demo-two`: Elizabeth films her own videos) and real estate (`listings`, `re-demo`: photo-only tours, planned).
Brand files the videos use: `fetch-assets.sh` downloads Cookie Yeti and InventoryProof fonts, icon and Proofy into `/opt/bestly/montage-kit` (the same public files `social-render` uses); Bestly uses `/opt/bestly/social-kit`, HOKU `/opt/bestly/hoku-kit`.

### Add a brand
1. `brands/<slug_with_underscores>.py`: a CFG dict for `_common.write` (slug, name, claim slug, ABOUT facts, themes, closing card `end` {title, sub, cta, say}, name patterns, b-roll shot wording), `BRAND` (the props `comp/brand` renders: fonts, head/label type, themes with bg/veil/ink/dim/accent, logo or wordmark, closing art), `ASSETS` ({public path: file on the Pi}), `VOICE`, `SHOT_STYLE`, `COMPOSITION="BrandShort"`, `COMP_DIR="brand"`, `write(job, log)`.
2. Only real brand files: logos, mascots and fonts from the brand's card kit. Never draw a logo.
3. Add a `montage_brand_policy` row (montage_ok false until a test video has been looked at), then flip it to true.
4. Render one free text-only job through `montage_start`, look at frames, then name the brand in `make_montage`'s description in `studio-chat`.
(`comp/<slug>` is still supported: leave `COMP_DIR` unset and om_render copies `comp/<slug>`.)

## Watchdogs
- cron `montage-watch` every 5 min (requeue stalled jobs 3x, then fail + push; push if work waits and the worker is quiet).
- `agent_beats` row `montage` every 2 min while idle, every minute while working (Team card pulse).

## Deploy
`scp -r worker.py om_render.py brands comp bestly-pi-lan:/opt/bestly/montage/ && ssh bestly-pi-lan "/opt/bestly/montage/fetch-assets.sh; sudo systemctl restart bestly-montage"`

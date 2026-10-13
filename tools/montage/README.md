# Montage: Spark's video crew (OpenMontage on the Pi)

Built 2026-10-06. Spark's main video tool (`make_montage` in `supabase/functions/studio-chat`).

- Runs as systemd `bestly-montage` on the Pi (`/opt/bestly/montage`, this folder). Restart=always.
- OpenMontage is pinned at commit `9327439` in `/mnt/ssd/apps/openmontage` (`make setup`; Remotion arm64; Piper).
  Never edit that tree (AGPL). `om_render.py` copies `comp/<brand>` to `remotion-composer/projects/bestly-<brand>`
  (git-excluded) and renders with OpenMontage's `VideoCompose` in atelier mode, adding the Pi's Chromium.
- Piper voices (manual switch only): `/mnt/ssd/montage/voices` (`python -m piper.download_voices en_US-hfc_female-medium --data-dir ...`).
- Jobs: `studio_video_jobs` (migration `20261006200000_montage_spark_ltx.sql`). Job files: `/mnt/ssd/montage/jobs/<id>`.

## Flow
1. `montage_claim` -> brand writer (`brands/<slug>.py`, free AI via `/opt/bestly/cron/freellm.py`, the brand's claim rules + fact check).
2. Music gate, then ElevenLabs voices each scene (held, not Piper, if it cannot; see Voice); scene lengths follow the voice. Then the music bed (see Music).
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
| `bestly-cloud` | `brands/bestly_cloud.py` | `jobs/bestly_social.py` PRODUCT, `claim_check('bestly-cloud')` (severity `setup` = no rules yet = house rules only) | `comp/brand`: Bestly card kit colors/type, the real pill logo, scene icons, rich closing card |
| `bestly-studio` | `brands/bestly_studio.py` | `jobs/bestly_social.py` PRODUCT_STUDIO, `claim_check('bestly-studio')` (rules start unapproved), `docs/studio-promo/claims.md`; text only, one posting tip per video, filed to Drafts > To review (Friday rotation of `bestly_social studio`) | `comp/brand`: same as bestly-cloud, closing card says bestly.tech/studio |
| `bestly-agent` | `brands/bestly_agent.py` | facts in the module, hand-written ads selected by `[ad:missed-call]` / `[ad:what-she-does]` in the brief (a re-cut marked `[recut-ad]` keeps the script), `claim_check('bestly-agent')` (13 rules, unapproved), number guard (`extra_check`); `docs/bestly-agent-ad-opusplan.md` | `comp/brand`: indigo ground, orchid second glow, Inter, Maya's orb on the closing card, phone call card (fictional caller, made-up business), prices in the accent; music borrowed from the other Bestly brands |

Never made by Montage: Centering YOU (`centering-you`, `demo-two`: Elizabeth films her own videos) and real estate (`listings`, `re-demo`: photo-only tours, planned).
Brand files the videos use: `fetch-assets.sh` downloads Cookie Yeti and InventoryProof fonts, icon and Proofy into `/opt/bestly/montage-kit` (the same public files `social-render` uses); Bestly uses `/opt/bestly/social-kit`, HOKU `/opt/bestly/hoku-kit`.

### Add a brand
1. `brands/<slug_with_underscores>.py`: a CFG dict for `_common.write` (slug, name, claim slug, ABOUT facts, themes, closing card `end` {title, sub, cta, say}, name patterns, b-roll shot wording), `BRAND` (the props `comp/brand` renders: fonts, head/label type, themes with bg/veil/ink/dim/accent, logo or wordmark, closing art), `ASSETS` ({public path: file on the Pi}), `VOICE`, `SHOT_STYLE`, `COMPOSITION="BrandShort"`, `COMP_DIR="brand"`, `write(job, log)`.
2. Only real brand files: logos, mascots and fonts from the brand's card kit. Never draw a logo.
3. Add a `montage_brand_policy` row (montage_ok false until a test video has been looked at), then flip it to true.
4. Render one free text-only job through `montage_start`, look at frames, then name the brand in `make_montage`'s description in `studio-chat`.
(`comp/<slug>` is still supported: leave `COMP_DIR` unset and om_render copies `comp/<slug>`.)

## Music (every video ships with a real music bed, Jared 2026-10-12)
Rule: `bestly_memory` `studio/rule-music-every-video`. The old synthesized pad (10 percent volume) is gone.
- Library: table `studio_music_tracks` (brand_slug or null = shared, mood, bpm, duration_s, storage_path, source, license, loudness_lufs, active) + private storage bucket `music`;
  `studio_music_uses` remembers which track went under which video. Moods (fixed set): calm, upbeat, confident, warm, playful. The writer adds `mood` to the script
  (`_common.MOODS`); the brand's `CFG["mood"]` (HOKU: `MOOD`) is the fallback.
- Picker `montage_music_pick(brand, mood, job)`: the brand's own and shared tracks; mood match first, then the brand's own track, then least recently used; never the
  track used last for that brand (unless it is the only one). `music.build` fits it to the video (crossfaded loop if short, soft fade in 0.8 s / out 2.2 s) and lowers it under
  every narration line with soft ramps (`volume` expression from the saved `voice_at`/`voice_end` timings): bed at -18 LUFS in the gaps, 9 dB lower under the voice, a small swell after
  the end card's line. Result `public/music.wav` (already ducked, played at volume 1.0 by `comp/brand` and `comp/hoku`). Levels: `montage_settings` key `music`.
- Gate: `worker._music_gate` runs BEFORE the voice is bought; a brand with no track means the job is `held` (reason starts "no music"), Spark alert `montage.music` (info, no push, one a
  day per brand, thread post on the first hold), re-checked every 30 min, resumes by itself when a track exists, stopped after 7 days. `worker.check` fails any video with no bed, a near-silent
  bed (mean under -45 dB) or a finished mix that is silent in the gaps between narration lines (`music.bed_problems`). Never filed silent.
- Filling the library: `music_library.py` (Pi: `python3 /opt/bestly/montage/music_library.py quote|run|list`). `quote` reads the live ElevenLabs balance, prices the starter library
  (3 beds x 5 house brands, 35 s, instrumental) and checks the 30 percent voice reserve; spends nothing. `run` does NOTHING until `select montage_music_approve(<credits>, <usd>)` ran
  after Jared said yes to Spark's dollar quote; it then generates, normalizes to -18 LUFS (FLAC), uploads, registers, stops before passing the approved credits or the reserve, and switches
  the approval off. One call per bed, never retried. Free tracks: the Pi has no licensed music (the wall audiofx is not a source); only OpenMontage sfx. Add one by hand with `montage_music_register`
  (license in plain words) after uploading the file to `music/<brand>/...`.
- Rollback: copy the `*.bak_music_20261012` files back next to worker.py / brands/*.py and restart `bestly-montage`.

## B-roll on a re-cut (2026-10-12, Jared approved one order for BC05)
Default re-cuts (trigger `montage_recut`, a "changes" note) stay `broll=false`, cost $0 and reuse the parent's clips. A re-cut orders FRESH clips only when its job has `broll=true`,
and the only thing that sets that is `select montage_recut_broll(<item id>, '<note>', <approved usd>, 'spark')` (service_role only; approved amount lands in `budget_usd`).
Do this ONLY after `select ltx_quote(<sec>)->>'text'` was shown to Jared and he said yes (about 5 sec per scene). The worker re-prices the whole order as one batch
(`ltx_quote(total sec)` + idle tail) and refuses, ordering nothing, if it is above `budget_usd`. Flow after that is the normal one: writer adds a `shot` per scene,
voice, `montage_clip_request` parks the job, LTX renders, `montage_claim` resumes it, render, `montage_file` updates the SAME item.
- A note that says "keep the current copy" (`_common.KEEP_NOTE`) restores the current kickers, lines, says, icons and caption word for word; the model only supplies shots + end card.
- `comp/brand` (BrandShort) plays each clip behind its scene under the brand-colored feathered veil (same as HokuShort); the scene icons stay (soft glow) over the clips.
- End-card chips: `_common.chip_problems` (2-4 words, 24 letters at most, a concrete topic, icon must match the topic: files, calendar, chat, passwords=key/lock, fees=tag, own=box, people, handled=check,
  private=lock/eyeslash; vague or jargon words like single/hardware/server/platform are refused). A proposal that fails keeps the brand default. A brand's own default chips must pass too (`default_chip_problems`).
  Bestly Cloud default: "Files, calendar, chat" (files), "No per-person fees" (tag), "A box you own" (box).
Pi backups of 2026-10-12: files named `*.bak_broll_20261012` next to worker.py, brands/_common.py, brands/bestly_cloud.py, comp/brand/BrandShort.tsx, README.md.

## Voice (ElevenLabs only; a video waits instead of using Piper)
`worker.voice()` uses ONE provider per video (never mixes voices). Track V, 2026-10-06. **Piper fallback retired 2026-10-10** (Jared, answer 20 of
`docs/elevenlabs-studio-opusplan.md`: "pause everywhere"). Montage never falls back to Piper by itself any more.

A brand module gives its ElevenLabs voice as `VOICE_11` (next to the Piper `VOICE`, which only the manual `piper` switch below uses):
```python
VOICE_11 = {"voice_id": "<id from GET /v1/voices>", "name": "<display name>",
            "stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "speed": 1.0}
```
- `voice_id`, `name`: required. A premade or library voice only, never a cloned person. Keep each brand's voice distinct, and do not
  reuse the RoofGuard caller's voice (Sarah).
- `stability`, `similarity_boost`, `style`, `speed`: optional (defaults above), sent as the request's `voice_settings`
  (`use_speaker_boost` is always true). `speed` is 0.7 to 1.2.
- No `VOICE_11` in the module = the job FAILS with that reason (add one, or flip the manual switch). The worker caches imported brand modules:
  restart `bestly-montage` after editing a brand file.

Voices in use (premade, none cloned): HOKU Lily `pFZP5JQG7iQjIQuC4Bku`, InventoryProof Matilda `XrExE9yKIg1WjnnlVkGX`, Cookie Yeti Liam `TX3LPaxmHKxFdv7VOQHJ`,
Bestly Cloud Eric `cjVigY5qzO86Huf0OWal`, Bestly Studio Chris `iP95p4xoKVk53GoZ742B`, Bestly Agent Hope (Maya's own voice) `tnSpp4vdxKPjI9w0GnoV`. Not available: Sarah `EXAVITQu4vr4xnSDxMaL` (the RoofGuard caller). Free premade voices to pick from for a new brand:
Bella `hpp4J3VqNfWAUOO0d1Us` (warm, bright), Roger `CwhRBWXzGAHq8TQ4Fs17` (laid-back), Jessica `cgSgspJ2msm6clMCkdW9` (playful), River `SAz9YHcvj6GT2YYXdXww` (calm, neutral).

### How to add a voice to a brand
1. `GET https://api.elevenlabs.io/v1/voices` (key: Vault `elevenlabs_api_key`; the Pi reads it only through `pi_secret`). Pick a premade or library voice that fits the brand.
2. Add `VOICE_11 = {...}` to `brands/<slug>.py` (keep the old `VOICE` line), restart `bestly-montage`.
3. Check the client's `montage_brand_policy.ai_voice_ok` is true and its `voiceover` switch is on in Studio > Settings > Audio.
4. Render one free text-only job (`montage_start`), confirm the job log says `voice: elevenlabs <name> (<n> chars)`.

### Rules (worker._eleven)
ElevenLabs is used only when ALL hold: `montage_settings` row `voice` says `"provider":"elevenlabs"`; the client's `ai_voice_ok` is true;
the `studio_audio_features` row (owner = the brand slug, feature `voiceover`) is not off; the brand has `VOICE_11`; the key resolves through `pi_secret`;
`GET /v1/user/subscription` answers; and the credits left AFTER this video (`character_limit - character_count - chars x rate`) stay at or above
`reserve_pct`% of `character_limit` (the 30% kept for Ava's calls; same reserve for all audio). Rate is 1 credit/char for multilingual and v3 models,
0.5 for `eleven_flash_*` / `eleven_turbo_*`. Per scene: `POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128` with `model_id`,
`voice_settings`, `previous_text`/`next_text`; 30 s timeout, 2 retries on 429/5xx. Scenes already paid for are cached in the job folder
(`v00.mp3` + `.key`) so a retry does not pay twice.

### What happens when ElevenLabs cannot read the video (HELD, not Piper)
Anything that stops ElevenLabs puts the job in status `held` (`held_reason`, `held_since`, `held_check_at` on `studio_video_jobs`):

| Cause | Kind | Spark alert (`scout_notify`, title "Spark: ...", dedupe `montage.voice-<kind>-<date>`, once a day) |
|---|---|---|
| credits would drop under the reserve | `low` | warning + push (plan credits are money) |
| key missing, subscription check fails, any scene errors (outage, bad voice id), settings unreadable | `down` | info, no push |
| Studio voiceover switch is off for the brand | `switch` | info, no push |

- The worker claims a held job again when `held_check_at` is due (every 30 minutes), re-runs only the voice step from the saved script and
  carries on to the render, or re-holds. It posts to the requester's thread on the first hold and when it resumes.
- After 7 days held the job fails (`error` says why) and Spark sends a warning.
- `montage_status` / Spark say "On hold: <reason>" with how long it has been held.
- Permanent no (client `ai_voice_ok` false, brand without `VOICE_11`): the job fails at once with that reason.
- Every video's voiceover is logged as a `studio_audio_jobs` row (`requested_by 'montage'`, feature `voiceover`, status `done` or `held`,
  credits and `cost_usd`). Montage is pre-approved daily automation for house brands: no per-video quote or yes.
- The estimated cost (`credits x 22 / 131000`) is added to the job's `cost_usd`. Observed bill on the Creator plan: about 0.5 credit per
  character on multilingual v2 (the worker still budgets 1 per character, the safe side).
- ElevenLabs clips are silence-trimmed and the finished narration is levelled to -16 LUFS. The narration mix uses `apad=whole_dur`
  (an open-ended `apad` hung ffmpeg on ElevenLabs audio).

### Settings row (no deploy needed)
`montage_settings` (service role only): key `voice` = `{"provider":"elevenlabs","model":"eleven_multilingual_v2","reserve_pct":30}`.
`provider: "piper"` is the MANUAL switch: every video is then voiced by Piper (log line `voice: piper (manual switch ...)`). It is never chosen automatically.
`model: "eleven_flash_v2_5"` halves the cost.

## Video format (normalize)
Every file is made standard before the checks and the upload: H.264 High 4.1, `yuv420p`, limited (tv) range, bt709 tags, AAC, faststart.
The Remotion render came out `yuvj420p` / full range / bt470bg with no bt709 tags (found 2026-10-12): Chrome plays that, Safari and the Studio app on a Mac do not.
`worker.normalize(out, jid)` probes the file and, when it is not standard, re-encodes it (`-crf 19 -preset slow`) and swaps it in, with a job note.
`worker.check()` still flags any non-standard result, so a missed normalize fails the job instead of filing it. Needs no settings.
Older videos: re-encode, upload to `video/<client>/<name>.<sha10>.mp4` (the signer `studio_ship_sign_upload` allows that write-once path), then `studio_item_set_media`.

## Re-cuts and graphics (2026-10-12)
A Changes note on a Montage item makes a re-cut job (`montage_recut` trigger, `revise_note` = the reviewer's full words). Why BC05's first re-cut came back
identical: the old prompt said "change nothing else, word for word", the closing card is fixed in code, the comp drew only text, and nothing checked that
anything changed. What a re-cut does now (`brands/_common.py`):
- **The note is applied fully.** A note about the writing as a whole (copy, bland, unclear, "dumbest person", ...) rewrites every scene and the caption from
  scratch (`MODE_BROAD`); a narrow note keeps everything it does not touch word for word (`MODE_NARROW`). House rules on every re-cut: scene 1 says plainly
  what the product is and who it is for (without naming it), no jargon, no absolutes, nothing outside the facts.
- **A re-cut must change.** If the note asks for copy changes and 70% or more of kickers, lines, says and caption paragraphs are unchanged, the writer retries once
  with a stronger instruction. Still the same: `RecutUnchanged` -> job `failed` with the reason, a Spark thread post, a Spark info alert (`montage.recut-<job>`,
  no push), the item's "Re-cutting" badge cleared. Nothing identical is filed.
- **Closing card on request.** A note that mentions the end card / closing card / CTA lets the writer propose the card's sub line and three chips (icon + 1-5 words);
  they pass `check_end` (lengths, no numerals/prices, `claim_check`) or the brand default stays (`CFG["end"]`). Title stays the product name.
- **Free graphics, no b-roll money.** Brands with `CFG["icons"]` (Bestly Cloud) make the writer pick one icon per scene from `ICONS` (files, lock, box, people,
  calendar, chat, key, check, tag, eyeslash; each different). `comp/brand/BrandShort.tsx` draws them as SVG in the brand palette: a glowing disc, a feathered
  orbiting arc, the icon drawing itself on with a soft spring. Brand flags: `ambient` (slow feathered glows behind everything), `end.heroLogo` + `end.chips`
  (rich closing card: big logo, product name, one plain line, three icon chips, glowing bestly.tech button). Every glow is a radial gradient to transparent.
  Unknown icons draw nothing; brands without these props render as before. Re-cuts never order LTX b-roll.
- **First cuts for Bestly Cloud** (`explain_first`) also open with a scene that says what the product is, and get icons plus the rich closing card.
- **Self-healing.** If the render with graphics fails, `worker.process` strips the graphics (`_plain`) and renders plain cards instead of losing the job, and posts a
  Spark info alert (`montage.graphics-<job>`). Both new alert prefixes belong to Spark (`notification_owners`, migration `20261012201000`). The existing
  `montage-watch` cron and the `montage` heartbeat still cover the worker itself.
- Backups of the files replaced on the Pi: `*.bak_recut_20261012` next to each (worker.py, brands/_common.py, brands/bestly_cloud.py, comp/brand/*, README.md).

## Unique content (2026-10-12): no two videos look or open alike, and viewers have a reason to come back
Jared: "no duplicate-looking content, brand-consistent, but every piece unique, engaging, and it brings viewers back." Plan and results:
`docs/studio-unique-content-opusplan.md`. Code: `variety.py`, `brands/_common.write`, `brands/hoku.write`, `comp/brand/BrandShort.tsx`, `comp/hoku/HokuShort.tsx`.
- **A look per video.** Before the writer runs, `variety.make_plan` picks a LOOK: scene-layout set (L1-L6, the order of five templates: stack, center, split,
  stat, steps), hook style (question, bold count, problem, imagined story, myth versus fact), accent colour (the brand's approved list in `CFG["accents"]`),
  closing-card layout (list, claim, qa) and icon style (orbit, badge, rings). Chosen so it differs from the brand's last 8 videos on 4 of its dimensions, and
  from the other brands' recent layouts. The music track is the sixth dimension: `montage_music_pick` never repeats the last 2 tracks of a brand (the last
  1 when the brand has fewer than 3). A forced look can be pinned in a brief or note with `[look:layout=L2,hook=myth,end=qa,icon=badge,accent=1,segment=myth-or-fact]`.
- **The gate.** A finished script must differ from each of the last 8 filed videos on at least 3 look dimensions and open with a hook sentence not 72% the same
  as any of the last 20 openings. A miss re-rolls the look and the words twice, then `VarietyHold`: the job is HELD (re-tried every 30 min with a fresh draw,
  stopped after 7 days) and Spark alerts `montage.variety` (info, no push). The fingerprint lives in `studio_look_ledger` (written at plan time, marked filed by the
  trigger `trg_look_filed`, earlier cuts of the same item marked superseded, a failed or stopped job marked failed).
- **Come-back features.** Numbered series per brand (`studio_series`: "Tip 3 of 8", "Moment 2 of 8", ... shown small in the corner of every scene), named recurring
  segments (`studio_segments`: Quick fix, Myth or fact, ... shown as the first kicker, rotated), an upcoming-topics queue (`studio_series_topics`) so the closing
  card, the spoken last line and the caption carry a real "Next: <topic>" (claim-checked; Spark alerts `montage.series` when fewer than 2 topics remain), and one
  easy comment question at the end of the caption (caption order: series line, body, tail, Next, question, hashtags last). A re-cut keeps its parent's number.
- **Templates.** `BrandShort` scene templates: stack (the old one), center, split (text top, graphic bottom), stat (one huge word), steps (2 or 3 numbered rows).
  Icon styles: orbit (the old one), badge, rings. Closing cards: list (chips), claim (title big, compact chips), qa (the question and its answer, then the product).
  The HOKU composition has the same five templates and two closing layouts. Every prop is optional; old props draw as before.
- **Alerts** `montage.variety` and `montage.series` are Spark's (`notification_owners`), info, never pushed.
- **Centering YOU** has no Montage brand: its videos are recordings of Elizabeth (cy-kit). `tests/cy_music_graphics.py` shows the pattern for a CY copy with a
  borrowed music bed and soft callout cards (CY29 itself is never touched).
- Deploy: `deploy_unique.sh <sha>` on the Pi (backs up as `*.bak_unique_20261012`, compiles, no restart), then `sudo -n systemctl restart bestly-montage`.

## Watchdogs
- cron `montage-watch` every 5 min (requeue stalled jobs 3x, then fail + push; push if work waits and the worker is quiet).
- `agent_beats` row `montage` every 2 min while idle, every minute while working (Team card pulse).

## Deploy
`scp -r worker.py om_render.py brands comp bestly-pi-lan:/opt/bestly/montage/ && ssh bestly-pi-lan "/opt/bestly/montage/fetch-assets.sh; sudo systemctl restart bestly-montage"`

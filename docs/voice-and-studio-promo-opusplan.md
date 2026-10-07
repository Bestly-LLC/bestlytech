# Opusplan: ElevenLabs voice for Montage + promoting Bestly Studio on Bestly's socials

Written 2026-10-06 (Opus) for execution by Sonnet agents. Owner of both: Spark (Head of Marketing & Content).

Jared, 2026-10-06 8:17 PM: "Switch Montage from the free Piper voice to ElevenLabs for HOKU, InventoryProof, Cookie Yeti
and Bestly Cloud, we're also going to start ad-ing Bestly Studio on the Bestly social accounts ... Keep Piper as a backup
that kicks in automatically if credits run low or ElevenLabs is down, so a video never fails over a voice."

## Facts this plan rests on
- ElevenLabs: Bestly already pays for Creator ($22/mo, 131,000 credits, resets the 4th). Key in Vault `elevenlabs_api_key`.
  The same credits will pay for Ava's RoofGuard cold calls (about 60 a day, about 430 credits a minute) and her personal
  calls. Calls matter more than video voice, so video voice must never eat the calls' share.
- A Montage video speaks about 340 to 440 characters (measured on 9 jobs). Multilingual v2 = 1 credit per character,
  Flash v2.5 = 0.5.
- Pi reads Vault only through `pi_secret` (service role, hard allowlist; see 20261006221500_pi_secret_fireworks.sql).
- Montage (tools/montage, systemd bestly-montage): worker.voice() renders Piper per scene and mixes with adelay/amix.
  Brands: hoku (own comp), inventoryproof, cookie-yeti, bestly-cloud (shared comp/brand + brands/_common.py).
- Bestly's own social posts come from Pi job jobs/bestly_social.py (client bestly-cloud) and the Bestly IG/TikTok posters.
- Bestly Studio as a product (sold to small businesses; first prospects are real estate agents): content is made for the
  business, they approve, request changes with a note, or kill it from a private board on their phone; it posts for them
  (or they press Post). Jared's price stance: about $50 to $100 a month for one realtor (not public yet).
  There is no public Studio page on bestly.tech yet.

## Track V: ElevenLabs voice with automatic Piper fallback (Sonnet agent "voice")
1. Allow the Pi to read `elevenlabs_api_key`: patch `pi_secret`'s allowlist the same safe way as the Fireworks migration
   (read live definition, replace, assert, execute). Record migration.
2. Settings row the worker reads each job (table `montage_settings(key text primary key, value jsonb, updated_at)`,
   service-role only): key 'voice' = {"provider":"elevenlabs","model":"eleven_multilingual_v2","reserve_pct":30}.
   Spark or Claude can flip provider to "piper" or model to "eleven_flash_v2_5" without a deploy.
3. worker.voice(): for each job pick ONE provider for the whole video (never mix voices):
   - ElevenLabs only if: setting says elevenlabs, client policy `ai_voice_ok` is true, the brand module has
     `VOICE_11`, the key resolves, GET /v1/user/subscription works, and
     (character_limit - character_count - this script's characters x model rate) >= reserve_pct% of character_limit.
   - Per scene: POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128 with model_id, voice_settings from the
     brand, previous_text/next_text for natural flow. 30 s timeout, 2 retries on 429/5xx. Any failure on any scene ->
     throw away the ElevenLabs audio and render the whole video with Piper (existing code path, unchanged).
   - Keep the existing timing logic (scene lengths come from the audio), so captions stay in sync.
   - Log `voice: elevenlabs <voice name> (<n> chars)` or `voice: piper (<reason>)` in the job log; add the estimated
     cost to cost_usd (chars x 22 / 131000).
4. Alerts, signed "Montage:": fallback for low credits -> scout_notify warning, push true (money: it protects Ava's
   calls), dedupe once a day; fallback for outage/error -> info, no push, dedupe once a day. Nothing else pages Jared.
5. One voice per brand from the account's voice library (GET /v1/voices; premade or library voices only, never clone a
   real person): HOKU calm warm female; InventoryProof clear friendly; Cookie Yeti light and quick; Bestly Cloud
   plain-spoken and steady. `VOICE_11 = {voice_id, name, stability, similarity_boost, style, speed}` in each brand
   module. Bestly Studio (Track S) gets one too.
6. Tests: unit-run voice() with a forced failure (bad voice id) and confirm Piper takes over and the video renders;
   then one real text-only video per brand (about 1,800 credits total). Check each: audio length matches scenes,
   no clipped words (ffmpeg silencedetect / ebur128 loudness about -16 LUFS), frames still fine. File to Studio.
7. Team: add ElevenLabs to Montage's card tools (team_onboard update, same slug). Repo copy + README + record
   migration, commit, push. Note to bestly_memory studio/montage-spark-ltx.

## Track S: Promote Bestly Studio on Bestly's social accounts (Sonnet agent "studio-promo")
Default reading (Jared can redirect): "ad-ing" = organic promo posts on Bestly's own accounts first, not paid ads.
Paid ads come later, once posts show which angle works.
1. True-claims sheet first. List only what Studio really does today (from the live product: board, approve/changes
   with a note/kill, re-cuts from notes, version history, posting for you or a Post button, studio@bestly.tech intake,
   Spark makes scripts, carousels and short videos). New approval client `bestly-studio` with active claim_rules:
   no prices, no results/stats/follower promises, no client names or quotes (no testimonials without written consent),
   no "AI does it all" (a person reviews), no fake app screens. Policy row montage_ok true, ai_footage_ok true,
   ai_voice_ok true. Rules start unapproved: Jared reviews in Settings > Claim rules.
2. A place to send people: public page bestly.tech/studio in this repo (light mode, Bestly voice, no emoji, written for
   someone who has never heard of it: "We make your social posts. You approve them from your phone. We post them.").
   Sections: what you get, how it works in 3 steps, who it's for (small businesses, solo pros, real estate agents),
   "Book a free call" (the existing Nextcloud Appointments link). No prices until Jared sets them. Add to products
   config so it shows on /products. SEO meta. Short link for posts: bestly.tech/studio.
3. Visuals that are real: screenshots and screen recordings of the actual Studio board running on the `bestly-test`
   client (demo data only, never a client's board), captured with Playwright. No mocked UI.
4. Content engine: a Studio rotation in the Pi's Bestly social job (read jobs/bestly_social.py first; add a PRODUCT
   block for Studio and alternate days with Bestly Cloud, or whatever fits its structure) + a Montage brand module
   `brands/bestly_studio.py` on the shared comp with the Bestly kit (same look as Bestly Cloud) and its own ElevenLabs
   voice. Uses the content playbook (scroll-stopping-creative) like every other writer.
5. Review first: Studio promo posts and videos land in Studio Drafts > To review (internal) for Jared, not auto-posted,
   until he says go. Cadence target after go: about 3 a week on Bestly's accounts.
6. Seed: 3 posts (one carousel from real screenshots, one short Montage video, one plain card) filed for review.
7. Team: whichever employee runs bestly_social owns it; update its card's pulse/tools. Commit, push, note to
   bestly_memory (studio/studio-promo).

## Rules for both
- Centering YOU and real estate: no AI voice, no AI footage (policy table, unchanged).
- Secrets only in Vault, never printed. Don't edit /mnt/ssd/apps/openmontage. Back up Pi files before editing.
- Track S must not edit worker.py or om_render.py (Track V owns them); brand modules only.
- Before restarting bestly-montage, check no job is working.
- git pull --rebase before every push.

## Done means
- New Montage videos for the four brands speak with ElevenLabs; a forced failure still produces a Piper video;
  low credits fall back before touching the calls' reserve.
- bestly.tech/studio is live; 3 Studio promo pieces wait in Studio for Jared's review; claim rules listed for his OK.

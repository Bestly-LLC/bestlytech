# Opusplan: ElevenLabs inside Bestly Studio (voice, STT, dubbing, music, cloning + switches, consent, billing)

Written 2026-10-10 (Opus) for execution by Sonnet agents. Owner: **Spark** (alerts, watchdog, credit tracking).

Jared, 2026-10-10 4:18 PM: integrate ElevenLabs into Bestly Studio for all projects — music, dubbing, speech to text,
cloning, the voices — with Studio UI to turn each feature on/off per client, pulling from the API. Voice cloning for a
client (e.g. Elizabeth / Centering YOU) only with her permission; AI audio is a sourced asset, noted as AI-generated.

## Jared's 20 answers (the contract)

| # | Question | Answer |
|---|---|---|
| 1 | Core features v1 | Voiceover (TTS), Speech-to-text, Dubbing, Music — all |
| 2 | Extras v1 | Voice cloning, Sound effects, Voice changer, Voice design — all |
| 3 | First projects | House brands, Real estate, Apps/agents (Centering YOU NOT first; built but locked) |
| 4 | Switch grain | Per client, per feature |
| 5 | Clone consent proof | Signed addendum via LibreSign (cloud.bestly.tech); clone switch locked until signed |
| 6 | Clone scope | Ongoing content; **the person approves each post** that uses their voice |
| 7 | Revoke | Pull drafts (unpublished), keep published |
| 8 | Disclosure | Platform AI label set automatically on publish |
| 9 | Who flips | **Jared only** (Eli sees, can't change) |
| 10 | Client view | Client sees switches; controls the consent ones (can turn her voice OFF any time) |
| 11 | Spark | **Asks before each generation with a dollar estimate** (quote → yes → run), like `ltx_quote` |
| 12 | Owner employee | Spark |
| 13 | Budget | **Plan credits only** — never past the subscription |
| 14 | Client billing | Pass-through + markup |
| 15 | Low credits / outage | **Pause + Spark alerts** |
| 16 | STT engine | Free Whisper first (Pi), ElevenLabs Scribe only when quality matters |
| 17 | Dubbing languages | Any on request |
| 18 | Music | Background beds, brand sonic logos, full tracks/jingles |
| 19 | Markup | 20% |
| 20 | Old Piper rule | **Pause everywhere** — retire the Montage auto-Piper fallback |

## Facts this plan rests on
- Key: Vault `elevenlabs_api_key` (Pi reads via `pi_secret`). Creator plan, credits reset monthly. Ava's calls share the
  credits; Montage keeps a 30% reserve for them (`montage_settings.voice.reserve_pct`). Keep that reserve for ALL audio.
- Voices in use: HOKU Lily, InventoryProof Matilda, Cookie Yeti Liam, Bestly Cloud Eric. Sarah = RoofGuard caller, never
  for content. Jared's own clone exists (Ava). See bestly_memory `studio/montage-voice`.
- `montage_brand_policy(client_slug, montage_ok, ai_footage_ok, ai_voice_ok)` already exists; house brands ai_voice_ok
  true, centering-you false.
- Clients (`approval_clients`): house = bestly-cloud, bestly-studio, cookie-yeti, hoku, inventoryproof;
  client = centering-you; sandboxes = bestly-test, demo-two, re-demo (real-estate demo).
- Studio app = `index.html`/`board.html` in storage behind the boot loader; ship ONLY per bestly_memory `ship/protocol`
  (live manifest → edit → upload → two-statement row flip → verify). Spark's chat = edge fn `studio-chat`.
- Cost-in-line pattern to copy: `ltx_quote` / `ltx_request(confirmed)` / `ltx_status` + Spark `make_video` tool.
- Autonomy: staff-side Studio changes may ship; **client-facing (board.html) waits for Jared** → preview only.

## Track A — Backend (Sonnet "audio-core")
1. Migration `<ts>_studio_audio.sql`:
   - `studio_audio_features(owner_slug text, feature text check in ('voiceover','stt','dubbing','music','clone','sfx',
     'voice_changer','voice_design'), enabled bool default false, updated_by text, updated_at, note, pk(owner,feature))`.
     `owner_slug` = an `approval_clients.slug` or an app/agent slug (maya, ava, …).
   - `studio_voice_consents(id, owner_slug, person_name, voice_id null, addendum_path, libresign_request_id,
     signed_at, scope jsonb default '{"per_post_approval":true}', revoked_at, revoked_by, created_at)`.
   - `studio_audio_jobs(code text pk (short, 7 chars), owner_slug, feature, requested_by, inputs jsonb, voice_id,
     consent_id, est_credits, est_usd, actual_credits, cost_usd, billed_usd, status quoted|confirmed|running|done|
     failed|held, held_reason, output_path, item_id null, provenance jsonb, created_at, finished_at)`.
   - `studio_audio_settings` row: `{markup_pct:20, reserve_pct:30, usd_per_credit:<from plan>, scribe_when:[...]}`.
   - **Gates (triggers, fail closed):** clone feature can't be `enabled` without an active consent row; a `clone`,
     `dubbing` or `voice_changer` job that uses a person's cloned voice needs `consent_id` of an active consent;
     only Jared's staff id may change `studio_audio_features` (RPC checks `4a612167-…`), EXCEPT the client may set
     `clone` → false on her own slug (board token RPC `client_voice_off`).
   - **Revoke:** `client_voice_off` / consent revoke → clone off, all `held`/`quoted`/`confirmed` jobs with that
     consent → failed('consent revoked'); every approval_item whose `provenance.ai_audio[].consent_id` matches and is
     not posted → blocked by `trg_items_stage_gate` (add the check); posted stays up. Spark deletes the voice from
     ElevenLabs within the hour (logged; reversible only by a new signed addendum + re-clone).
   - **Per-post approval for cloned voices:** `social_enqueue_item` refuses an item whose provenance carries a clone
     consent unless the client approved THAT content_version (reuse `studio_signoff` logic).
   - **Provenance:** every job that lands on an item appends `{feature, job_code, model, voice_id, voice_name,
     consent_id, ai_generated:true}` to `approval_items.provenance.ai_audio`. Library shows an "AI audio" badge.
   - Billing view `studio_audio_billing` (month × owner): cost_usd, billed_usd = cost × (1 + markup) for kind=client,
     0 for house. Feeds invoices later (Libra).
   - Seeds: house brands + bestly-studio → every feature ON except clone; re-demo → every feature ON except clone;
     centering-you → all OFF; app slugs maya, ava → voiceover, stt ON. Add `studio_*` RPCs to `security_public_rpcs`
     only if a public key calls them (board token RPC does).
2. Edge fn `studio-audio` (verify_jwt false, staff token / board token / service key; read live verify_jwt before any
   redeploy): actions `quote`, `run` (requires `confirmed:true` from a quote ≤ 30 min old), `status`, `features`
   (get; set = Jared only), `consent` (record signed addendum / revoke). Before every run: GET
   `/v1/user/subscription`; if `remaining − est < reserve_pct × limit` → `held('credits')`, Spark alert, no call.
   If the account can go past plan (usage-based billing on) → one Spark money alert telling Jared to switch it off.
   Feature → API: voiceover `/v1/text-to-speech`, sfx `/v1/sound-generation`, music `/v1/music` (verify plan allows
   commercial use before anything with music publishes; if not, hold and alert), dubbing `/v1/dubbing` (async; cron
   polls), voice_changer `/v1/speech-to-speech`, voice_design design+save, clone `/v1/voices/add` (IVC; only with
   consent), stt Scribe `/v1/speech-to-text`. Output → storage `studio-audio/<owner>/<code>.<ext>`, short link
   `bestly.tech/a/<code>` (add route like `/v/<code>`), never a raw signed URL.
3. STT routing: default Whisper on the Pi (Track B); Scribe when the transcript becomes client-facing captions,
   is a dubbing source, or Whisper's avg logprob is low. Recorded on the job.

## Track A2 — Spark (`studio-chat`)
- Tool `make_audio`: `quote` (returns plain text: "Voiceover, 41 sec, ~620 credits, about $0.11. Credits left after:
  58%.") → Spark shows it and waits for Jared's yes → `make` with `confirmed:true` → `status`. Spark never runs a
  generation without a yes in the thread. Same for every feature. Results post to the thread + bell, signed Spark.
- Spark respects the switches (off = says which switch and that only Jared can flip it).

## Track A3 — Studio UI (staff, ship) and board (client, PREVIEW ONLY)
Apple HIG skill first, then ui-ux-pro-max. Numbers never wrap from units; no "…" truncation.
- **Studio › Settings › Audio** (per client): 8 rows with switch + one-line plain description; switches enabled only
  for Jared, read-only for Eli. Header: credits left this cycle + reset date, this month's spend per client
  (cost / billed). Clone row shows consent state: "Locked — needs signed addendum" / "On — signed Oct 12, 2026" /
  "Turned off by client". Button "Prepare consent addendum" drafts it in LibreSign (does NOT send; Jared sends).
- **Library / post detail:** "AI audio" pill + provenance popover (feature, voice, model, consent, job code).
- **Board (client):** "Your voice" card: status in plain words + a switch that can only turn her voice OFF (turning
  on = "Ask Bestly to send the consent form"). Ship as a `?preview=` build; Jared approves before it goes live.

## Track B — Montage + Pi (Sonnet "montage-pi")
1. Retire the auto-Piper fallback (answer 20): when ElevenLabs is unavailable, below reserve, or errors → the Montage
   job goes `held` with reason, Spark alert (credits = money → push; outage → info), and the job resumes on its own
   when credits reset or the API answers (requeue loop in worker, check every 30 min, give up after 7 days → failed +
   alert). Keep the Piper code path only behind `montage_settings.voice.provider = 'piper'` (manual switch).
   Update bestly_memory `studio/montage-voice` and `tools/montage/README.md`.
2. Montage asks `studio_audio_features` (voiceover for that brand) instead of only `ai_voice_ok`; logs each video's
   voice as a `studio_audio_jobs` row (house brand, cost tracked, `requested_by:'montage'`) so spend is in one place.
   Montage is pre-approved daily automation for house brands, so it does NOT need a per-video quote/yes.
3. Whisper on the Pi (free STT): faster-whisper `small.en`/`small` int8 service, job queue via
   `studio_audio_jobs(feature='stt', status='confirmed', engine='whisper')`; writes transcript + avg logprob. Check
   first that nothing like it already runs on the Pi (CLAUDE.md "check whether the bot exists").

## Track C — Watchdog, team, memory (audio-core finishes)
- Cron `audio-watch` every 10 min (edge fn or SQL): API reachable, credits vs reserve, stuck jobs (requeue once then
  fail + tell thread), dubbing poll, consent integrity (any clone use without active consent → block + alert),
  usage-billing flag. Alerts via `scout_notify` signed **Spark**, prefix `audio:` in `notification_owners`.
  Only money/credits interrupt; the rest goes to the recap.
- `team_onboard`: tool `elevenlabs-audio` under Spark, pulse = audio-watch, owns `audio`.
- bestly_memory: `studio/elevenlabs` (how it works, gates, where switches live), update `studio/handoff`,
  `studio/montage-voice`. Commit + push repo (migrations, functions, docs, tools).

## Done means
- Jared can flip any of 8 switches per client in Studio; Eli can't; the clone switch refuses without a signed consent.
- Spark quotes $ and waits for yes, then makes audio; every file carries AI provenance and a short link.
- Credits never go past plan; low credits pause work and Spark tells Jared once.
- Montage no longer silently falls back to Piper.
- Board "Your voice" card exists as a preview for Jared to approve.
- Tests: forced low-credit hold, clone-without-consent refusal, revoke blocks an unposted item, Eli flip refused,
  one real voiceover + one sfx + one Whisper transcript on a house brand.

## Open items that need Jared (none block the build)
- Send Elizabeth the consent addendum when he chooses (Centering YOU stays locked until then).
- Confirm the ElevenLabs plan's music license covers commercial posts (agent checks the docs; holds music if not).
- Platform AI label: if a platform's API has no AI-label field, that post routes to the manual Post button with a
  "turn on the AI label" step — agent reports which platforms.

# Bestly Agent ad (Montage) - Opus plan, executed by Sonnet

Jared, 2026-10-12, 9:38 PM PT: "Make an ad for our new product Bestly Agents." Plan by Opus, executed by Sonnet. Everything is filed by Spark, internal only (Studio > Drafts > To review). Nothing is posted or sent.

## What the product is (the only facts the ad may use)
Bestly Agent is an AI receptionist (her name is Maya) that answers a business's phone and does the work: books appointments, answers questions, and connects to the apps the business already uses (calendar, customer list, help desk, payments, crew schedule; 120+ apps, new connections usually the same day). Calls, texts, website chat, email and WhatsApp in 90+ languages, and the owner sees every call. Plans: Lite $49 a month (30 min), Starter $199 a month (150 min), Growth $499 a month (500 min). No setup fee, 30-day money back, cancel anytime. Demo: bestly.tech/agent (H1 "An AI receptionist that answers your phone and does the work."). Sources: `bestly_memory` agent/* and maya/*, the /agent page, Maya's KB doc "Maya KB - Bestly Agent".
No invented stats, customers or claims. No compliance claims (HIPAA etc.). No absolutes (never / always / guaranteed).

## Jared's rules for this work
- Least-informed viewer: in the first 2 seconds it must be obvious what this is (an AI receptionist that answers your business phone). Hook = the pain (missed calls). Plain words; "omnichannel", "LLM", "agentic" are banned.
- Every video has music (Montage music library + rule `studio/rule-music-every-video`). Graphics, not bland. Closing card in Inter (modern sans) like Bestly Cloud's. Feathered effects, no "...".
- Money: nothing paid without Jared's yes. No b-roll orders (LTX). No new music generation. The ElevenLabs voice (about 5 cents a video) is pre-approved by the standing Montage setup.
- Run on the Pi with free AI first. Filed by Spark, internal only.

## Plan (as given)
1. Studio house client `bestly-agent` (kind house, code prefix BA) set up like bestly-cloud: approval_clients row, a real claim rule pack from the facts (the claim gate fails closed), `montage_brand_policy` montage_ok, voiceover switch, posting target.
2. Montage brand `brands/bestly_agent.py` on the shared `comp/brand` (BrandShort): product facts, palette, Inter end title, icons (phone, calendar, chat, globe, check, tag), end-card chips validated by the chip validator and claim check, CTA bestly.tech/agent. Voice = Maya's own ElevenLabs voice. Music moods confident/upbeat from the existing library (a brand with no tracks of its own must be able to borrow). Optional free "call screen" scene from the /agent demo assets.
3. Two vertical 1080x1920 ads filed as two Studio posts: "Missed call" hook (~20-25 s) and "What she does" (~30 s), each with a plain 2-3 paragraph caption with the CTA (Instagram variant).
4. Deploy to the Pi (back up `.bak_agentad_20261012`, py_compile, restart bestly-montage, heartbeat), enqueue both jobs through `montage_enqueue` as Spark, watch, LOOK at frames and listen-check (Whisper transcript, music under the voice), re-cut if bland or unclear; verify yuv420p / tv / bt709.
5. Stills and mp4s to /tmp/claude-0/sp/agent-ad/.
6. Commit (rebase), push; add the brand wherever per-brand lists exist.
7. Memory row `agent/ad-2026-10-12` (written_by Spark).

## Refinements while executing
- **Scripts are hand-written, then gated.** The shared writer forbids numerals, prices and links (right for Cloud, wrong for an ad that must say "$49 a month" and "bestly.tech/agent"). Added opt-in brand flags in `brands/_common.py` (`allow_numbers`, `allow_links`, `extra_check`, `chip_topics`, `number_rule`, `icon_help`); every other brand is untouched. The two ads are fixed scripts in `brands/bestly_agent.py` selected by a `[ad:...]` tag in the brief. They still pass `_common.check`, the database claim rules (13 rules, `claim_check('bestly-agent')`) and a number guard (`extra_check`: only $49 / $199 / $499, 30 / 150 / 500 minutes, 90+ languages, 120+ apps, 30 days). A brief with no tag, or a re-cut with a Changes note, goes through the free-AI writer with the same gates.
- **Claim rules.** 10 hard (price not on the plan list, minutes not on the plan list, money-back window, terms not offered, compliance, invented proof, absolute or availability promise, results or replacement, passes as human, named app or vendor) and 3 soft (jargon, channel not wired yet, fear bait). Active but unapproved (like Cloud and Studio): Jared reviews them in Studio > Settings > Claim rules. Montage treats a soft hit as a failure too.
- **Email and WhatsApp stay out of the video copy** (soft rule): `agent/page-copy-rewrite-2026-10-11` says the page lists them but they are not wired for Bestly customers yet. The ads say "calls, texts and chat".
- **"Answers every call" and "cancel anytime" are not used**: both read as absolutes under Jared's rule. Chips say "Answers your calls" and the copy says what the plans include.
- **No voiceover switch exists.** There is no `studio_audio_features` table in the live project (the worker treats a missing table as "only `ai_voice_ok` decides"), so there was nothing to turn on. `ai_voice_ok` is true.
- **Posting target.** No house-brand -> social account mapping table exists yet (the "house post button" work had not landed). `social_brand` is `bestlyagent`, which has no account, so nothing can post. When the mapping exists: bestlyagent -> @bestly_llc.
- **Music borrowing.** `montage_music_pick` / `montage_music_ready` now let a brand with no track of its own and no shared track borrow from the other Bestly-branded house clients (bestly-cloud, bestly-studio). Migration `20261013050000_bestly_agent_house_client.sql`.
- **Maya's voice** is "Hope - upbeat and clear" (`tnSpp4vdxKPjI9w0GnoV`), a licensed ElevenLabs library voice, the voice on her agent (`agent_3701m4jbjnyef6ga4ys73xtbz37s`). Not a cloned person, not Sarah, not used by another Montage brand.
- **Graphics added to `comp/brand`** (all optional per brand, others render as before): `accent2` second glow color, `hlNumbers` (prices in the accent), `end.orb` (Maya's orb as the closing-card hero), a scene `card` (phone call card: ringing, then Missed call; then Answered by Maya, Appointment booked; fictional caller portrait and a made-up business logo from `public/agent-demo`), icons `phone`, `missedcall`, `apps`, `globe`.

## Scripts
See the bottom of this file ("Result") for the final scene lines, post codes and costs.

## Result (2026-10-12, Spark)
Two Studio posts in Drafts > To review (nothing posted or sent): **BA01** "Bestly Agent ad: missed call" (26 s) and **BA02** "Bestly Agent ad: what she does" (32 s). Both 1080x1920, yuv420p / tv / bt709, about -16 LUFS, music under the voice (9 dB duck). Each has a caption and an Instagram variant.
- BA01 media: https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/review/video/bestly-agent/montage-cc916299-80d8-43e8-b2ae-2f7a59793c66.mp4
- BA02 media: https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/review/video/bestly-agent/montage-d2c5d93d-c3e4-408e-860c-7cbd79502fd1.mp4

Scene lines. BA01: "A missed call can send a customer elsewhere." (ringing call card, then Missed call) / "Maya answers your business phone." (Answered by Maya, Appointment booked) / "She books appointments and answers questions." / "From $49 a month." / closing card (Bestly Agent, Inter; chips Answers your calls, Books on your calendar, From $49 a month; bestly.tech/agent).
BA02: "Meet Maya. She answers your business phone." (call card) / "She books appointments and answers questions." / "She connects to the apps you already use." / "Calls, texts and chat in 90+ languages." / "From $49 a month." / closing card (chips Calls, texts, chat; 90+ languages; From $49 a month).
Voice: ElevenLabs "Hope - upbeat and clear" (Maya's own voice). Music: borrowed Bestly Studio beds (BA01 upbeat 35s, BA02 confident 35s). Whisper listen-check matched both scripts word for word (Whisper heard "slash" as a dot, and "Hear" as "Here").
Cost: 4 voice takes (two first cuts, two re-cuts for the price-line wrap and a call card on the opening scene of ad 2), about 27 cents total; everything else $0. No b-roll, no new music.
Re-cuts: a re-cut marked `[recut-ad]` in the revise note keeps the hand-written script (`brands/bestly_agent.py`); any other re-cut note goes to the free-AI writer with the same gates.

Open for Jared: review the 13 claim rules (Studio > Settings > Claim rules); a house-brand to @bestly_llc posting map does not exist yet; there is no voiceover switch table.

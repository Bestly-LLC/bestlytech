# Montage opusplan: every product, AMD credits, and the two brands that stay human

Written 2026-10-06 (Opus) for execution by Sonnet agents. Owner: Spark (Head of Marketing & Content). Montage is Spark's tool.

Jared, 2026-10-06: "montage should be able to make videos for all products minus centering you and realestate, we need our
own plans with those. Centering you she is recording her own videos, do not want AI videos in her videos. Real Estate, we
have to be careful about AI videos as well, if anything i want it to be legal and kinda do what Autoreel app does."
Also: AWS connector reconnected; Bestly is in the AMD AI Developer Program (AMD Developer Cloud GPUs + Fireworks AI credits).

## Where things stand (start of this plan)
- Montage (OpenMontage on the Pi, `tools/montage`, systemd `bestly-montage`) makes HOKU shorts: free-AI script inside
  HOKU's claim rules, Piper voice, HokuShort composition, optional LTX b-roll, files to Studio, posts to the Spark thread.
- Spark's `make_montage` tool (studio-chat v25) quotes, starts and tracks it. Changes notes re-cut the same item.
- LTX box (AWS g5.2xlarge) renders clips; vertical support is committed but not on the box (`tools/ltx-box`).
- Only `hoku` is allowed (`montage_quote` hard-codes it).

## Rules this plan adds (enforced in code, not by memory)
1. **No AI footage, voice or generated imagery for Centering YOU** (`centering-you`, `demo-two`). Elizabeth records her
   own videos. Montage refuses these clients; `make_video` (LTX) refuses them too.
2. **Real estate (`listings`, `re-demo`) gets no generative video at all.** Only the real listing photos, animated with
   camera moves (pan/zoom/crossfade). See the real-estate plan below; until it ships, Montage refuses these clients.
3. One table decides it: `montage_brand_policy (client_slug, montage_ok, ai_footage_ok, ai_voice_ok, note)`.
   `montage_quote`, `montage_start`, `ltx_request` (when called from a Spark thread on that client) and the Pi worker
   all read it. Default for an unknown client: refuse.

## Track A: Montage for every other product (Sonnet agent "brands")
Clients: `hoku` (done), `inventoryproof`, `cookie-yeti`, `bestly-cloud`.
1. Generalize the design: `comp/brand/BrandShort.tsx` (copy of HokuShort driven by a `brand` prop: palettes, fonts,
   logo files, closing card title/cta/image). Keep `comp/hoku` as is (it works; do not regress H01/H02).
2. Brand registry: `worker.brand_for(slug)` imports `brands/<slug with - as _>.py`; refuses if the policy row says no.
3. One writer per brand, reusing the facts and claim checks that already gate the daily posts:
   - Cookie Yeti and InventoryProof: `jobs/brand_maker.py` BRANDS[...] `about` + `claim_check(<claim slug>)`, STATS/PRICE
     regexes, the REVIEW fact-check pass.
   - Bestly Cloud: `jobs/bestly_social.py` PRODUCT text (its "ONLY things you may say" list) + `claim_check('bestly-cloud')`
     if rules exist, else the same regex gates.
   - Shared rules for all: no stats, prices, emoji, hashtags in the video; numbers stay with their units (no-break space).
4. Assets: fonts/logos/mascot art from the existing card kits (Pi `/opt/bestly/social-kit`, storage used by edge fn
   `social-render`, the brands' repos). Never draw or invent a logo.
5. B-roll shot rules per brand (no faces to camera, no text/logos/products; for apps: no fake UI, phones only as dark
   silhouettes).
6. `montage_quote`/`montage_start` read the policy table; Spark's `make_montage` description lists brands from it.
7. Test: one free text-only job per new brand through `montage_start` (thread = a Spark test thread), look at frames,
   fix, then file. B-roll on one brand only if the quote is under $1.

## Track B: LTX box (Sonnet agent "ltx")
1. Push `tools/ltx-box/make-video.py` + `ltx-worker.py` to `/opt/ltx/` over SSM, restart `ltx-worker`, verify sha256.
2. One 3-second 704x1280 test clip (source `claude`), confirm the file is vertical, note the cost.
3. Fix the multi-clip overcharge in `ltx_request`: only the first clip queued while the box sleeps gets `woke_box`.
4. Policy guard in `ltx_request` for Centering YOU / real-estate threads (rule 1-2 above).
5. If the capacity error repeats (g5.2xlarge, us-west-2b), write down the options (other AZ via snapshot, g6/g6e), do
   not move the box without Jared.

## Track C: AMD credits (Sonnet agent "amd")
- **Fireworks AI** (OpenAI-compatible inference on AMD Instinct): add a rung to the Pi free-AI ladder
  (`/opt/bestly/cron/freellm.py`) right after FreeLLM's named writers, reading Vault secret `fireworks_api_key` via
  `pi_secret`; skipped silently when the key is missing. Pick a strong instruct model that Fireworks lists today.
  Same rung later for Scout (`supabase/functions/_shared/free-llm.ts`), not in this pass.
- **AMD Developer Cloud** (bare-metal MI300X, ROCm): plan + script only, no spend. `tools/ltx-box/amd/` with a ROCm
  ComfyUI + LTX install script and a worker config that claims from the same `ltx-box` edge function with its own box
  key, so it can serve the same queue when activated. Document start/stop and the credit balance check.
- Credential registry rows for both (`status = 'needed'` until keys exist). Jared's one step, same as Groq: activate the
  credits, create the key, add it to Vault as `fireworks_api_key` (never in chat).

## Track D: Centering YOU plan (not built in this pass; for Jared's yes)
Elizabeth films everything herself. Montage's job is editing, never generating:
1. **Script from a reference Reel** (ask writer): transcript + pacing + hook of a Reel she likes -> her script with
   second marks and what to film, in her words, inside CY's claim + crisis-resource rules. Lands in Asks.
2. **Finish her recordings**: when an ask upload lands (transcoded), Montage cuts dead air, word-level captions,
   audio clean-up, color match, 9:16 reframe, the deck graphic in the corner (the house rule), end card. No AI footage,
   no AI voice, no generated images, ever. Replaces the lost recut kit with code in the repo.
3. Optional: Spanish captions (her words translated, shown as captions only; never a cloned voice).

## Track E: Real-estate plan (not built in this pass; for Jared's yes) - "AutoReel, but legal by design"
Input: the agent's own listing photos (email to studio@ as today) + listing facts.
1. **Photo-to-video tour**: each real photo becomes a ~3 s clip with a camera move (Ken Burns pan/zoom, parallax at
   most), crossfades, 30-60 s, portrait and landscape, music, captions, agent branding (name, brokerage, license #),
   voiceover from Piper or the agent's own recording.
2. **Legal guardrails in code**: no generative video of the property; no AI changes to what a photo shows. Virtual
   staging or twilight edits only if the agent asks, and then every altered frame carries "Virtually staged" /
   "Digitally enhanced" on screen and in the caption (MLS/NAR and state rules). Fair Housing check on every line
   (the content bot's existing compliance pass). Brokerage name and license number on the end card. Photo rights:
   only photos the agent sent. No people in generated content, no AI avatar of the agent unless it is their recorded
   likeness with written consent.
3. Delivery: Studio board for the agent (approve / changes), optional auto-post.

## Watchdogs and Team
- Montage card already watches `montage-watch` and its heartbeat; new brands need no new card.
- Fireworks rung: provider failures already surface through the Pi ladder's error log; add nothing that pages Jared.
- AMD box (when activated): reuse `ltx-watch`; it already alerts on a box that started and never checked in.

## Done means
- Spark can make a video for HOKU, InventoryProof, Cookie Yeti and Bestly Cloud; refuses Centering YOU and real estate
  with a plain reason; each new brand has one filed test video that Claude looked at.
- LTX box renders native vertical; overcharge fixed; guard in place.
- Fireworks rung live (inactive until the key lands); AMD box script + doc committed.
- Tracks D and E written here, waiting on Jared.

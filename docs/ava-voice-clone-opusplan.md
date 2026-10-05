# Personal Ava in Jared's voice: opusplan (2026-10-04)

**Ask:** let personal Ava clone Jared's voice, with a toggle so she can make calls in his voice when he wants.

## TL;DR

- **Doable with the voice platform we already use.** A quick clone needs 1 to 3 minutes of clean recording. A high-quality clone needs 30+ minutes and a short voice check that Jared does himself.
- **A switch per call** in the personal dialer: **"Use my voice"**. Off by default. Personal Ava only, never RoofGuard.
- **She still says she's an AI.** In Jared's voice, her first line is "Hey, it's Jared's AI assistant, using his voice." She never claims to *be* Jared, and never agrees to anything as him.
- **Why the disclosure isn't optional:** US rules treat AI-cloned voices as "artificial voice" on phone calls (FCC, 2024), so calls to cell phones need the person's consent. A person who's told up front isn't misled. It also protects the people Jared calls from voice-clone scams, and protects his own voice.
- **Cost:** no extra per-minute charge. Cloning is included in paid voice plans; we confirm our plan tier at build time.

## How it works

1. **Record (Jared, about 3 minutes):** a "Your voice" card on /admin/ava. Record in the browser, or upload an iPhone Voice Memo. Quiet room, normal talking voice, a natural read of a short script we provide. For the high-quality clone: 30+ minutes, uploaded in parts, plus the in-app voice check.
2. **Clone:** an edge function action `voice_clone` stores the audio in a private Supabase Storage bucket (`ava-voice`, admin only) and creates the clone through the voice platform's API. It saves `ava_settings.jared_voice_id`, then deletes the raw audio from storage once the clone exists. A preview button plays a sample line.
3. **Use per call:** the dialer's personal mode gets a **"Use my voice"** switch, disabled until a voice exists. The call sends a per-call voice override (`tts.voice_id`). The agent must allow that override (`platform_settings.overrides…tts.voice_id`), and the opener and prompt switch to the disclosure version.
4. **Optional later:** a "Jared's voice for saved contacts" setting, so Mom hears his voice by default. Still with the disclosure line.
5. **Delete any time:** a "Delete my voice" button removes the clone from the voice platform and clears the setting, with an inline confirm.

## Guardrails

- Personal Ava only. RoofGuard can't use the setting (separate function, separate settings). Never on incoming calls unless Jared turns on the saved-contacts option.
- Prompt rules in voice mode: disclose in the first line; say she's AI if asked; never say "this is Jared"; never commit to money, plans or promises for him; take messages as usual.
- Every voice-mode call is tagged (`ava_calls.voice = 'jared'`) and shows a small "Your voice" label in the call list and sheet.
- **Reply guard adds `impersonation`:** in voice mode, a call with no disclosure in her first two lines, or any "this is Jared" / "I'm Jared", raises a high-severity Scout alert and switches voice mode off until Jared turns it back on.
- **Watchdog:** the line-health check also confirms the cloned voice still exists. If not, the switch greys out and Scout gets told.

## Build steps (Sonnet, when Jared says go)

1. Migration: `ava_settings.jared_voice_id`, `jared_voice_for_contacts bool default false`; `ava_calls.voice text default 'ava'`; private storage bucket `ava-voice` with admin-only policies.
2. `ava-assistant`: actions `voice_clone` (upload → clone → save id → remove raw audio), `voice_preview`, `voice_delete`. `call` accepts `voice: 'jared'` → per-call override + disclosure opener. Setup enables the voice override on the agent.
3. Reply guard `impersonation` check, and health check on the voice.
4. UI (Apple HIG): a "Your voice" card with a recorder (big round record button, timer, level meter, script text), upload, preview, delete; the dialer switch "Use my voice" with a one-line note "She'll say she's your AI assistant"; a "Your voice" label on calls.
5. Test: Jared records → preview → one call to his own cell in voice mode → check the disclosure line and the reply guard.

## What Jared does

- Record about 3 minutes once (or 30+ minutes for the best quality, plus the quick voice check in the voice platform's app).

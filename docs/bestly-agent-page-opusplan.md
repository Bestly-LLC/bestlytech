# Bestly Agent product page + live demo (/agent)

Planned with Opus 2026-10-11, built with Sonnet. Jared: "a true demo website page with Maya on it, multiple examples of her use cases for any industry, truly interactive. One panel has Maya, the other a mock desktop app window (a SaaS product, say). Click play, it plays a demo call with two different voices back and forth, the desktop window updates live, the transcript streams in the Maya panel. Show me what it looks like before push."

**Do not push until Jared approves the screenshots.** Commit locally on a branch `bestly-agent-page`; the CLAUDE.md always-push rule is overridden for this task by Jared's explicit ask.

## What Bestly Agent is (for the copy)

Bestly's own front end on ElevenLabs voice AI: a business gets an AI that answers its phone line (and its website), talks like a person, and does the work in the business's own tools: books, refunds, dispatches, logs. Maya ((213) 641-0074, and the "Talk to Maya" button on bestly.tech) is a live Bestly Agent.

Copy rule: written for the least-informed reader. Say what it does in plain words. No jargon ("LLM", "ElevenLabs", "API", "agentic") on the page. No emoji. No invented stats, customer logos or testimonials. Every business in the demo is fictional and the page says so once, quietly ("Sample calls with made-up businesses").

## Page: /agent

Route `/agent` (also `/bestly-agent` and `/demo` redirect to `/agent`). Light site theme for the page; the demo stage is a dark band (Maya's colors) so the light desktop window pops.

1. **Hero.** Eyebrow "Bestly Agent". H1 "An AI that answers your business phone." Sub: "It picks up every call, day or night, talks like a real person, and does the work while it talks: books the appointment, updates your software, and texts the confirmation." Buttons: "Watch a call" (scrolls to the stage and starts the default call) and "Talk to Maya live" (opens Maya's intro, voice first; reuse `MayaIntro`/`MayaScreenLauncher` path that MayaWidget already uses). Small line: "Or call Maya: (213) 641-0074".
2. **Demo stage** (the centerpiece, id `demo`). See below.
3. **What it does**: four plain cards. "Answers every call" (24/7, no hold music, no voicemail) · "Does the work" (books, refunds, dispatches, in the software you already use) · "Texts and emails for you" (confirmations, forms, links) · "Hands you the hot ones" (alerts you or transfers when a call needs a person).
4. **Works for any business**: grid of the five demo industries (each card loads that call in the stage and scrolls up) plus a sixth card "Yours" → "Tell Maya what you do and she'll show you how it would work" (opens Maya live).
5. **How it works**: 3 steps. "We learn your business" (hours, prices, policies, FAQs) · "Connect your phone and tools" (keep your number; we connect your calendar, CRM or helpdesk) · "Read every call" (each call comes with a summary; you can listen back).
6. **Try her right now**: "Maya is a Bestly Agent. Talk to her the way your customers would." Talk to Maya + call link.
7. **CTA**: "Get your own agent" → `/contact` (same target as Maya's `book_demo` off-Cloud). Pricing is **not on the page** until Jared sets it (open question).

SEO: SEOHead title "Bestly Agent: an AI that answers your business phone".

## The demo stage

Desktop (≥1024px): two panels side by side inside the dark band. Left ~380px: **Maya panel**. Right: **desktop window**. Above both: industry chips (`SCENARIOS[].chip`, radiogroup) and the scene line (`hook`). Below: the transport.

Phone (<768px): chips scroll horizontally (no truncation, full labels), the desktop window first (it is laid out for ~360px width, not a scaled screenshot), the Maya panel under it with the transcript capped to ~40vh and auto-scrolling. Tablet: stack the same way with more height.

### Maya panel (left)

- Header: Maya's orb (reuse the conic orb + `.maya-orb-live` from maya-widget.css), "Maya" and "{business} · AI agent", and a call pill: idle "Ready", ringing, then "On a call · 0:42" (mm:ss timer driven by the timeline clock).
- Caller row: initials avatar, caller name (appears when identified, before that the phone number), "Caller".
- Transcript: bubbles. Maya left with her tint; caller right, neutral. The current line types in word by word, synced to the audio (see Timeline). Past lines stay. Under Maya lines with `tool`: a small chip with a check icon ("Refunded $49 and emailed the receipt") that appears when that line's first event fires (or at line end if no events).
- Who is talking: the orb breathes while Maya talks; the caller avatar gets a soft feathered ring while the caller talks. Reduce Motion: static ring/orb, no breathing.
- End of call: an outcome card "Call handled in 1:08" + the three `outcome` bullets + "Play another call" (next chip) and "Talk to Maya live".

### Desktop window (right)

A believable but fictional macOS-style app window: traffic-light dots, title bar `windowTitle`, a slim menu-bar strip with `clock` (12-hour) and a "Bestly Agent connected" status dot. Inside: a sidebar (app sections, the current one selected) and the main area for the app kind. Light UI, 13–15px text, real-looking but not cluttered. Each app has seeded fictional data so it looks lived in before the call starts.

Changes Maya makes animate in place with a feathered glow (no hard-edged boxes) and a tiny "Maya" attribution tag on the changed item for ~2.5s. Toasts slide from the window's top-right corner and stay ~3.5s.

Event vocabulary per app (payloads in scenarios.ts):

- **helpdesk** (Ledgerly Support): inbox list + detail. `incoming` (new "Incoming call" row at top, ringing badge, selected) · `identify` (detail shows customer card: name, company, plan, seats) · `flagCharges` (billing table with two Oct 3 $49.00 rows, second flagged "Duplicate") · `refund` (that row → "Refunded") · `invite` (seats row with the invitee "Invited", seats count updates) · `resolve` (ticket status → Resolved, summary note card) · `toast`.
- **calendar** (Brightside Schedule): day view for tomorrow, 7:00 AM–1:00 PM, columns Dr. Patel / Dr. Lin / Hygiene with seeded blocks (initials + reason). `incoming` (side panel "Incoming call") · `findSlot` (the 9:30 AM Dr. Patel open slot glows) · `insurance` (side panel chip "Delta Dental · accepted") · `book` (block fills with patient + reason) · `note` (note appears on the block's detail) · `toast`.
- **dispatch** (Ridgeline Dispatch): board columns New / Assigned / On the way / Done + techs list (Luis on call, 12 min away; two off-shift). `incoming` · `newJob` (card in New, red "Emergency" label) · `address` (card gets the address) · `assign` (card moves to On the way, "Luis · ETA 9:40 PM", fee line; Luis's tech row → "En route") · `note` · `toast`.
- **crm** (Harbor & Pine Leads): pipeline New lead / Qualified / Showing booked, plus a listing panel. `incoming` · `listing` (listing panel shows address, details, price) · `lead` (card "Alex Kim" in New lead) · `qualify` (tags appear, card moves to Qualified) · `showing` (card moves to Showing booked with "Sat 11:00 AM · Sarah") · `toast`.
- **reservations** (Lume Reservations): Friday list by time with party sizes + a small floor map. `incoming` · `check` (7:30 PM rows show "Full for 6", the offered times glow) · `hold` (8:15 PM corner table held, dashed) · `name` (held row gets the name) · `tag` (chip on the row; tone warn = amber, good = green) · `confirm` (hold → booked, solid) · `toast`.

Card moves use FLIP-style transform animation (spring-ish ease, interruptible). Reduce Motion: no movement, just crossfade.

### Transport and interaction

- Big round Play/Pause (52px), Replay, Sound on/off (captions-only mode), and a progress bar with a dot per Maya action (seekable by click/drag and arrow keys). Time "0:42 / 1:08" (tabular numbers, never wraps).
- Switching chips stops the current call and loads the next one paused, at 0:00, with its window seeded.
- "Watch a call" in the hero starts the default scenario (saas-support).
- Space toggles play when the stage has focus. Everything is keyboard reachable with visible focus rings.
- Autoplay: never with sound. Optional: when the stage scrolls into view the first time, the window seeds and the Play button gently pulses once. No autoplay.

### Timeline engine (`useDemoClock`)

- Source of truth is time `t` (seconds). With sound: `audio.currentTime` (one `<audio>` per scenario, `preload="none"` until the chip is chosen or Play is pressed). Captions-only, or if the audio fails to load: a rAF virtual clock using the same timeline.
- Timeline JSON `public/agent-demo/<id>.json` (written by the audio pipeline): `{ id, duration, lines: [{ start, end, words?: [{ w, start }] }] }`. If the file is missing, estimate (`words / 2.7` seconds per line + `TURN_GAP_S`) so the page always works.
- Derived each frame (pure): current line index, words revealed (from `words` timings when present, otherwise proportional to time within the line), events whose absolute time (`start + at * (end - start)`) ≤ t, app state = `reduce(events, initialState)`. Seeking backwards just recomputes.
- Transcript region is `aria-live="polite"` but only announces completed lines (not each word).
- Failure: if audio errors, switch to captions-only silently, keep playing, and send `mayaDiag("agent-demo-audio", {...})` (existing helper) so the watchdog sees it.

### Visual direction

Run the Apple design skill (`.claude/skills/apple-design`) first, then a second pass with ui-ux-pro-max (`docs/skills-backup/ui-ux-pro-max`). Maya palette: #8E9BFF / #E59CFF on deep navy (#0E1030 → #161A45). Desktop window: white/very light gray with system-like UI, subtle shadow, 12px radius. Rules: feathered glows only (no hard-edged highlight boxes), numbers never wrap away from their units (`whitespace-nowrap` on amounts, times, phone numbers), no "..." truncation anywhere (wrap or shorten instead), 44px minimum tap targets, 12-hour times, US formats.

## Audio pipeline

- Edge function `agent-demo-tts` (verify_jwt true; service-role bearer only). Input `{ id, lines: [{ voiceId, text }] }`. For each line calls ElevenLabs `POST /v1/text-to-speech/{voice_id}/with-timestamps` (key via `ava_secret('elevenlabs_api_key')`, `output_format` mp3_44100_64, a model that supports timestamps, e.g. eleven_multilingual_v2; Maya's voice is `tnSpp4vdxKPjI9w0GnoV`), uploads each clip + alignment to Supabase Storage bucket `agent-demo` (private) at `<id>/<n>.mp3|json`, returns signed URLs. Never returns the key.
- Script `tools/agent-demo-audio/build.mjs`: reads the scenarios (import the TS via a tiny transpile or a JSON export), calls the edge function per scenario through the service role from `supabase` CLI env or via the `invoke_edge_function` SQL path, downloads the clips, concatenates per scenario with ffmpeg inserting `TURN_GAP_S` of silence between lines, writes `public/agent-demo/<id>.mp3` (mono, 64 kbps) and `<id>.json` (line start/end from the real clip durations and word starts from the character alignment of `say ?? text`; for lines with `say`, keep only start/end and let the page reveal proportionally). Re-running is idempotent; only scenarios whose text changed are re-recorded (hash in the JSON).
- Budget: roughly 6,000 characters of speech in total, one time.

## Site plumbing

- `src/App.tsx`: lazy route `/agent` + redirects.
- `src/config/products.ts`: add "Bestly Agent" card (`href: "/agent"`), plain description.
- `src/components/maya/siteTools.ts`: move `/agent` into `PAGE_PRODUCT` ("Bestly Agent"), keep `/bestly-agent` and `/demo` as aliases, remove "agent"/"demo" from NO_PAGE_YET; add SECTION_ALIASES for "demo", "example call", "how it works" on /agent.
- After Jared approves and it is pushed: rebuild `public/maya/site-index.json` with `tools/maya-site-index/build.mjs` so Maya can show the /agent sections.
- Nav: add "Agent" where products are listed in the header/footer if there is a product list there.

## Watchdog (Jared's rule)

- Client: the page falls back to captions-only on any audio failure (self-heal for the visitor) and reports it with `mayaDiag`.
- Server: extend `maya-watch` (already on Maya's team card, every 10 minutes) with an hourly-ish check (skip unless minute < 10) that fetches `https://www.bestly.tech/agent` (200) and every `/agent-demo/<id>.json` + `.mp3` (200, JSON duration > 20 s), and counts `agent-demo-audio` diag rows in the last hour. Problems go to the existing `maya.site` alert in Maya's voice ("The Bestly Agent demo calls are playing without sound: ..."). Nothing to auto-heal on a static file except the page fallback, so the alert says what to re-run (`node tools/agent-demo-audio/build.mjs`).
- Add `agent-demo-tts` to Maya's team card `tool_of` via `team_onboard` (same slug, idempotent) in a migration.

## Out of scope now (phase 2 ideas)

- A `play_agent_demo` client tool so Maya, live on the page, can say "let me play you a dental call" and start it muted with captions while she narrates.
- "Build your own demo": visitor types their business, free AI writes a script, page plays it with live TTS.
- Pricing section.

## Open question for Jared

- Pricing for Bestly Agent (setup + monthly? per minute?). The page ships without prices until he says.

## Verification before showing Jared

- `npx tsc --noEmit -p tsconfig.app.json` (only the two WowButton errors) and `npm run build`.
- Headless (Playwright, chromium at /opt/pw-browsers): load /agent at 1440×900 and 390×844; press Play with sound muted at the browser level; screenshots at ~0:15 and ~0:45 for saas-support and one other scenario, plus the end-of-call card; confirm events fired in order, transcript in sync with `audio.currentTime`, no console errors, no horizontal scroll on the phone, no text cut off.

# Opusplan: YouTube app verification kit (demo video + scope justifications)

Written 2026-10-15 (Opus) for a Sonnet agent. Owner: Spark.

Jared, 2026-10-15: "do for me: Record a short demo video of connecting and uploading. Write a sentence on why each
permission is needed, then submit."

## The hard line
An agent cannot sign in to Jared's Google account. That rules out four things:
- filming Google's consent screen for real
- running a real upload
- clicking Submit in Google Cloud Console
- getting the Search Console token

So the agent builds everything else, and leaves Jared one short, scripted job. Never ask for, store or handle his
Google password or cookies.

## Context (read first)
- Read these bestly_memory keys: `studio/youtube-connect-2026-10-15` and `studio/youtube-live-gate-2026-10-15`.
- Read `docs/handoff-studio-linkedin-pinterest.md` (the YouTube section).
- Google project: `bestly-studio`. The OAuth app is External, "In production (unverified)".
- Scopes: `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`.
- Redirect: `https://www.bestly.tech/connect/youtube.html`.
- Bestly-side pages:
  - Connect page: `public/connect/youtube.html`.
  - Setup page: `youtube-setup.html`.
  - The client portal's YouTube tile, on the `client_connect_tile` portal board.
  - The Studio post that gets "Posted on YouTube".
- Edge fns:
  - `studio-social`: `yt_setup` / `yt_start` / `yt_finish`.
  - `bestly-yt-poster`: `check`, `me`, `dryrun`, private `test` `{account_id, item_id}`.
- Uploads stay gated by `studio_yt_live()`, which is false. Do not flip it.
- Do not run `test` uploads; that is Jared's to-do.

## What Google wants (check the current Google docs before writing; do not trust memory)
Use web search/fetch on Google's OAuth app verification and sensitive-scope verification help pages. Confirm three things:
1. What the demo video must show.
2. That it must be unlisted on YouTube.
3. What the "scope justification" fields look like.

Typical requirements, to confirm:
- The video shows the app's home page and its privacy policy link.
- It shows the full OAuth flow, including the consent screen. The consent screen must show the app name and the
  browser URL bar with the client_id.
- It shows the app using each sensitive scope, in a real use.
- It is in English and uploaded as unlisted.

## Steps

### 1. Pre-flight check of the Bestly side (fix only blockers)
Use Playwright (Chromium at /opt/pw-browsers; never run `playwright install`) to check these pages:
- bestly.tech home
- `/privacy` (or wherever the privacy policy lives). It must mention YouTube data use and the Google API Services
  User Data Policy / Limited Use. If it does not, draft the addition, ship it in the normal way (repo page,
  commit to main), and list it in the report.
- `/terms`
- The connect page.

Also confirm the OAuth consent screen branding is consistent:
- app name
- logo
- home page, privacy and terms links, which must be on verified bestly.tech

### 2. The written kit: `docs/youtube-verification-kit.md`, plus a copy in Nextcloud if the bestly-files fn is easy
Write it paste-ready, in plain words, with no marketing fluff. Include:
- **Per-scope justification, 1–3 sentences each, tied to a visible feature:**
  - `youtube.upload`: posts the client's approved short videos to their own channel, only after they approve each
    post in Bestly Studio.
  - `youtube.readonly`: reads the connected channel's name/id to show which channel is connected and to confirm a
    post went live (status check).
  - Also say why narrower scopes don't work, if Google asks.
- **App description / "how will the scopes be used":** a short paragraph.
- **Data handling:**
  - What is stored: the refresh token in Supabase Vault, plus the channel id and title.
  - No sale, no sharing, no ads, no AI training.
  - Deletion on disconnect or request.
- **Click-by-click submit steps:**
  1. Google Cloud Console → `bestly-studio` → Google Auth Platform → Verification Center / Data access.
  2. Paste each field.
  3. Add the demo video link.
  4. Submit.
- **After that, the YouTube API Services audit form:**
  - the link
  - a pre-filled answer sheet for its likely questions (company, use case, quota, which API calls, how data is
    displayed and stored)
- **Prerequisites checklist:**
  - Search Console domain verification for bestly.tech (step 4).
  - The support email open item (`support@bestly.tech`, which needs a real mobile number). If it is not done, say
    plainly that the consent-screen support email is still a personal one. Decide whether that blocks submission;
    Google allows any owned email.

### 3. Demo video: agent records the Bestly parts, Jared records ~60 seconds of Google
- **Agent part:** a Playwright screen recording at 1280x720, saved under the scratchpad, and also uploaded to Storage
  bucket `review` at `review/youtube-verification/` for a stable link. Cover, in order:
  1. A title card naming the app (Bestly Studio) and its purpose, in one sentence.
  2. The bestly.tech home page.
  3. The privacy policy, scrolled to the YouTube section.
  4. Studio: a client post approved for YouTube.
  5. The client portal YouTube tile with the Connect button.
  6. The click that leads to Google (stop at the Google redirect).
  7. A clip of the result side, showing the connected channel name. Use the `zz-connect-test` account, which already
     has Jared's channel connected.
  8. The post showing "Posted on YouTube" / status. Use a dry run or the existing connected test state; never fake a
     real upload result. If there is no honest way to show it, mark it as Jared's part.
  - No secrets, tokens or client personal data on screen. Use the sandbox client.
- **Jared part:** a numbered shot list in the kit, at most 6 steps, using QuickTime "New Screen Recording" on his Mac:
  1. Open the connect link.
  2. Google account chooser.
  3. Consent screen, holding 3 s on the URL bar showing client_id, and on the scopes.
  4. Allow.
  5. Back on Bestly, the connected channel.
  6. The private test upload (`test` action), shown on his channel as Private/Unlisted.
  - Give him the exact URL to start from.
- **Stitching:** provide a one-paste command for his Mac that joins agent part + his part into one mp4, using ffmpeg if
  present (if not, give the brew install line). Also provide the YouTube upload steps (unlisted) and where to paste
  the link.

### 4. Search Console (prepare only)
- Find where bestly.tech DNS lives: check the docs, memory and the Vercel MCP domain tools.
- Write the 3-step flow for the kit:
  1. Jared clicks Add property → Domain in Search Console and copies the TXT value.
  2. He pastes it to this agent or a session.
  3. The record is added. If the Vercel or Cloudflare DNS tools can add a TXT record, say exactly which call; do not
     add anything now.

### 5. Ship
- Commit the kit, plan, any privacy-page change and the recording scripts to main.
- Commit message ends with:
  ```
  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012XxH5nqNCsavvpmvG2Vf7T
  ```
- Write bestly_memory key `studio/youtube-verification-kit-2026-10-15`, covering:
  - where everything is
  - what Jared still does
  - that `studio_yt_live` is still false

## Out of scope
- Flipping `studio_yt_live`.
- Real uploads.
- Creating Google accounts.
- The `support@` phone problem.

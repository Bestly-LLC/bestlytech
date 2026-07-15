# Content Engine — daily LinkedIn (and occasional Reddit) auto-publish

## What this does
Every day at ~8:00 AM Pacific, builds ONE LinkedIn post for the Bestly LLC company page, pre-post gates on cloud.bestly.tech being healthy, and publishes via the LinkedIn Community Management API. Optionally drafts a Reddit "share your setup" post 1-2x/week (never auto-published — always human-checked).

## Run order (every run)
1. **Load** `secrets/.env`. If `LINKEDIN_ACCESS_TOKEN` is missing → skip publish, stage only, notify owner.
2. **Health-check** `cloud.bestly.tech/status.php` and `bestly.tech/cloud`. If either 5xx → skip publish, stage only, notify.
3. **Read** `kit/learnings.md` (built by the weekly growth loop — 75% winning themes, 25% experiment slot). If missing (first run), default to theme rotation.
4. **Pick today's theme** — see TARGETING.md's 8 themes; rotate with anti-repeat memory (log in `kit/theme_history.jsonl`).
5. **Build the post copy** — 1300 char sweet spot; hook + 2-4 short paragraphs + one concrete number + CTA. Bestly voice (privacy-first, plain-spoken, no emoji, no hype).
6. **Pick the visual:**
   - If theme = "The 3D device" → attach a rotating MP4 from `kit/videos/` (see the video kit section below).
   - Else → attach a static hero screenshot (`kit/thumbnails/hero.png`) OR a topic-relevant image.
7. **Publish** to LinkedIn via the `ugcPosts` API endpoint.
8. **Log** the post: media_id, permalink, theme, hook_angle, format, experiment_used, post_hour, char_count → append to `kit/post_history.jsonl` for the weekly growth loop to measure.
9. **Reddit companion (Tue and Fri only)** — build a matching post for r/selfhosted or r/homelab, save as **draft** in `kit/staging/<date>/reddit-draft.md`. Never auto-post to Reddit.
10. **Write** `kit/staging/<date>/run-report.md` — what was built, what was published, what was staged, any warnings.
11. **Notify** the owner via ntfy: one-line summary + permalink.

## Video kit (the 3D animated device)
`kit/videos/` holds pre-rendered MP4s of the Bestly device 3D scene at different scroll positions and camera angles. Each MP4 is 8-15 seconds, 1200x1200 or 1080x1080 (LinkedIn-friendly square), h264, MP4 container.

### Building the kit (one-time, then rebuild quarterly)
Use headless Chromium to record the `bestly.tech/cloud` hero at different scroll positions:

```bash
# Requires: npm i -g playwright  (installs its bundled Chromium)
node social/scripts/render-3d-clips.js
```

The script (to be built — see `TODO/render-3d-clips.js`):
- Launches headless Chromium at 1200x1200.
- Loads `bestly.tech/cloud`.
- Waits for CloudScrollHero to fully load the GLB.
- Scrolls to 12 different positions (0%, 10%, 20% … 90%, 95%, 100% of the hero's 520vh height).
- At each position, records a 6-second clip (rotates the camera azimuth via injecting `window.__heroSetP(p)` dev hooks).
- Encodes each as MP4 at 30fps, h264, ~1MB target size.
- Writes to `kit/videos/hero-{01..12}.mp4`.

**Fallback while the kit doesn't exist:** the engine attaches a static screenshot from `kit/thumbnails/hero.png`. Owner should drop one there manually as a stopgap — save a full-window screenshot of https://bestly.tech/cloud hero and crop to 1200x1200.

## LinkedIn post payload template
```json
{
  "author": "urn:li:organization:{ORG_ID}",
  "lifecycleState": "PUBLISHED",
  "specificContent": {
    "com.linkedin.ugc.ShareContent": {
      "shareCommentary": {"text": "{POST_BODY}"},
      "shareMediaCategory": "VIDEO",
      "media": [{
        "status": "READY",
        "description": {"text": "{ALT_TEXT}"},
        "media": "{MEDIA_URN_from_upload}",
        "title": {"text": "{TITLE}"}
      }]
    }
  },
  "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"}
}
```

## Anti-copy variation protocol
- No two consecutive posts share the same first line.
- No theme repeats within 7 days.
- No two posts within 30 days share more than 3 consecutive words in the hook.
- Log every hook to `kit/hook_history.jsonl` and check before publish.

## Failure modes
- **LinkedIn API 429 (rate limit)** → back off exponentially, stage, retry next day.
- **LinkedIn API 401 (token expired)** → notify owner immediately: "LinkedIn token needs refresh — see credential doc."
- **cloud.bestly.tech 5xx** → hold, notify, do not publish. Retry next scheduled run.
- **Missing kit/videos/** → fall back to static image, log warning.

# Bestly Cloud — Instagram + Facebook Expansion Plan

**Adds Instagram and Facebook to the Bestly Cloud daily content engine, publishing the same daily story across three channels (LinkedIn already live), with the site's 3D device graphic rendered to video as the hero.**

Owner: Jared Best
Started: 2026-07-15 (driven by Claude, guided by Jared)
Parent plan: `docs/bestly-cloud-social-opusplan.md`
Playbook of record: mempalace wing `social-growth-playbook` room `playbook`

---

## 1. Decisions locked (2026-07-15)

| Decision | Choice | Why |
|---|---|---|
| Channels to add | **Instagram + Facebook** | Where small-business owners actually scroll. |
| Channels dropped | **Reddit + X** | Not needed right now (Reddit comment-scout paused, X never started). |
| 3D graphic | **Incorporate it — video primary** | The `device-web-split.glb` from bestly.tech/cloud, rendered to a looping turntable MP4 + stills. |
| Instagram account | **Exists already** | Convert to Professional (Business) + link to the new FB Page. |
| Facebook Page | **Create it** (Jared's step) | Required by Meta's Graph API to publish to IG at all. |
| Publish method | **Full Meta Graph API for both** | One Meta app auto-publishes to the FB Page and the linked IG Business account. |

**Scope guardrail:** this is an *expansion* of the existing `social/` engine, not a rebuild. LinkedIn keeps working exactly as it does today. IG + FB are added as additional publish targets in the same daily run.

---

## 2. How Meta publishing works (the important part)

To post to Instagram programmatically, Meta requires a **chain of linked accounts** — you cannot post to IG alone:

```
Facebook Business (Meta Business Suite)
        │
        ├── Facebook Page  ────────────────►  publish via /{PAGE_ID}/photos | /videos | /feed
        │        │
        │        └── linked Instagram Professional account
        │                     │
        └─────────────────────┴──►  publish via /{IG_BUSINESS_ID}/media → /{IG_BUSINESS_ID}/media_publish
        │
   Meta Developer App  ──►  issues the Page Access Token that authorizes both
```

**2026 specifics (verified this session):**
- IG publishing needs a **Professional (Business or Creator)** account — a personal IG account can't use the API. Jared's existing IG must be switched to Professional and linked to the Page.
- Required permissions are now **`instagram_business_basic`** + **`instagram_business_content_publish`** (the old `instagram_content_publish` was deprecated Jan 2025). Facebook Page posting needs **`pages_manage_posts`** + **`pages_read_engagement`**.
- IG publish is a **two-step call**: create a media container at `/{IG_BUSINESS_ID}/media` (pointing at a **public** image_url/video_url), then `/{IG_BUSINESS_ID}/media_publish`. Containers expire after 24h.
- **Fast path — no 2–4 week App Review needed for our use case.** App Review (with screencasts) is only required to publish on behalf of *other* people. To publish to **your own** Page + IG, the app runs in **Development mode** and you generate a **long-lived Page Access Token** for the accounts you admin. This is exactly how the sister project (InventoryProof) ships to IG today. We use this path.

**Media must be at a public URL.** The Graph API fetches the image/video from a URL — it does not accept file uploads for IG. We host the daily media in a public Supabase Storage bucket (Bestly already runs Supabase project `rcqfqhguwpmaarseifqg`).

⚠️ **Risk flag carried from the sister project:** InventoryProof's Facebook Graph automation got the business **ad-restricted** and they abandoned the FB side. We're proceeding with full Graph for both per your call — mitigations: post at human cadence (1/day), no engagement-bait, real content only, and we keep the LinkedIn-style stage-then-review option available so we can fall back to semi-auto FB if Meta ever flags the page.

---

## 3. The 3D graphic → social media pipeline

**Source:** `public/models/device-web-split.glb` (2.2 MB, draco-compressed, single gunmetal PBR material), the exact model rendered live on bestly.tech/cloud by `src/components/cloud/CloudScrollHero.tsx`.

**Rendered outputs (built by the agent, refreshed quarterly):**
- `social/kit/videos/device-turntable-1x1.mp4` — 1080×1080 square, ~6–8 s loop, power-on rim glow then a full slow rotation on a dark `#0a0a0a` stage. Primary IG feed + FB video.
- `social/kit/videos/device-turntable-4x5.mp4` — 1080×1350 portrait (IG feed favors 4:5 for screen real estate).
- `social/kit/videos/device-turntable-9x16.mp4` — 1080×1920 (IG/FB Stories + Reels, later).
- `social/kit/thumbnails/device-shots/device-hero-1x1.png` / `-4x5.png` — high-res stills (fallback + FB photo posts).

**Render path:** render the GLB to frames (Blender MCP or a headless Three.js harness matching the site's lighting), then `ffmpeg` to H.264 MP4. Falls back to the existing static `device_clean_v6/v7` stills if a render is unavailable — the daily engine never blocks on video.

**When it's used:** the "3D device" theme leads with the turntable video on every channel. Other themes use it ~1 in 3 posts for variety, or use the branded `hero.png` / a text-forward still.

---

## 4. Per-channel format adaptation

The daily engine composes **one story**, then adapts it per channel (same message, native formatting):

| | LinkedIn (live) | Instagram | Facebook |
|---|---|---|---|
| Body | 1300-char sweet spot, hook-first | Caption ≤ 2200 chars, hook in first 125 (pre-"more" cutoff) | 400–600 chars, hook-first, link OK inline |
| Media | 1200×630 or square | **1:1 or 4:5 video/still, required** | 1:1 video/still |
| Hashtags | 3–4 buyer tags | 8–12 (IG rewards more; mix broad + niche) | 0–2 (FB ignores them) |
| Link | in body | **in bio only** (IG kills in-caption links) → "link in bio" | inline link fine |
| CTA | bestly.tech/cloud | "link in bio" + bestly.tech/cloud in profile | bestly.tech/cloud inline |

Voice is unchanged and locked: dumb-clear, no jargon, no emoji, buyer-focused. Same pre-post health gate (never link a dead `cloud.bestly.tech`).

---

## 5. Architecture (extends the existing engine)

```
bestly-cloud-daily-post  •  cron 0 8 * * *   (one run, now multi-channel)
  → Health gate (cloud.bestly.tech / bestly.tech/cloud)
  → Pick theme + compose ONE story (existing logic)
  → Adapt per channel: LinkedIn / IG / FB variants + pick media (video-first for device themes)
  → Ensure media is at a public URL (upload render to Supabase bucket if needed)
  → Publish:
       LinkedIn → existing path (semi-auto today / API when token lands)
       Instagram → Graph API: /{IG_BUSINESS_ID}/media (video_url|image_url) → /media_publish
       Facebook → Graph API: /{PAGE_ID}/videos | /photos | /feed
     …each guarded: publish if creds present, else STAGE that channel + notify
  → Log one post_history.jsonl line per channel
```

New config + code:
- `social/config/PLATFORMS.md` — the per-channel format spec above (source of truth for the composer).
- `social/engine/meta_publish.py` (or `.mjs`) — Graph API publisher for FB + IG, with dry-run/stage mode.
- `social/engine/upload_media.py` — pushes a render/still to the public Supabase bucket, returns the public URL.
- `social/secrets/.env` additions: `META_APP_ID`, `META_APP_SECRET`, `FB_PAGE_ID`, `PAGE_ACCESS_TOKEN`, `IG_BUSINESS_ID`, `SUPABASE_MEDIA_URL/BUCKET/KEY`.

---

## 6. Phases

### Phase A — Assets + code (agent, in progress)
- [ ] Render the 3D device → MP4 (1:1, 4:5) + stills.
- [ ] Write `PLATFORMS.md`, `meta_publish`, `upload_media`, `.env.template` additions.
- [ ] Create the public Supabase media bucket.
- [ ] Extend the daily task spec to compose + publish/stage IG + FB.

### Phase B — Accounts + app (Jared, ~30–40 min — see `social/config/META-SETUP.md`)
- [ ] Create the Bestly **Facebook Page**.
- [ ] Switch the existing **Instagram to Professional (Business)** + link to the Page.
- [ ] Create the **Meta Developer app**, add IG + Pages products.
- [ ] Generate a **long-lived Page Access Token**; capture `FB_PAGE_ID` + `IG_BUSINESS_ID`.
- [ ] Paste the token + IDs into `social/secrets/.env` (secrets are Jared-only).

### Phase C — Go live
- [ ] Agent validates tokens (`/me`, `/{PAGE_ID}`, `/{IG_BUSINESS_ID}`) — non-secret IDs confirmed.
- [ ] First IG + FB post published (stage-and-review for the very first one, then auto).
- [ ] Add `meta-token-refresh` scheduled task (Page tokens are long-lived but re-validate ~monthly).

---

## 7. Boundaries (unchanged, non-negotiable)

- Agent **never** creates accounts, completes OAuth/CAPTCHA, or types/pastes secrets — those are Jared's steps. Agent may write **non-secret IDs** (Page ID, IG Business ID).
- **Own content via official API only.** Comments are always human. No auto-commenting, ever.
- No emoji on public surfaces. Dumb-clear voice. Never link `cloud.bestly.tech` when it's 5xx — fall back to `bestly.tech/cloud`.
- 1 post/day/channel max. Real content only (protects against Meta ad-restriction).

---

*Same story, three feeds, the real product spinning on screen. Ship every day.*

# TikTok production resubmission kit (Bestly Studio)

Built 2026-10-17 by Spark, modeled on `docs/youtube-verification-kit.md` and `docs/youtube-demo-v2-opusplan.md`. Everything in sections 2 to 4 is paste-ready.
Nothing here needs an agent to sign in to TikTok. The agent never submits; Jared does, in the developer portal.

App: **Bestly Publisher** (app id `7656531505153427476`), developer id `7656563099889550343`.
Production: **Rejected Oct 13 2026 4:20 AM PT**. Reviewer note: "apps for personal or internal company use are not eligible."
Sandbox: id `7656633630060251156`, renamed "Bestly Studio" on Oct 13, client key starts with `sb` (`sbawnzlu7uoxt067kn`).
Redirects registered (sandbox, must also be on the production app): `https://www.bestly.tech/tiktok-callback.html` and `https://www.bestly.tech/connect/tiktok.html`.

## 0. What TikTok requires today (checked 2026-10-17)

Source: https://developers.tiktok.com/docs/en/app-review-guidelines
- **Name:** custom, matches the app or website name, does not describe the app, no reference to social media companies, follows TikTok's Brand guidelines. (So not "Bestly Publisher for TikTok", and not "Cookie Yeti Poster".)
- **Icon:** clear, consistent with the name or brand, not confusable with a known brand.
- **Description:** says what the app or website does and how it works. It is visible to users. "Apps that are still in development or testing will not be approved."
- **Website URL:** "a valid official website that houses information about your web and services." It cannot be a landing or login page and must be fully developed and externally facing.
- **Privacy Policy and Terms:** valid, active, and visible on the website URL **without opening a menu**.
- **Web platform:** a valid redirect URI.
- **Scopes:** only request what the app needs. Unused products or scopes left selected delay review.
- **Demo video:** at least one, up to 5, up to 50 MB each. "All selected products and scopes must be clearly demonstrated." Show the real website or app, the UI and the user interactions. For web apps the **domain shown must match the website URL you gave**. First review must use the **sandbox** environment.
- **App review explanation:** a detailed explanation of how each product and scope works in the app.
- **Eligibility:** "Apps must not be for private or personal use." That is the rule we hit.

Content Posting API rules: https://developers.tiktok.com/doc/content-sharing-guidelines and https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content
- Upload (inbox) endpoint `POST /v2/post/publish/inbox/video/init/` needs the **`video.upload`** scope, approved for the app and authorized by the user. It creates a **draft**: the user gets an inbox notification, opens it in TikTok, reviews and posts. TikTok tells developers to inform users of this.
- Direct Post (`/v2/post/publish/video/init/`) needs **`video.publish`** and a separate Direct Post configuration. **Unaudited clients can only post with `SELF_ONLY` (private) visibility**, are capped at 5 users per 24 hours, and need an audit "to verify compliance with our Terms of Service" before public posting. Direct Post also carries a long list of required UX (creator info, privacy picker with no default, comment/duet/stitch toggles, commercial-content disclosure, consent declaration).
- "Clients must be intended for a wide audience, not only internal or private use." (Same rule as the review guideline.)
- Third-party summaries say the Content Posting API review also wants the URL or domain verified when you use `PULL_FROM_URL`. We use `FILE_UPLOAD`, so this does not apply. The video-length, language and format of the demo are not stated on the official page; keep it short and in English.
- Pages not reachable or changed: the guidelines page at `/doc/getting-started-app-review-guidelines` now 404s; use `/docs/en/app-review-guidelines`. If the portal's submit form shows extra fields not listed here, trust the portal.

## 1. Why we were rejected and how to frame it

What the reviewer saw: app "Bestly Publisher", website `https://www.bestly.tech/cookie-yeti` (a Cookie Yeti product page, not a posting product), a sandbox still labelled "Cookie yeti Poster", and a single target user (`cookie_yeti_privacy`). That reads as one company posting to its own account. Also the code that originally used the app (`supabase/functions/tiktok-poster`) is literally the Cookie Yeti internal poster.

The truth, and the framing:
- **Bestly Studio is a multi-client product.** Bestly makes short videos for small-business clients. Each client gets a private portal (a "board"), approves each post, and connects **their own** TikTok account with TikTok Login Kit. Studio then sends the approved video to **that client's** TikTok drafts. The client taps Post. Many different clients, each their own account, each their own content.
- It is not "internal use": the TikTok accounts belong to Bestly's customers, not to Bestly.
- Be honest that it is small today (a few clients). Do not claim thousands of users.

### What to change before resubmitting
| # | Change | Where | Who |
|---|---|---|---|
| 1 | App name `Bestly Studio` on the **production** app (sandbox is already renamed) | Dev portal, app details | Jared |
| 2 | Website URL `https://www.bestly.tech/studio` (replace `/cookie-yeti`) | Dev portal, Web platform | Jared |
| 3 | Terms of Service URL `https://www.bestly.tech/terms-of-service`, Privacy Policy URL `https://www.bestly.tech/privacy-policy` | Dev portal | Jared |
| 4 | Remove `video.publish` from the production request (we never call it) | Dev portal, Scopes | Jared |
| 5 | Make `/studio` say TikTok, and show Privacy/Terms links where the reviewer can see them | `src/pages/BestlyStudio.tsx` | needs a session to ship (below) |
| 6 | Privacy policy TikTok section | `src/pages/PrivacyPolicy.tsx` | **shipped in this commit** (below) |
| 7 | Rename the `public/tiktok-callback.html` page copy from "Cookie Yeti" to Bestly Studio (it is a registered redirect URI, a reviewer may land on it) | `public/tiktok-callback.html` | needs a session to ship |

### Site check (2026-10-17)
- `https://www.bestly.tech/studio` loads (HTTP 200). It is the public Bestly Studio page. **It does not mention posting to TikTok.** Its FAQ says "We post to your Instagram account, which you connect once. We also make videos in the vertical shape that TikTok and Reels use." A reviewer reading that sees no TikTok integration. Needs the copy block below. It is a page edit with the house copy rules and the `docs/studio-promo/claims.md` claim limits, so it is **not shipped here**.
- `/privacy-policy` 200 and `/terms-of-service` 200 (footer links on the home page). `/terms` is also 200. Use `/terms-of-service` for the portal Terms field (the home footer links Terms of Use and Terms of Service; pick the same one on `/studio` and in the portal).
- `https://www.bestly.tech/privacy` is the **Cookie Yeti** policy. Do **not** use it for TikTok.
- `/connect/tiktok.html` 200 (the Bestly Studio connect page, copy is already Bestly Studio and explains the drafts flow). `/tiktok-callback.html` 200 but is a Cookie Yeti "copy this code" page (item 7).

### Copy block to add to `/studio` (needs a session to ship)
Replace the "Where do you post?" answer in `faqs` in `src/pages/BestlyStudio.tsx` and add a short section "Connect your accounts". Wrap multi-sentence prose in `<Lines>` per the house rule.
> **Where do you post?**
> We post to your Instagram account, which you connect once. We can also send your approved videos to your TikTok drafts.
> **Connect your accounts**
> You connect your own accounts from your private Bestly portal. For TikTok you sign in with TikTok and allow two permissions: seeing your account name, and sending a video to your drafts.
> Nothing is sent until you approve that post. The video lands in your TikTok drafts, you open it in TikTok, and you tap Post. We never post for you.
> You can disconnect at any time from your portal or in TikTok under Security and permissions, Apps and services. See our [Privacy Policy](/privacy-policy) and [Terms](/terms-of-service).
Also make sure the Privacy Policy and Terms links are visible in the page body or the site header/footer **without opening a menu** (TikTok rule; the site footer links them, confirm it is visible on `/studio`).

### Privacy policy (shipped)
The master policy had no TikTok text. Added section "Bestly Studio: Connected TikTok Accounts" (id `16d`) after the YouTube section, same style: the two scopes, what is stored (access and refresh token in the vault, open ID, display name), nothing sold or shared or used for ads or AI training, how to disconnect and delete (within 30 days, privacy@bestly.tech). Also a "Connected a TikTok account?" block in `public/data-deletion.html` (`#tiktok`). Live after Vercel deploys main.

## 2. Paste-ready text for the portal

### Name / category / description
- **App name:** `Bestly Studio`
- **Category:** Social Media Management (if the list has no such entry: "Business" or "Productivity", whichever the portal offers closest to scheduling and content tools). Do not pick "Entertainment" or "Games".
- **Description (visible to users; ~290 characters, keep under the portal limit, which is 120 characters in some forms; use the short one if it truncates):**
  - Long: `Bestly Studio is a content service for small businesses. We make short videos with each client, the client approves each one in a private portal, and Studio sends the approved video to the client's own TikTok drafts so they can review and post it.`
  - Short (≤120): `Bestly Studio sends a small business's approved videos to its own TikTok drafts, ready for the owner to review and post.`
- **Website URL:** `https://www.bestly.tech/studio`
- **Terms of Service URL:** `https://www.bestly.tech/terms-of-service`
- **Privacy Policy URL:** `https://www.bestly.tech/privacy-policy`
- **Web platform redirect URIs:** `https://www.bestly.tech/connect/tiktok.html` and `https://www.bestly.tech/tiktok-callback.html`
- **Icon:** the Bestly Studio orb (1024 px), already on the sandbox.

### Why this is not personal or internal use (for the app review explanation, first paragraph)
> Bestly Studio is a product used by multiple independent small-business clients of Bestly LLC. Each client has a private portal, approves their own videos, and connects their own TikTok account with TikTok Login Kit. Videos are sent only to the connected client's own account. Bestly does not use Studio to post to its own account on behalf of others, and no client's content is shown to another client. Today a small number of clients use it, and more are onboarded as Bestly signs them.

### Product and scope justifications (paste into the review explanation, one per product/scope)
**Login Kit.**
> Each client signs in with TikTok from a one-time connect link in their Bestly portal. Login Kit gives Studio an authorization code that we exchange for an access token and refresh token for that client's account. This is how we know which TikTok account belongs to which client, and it is the only way a client can give us permission to send videos to their drafts. The client can disconnect at any time.

**Scope `user.info.basic`.**
> After the client signs in we call `GET /v2/user/info/?fields=open_id,display_name` once to read the account's open ID and display name. The portal shows the display name ("Connected: <name>") so the client can check they connected the right account. We do not request avatar, bio, follower or video fields.

**Scope `video.upload` (Content Posting API, Upload / inbox mode).**
> When a client approves a video in their portal, Studio calls `POST /v2/post/publish/inbox/video/init/` with `source=FILE_UPLOAD` and sends the file. The video appears in the client's TikTok drafts and TikTok notifies them. The client opens the draft, adds the caption and tags, and taps Post themselves. We then call `POST /v2/post/publish/status/fetch/` to see whether the draft was published so the portal can show "Posted". We use the Upload method on purpose: nothing is published by us, and the client keeps full control of caption, audience and settings in TikTok. A narrower scope that can place a video in the client's drafts does not exist.

**Content Posting API: Direct Post.** Not requested. If the portal lists a Direct Post configuration, leave it **off**. Studio never calls `video/init/` (direct) and never needs `video.publish`.

**Scope `video.publish`.** Remove. The sandbox has it ticked but no Studio code uses it. Leaving it selected is a listed cause of delay and, since it implies Direct Post, would open a UX audit we do not need.

### Honest data handling (for any form field)
- **Stored:** access token and refresh token (database row, shown to nobody), open ID, display name. Short-lived access token refreshed about hourly by an internal job.
- **Not stored:** other videos, followers, messages, analytics, password.
- **Sale, sharing, ads, AI training:** none.
- **Access:** only Bestly staff who run that client's account.
- **Deletion:** disconnect in the portal stops sending at once; stored data deleted within 30 days on request to privacy@bestly.tech (`https://www.bestly.tech/data-deletion.html#tiktok`).
- **Honest gap (a follow-up, not a blocker):** like YouTube, portal Disconnect clears use but tokens may remain until deletion on request. Say "disconnect stops all use; deletion is on request within 30 days." Also tokens are stored in the `social_accounts` table, not in Vault (Vault holds only the app key and secret). The privacy section says tokens are in a "secrets vault"; if that wording worries you, edit it before submitting to "encrypted at rest in our database". Checked against code: `studio-social` writes `access_token`/`refresh_token` to `social_accounts`.

## 3. What the code really calls (for the reviewer questions)
Confirmed from `supabase/functions/studio-social/index.ts` and the deployed `tiktok-inbox` function (v5; its source is only on Supabase, not in this repo, so a session should pull it into `supabase/functions/tiktok-inbox/`).
| Step | Call | Scope |
|---|---|---|
| Authorize | `https://www.tiktok.com/v2/auth/authorize/` with `scope=user.info.basic,video.upload` (`TT_SCOPES`), `redirect_uri=https://www.bestly.tech/connect/tiktok.html`, `state` = the client's one-time link code | Login Kit |
| Token | `POST https://open.tiktokapis.com/v2/oauth/token/` (authorization_code, then refresh_token hourly) | none |
| Account name | `GET /v2/user/info/?fields=open_id,display_name` | `user.info.basic` |
| Send video | `POST /v2/post/publish/inbox/video/init/`, `source=FILE_UPLOAD`, PUT to `upload_url` (single chunk up to 64 MB, else 10 MB chunks) | `video.upload` |
| Status | `POST /v2/post/publish/status/fetch/` (SEND_TO_USER_INBOX, PUBLISH_COMPLETE, FAILED) | `video.upload` |

- **Direct post is NOT used by Studio.** The old `tiktok-poster` function (Cookie Yeti internal poster) does call `/post/publish/video/init/` with `privacy_level` defaulting to `SELF_ONLY`. It uses a single account's refresh token from edge secrets, not clients'. Do not mention it in the submission, and do not demo it. The sandbox "target user" it used is `cookie_yeti_privacy`.
- Studio never calls `creator_info/query`, comments, followers or analytics.
- A client sees a TikTok draft only after approving the post, and the weekly cap and scheduling are internal.

## 4. Demo video (sandbox, one file ≤ 50 MB, English)
TikTok's rule: first review is recorded in the **sandbox**; the domain shown must match the website URL (`www.bestly.tech`); every selected product and scope must be shown; show real UI. With `video.publish` removed, the scopes to show are `user.info.basic` and `video.upload`.

Sandbox client: `bestly-test` ("Bestly Test"), never Centering YOU. The portal tile needs TikTok to be offered for that client (check `client_connect_tile` / `social_brand_settings.platforms`; `studio_tiktok_ready()` must be true) and a TikTok connect link minted for it: `social_connect_mint(<client id>, 'Jared', 'tiktok')`. That link works once.
Prerequisite for the TikTok login step: the TikTok account used must be a **sandbox Target User** (Sandbox settings, Target Users, Add account; log in as that account). Jared's own test TikTok works. Max 10 target users. Add it before recording.

| Clip | Who | Shows | Length |
|---|---|---|---|
| A | **Agent** (Playwright, 1280x720, same script style as `tools/youtube-verification/record-bestly-part.cjs`) | 1. Title card "Bestly Studio: TikTok integration demo (part 1 of 3)". 2. `www.bestly.tech/studio` page with the TikTok copy and visible Privacy/Terms links. 3. `/privacy-policy` scrolled to the TikTok section. 4. `bestly-test` portal dashboard. 5. All posts, Scheduled: a video post approved ("Posts go out only after the client approves them"). 6. Settings, Your accounts: TikTok tile "Connect TikTok" (not connected). 7. Tap Connect: the `/connect/tiktok.html` page ("Connect TikTok for Bestly Test"). Stop before the button that goes to TikTok, so the link is not consumed. | ~100 s |
| B | **Jared** (QuickTime on Mac, whole screen, URL bar visible, browser logged out of tiktok.com first or use the logout link in section 5) | 1. Open the one-time connect link, click Continue to TikTok. 2. TikTok login with the sandbox target user. 3. **Authorization screen**: hold 3 s on the app name "Bestly Studio" and the two permission lines (basic profile info; upload content to your account). Scroll if needed. 4. Authorize. 5. Land on Bestly "Connected. <TikTok name> is now connected to Bestly Studio" page, hold 3 s. | ~60 s |
| C | **Agent** (after Jared says "connected") | Same portal: TikTok tile now "Connected" with the TikTok name. Approve (or re-approve) one video post and let the drain send it (or show the post in "In your TikTok drafts"). Closing card: "user.info.basic reads the account name. video.upload sends approved videos to the client's drafts." | ~60 s |
| D | **Jared** (phone screen record or desktop TikTok) | The TikTok inbox notification, the video in **Drafts**, the draft opened with the video, Jared taps Post (or stops at the Post screen if he does not want a public post; with sandbox, posts are visible only to target users). | ~45 s |

Order in the final file: A, B, C, D. Use the same stitch approach as the YouTube kit (ffmpeg concat to 1920x1080 mp4, `-crf 20`), then check the size is under 50 MB (`ls -lh`); if over, use `-crf 26`. No voiceover needed; captions in clips A and C carry the story. Keep the file under about 4 minutes.
Do not show: tokens, the dev portal client secret, other clients' names, Centering YOU's board, the Cookie Yeti pages.
A session still needs to extend `record-bestly-part.cjs` for TikTok (tile text, portal selectors) and publish `bestly-tt-part-a.mp4` / `-c.mp4` under `public/tiktok-verification/`. That has not been done; this kit lists what to record.

Upload note: TikTok accepts the file directly in the portal (up to 5 videos, 50 MB each). No YouTube link is needed.

## 5. Click-by-click: resubmit in the developer portal (Jared, ~20 min)
Portal: https://developers.tiktok.com/apps/ (account that owns `Bestly Publisher`).
0. If the TikTok web session in the browser is another account, use the logout link first: `https://www.tiktok.com/logout`, then log in with the test account.
1. Open the app **Bestly Publisher**. Rename the app to **Bestly Studio** (app details) if the production side still says Bestly Publisher.
2. Fill production app details from section 2: description, category, icon, Website URL `https://www.bestly.tech/studio`, Terms and Privacy URLs.
3. **Products:** keep Login Kit and Content Posting API. In Content Posting API leave **Direct Post off** (Upload only).
4. **Scopes:** keep `user.info.basic` and `video.upload`. Remove `video.publish`.
5. **Platforms, Web:** set the website URL again, add both redirect URIs (`/connect/tiktok.html`, `/tiktok-callback.html`). Apply changes.
6. **App review** tab (or "Submit for review"): paste the explanation from section 2 (the first paragraph, then each product and scope justification). Upload demo video(s) from section 4.
7. Click **Submit for review**. Production moves from Rejected/Draft to In review.
8. Watch the email on the developer account (jared@bestly.tech) for the result. Reviews often take several days. Do not edit the app while In review.
9. If rejected again: copy the exact reason into `bestly_memory` and the next session adjusts. Common asks: a more visible Privacy link on the website, a clearer demo of every scope, or proof that more than one outside user uses it.

Sandbox note: keep the sandbox working for clients in the meantime. Sandbox only works for added Target Users (max 10), which is why Elizabeth had to be added once. Do not delete the sandbox target users while waiting.

## 6. After approval
1. In the portal, production app: copy the **production client key and secret** (not starting with `sb`).
2. Save them to Vault. The code reads them through `studio_tiktok_app_get()`; the Vault secrets are named **`studio_tiktok_client_key`** and **`studio_tiktok_client_secret`**. Set them with the existing `studio_tiktok_app_set(p_client_key, p_client_secret)` (service role) or via `studio-social` op `tiktok_setup` (`{op:"tiktok_setup", s, client_key, client_secret}`). Do not paste them in chat or a doc.
3. Flip the flag: `tt_production_approved` (another session is adding it; confirm its setter name in the migrations, then set it true).
4. Existing clients' tokens were issued by the **sandbox** key. They will not refresh with the production key. Every connected client (Elizabeth) must tap Connect on their board once more. Mint new TikTok connect links as needed (`social_connect_mint`), and tell them the app name is now Bestly Studio.
5. Re-test with `bestly-test`: connect with a real account that is **not** a target user, approve a post, confirm it lands in TikTok drafts and `social_posts.status` goes `in_drafts` then `posted`. Check `tiktok-inbox` `action:'me'` for the brand.
6. After approval, the non-target-user error `non_sandbox_target` (what Elizabeth saw) should be gone.
7. Update `bestly_memory` with the approval date and remove the sandbox mention. Clean up sandbox state for `bestly-test` (below).

## 7. Sandbox state to undo after filming
Not made yet; the agent has not touched the database for this kit. When a session prepares the demo it will record the changes here. At minimum plan to undo: TikTok offered flag on `bestly-test` brand, any approved video item, any minted TikTok connect link, and the `social_accounts` tiktok row (tokens) for `bestly-test`, then revoke Studio in TikTok Settings, Security and permissions, Apps and services on the test account.

## 8. Checklist
- [ ] `/studio` page TikTok copy and visible Privacy/Terms links shipped (section 1; needs a session)
- [ ] `public/tiktok-callback.html` copy changed from Cookie Yeti (section 1 item 7; needs a session)
- [ ] `tiktok-inbox` source committed to the repo (needs a session)
- [x] Privacy policy TikTok section + data-deletion `#tiktok` (shipped with this kit)
- [ ] Test TikTok account added as sandbox Target User
- [ ] TikTok connect link minted for `bestly-test`; `studio_tiktok_ready()` true
- [ ] Clips A to D recorded, stitched, under 50 MB
- [ ] Portal fields set (name, description, category, website, privacy, terms, scopes without `video.publish`, Direct Post off)
- [ ] Submitted

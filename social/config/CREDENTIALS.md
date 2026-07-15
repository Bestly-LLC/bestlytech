# Bestly Cloud — Credentials setup

Everything lives in `social/secrets/.env` (git-ignored). Copy `.env.template` → `.env` and fill in.

## LinkedIn Company Page (posting via API)

Bestly LLC has a LinkedIn Company Page. To auto-post to it we need:

1. **Create a LinkedIn Developer App** at https://www.linkedin.com/developers/apps → Create App.
   - Name: "Bestly Cloud Social Engine"
   - LinkedIn Page: pick the Bestly LLC company page
   - Logo: upload the Bestly mark
2. **Product access:** request the **"Share on LinkedIn"** product AND the **"Community Management API"** (posting to Company Pages requires the latter — approval usually 1–3 business days).
3. **Auth:** OAuth 2.0 3-legged flow with scopes:
   - `w_organization_social` — write posts on behalf of the company
   - `r_organization_social` — read posts (for analytics later)
   - `rw_organization_admin` — required for some post types
4. **Generate the long-lived access token** via the auth flow (LinkedIn tokens last ~60 days — set up `linkedin-token-refresh` scheduled task alongside).
5. Get the **Company URN**: `urn:li:organization:{ID}` — find it in the LinkedIn admin UI under Page → Admin View → About.
6. Fill in `.env`:
   ```
   LINKEDIN_ACCESS_TOKEN=<long-lived token>
   LINKEDIN_ORGANIZATION_URN=urn:li:organization:XXXXXXX
   LINKEDIN_APP_CLIENT_ID=<from app>
   LINKEDIN_APP_CLIENT_SECRET=<from app>
   ```

## Reddit (new dedicated account for Bestly Cloud)

Do NOT reuse the Cookie Yeti Reddit creds. New account keeps signals cleanly separated and lets `u/bestly_cloud` build karma organically without any Cookie Yeti crossover.

1. **Create Reddit account:**
   - Username suggestion: `u/bestly_cloud` (check availability) or `u/bestly_llc`
   - Email: use a Bestly-owned email (e.g. `hello@bestly.tech` or a HideMyEmail relay)
   - Verify email
2. **Get karma before posting.** New accounts posting links = instant shadowban. Spend the first 2 weeks commenting helpfully in the target subs (r/selfhosted, r/homelab, r/devops) to build minimum karma (~50-100) before any Bestly link ever ships.
3. **Create a Reddit Script App:** https://www.reddit.com/prefs/apps → "create app" → **script** type.
   - Name: "Bestly Cloud Social Engine"
   - Redirect URI: `http://localhost:8080` (unused for script apps)
4. Fill in `.env`:
   ```
   REDDIT_CLIENT_ID=<from app>
   REDDIT_CLIENT_SECRET=<from app>
   REDDIT_USERNAME=bestly_cloud
   REDDIT_PASSWORD=<the account password>
   REDDIT_USER_AGENT=bestly-cloud-social/1.0 by u/bestly_cloud
   ```
5. Reddit account is used for **draft-only Comment Scout** (never auto-posted) and occasional **own-content posts** via `praw` (max 1-2/week per sub, respecting each sub's self-promo rules).

## X / Twitter
Skipped. Not authorizing. If we ever change our mind: X API Basic tier is $200/mo (write-eligible), Free tier is 500 writes/mo (barely usable). Reddit + LinkedIn is the play for a B2B seed audience.

## When credentials are missing
The content engine and comment scout tasks BOTH:
1. Check `.env` on every run.
2. If a required cred is missing, STAGE the post to `kit/staging/<date>/` and skip publish.
3. Log which cred is missing in `run-report.md`.
4. Notify the owner: "Bestly Cloud daily post STAGED — missing LINKEDIN_ACCESS_TOKEN."

This keeps the engine running (building content, learning, drafting comments) even before credentials arrive.

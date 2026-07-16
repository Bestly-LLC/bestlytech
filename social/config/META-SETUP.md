# Meta Setup — Bestly Cloud Instagram + Facebook (Jared's steps)

These are the steps **only you can do** (creating accounts, granting consent, handling secrets).
The agent handles everything else. Budget **~30–40 minutes**, most of it one-time.

You already have the Instagram account. You need to: create a Facebook Page, make IG
Professional and link it, create a Meta app, and generate one token. That's it.

> Why a Facebook Page is required even though we mostly care about Instagram: Meta's API
> won't let anything post to Instagram unless the IG account is a Professional account
> **linked to a Facebook Page**. The Page is the anchor the token hangs off of.

---

## Step 1 — Create the Bestly Facebook Page (~5 min)
1. Go to **facebook.com/pages/create** (logged in as yourself).
2. Page name: **Bestly** (or "Bestly Cloud"). Category: **Software company** (or "Product/Service").
3. Bio: one line — "Own your business software. One computer, no monthly per-person bills." Add bestly.tech/cloud as the website.
4. Publish the Page. Done — no followers needed yet.

## Step 2 — Make Instagram Professional + link to the Page (~5 min)
1. In the **Instagram app** → your profile → menu (≡) → **Settings** → **Account type and tools** → **Switch to professional account**.
2. Choose **Business** (not Creator — Business is the cleaner API path). Pick a category (e.g. Software).
3. When it offers to **connect a Facebook Page**, connect the **Bestly** Page from Step 1.
   - If it doesn't prompt, do it from Meta Business Suite (Step 3) instead.

## Step 3 — Confirm both are in one Meta Business (~5 min)
1. Go to **business.facebook.com** → you should see the Bestly Page.
2. **Business settings → Accounts → Instagram accounts** → confirm your IG is listed and linked to the Bestly Page. If not, add it here.
3. This is the moment the chain (Business → Page → IG) is complete.

## Step 4 — Create the Meta Developer app (~10 min)
1. Go to **developers.facebook.com/apps** → **Create app**.
2. Use case: choose **Other** → app type **Business**.
3. App name: **Bestly Cloud Social Engine**. Contact email: your Bestly email.
4. Link it to your **Bestly** business portfolio when asked.
5. In the app dashboard, **Add products**:
   - **Instagram** (Instagram Graph API / "Instagram" product).
   - **Facebook Login for Business** (needed to mint the token).
6. Leave the app in **Development mode** (top toggle stays off / "In development"). We are only
   posting to your **own** Page + IG, so **you do NOT need App Review** or the 2–4 week screencast process.

## Step 5 — Generate the token + grab the IDs (~10 min)
Use the **Graph API Explorer**: developers.facebook.com/tools/explorer

1. Top-right: select your app **Bestly Cloud Social Engine**.
2. Click **Generate Access Token** / add permissions — check ALL of these:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_business_basic`
   - `instagram_business_content_publish`
   - `business_management`
3. Click **Generate** and approve the consent popup (log in / Allow). You now have a **short-lived user token**.
4. **Get your Page ID + Page token:** in the Explorer, call `GET /me/accounts`.
   - In the response, find the **Bestly** page → copy its **`id`** (this is `FB_PAGE_ID`) and its **`access_token`** (this is a Page token).
5. **Get your IG Business ID:** call `GET /{FB_PAGE_ID}?fields=instagram_business_account` (paste your Page ID).
   - Copy the returned **`instagram_business_account.id`** (this is `IG_BUSINESS_ID`).
6. **Make the Page token long-lived** (short tokens die in ~1 hour). Call:
   ```
   GET /oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={PAGE_TOKEN_FROM_STEP_4}
   ```
   - `APP_ID` + `APP_SECRET` are in your app's **Settings → Basic**.
   - The returned token is a **long-lived Page token** (~60 days; Page tokens derived from it are effectively non-expiring while the app is active). This is the one we use.

## Step 6 — Paste into `.env` (secrets are yours to paste — ~2 min)
Open `social/secrets/.env` and fill:
```
META_APP_ID=            # from Settings → Basic
META_APP_SECRET=        # from Settings → Basic (keep secret)
FB_PAGE_ID=             # from Step 5.4  (non-secret — agent may also read/write this)
IG_BUSINESS_ID=         # from Step 5.5  (non-secret)
PAGE_ACCESS_TOKEN=      # the long-lived Page token from Step 5.6 (SECRET)
```
Then tell the agent "Meta creds are in." It will validate them (calling `/me`, `/{PAGE_ID}`,
`/{IG_BUSINESS_ID}`), confirm the IDs, and do the first IG + FB post as stage-and-review.

---

## What the agent does NOT need from you
- It does **not** need your Facebook/Instagram password — never paste it anywhere.
- It does **not** need App Review — we publish only to your own accounts (Development mode is fine).
- It will **not** create accounts or click "Allow" for you — those are the steps above.

## If Meta ever restricts the Facebook side
The sister project's FB automation got ad-restricted once. If that happens: the engine keeps
Instagram running, holds Facebook, and we switch FB to click-to-publish (like LinkedIn). Nothing
else breaks. Tell the agent and it will flip FB to semi-auto.

---

*One Page, one app, one token. Then it runs itself.*

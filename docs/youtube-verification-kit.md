# YouTube app verification kit (Bestly Studio)

Built 2026-10-15 by Spark from `docs/youtube-verification-opusplan.md`. Everything here is paste-ready.
`studio_yt_live()` is still **false**. No real or `test` upload has been run. Nothing in this kit needs the agent to sign in to Google.

Google project `bestly-studio`. OAuth app: External, "In production (unverified)".
Scopes: `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`.
Redirect: `https://www.bestly.tech/connect/youtube.html`.

## 0. What Google's current help pages say (checked 2026-10-15)
Source: support.google.com/cloud/answer/13464321 (sensitive scope verification) and the YouTube API Services Terms.
- The demo video must show the full OAuth flow, the same app and name you submitted, the **whole consent screen with the exact scopes**, and the app using each scope. The language setting on the consent screen must be English.
- Google asks only for a **link** to the video. It does not require YouTube or "unlisted" on that page. Unlisted on YouTube is still the easy safe choice, so the steps below use it.
- The page does not mention the URL bar or client_id. Showing the URL bar with `client_id` on the consent screen is a harmless extra, so Jared's part keeps it.
- Scope justification: ask for the narrowest scopes, say why narrower ones would not work, and name what would break.
- Privacy policy: on the same domain as the home page, linked from the home page, and **the same URL as the one set on the consent screen**. It must disclose how Google user data is accessed, used, stored and shared, and follow Limited Use.

## 1. Pre-flight result (Playwright, 2026-10-15)
| Page | Result |
|---|---|
| `bestly.tech` home | Loads. Footer links Privacy Policy (`/privacy-policy`), Terms of Use, Terms of Service. |
| `/privacy-policy` (master policy) | Had **no** YouTube or Google API text. **Fixed**: new section "Bestly Studio: Connected YouTube Channels" (scopes, what is stored, no sale or sharing or ads or AI training, Limited Use sentence, YouTube ToS and Google Privacy links, revoke link, deletion within 30 days). Commit `56b6f059`. Also added a YouTube block to `public/data-deletion.html`. |
| `/terms` | Loads (Terms of Use). Nothing YouTube-specific needed. |
| `/connect/youtube.html` | Loads. With a link it shows "Connect YouTube" and "Continue to Google". |
| Consent screen branding | App name shows as "Bestly Studio". Google's sign-in page links Privacy Policy `https://www.bestly.tech/privacy` and Terms `https://www.bestly.tech/terms`. |

**One blocker for Jared (a Console setting, not code):** `https://www.bestly.tech/privacy` is the **Cookie Yeti** privacy policy (the apps link to it, so it stays). It has no YouTube text, and it is not the link in the home page footer. Google wants the consent-screen privacy link to match the home page link.
In Google Auth Platform, Branding, set the **Privacy policy link** to `https://www.bestly.tech/privacy-policy`. Leave the Terms link as is (or use `https://www.bestly.tech/terms-of-service`).
Not checked (needs his login): the logo, the home page URL field, and the Authorized domains list in Branding. Confirm `bestly.tech` is listed there and the home page is `https://www.bestly.tech/`.

## 2. Paste-ready text

### Scope justification: `youtube.upload`
> Bestly Studio posts the short videos our client has approved to the client's own YouTube channel. A video is uploaded only after the client approves that specific post in Bestly Studio, and only at the time on their calendar. We use this scope for one thing: the videos.insert upload call. There is no narrower scope that allows uploading a video, and we do not ask for edit or delete scopes.

### Scope justification: `youtube.readonly`
> After the client signs in, Bestly Studio reads the connected channel's name and ID (channels.list with mine=true) so the client can see in their Bestly portal which channel is connected. About every six hours it makes the same one-unit call to confirm the connection still works, so a scheduled post does not fail without anyone knowing. youtube.upload alone does not allow channels.list, so without this scope the client could not tell which channel they connected and we could not detect a broken connection. We do not read other videos, comments, subscribers or analytics. There is no narrower read scope for the channel name and ID.

### "Why not a narrower scope?" (if Google asks)
> youtube.upload is already the narrowest scope that can upload a video. youtube.readonly is the narrowest scope that can read the channel's name and ID. We do not request youtube, youtube.force-ssl or youtubepartner, so we cannot edit or delete videos or comments, and we do not request any scope for features we have not built.

### How will the scopes be used (app description)
> Bestly Studio is a content service run by Bestly LLC for small businesses. We make short videos with each client, the client approves each post in their private Bestly portal, and Bestly Studio publishes the approved posts to the accounts the client has connected. For YouTube, the client taps Connect in their portal, signs in with Google, and allows two permissions. youtube.upload lets us upload an approved video to their channel. youtube.readonly lets us read the channel's name and ID to show which channel is connected and to check the connection still works. Nothing is uploaded until the client approves that post. The client can disconnect at any time from their portal or from their Google Account permissions.

### Data handling (for the form and the audit)
- **Stored:** the Google refresh token (in Supabase Vault, not shown in any screen), the channel ID, and the channel title. Short-lived access tokens are used in memory for the call and are not shown to anyone.
- **Not stored:** other videos, comments, subscribers, analytics, the client's Google password.
- **Sale, sharing, ads:** none. We do not sell it, share it with third parties or use it for advertising.
- **AI:** not used to train AI or machine-learning models.
- **Access:** only Bestly staff who run that client's account, only to operate the connection.
- **Deletion:** disconnecting in the client's portal stops posting at once (the access token is cleared and the account marked inactive). The stored refresh token, channel ID and channel title are deleted within 30 days on request to privacy@bestly.tech (public steps: `https://www.bestly.tech/data-deletion.html#youtube`). The client can also revoke at Google (Account permissions).
- **Limited Use:** stated in the privacy policy, section "Bestly Studio: Connected YouTube Channels".
- **Honest gap (a follow-up for a session, not a blocker):** the portal's Disconnect (`social_disconnect`) clears the access token but leaves the refresh token and channel title in place until someone deletes them on request. Google may ask whether data is deleted on disconnect. Say: "disconnect stops all use; deletion is on request within 30 days", or have a session extend `social_disconnect` to null `refresh_token` for YouTube. We also have no code that calls Google's revoke endpoint.

## 3. Submit to Google: click by click (Jared, about 10 minutes)
Do the prerequisites in section 6 first.
1. Open Google Cloud Console, project `bestly-studio`, left menu **Google Auth Platform**.
2. **Branding**: set Privacy policy link to `https://www.bestly.tech/privacy-policy`. Check app name "Bestly Studio", home page `https://www.bestly.tech/`, authorized domain `bestly.tech`. Save.
3. **Data Access**: confirm exactly the two scopes above are listed. Paste each justification from section 2 into its field.
4. Paste the "How will the scopes be used" paragraph into the app-use field. Paste the demo video link (section 5) into the video field.
5. Open **Verification Center** (menu names move, so go by the page that shows "Prepare for verification" and **Submit for verification**). Click it.
6. Watch for Google's emails to the support email. If they ask for a narrower scope, section 2's "why not narrower" is the answer.

## 4. Then the YouTube API Services audit
Link: https://support.google.com/youtube/contact/yt_api_form ("YouTube API Services - Audit and Quota Extension Form").
Why: Google locks videos uploaded by an unaudited project to private (that is why `studio_yt_live()` stays false until this passes).
Pre-filled answers (edit if a field differs):
- **Company:** Bestly LLC, Los Angeles, CA. Contact: Jared (privacy@bestly.tech for privacy questions).
- **Project:** Google Cloud project `bestly-studio`. App name: Bestly Studio. Website: https://www.bestly.tech/. Privacy policy: https://www.bestly.tech/privacy-policy.
- **Use case:** Server-side service. Clients approve short videos in a private portal and Bestly publishes them to the client's own channel.
- **API calls:** `videos.insert` (resumable upload) and `channels.list` (part=snippet,statistics or id, mine=true). No search, no comments, no analytics, no captions.
- **Quota:** Default quota is enough for now: about 3 to 7 uploads per client per week for a handful of clients. We are not asking for an extension in this pass. (Google's page says the default allows 100 `videos.insert` calls a day. Confirm on the form.)
- **How data is displayed:** Only to the client who owns the channel and Bestly staff: the channel name in the portal, and "Posted" with the video link after an upload. No public display, no aggregation.
- **How data is stored:** Refresh token in Supabase Vault, channel ID and title in our database. Encrypted at rest and in transit. Deleted on disconnect or request.
- **Third parties / ads / AI training:** none.
- **Users and consent:** each client signs in with Google and approves the two permissions on Google's consent screen. Revoke any time at https://security.google.com/settings/security/permissions.
- **YouTube ToS notice:** the privacy policy tells users they are bound by the YouTube Terms of Service (https://www.youtube.com/t/terms) and links the Google Privacy Policy.
When both reviews pass, a session runs `studio_yt_live_set(true)` and decides what to do with stale queued posts.

## 5. Demo video

### What is already recorded (agent part, about 90 seconds, 1280x720)
Local copy: `/tmp/claude-0/-home-user-bestlytech/85d97aee-caab-5c44-9352-d85e9756e44f/scratchpad/vid/bestly-part.mp4`
Stable link: `https://www.bestly.tech/youtube-verification/bestly-part.mp4` (committed to the repo under `public/`; the Storage upload could not be done, see "Not done" in the report).
Script: `tools/youtube-verification/record-bestly-part.cjs`. It shows, in order:
1. Title card: Bestly Studio and its one-sentence purpose.
2. The bestly.tech home page, scrolled to the footer with the Privacy Policy link.
3. The privacy policy, scrolled to the YouTube section (limited use, stored data, deletion).
4. The client portal for the sandbox client, Settings, Your accounts, the YouTube tile showing the connected channel ("Jared") and "Nothing has gone out yet."
5. The connect page and the click on "Continue to Google", stopping at Google's sign-in page ("Sign in to continue to Bestly Studio").
No tokens, secrets or real client data appear. The portal page URL (which holds a token) is not on screen because the recording is the page only.

Not in the agent part, on purpose (so the video stays honest): a client post being approved for YouTube, and a post showing "Posted on YouTube". The sandbox client has no approved video post, no upload has run, and the gate is closed. Jared's step 6 covers the upload.

### Jared's part (about 60 to 90 seconds, QuickTime on his Mac)
Start: QuickTime Player, File, **New Screen Recording**, record the whole screen with the browser URL bar visible. Use a window where the URL bar is easy to read. Set the Google language (bottom left of the consent screen) to **English**.
Start URL (test client, valid until Oct 29 2026): **https://www.bestly.tech/c/qs77sebp**
1. Open the start URL. Click **Continue to Google**.
2. Google account chooser: pick the account that owns the channel. (He can blur nothing; just do not show the password field.)
3. **Consent screen.** Hold 3 seconds on the URL bar so `client_id` shows, then hold 3 seconds on the app name "Bestly Studio" and both permission lines (upload videos, view your account). Scroll if needed so both scopes are on screen.
4. Click **Continue** / **Allow**.
5. Back on Bestly: the "Connected" page naming the channel. Hold 3 seconds.
6. The private test upload (`bestly-yt-poster` action `test`, from his to-do #1), then YouTube Studio, Content, showing the new video as **Private**. Hold 3 seconds on its title and visibility. (If the test upload is not ready, record steps 1 to 5 and say so in the submission note; do not fake it.)
Stop the recording, save it to the Desktop.

### Stitch (one paste, Mac Terminal)
`ffmpeg` joins the two parts into one 1080p mp4. If `ffmpeg` is missing, run `brew install ffmpeg` first.
```
cd ~/Desktop && curl -fLo bestly-part.mp4 https://www.bestly.tech/youtube-verification/bestly-part.mp4 && ffmpeg -y -i bestly-part.mp4 -i "$(ls -t ~/Desktop/Screen\ Recording*.mov | head -1)" -filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[a];[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1[b];[a][b]concat=n=2:v=1:a=0[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart bestly-google-oauth-demo.mp4 && open .
```
It picks his newest "Screen Recording ... .mov" on the Desktop. Result: `~/Desktop/bestly-google-oauth-demo.mp4` (tested here with a synthetic recording; output was 1920x1080).

### Upload the demo to YouTube (unlisted) and where to paste the link
1. youtube.com, Create, Upload videos, pick `bestly-google-oauth-demo.mp4`.
2. Title: "Bestly Studio OAuth verification demo". Audience: not made for kids.
3. Visibility: **Unlisted**. Save. Copy the video link.
4. Paste it in Google Auth Platform, Data Access (or the Verification Center video field), step 4 of section 3.
Do not upload this with the Studio test channel's private test video mixed in. It is a separate upload.

## 6. Prerequisites checklist
- [ ] **Branding privacy link** set to `https://www.bestly.tech/privacy-policy` (section 1, blocker).
- [ ] **Search Console domain proof for bestly.tech** (section 7). Branding needs the domain verified under the Google account that owns the project.
- [ ] **Support email.** The consent-screen support email is still a personal one (jareds.mac). Google allows any email you own, so this does **not** block submitting. The `support@bestly.tech` sign-in needs a real mobile number and is out of scope here. Note that Google's review emails go to this address, so Jared must watch it.
- [ ] Demo video recorded, stitched, uploaded unlisted (section 5).
- [ ] The two Bestly pages in section 1 are live (privacy section is live as of this commit).

## 7. Search Console (prepared, nothing added)
DNS for bestly.tech lives on **Cloudflare** (nameservers `sean.ns.cloudflare.com` and `reza.ns.cloudflare.com`, checked by DNS lookup on 2026-10-15). Vercel only hosts the site, so the Vercel DNS tools (`create_record`) do not apply. The Cloudflare tools available to agents here cover Workers, KV, D1, R2 and Hyperdrive, with no DNS record call. So a TXT record is added in the Cloudflare dashboard, not by an agent tool.
1. Jared: search.google.com/search-console, **Add property**, choose **Domain**, type `bestly.tech`, copy the TXT value (looks like `google-site-verification=...`). Do not click Verify yet.
2. Jared: Cloudflare dashboard, bestly.tech, DNS, Records, **Add record**: Type `TXT`, Name `@`, Content = the value, TTL Auto. Save. (Or paste the value to a Claude session, which can check it appears but cannot add it.)
3. A session checks it: `curl -s "https://dns.google/resolve?name=bestly.tech&type=TXT"` should show the value. Then Jared clicks **Verify** in Search Console.
Fallback if he wants no DNS change: add a **URL prefix** property for `https://www.bestly.tech/`, download the HTML file, and paste the file name to a session, which commits it to `public/` and pushes. Google may still ask for the domain to be verified for Branding, so the TXT route is the sure one.

## 8. After approval
- Both reviews pass: `studio_yt_live_set(true)` (service role), decide on stale queued posts.
- Clean up the sandbox after filming (section 9).

## 9. Sandbox state left for filming (undo after)
To show the portal tile, the agent made two small changes to the sandbox client `zz-connect-test` ("Connect Test (delete me)"):
- `approval_clients`: `active = true` and a fresh board token (it was inactive with a "retired" token).
- `social_brand_settings` for brand `zz-connect-test`: added `"youtube_offered": true` to `platforms`.
- A 14-day YouTube connect link `qs77sebp` was minted for it.
Undo, after Jared films step 5 (run in the SQL editor, small statements):
```
update approval_clients set active=false, access_token='retired-214b36c952514f9e66a4ade1a765879d' where slug='zz-connect-test';
update social_brand_settings set platforms = platforms - 'youtube_offered' where brand='zz-connect-test';
```

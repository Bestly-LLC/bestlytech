# Eli's Google Calendar booking

## What it does
Eli taps **Connect Google Calendar** once (partner portal, Ava, Meetings tab). After that, each meeting Ava books can go on his calendar with one tap ("Add to my calendar"). Ava's wording for the time is parsed by plain rules (no AI); if it is vague, Eli picks the time himself.

## Two events per meeting
Google allows one description per event, and the two audiences must not see each other's text.

| | A. The meeting | B. The prep brief |
|---|---|---|
| Who sees it | Eli and the lead (invited by email) | Eli only (private, no attendees) |
| When | The meeting time, 30 minutes | 15 minutes before, ends when A starts |
| Google Meet | Yes, created with the event | No (the Meet link is pasted inside) |
| Description | Fixed customer-facing text only | Full internal brief: who, company, roof, what they said, Ava's summary, notes, next steps, recording, Meet link |

Booking again ("Change time") updates the same two events and keeps the same Meet link. If Eli deleted an event, a fresh one is made.

## One-time Google Cloud setup (Jared)
1. Google Cloud Console, pick or create a project, **APIs and Services, Library**, enable **Google Calendar API**.
2. **OAuth consent screen**: User type External, app name "Bestly Partner Portal". Leave **Publishing status = Testing**. Under **Test users** add `eli.cooper@bdcuniversal.com` and Jared's Google account. (In Testing mode the sensitive calendar scope needs no Google verification review. Google expires refresh tokens after 7 days for apps left in Testing, so Eli may see "Reconnect Google Calendar" about once a week. Publishing the app later needs Google's verification.)
3. **Credentials, Create credentials, OAuth client ID, Web application.**
4. **Authorized redirect URIs**, add exactly:
   `https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/partner-google/callback`
5. Copy the client ID and secret, then set them as Edge Function secrets (never in the repo):
   ```
   npx supabase secrets set GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... --project-ref rcqfqhguwpmaarseifqg
   ```
Until these are set the portal shows "Not set up yet" and nothing breaks.

## Apply and deploy
```
npx supabase db push --project-ref rcqfqhguwpmaarseifqg      # applies 20261005120000_partner_google_calendar.sql
npx supabase functions deploy partner-google --project-ref rcqfqhguwpmaarseifqg --no-verify-jwt
```
`--no-verify-jwt` matches `supabase/config.toml`: Google's redirect to `/callback` carries no JWT. The JSON actions check the caller's JWT and role inside the function, and `/callback` accepts only the signed `state` the function issued.

## Where things live
- Refresh token: Supabase Vault, `partner_google_refresh_<user_id>`. The browser can only read `partner_google_status()`.
- Where each meeting landed: `rg_calls.cal_event_id`, `cal_prep_event_id`, `cal_meet_url`, `cal_start_at`, `cal_error`.
- Alerts: key `rg:booking`, owned by roofguard-outreach (bell and phone push). A failed booking or a Google sign-in that stopped working raises it; the next success or reconnect resolves it.
- Time parsing: `src/lib/meetingTime.ts` (pure functions).

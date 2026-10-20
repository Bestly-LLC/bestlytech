# Passkeys only, company-wide (opusplan)

Rule (Jared, Oct 19 2026, 5:45 PM): no passwords anywhere at Bestly. Every app is off passwords 100% by **Dec 31, 2026**. Passkeys only. New builds ship passkey sign-in and no password field.
Owner: **Ares** (Head of Security). Memory key: `house/rule-passkeys-only-2026-10-19`.
Status: read-only audit and plan, written Oct 19 2026. Nothing was changed. Numbers below are counts only, no emails.

## Bottom line

- The estate is closer than it looks. Studio, the partner portal and Vesta are already passkey-only for sign-in. The real work is **/admin**, **the open email/password signup on the Supabase project**, **Nextcloud**, **bearer-token links that act like passwords**, and **vendor consoles**.
- Only **2 people** sign in to bestly.tech through Supabase Auth: 1 admin (Jared, Apple + passkey + a password he does not know) and 1 partner (Eli, passkey + a password he never uses). **Both have a password hash today. Both have a passkey.** So the cutover is two accounts, not a migration of hundreds.
- Passkeys are **custom** (our own edge functions and tables), not Supabase native (`passkeys_enabled: false`). That is fine, but it has three gaps worth fixing as part of this (see "Hardening").
- The biggest structural gap is the **RP ID**. Admin passkeys are bound to the exact host `www.bestly.tech` (confirmed in function logs), so they cannot work on `studio`, `preview`, or any other subdomain, and not on `*.vercel.app` previews. That is what blocked the email-builder preview on Oct 19.
- "Passkeys only" is **not technically possible** for bots and service credentials (app passwords, API keys, SIP, Wi-Fi) and for vendors without passkey support. Those get a separate class with the closest alternative (section 7).

## 1. Inventory

Legend: effort S (under a day), M (1-3 days), L (a week or more). Order = phase in section 4.

### A. bestly.tech and Supabase Auth (project `rcqfqhguwpmaarseifqg`)

| # | Surface | Today | Users | Passkey-ready | Passkey-only version | Risk | Effort | Order |
|---|---|---|---|---|---|---|---|---|
| A1 | `/admin` login (`AdminLogin.tsx`, `useAdminAuth.ts` `signInWithPassword`) | Apple, passkey, "Approve from my phone" (device login), and a hidden "Sign in with email instead" username + password form | 1 staff (Jared) | Yes. Passkey and device-approve already work | Delete the email/password form, the `admin_login_email` username lookup and `signInWithPassword`. Keep Apple only if decision 1 allows it | Low | S | P1 |
| A2 | `PasswordSetup.tsx` (mounted in `AdminRoute`) | Nags every admin sign-in to "set up a username and password" until done | 1 staff | n/a | Delete. Replace with an "Add a second passkey" prompt until the account has 2 | Low | S | P1 |
| A3 | `ChangePasswordDialog.tsx` (in `AdminSettings`) | Change password + passkey management in one dialog | 1 staff | Passkey half exists | Remove password section, keep and promote passkey list (add, rename, remove, "needs a 2nd one" banner) | Low | S | P1 |
| A4 | Supabase Auth config | Providers on: **email (password + magic link)**, **apple**. Everything else off. **`disable_signup: false`** (anyone on the internet can create an email/password account), `mailer_autoconfirm: false`, `passkeys_enabled: false`. Trigger `on_auth_user_created_admin` grants admin to one hard-coded Apple relay address | Public endpoint | n/a | (1) `disable_signup: true` (admins and partners are created with `auth.admin.createUser`, which still works). (2) Add the Vesta pattern: trigger `no_passwords` on `auth.users` that blanks `encrypted_password` on insert/update (escape hatch only from SQL with a session setting). (3) Blank the 2 existing hashes. (4) Keep email only for the magic-link token handoff our functions mint | **Medium today** (open signup is a spam and enumeration surface; not an admin-takeover path because roles are explicit) | S | P0 |
| A5 | Custom passkeys: `webauthn-register`, `webauthn-authenticate`, tables `passkey_credentials`, `webauthn_challenges`. Session minted by `auth.admin.generateLink(magiclink)` then `verifyOtp` | Live. 2 users, 2 credentials (1 each) | 1 staff + 1 partner | Yes | Keep, harden (see section 6) | Medium (it is the only door) | M | P1 |
| A6 | Partner portal `/partner`, `/partner/welcome` (`PartnerPortal.tsx`) | Already passkey-only in code. One-time claim link (7 days, multi-use) creates the first passkey. `partner-admin` creates the user with **no password** | 1 partner (Eli) | Yes | Already done for new accounts. Blank Eli's old hash (A4). Header comment in the file still says "email + password": fix wording | Low | S | P1 |
| A7 | `admin-device-login` ("Approve from my phone", QR + 2-digit match) | Needs an already signed-in admin session to approve | Staff | Yes, it is passkey-derived | Keep. It is also the recovery tool for browsers that cannot do passkeys (Claude in-app browser, TV) | Low | none | n/a |
| A8 | `bestly-admin-auth` (hoku-clean.com admin; RP ID `bestly.tech` or `hoku-clean.com`; table `admin_passkeys`, 1 row for `hoku-clean.com`) | Passkeys only, with enrolment codes | 1 staff | Yes | This one already uses a registrable-suffix RP ID and a server allowlist. **Use it as the model for A5** | Low | none | model |
| A9 | Ava approvals `/y/:code`, `confirmApprovalWithPasskey` | Passkey tap with UV required | Jared | Yes | Keep as is. This is the best implementation in the repo (UV required, challenge bound to the approval) | Low | none | model |
| A10 | Ava **owner PIN** (`AvaOwnerPin.tsx`, Vault `ava_owner_pin`, spoken 6-digit PIN, 2-hour session) | A memorised secret. It is a password in all but name. Exposed once in a chat | Jared | **No**: it is spoken on a phone call | Retire in favour of the existing approve-on-phone path (A9). Voice stays read-only/status; any action keeps needing the passkey tap. See decision 2 | Medium | M | P4 |
| A11 | Secret-entry fields (`type="password"` on token cards: Mercury, Apollo, JEV, Tesla, ChargePoint cookie, SkyTouch app password, RoofGuard, AskCard, ScoutAI, HomeHubAccess, Ava calendars, Turo settings) | These are **machine credentials typed once into a write-only Vault form**, not sign-ins | 1 staff | n/a | Out of scope as "passwords" but the watchdog must tell them apart (section 5). **Exception:** `TuroSettings.tsx` line ~217 takes an email + password (a third-party Turo/login credential). Treat as a vendor credential (section 7) | Low | S | P4 |
| A12 | Token-link pages: `/brief/:token`, `/intake/:token`, `/shield/request/:token`, `/t/:token`, `/g/:token`, `/d/:token`, `/xa/:token`, `/w/:token`, `/pay/:token` | Unguessable single-purpose bearer links to a customer or guest. No account | Customers/guests (unbounded) | n/a (no account to attach a passkey to) | See decision 3. Proposal: **not passwords** as long as each link is single-purpose, expiring or per-trip, and cannot sign in to an account. Do not add passwords here | Low | none | policy |
| A13 | Sign-in with Apple on `/admin` | OAuth. Not a password. The Apple ID behind it can itself be passkey-backed | 1 staff | Yes | Decision 1: keep as a second door or remove | Low | S | P1 |
| A14 | Lovable auth shim `src/integrations/lovable/index.ts` (google/apple `signInWithOAuth`) | Dead code path (Google provider is off) | none | n/a | Delete | Low | S | P1 |

### B. Bestly Studio (`studio.bestly.tech`, `review-auth`, `studio-recover`)

Verified from the live build (`studio_builds` id `00d96ff5…`, files `app/index.cee343349b.html`, `app/board.f843d1155d.html` in the public `review` bucket): **no password input exists in either file**. Staff and client sign-in are WebAuthn discoverable credentials (`residentKey: required`, `userVerification: preferred`). RP ID comes from a server allowlist (`studio.bestly.tech`, old `review.bestly.tech`, localhost).

| # | Surface | Today | Users | Passkey-ready | Passkey-only version | Risk | Effort | Order |
|---|---|---|---|---|---|---|---|---|
| B1 | Staff sign-in (Studio `/`) | Passkey only. Active real staff: **Jared (3 passkeys), Eli (1)**. Two system/fixture rows (Spark system actor, re-intake) have **0** passkeys and no sign-in. 13 live staff sessions | 2 humans + 2 non-human | Yes | Give Eli a 2nd passkey. Require UV (`required`, not `preferred`). Cap session at 14 days (code says 14; data shows up to 365, check) | Medium (Eli has 1 key) | S | P2 |
| B2 | Staff recovery (`studio-recover`, `staff_recovery`, `staff_recovery_redeem`) | Emailed link (7 days for invites) grants permission to enrol a NEW passkey, never a session. Mailbox is the factor | 2 | n/a | Keep but see decision 3. Add: owner approval required for a recovery on an owner account, 1 use, 30 minutes, push to Jared | Medium | M | P2 |
| B3 | Client board sign-in `/<slug>` | Passkey (`client_passkeys`: 2 total, **centering-you 1, bestly-test 1**). 8 real active boards, **7 of them are house boards with no passkey and no people** | 1 external client (Elizabeth), 2 people rows | Yes | Elizabeth gets a 2nd passkey (phone + laptop, or a hardware key from Bestly) | Medium | S | P2 |
| B4 | **Client link `?c=<access_token>`** (`approval_clients.access_token`, never expires) | The link alone opens the board (`approval_board(p_token)`). The registry note says it plainly: "treat the URL like a password"; the live board code also reads `?c=` as the token (confirm in P2 that a bare token still opens the board after a passkey exists). This is the one **password-equivalent** in Studio | Every client | n/a | Make `?c=` an **enrolment-only** door: valid until the first passkey exists (or 7 days), then the token stops opening the board and only mints a "register a passkey on this device" ceremony. Rotating token = re-invite. Keep view-as tokens (`va_`) for staff | **High** | M | P2 |
| B5 | Client sessions (`client_sessions`) and staff sessions | Live: 7 client, 13 staff. Max stored lifetime in the data is 365 days | | n/a | 30 days client, 14 days staff, slide on use. Re-auth with UV for sensitive actions (promote, delete) | Medium | S | P2 |
| B6 | Client enrolment codes (`client_people.enroll_code_hash`, `approval_staff.enroll_code_hash`) | Time-boxed codes that permit a new passkey | | n/a | Keep. They are enrolment, not sign-in | Low | none | n/a |
| B7 | Nextcloud call window inside Studio (the "Sign in inside the call" frame) | Nextcloud `/login` is framable by `studio` and `review`. Guests who are not signed in to Nextcloud see its password form inside the call | Elizabeth, Eli | Depends on Nextcloud (C1) | Replace with the ticket path that already exists (`/apps/bestlytheme/call?t=<ticket>`, 120 s, single use, no password) as the only door; remove the framed login and its CSP widening | Medium | M | P3 |

### C. Nextcloud (`cloud.bestly.tech`, Nextcloud 33.0.8 on the Pi)

Not reachable from this audit: Nextcloud admin, `occ`, and per-user security settings. What is known comes from Supabase (`nextcloud_seats`, Vault names) and `bestly_memory`. **No note anywhere records passkey/WebAuthn or 2FA status for any Nextcloud user.** Treat as unknown and verify in P3 (`occ twofactorauth:state <uid>`, Settings > Security).

| # | Surface | Today | Users | Passkey-ready | Passkey-only version | Risk | Effort | Order |
|---|---|---|---|---|---|---|---|---|
| C1 | Human web login: accounts **jared, eli, elizabeth** (+ `admin`/house account, `cowork-bot`, `calltest`, `scout-notetaker`) | Username + password form at `/login`. 2FA unknown | 3 humans (1 staff owner, 1 partner, 1 client) | Nextcloud core supports WebAuthn passwordless login (Settings > Security > "Passwordless" / WebAuthn devices). Needs HTTPS, correct RP | Enrol 2 WebAuthn devices per human. Then set a random unknown password per account (kept only in Vault as break-glass for the **server admin**, see 7.4) and tell users the form is gone. To remove the password field entirely: SSO through an OIDC login (`user_oidc`) in front of a passkey-only IdP, and set Nextcloud to auto-redirect to it. The IdP can be a small Bestly OIDC front (reuse `webauthn-*`) or Sign in with Apple | Medium | L | P3 |
| C2 | Guest call links `cloud.bestly.tech/call/<token>` (public Talk rooms) | No login. Guests join with a name | Elizabeth, Eli, clients | n/a | Fine. This is a bearer link for a room, not an account | Low | none | policy |
| C3 | **App passwords used by bots** (machine credentials): seat tokens for `jared`, `eli`, `elizabeth`, `calltest` (`nextcloud_seats`, 4 active); Vault `nextcloud_app_password`, `job_finder_nextcloud_app_password` (a disabled scheduled task, flagged compromised until rotated), `nextcloud_user`; the Mercury Nextcloud sync; `cowork-bot` | Per-device tokens, revocable, not the account password | Bots | **No** (not interactive) | Keep, but treat as a separate class (7.1). Scope each to one purpose, rotate on a schedule, one token per bot, no personal-account tokens (replace `jared` seat use with a `bot-*` service user where possible) | Medium | M | P3 |
| C4 | LibreSign signing (Nextcloud-hosted) | Signer identified by email link | Clients | n/a | Signing link is single-document bearer. Fine under decision 3 | Low | none | policy |
| C5 | Brute-force/2FA settings | Untouched, per Oct 18 note | | | Re-check after C1 | | S | P3 |

### D. Product apps (source not reachable)

The GitHub org `Bestly-LLC` is **not reachable** from this session (the API is bound to the configured repo; anonymous org listing is blocked) and no repos were attached. What is known from memory and the bestlytech repo:

| # | App | Auth known | Passkey-only version | Status |
|---|---|---|---|---|
| D1 | **Vesta** (women's app, own Supabase `ulpdhwmjnmcbccluyhzg`, `vesta-app.bestly.tech`) | Email magic link + passkeys. Passwords **already blocked by DB trigger** `vesta_no_passwords`, watchdog self-heals (`vesta:passwords`) | Already compliant. Gaps: passkey RP is `vesta-app.bestly.tech` or `app.bestly.tech` host-only, so a passkey on one does not work on the other (pick one canonical host); email link remains as the recovery path (decision 3) | **Done** except RP cleanup |
| D2 | **Vesta walkthrough** (`vesta.bestly.tech`) | **Password gate** (access code from Jared) for investors/partners | Replace with a per-person expiring link (bearer, no typing), or a passkey-enrolled viewer account | Open, S, P4 |
| D3 | **InventoryProof** (iOS, live) | Not reachable. Likely device-local or Apple ID based | Verify there is no account password. If it has accounts, use Sign in with Apple + passkeys | Unknown, verify |
| D4 | **Cookie Yeti** (extension + Safari/iOS; `bestly.tech/cookie-yeti/*`) | Dashboard and cancel pages in this repo use no password field (grep clean). Extension reports with per-version keys, not user logins | Likely compliant. Confirm no account system in the extension apps | Verify |
| D5 | **Confesh, SchoolPilot, ParentIQ, HOKU, El Dora, Bestly Cloud, Minute News Daily, Bestly Agent** | Not reachable / not recorded | Each gets one line in the P4 checklist: "has a sign-in? method? field?". Block release if a password field exists | Unknown |
| D6 | **hoku-clean.com admin** | Passkey-only (A8) | Compliant | Done |
| D7 | **Home hub pages**: Homebridge UI (user + password), Home Assistant, Pi-hole v6 admin, Music Assistant web login (password "not recorded anywhere"), Bestly Home tvOS app | Local-network web consoles with passwords | HA and Pi-hole support passkeys only via a proxy/SSO. Put them behind Tailscale + the Bestly OIDC front (C1), or accept "local admin password, vaulted" as 7.4 | M-L, P4 |
| D8 | **Maya, Leo, Ava (voice)** | Caller identity, not accounts. Ava owner mode is A10 | Covered in A10 | |

### E. Vendor and admin consoles (human passwords today)

From `bestly_credential_registry` and memory. Rule: **switch to passkeys wherever the vendor offers them**; where it does not, hardware-key 2FA (FIDO2) plus a vaulted unique password is the closest legal alternative, and the account gets a documented exception until the vendor ships passkeys.

| Vendor | Account | Passkey support (verify at switch time) | Action |
|---|---|---|---|
| AWS | root `jared@bestly.tech` (account 375268683464), paid plan since Sep 24 | Root supports MFA with passkeys/FIDO2 hardware keys. Password stays on root (cannot be removed) | Register 2 FIDO2 keys on root, then create IAM Identity Center admin with passkey and **stop using root**. Exception for the root password |
| Apple (App Store Connect, Developer, iCloud, Sign in with Apple) | Jared, Bestly LLC team PV65ABS5W9 | Apple ID uses passkeys/hardware keys; account password remains | Enable hardware security keys on the Apple ID; ASC API key (.p8) is a machine credential (7.1) |
| Google (Play Console, Chrome Web Store, Workspace/Gmail, GCP wallet project) | `jareds.mac@gmail.com` and others | Passkeys supported | Enable passkeys, turn on "skip password when possible" |
| Supabase (dashboard, Bestly org `mwksmuoodijoiptrrqdu`) | Jared | Check: GitHub SSO or email+password | Move to GitHub login with passkey, or SSO if offered |
| Vercel (team `team_Kwxz5PIgolwApAnbC131PCDd`) | Jared | Passkeys supported | Passkey, remove password login |
| GitHub (Bestly-LLC, `fungus-amungus`) | Jared, SSH keys | Passkeys supported | Passkey + hardware key. SSH keys and fine-grained PATs are machine credentials (7.1) |
| Namecheap / PrivateEmail (`mail.privateemail.com`, `jared@bestly.tech` IMAP) | Jared | Namecheap: 2FA, passkey support limited, verify | Passkey if offered. **IMAP password is a machine credential** held in macOS Keychain on the Mac mini for the mail sync; closest alternative is an app-specific/limited mailbox |
| Cloudflare | bestly.tech DNS | Passkeys supported | Passkey + hardware key on the login; scoped API token (none exists yet) is a machine credential |
| Stripe, Mercury, Shopify, Resend, Twilio/Telnyx, ElevenLabs, Meta, TikTok dev, Trustpilot, Groq, Fireworks, AMD DevCloud, Okta | Jared | Stripe, Shopify, Mercury, Meta, TikTok: check; many support passkeys or hardware keys | One checklist row per vendor in P4: passkey on, password login removed or vaulted + hardware key 2FA |
| Third-party consumer portals: WashConnect (email + password, no 2FA), Park My Share host portal, ChargePoint (password + Datadome), Turo, Arlo | Jared | Mostly **no** passkey support | Documented exceptions (7.3). Prefer removing the dependency: ChargePoint already uses a session cookie token; WashConnect poller holds a root-only file on the Pi |

## 2. Counts

| What | Count |
|---|---|
| `auth.users` (bestly.tech project) | **2** |
| with a password hash | **2** (100%) |
| with at least one passkey | **2** (100%) |
| with Apple identity | 1 |
| roles | 1 admin, 1 partner |
| passkey rows: `passkey_credentials` (bestly.tech admin/partner) | 2 |
| passkey rows: `staff_passkeys` (Studio) | 4 (Jared 3, Eli 1) |
| passkey rows: `client_passkeys` (Studio boards) | 2 (centering-you 1, bestly-test 1) |
| passkey rows: `admin_passkeys` (hoku-clean.com) | 1 |
| sign-in identities with only **one** passkey (no backup) | **5**: bestly.tech admin (Jared), bestly.tech partner (Eli), Eli on Studio, Elizabeth on her board, hoku-clean admin. Only Jared on Studio has 3 |
| Studio staff (real humans) / system rows | 2 / 2 |
| Studio active boards: real client / house / sandbox | 1 real client (+1 sandbox with passkey) / 7 house boards (no passkeys, no people) / 4 sandboxes |
| Live sessions: staff / client | 13 / 7 |
| Password form inputs that are **sign-in**: | 3 (`AdminLogin`, `PasswordSetup`, `ChangePasswordDialog`) |
| `type="password"` inputs that are secret-entry for bots/vendors | about 18 (not sign-ins) |
| Nextcloud humans / bot seats | 3 humans (jared, eli, elizabeth) / 4 active app-password seats |
| Vault secrets with password/PIN in the name | 21 (all machine or vendor credentials, values never read) |

## 3. What the passkey-only end state looks like

1. **One RP ID: `bestly.tech`** (registrable suffix). One passkey works on `www`, `studio`, `cloud`, `preview`, `app`. Origins are checked against a **server allowlist**, never taken from the request body.
2. **Every human has 2+ credentials** of different kinds: a synced passkey (iCloud/Google) on a phone **and** a second device or a FIDO2 hardware key kept off-person (home safe). Account is "not compliant" until it has 2.
3. **User verification required** on every human login (Face ID / Touch ID / PIN on the key), not "preferred".
4. **No password column in use anywhere**: `encrypted_password` blanked by trigger, `disable_signup` true, no password inputs in any shipped bundle.
5. **Bearer links are enrolment or single-purpose only.** A link that opens an account forever is a password and is removed (B4).
6. **Machine credentials are separate, named, scoped and rotated** (section 7), and never typed by a person at a login form.

### Recovery (lost device). No password fallback, ever.

| Situation | Path |
|---|---|
| Lost one device, other passkey works | Sign in with the other, remove the lost one, add a new one. Account flagged "needs 2nd" until fixed |
| Lost all synced passkeys, has hardware key | Hardware key signs in, re-enrol |
| Lost everything (staff) | **Owner-approved re-enrol:** another staff signs in and uses "Add a passkey for X" (existing `enroll_code` flow), or Jared runs it. Code is single use, 30 minutes, push to Jared, logged |
| Lost everything (Jared, the only owner) | Second owner is Eli with owner-recovery rights, or a sealed hardware key #3 held off-site. **Never** a password and never an emailed link alone. See decision 3 |
| Lost everything (client) | Jared or Eli sends a fresh enrolment link from Studio (existing `invite_client`), valid until first passkey |
| Lost everything (partner) | `partner-admin link` makes a new claim code (7 days) |
| Browser cannot do passkeys (Claude in-app browser, TV) | "Approve from my phone" (`admin-device-login`) |

## 4. Phases and dates (end Dec 31, 2026)

Dates are working dates; Dec 21-31 is a freeze and buffer.

| Phase | Dates | Goal | Done when |
|---|---|---|---|
| **P0 Guardrails** | Tue Oct 20 - Fri Oct 30 | Stop the bleeding, make drift visible | `disable_signup` on; `no_passwords` trigger live; both hashes blanked; Ares watchdog v1 live and green (section 5); `house/rule-passkeys-only` linked from CLAUDE.md "rules of the road"; Ares team card owns prefix `pk` |
| **P1 bestly.tech admin + partner** | Mon Nov 2 - Fri Nov 13 | /admin and /partner are passkey-only; RP ID moves to `bestly.tech` | Server RP allowlist shipped; **re-enrol** Jared + Eli on `bestly.tech` RP (2 each, one hardware key for Jared) **before** removing the old ones; password form, `PasswordSetup`, `ChangePasswordDialog` password section, `signInWithPassword`, Lovable shim deleted; preview subdomain live (section 6); crawler check passes |
| **P2 Studio** | Mon Nov 16 - Wed Nov 25 | Studio has no password-equivalent | `?c=` becomes enrol-only (B4); Eli 2nd passkey; Elizabeth 2nd passkey; UV required; session TTLs capped; owner-approved recovery (B2) |
| **P3 Nextcloud** | Mon Nov 30 - Fri Dec 11 | Humans sign in to Nextcloud by passkey | Verify 2FA/WebAuthn state per user; 2 devices each for jared, eli, elizabeth; SSO/OIDC decision implemented or passwordless-WebAuthn with unknown random passwords; framed-login CSP removed once call ticket path is the only door; bot app passwords re-issued per bot and listed in registry |
| **P4 Everything else** | Mon Dec 7 - Fri Dec 18 (overlaps P3) | Vendors, home hub, residual PINs and gates | Vendor checklist 100% (passkey on or documented exception); Vesta walkthrough password gate replaced; Ava owner PIN retired; Home Assistant/Homebridge/Pi-hole/Music Assistant behind SSO or listed as exceptions; product app sign-in review (InventoryProof, Cookie Yeti, Confesh, SchoolPilot, ParentIQ, HOKU, El Dora, Bestly Cloud) recorded |
| **P5 Freeze and prove** | Mon Dec 21 - Thu Dec 31 | Prove it, then lock it | Lost-device drill for each account class (actually remove a key and recover); watchdog green 7 days; exceptions list signed by Jared; memory note "passkeys-only complete, Dec 31 2026"; any open item moves to a dated exception, not a silent miss |

Sequencing rule: **never remove the old method before the new one is proven on the same account**, and never remove the last working door (this is how Jared gets locked out). Each phase ends with a sign-in test from a second browser.

## 5. Watchdog idea: "Passkey Guard" (owned by Ares)

Local first (token-saving rule): Postgres cron + edge functions + a Pi/Mac script. No Claude scheduled task.

**Checks** (hourly, plus on every deploy):

1. **Database password check** (hourly cron `passkey-guard-db`): count `auth.users` with non-empty `encrypted_password`; any new row alerts and auto-heals by blanking (same as `vesta_password_heal`). Also checks Studio/Vesta equivalents.
2. **Auth config check** (daily): fetch `/auth/v1/settings` (public, anon key). Alert if `disable_signup` is false, if any external provider outside the allowlist turns on, or if phone is on.
3. **Bundle scan** (on deploy and nightly, Mac mini or Pi): extend `scripts/site-audit/crawl.mjs`. Fetch every route's HTML and JS chunks plus Studio's live `index`/`board` and Vesta's `app.js`. Fail on `type="password"` / `autocomplete="current-password"` / `new-password` / `signInWithPassword` / `auth.signUp` / `updateUser({password` **unless** the input is in the machine-credential allowlist (`src/security/secret-entry-allowlist.json`, entries keyed by file + purpose, each owned by an employee). A secret-entry field must carry `data-secret-entry="vault:<name>"` and `autoComplete="off"`.
4. **Repo guard in CI**: a grep rule in a pre-commit hook and GitHub Action. A new password input fails the PR with "passkeys only, see docs/passkeys-only-opusplan.md". New edge functions that call `signInWithPassword` or `createUser({ password` fail.
5. **Coverage check** (daily): every active human account has 2+ credentials with at least one used in 30 days; any with 1 gets a reminder; any account on `?c=` bearer with a passkey already enrolled gets flagged (B4).
6. **RP/origin check** (daily): live `webauthn-*` options calls from the allowlisted origins return rpId `bestly.tech`; a request from a bogus origin must be refused.
7. **Third-party exceptions register**: `passkey_exceptions` table (system, owner, reason, compensating control, expires). The guard raises 30 days before expiry. Anything past Dec 31 without an entry is a miss.

**Alerts:** raised via `bestly_raise` with prefix `pk:`, signed **Ares**, class security (a password appearing in a live auth system is "security nobody could fix" only if auto-heal fails; otherwise it goes to the 7 PM recap). Add `team_onboard` card for Ares with the cron names and prefix `pk`, per CLAUDE.md.

## 6. Preview deployments and the RP ID

**Problem (confirmed in function logs, Oct 19):** `webauthn-authenticate` takes `rpId` from the browser-supplied origin hostname. On `bestlytech-git-email-builder-bestly.vercel.app` it asked for rpId `bestlytech-git-email-builder-bestly.vercel.app`. Jared's passkey is bound to `www.bestly.tech`, so no credential matched. A passkey cannot move between hosts or onto `vercel.app` (Vercel owns that suffix).

**Fix (two parts):**

1. **Use the registrable suffix as RP ID.** Register all admin/partner passkeys with `rpId = bestly.tech`. Then any `https://*.bestly.tech` origin can use them (WebAuthn allows a subdomain origin to use a parent-domain RP ID). This needs a one-time **re-enrol** of Jared and Eli (host-bound credentials cannot be converted). Do it in P1 while `www.bestly.tech` credentials still work, then drop the old ones.
2. **Give previews a home inside `bestly.tech`.** Assign a stable preview domain to the Vercel project: `preview.bestly.tech` (follows the latest preview branch) and, if wanted, `*.preview.bestly.tech` per-branch. A wildcard needs the zone delegated to Vercel's nameservers for that subdomain (DNS is on Cloudflare, so delegate only `preview.bestly.tech` with NS records; verify with Vercel docs when doing it, and note Cloudflare Workers/Edge Guard must not touch this subdomain). Keep Vercel Deployment Protection (team SSO) on so that only team members can open a preview.
3. **Server allowlist, not a body-supplied origin.** Replace `getRpId(origin)` in `webauthn-register`/`webauthn-authenticate` with a map like `review-auth` and `bestly-admin-auth` already use: exact origins `https://www.bestly.tech`, `https://bestly.tech`, `https://studio.bestly.tech`, `https://preview.bestly.tech`, plus a pattern for `https://*.preview.bestly.tech` → rpId `bestly.tech`. Anything else returns 403. This also removes the current behaviour where a `*.vercel.app` origin is silently accepted and fails later.

**Trade-off to accept explicitly:** a preview build runs untrusted-until-reviewed code with a real admin session for production data. Mitigation: previews only for branches by team members (Deployment Protection), previews point at production Supabase only for admin work Jared chooses to do, and the email-builder-style "preview" can alternatively use the existing **Approve from my phone** (`admin-device-login`) which already works on any origin, since it does not depend on an RP ID. That is a zero-cost workaround today; the subdomain is the permanent fix.

## 7. Where "passkeys only" is not possible, and the closest alternative

1. **Bot and service credentials** (app passwords, API keys, OAuth refresh tokens, `.p8`, SIP, Vault secrets, `x-proxy-key` family, Pi SSH keys). Not interactive, so no passkey exists. Alternative: unique per-purpose credential, least scope, stored only in Supabase Vault (or Keychain for Mac-only), rotated on a schedule with an owner, **never typed at a login form**, never in a scheduled-task prompt (one already violated this on Oct 14). Use SSH keys / mTLS / OIDC workload identity where the target supports it. Registry: `bestly_credential_registry`, with `status` and `owner` columns required.
2. **Voice and phone callers** (Ava owner PIN, Maya, Leo). A spoken secret is a password. Alternative: voice stays read-only; actions require the existing passkey tap (A9). Retire the PIN (A10).
3. **Vendors without passkeys** (WashConnect, Park My Share, ChargePoint, Turo, Arlo, others to be confirmed). Alternative: vaulted unique password + FIDO2/TOTP 2FA where offered; prefer cookie/session tokens captured once (as Charge Watch does); otherwise drop the dependency. Each lives in `passkey_exceptions` with an owner and a review date.
4. **Break-glass and server roots**: AWS root password, Nextcloud server `admin`, Pi root/sudo, Supabase database password. Alternative: hardware key (FIDO2) on the console, the password is random 32+ chars, sealed (offline or Vault), used only for recovery, access logged and alerted by Ares. These are the only places a password legitimately remains, and they are listed, owned and watched.
5. **Guests and customers with no account** (Turo guest `/t/…`, intake, brief). Bearer links, not passwords, under decision 3.

## 8. Hardening to fold in (found while auditing the custom passkey code)

These are in the custom WebAuthn paths and should be fixed in P1, because "passkeys only" makes this code the single door:

- `webauthn-authenticate` derives `rpId` from the request's `origin` (no allowlist). Fix as in section 6. (`review-auth` and `bestly-admin-auth` already do it right.)
- `userVerification: "preferred"` on normal login, UV is not required in the flag check (only UP). Require UV on admin, partner, Studio staff.
- The login challenge lookup takes "any of the 5 most recent valid challenges" (not bound to a session or IP), and single use of the challenge was not confirmed on this path (verify). Bind the challenge to a request id and delete it on use.
- Counter regressions are only logged. Alert Ares on a regression for a non-synced credential.
- `attestation` / transports: record `backed_up` and `device_type` so the coverage check knows hardware keys vs synced.
- `useAdminAuth`/`webauthn-authenticate` mint sessions via `generateLink(magiclink)` using the user's email. That requires the `email` provider to stay enabled. Keep it, but with signup off and passwords blanked it is token handoff only.
- Edge function `partner-admin` `listUsers(perPage 200)` to find an existing email: fine at 2 users, replace with a direct lookup before it grows.

## 9. Open decisions for Jared (max 3)

1. **Is Sign in with Apple allowed?** It is not a password and the Apple ID can be passkey-backed. Keeping it gives a second door for /admin; removing it makes the passkey the only door (strictest reading of the rule). Recommendation: keep it for /admin only, as a recovery door behind Apple's own passkey/hardware key, and disallow it for every other surface.
2. **Do bearer links count as "passwords"?** Proposal: single-purpose or per-trip links (guest trip, intake, brief, call room, pay) are fine. A link that opens an account forever (Studio client `?c=`, Vesta walkthrough password) must become enrolment-only or expiring. Also OK to retire the Ava spoken PIN?
3. **Recovery policy for you as the sole owner.** No password fallback means a lost-everything day needs a human or a hardware key. Recommendation: buy 3 FIDO2 keys now (one on you, one in the home safe, one off-site) and make Eli a second owner-recovery approver. Is an emailed recovery link alone ever acceptable for staff (current Studio behaviour), or must it always need an approving owner?

## 10. First actions (P0, ready to hand to agents)

1. `disable_signup: true` in Supabase Auth, then verify `/auth/v1/settings`.
2. New migration: `no_passwords()` trigger on `auth.users` (copy `vesta_no_passwords` pattern), blank 2 hashes, add `passkey_exceptions` table, add the two new rows to `privacy_data_map` if any column holds personal data.
3. Passkey Guard cron + edge function + `team_onboard` for Ares (prefix `pk`).
4. Add the grep rule and the allowlist file to the repo and CI.
5. Record in `bestly_memory`: area `security`, key `plan/passkeys-only-opusplan`, pointing at this file.

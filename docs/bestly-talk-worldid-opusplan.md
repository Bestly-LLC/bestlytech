# Bestly Talk × World ID — Tiered Verification Opusplan

**Compiled:** 2026-05-18
**Status:** Plan-of-record, ready for execution
**Pattern:** Option 1 — *everyone can join, verified humans get a fast lane*
**MVP target:** 2 working days from kickoff to one pilot room live

> The premise: World ID is a fast lane, not a gate. Anyone with a Talk room
> link gets in the normal way; humans who have signed in with World get a
> verified checkmark + skip the moderation queue + can unmute and screenshare
> without host approval. Spam bots and trolls hit a friction wall they have
> to ask through. Real humans in a hurry tap one button and skip it.

---

## 1. Goal & non-goals

### In scope (MVP)
- A "Sign in with World" button on the Talk pre-join screen for guest visitors
- A persistent verified badge ("✓ Verified · World") next to verified users in the participant list + chat
- A capability tier: verified users join the call directly; unverified users land in a moderation lobby (host clicks "Admit") OR are admitted into a "voice-off / chat-throttled" mode
- A per-room policy toggle (admin UI) — host decides whether the room uses this pattern at all
- Pilot on ONE room (recommended: a public Bestly Cloud Demo Room)

### Out of scope (later phases)
- World ID nullifier as persistent guest identity across calls (Pattern B from earlier)
- Replacing Nextcloud account login with World ID OIDC (different project)
- WLD-token payment integration in Talk (different product, see Mini App opusplan)
- Multi-Orb / Device-tier policy distinctions (start with one tier)

### Non-goals
- We are not building a custom WebRTC stack. The signaling, the SFU, the TURN — all unchanged.
- We are not gating the entire Bestly Cloud Talk install. Per-room opt-in only.
- We are not requiring World accounts of existing customers. The pattern is additive.

---

## 2. Architecture

### Surfaces we touch (and don't)

| Layer | Owner today | We add | We don't change |
|---|---|---|---|
| Talk frontend (Vue) | `custom_apps/spreed` | A "Sign in with World" button on pre-join + a verified badge component | Existing room UI, call UI, chat UI, anything not gated by verification |
| Talk backend (PHP) | `custom_apps/spreed` | A pre-join filter that reads a verification claim | The DB schema for rooms/attendees |
| New Nextcloud app | new — `bestly_world_id` | OIDC/IDKit handler + verification storage + OCS endpoints | nothing existing |
| Spreed-signaling HPB | `talk-hpb-signaling-1` | Capability rules: verified users have `canUnmute=true, canScreenshare=true` by default | The signaling protocol, NATS routing, TURN config |
| Database | postgres `nextcloud-db` | One new table: `oc_bestly_world_verifications` | Existing `oc_talk_*` tables |
| Deploy | `bestly-multi-ai/scripts/install-on-cloud.sh` pattern | A `bestly-world-id/scripts/install-on-cloud.sh` clone | The bootstrap self-heal pattern (we'll re-use it) |

### Why a separate `bestly_world_id` app (not a spreed fork)

We considered forking spreed (the way we forked `assistant` and `integration_openai` for Multi-AI). Decision: **don't fork spreed**, build a separate app that integrates via spreed's existing extension points. Reasons:

1. Spreed has hundreds of contributors and ships every 4–6 weeks. Maintaining a long-running fork is a tax we keep paying.
2. World ID verification is a cross-cutting concern (could apply to Files sharing, Forms, Calendar bookings later) — building it as its own app means it's reusable.
3. The Talk pre-join screen has a `<NcAppNavigationItem>` slot pattern and the spreed Vue components emit a `pre-join-action` event we can subscribe to from a separate app. No fork needed.

### The new app: `bestly_world_id`

Structure mirrors `bestly-multi-ai/integration_multi_ai` for consistency:

```
bestly_world_id/
├── appinfo/
│   ├── info.xml                          — app metadata, dependency on spreed >= 22.0
│   └── routes.php                        — OCS + AppFramework routes
├── lib/
│   ├── AppInfo/Application.php           — app bootstrap, registers listeners
│   ├── Controller/
│   │   ├── VerifyController.php          — receives IDKit proof, validates, stores
│   │   └── BadgeController.php           — returns badge HTML/JSON for spreed UI
│   ├── Db/
│   │   ├── Verification.php              — entity (session_id, nullifier_hash, verified_at, level)
│   │   └── VerificationMapper.php
│   ├── Listener/
│   │   ├── BeforeRoomJoinListener.php    — subscribes to OCA\Talk\Events\BeforeRoomJoinedEvent
│   │   └── ParticipantListListener.php   — annotates participant list with verification
│   ├── Migration/
│   │   └── Version010000Date20260518000000.php  — creates oc_bestly_world_verifications
│   └── Service/
│       └── WorldIdService.php            — calls developer.worldcoin.org /api/v2/verify
├── src/
│   ├── components/
│   │   ├── PreJoinVerifyButton.vue       — "Sign in with World" CTA
│   │   ├── VerifiedBadge.vue             — green checkmark next to name
│   │   └── LobbyView.vue                 — what unverified guests see during host approval
│   ├── main.js                           — mounts components into spreed's slots
│   └── personalSettings.js               — per-user setting page
├── img/
│   └── world-mark.svg                    — World ID logo for the button
└── scripts/
    ├── install-on-cloud.sh               — clone of bestly-multi-ai install
    └── bootstrap-snippet.sh              — self-heal block for bestly-bootstrap.sh
```

### Database schema

One table. Append-only event log + a derived "current verification" view.

```sql
CREATE TABLE oc_bestly_world_verifications (
  id              BIGSERIAL PRIMARY KEY,
  session_id      VARCHAR(255) NOT NULL,    -- maps to oc_talk_sessions.session_id
  nullifier_hash  VARCHAR(255) NOT NULL,    -- per-app, can't be cross-correlated
  verification_level VARCHAR(32) NOT NULL,  -- 'orb' or 'device'
  room_token      VARCHAR(64),              -- which room they verified for
  verified_at     INTEGER NOT NULL,         -- unix epoch
  expires_at      INTEGER,                  -- nullable; verifications can be evergreen
  ip_hash         VARCHAR(64)               -- sha256(ip), for abuse forensics only
);
CREATE INDEX idx_bwv_session ON oc_bestly_world_verifications (session_id);
CREATE INDEX idx_bwv_nullifier ON oc_bestly_world_verifications (nullifier_hash);
CREATE INDEX idx_bwv_room ON oc_bestly_world_verifications (room_token);
```

The `nullifier_hash` is the World ID privacy-preserving identifier. It's per-app (Bestly Cloud), so it cannot be correlated with the same person's nullifier on other apps. Two consequences:
- A returning verified human shows up as the same nullifier_hash — useful for "trusted regulars" features later
- We never store anything that ties to a real-world identity unless the user volunteers it

### Wire diagram (text)

```
Visitor with Talk link
  │
  ▼
Pre-join screen (spreed Vue)
  │  ┌─────────────────────────────────────┐
  │  │  Continue as guest  │  Sign in with │
  │  │                     │     World     │ ← bestly_world_id mounts here
  │  └─────────┬───────────┴───────┬───────┘
  │            │                   │
  │            │                   ▼
  │            │           IDKit JS widget
  │            │                   │
  │            │                   ▼
  │            │           World App on phone
  │            │                   │
  │            │                   ▼
  │            │       Returns: proof + nullifier_hash
  │            │                   │
  │            │                   ▼
  │            │   POST /apps/bestly_world_id/verify
  │            │                   │
  │            │                   ▼
  │            │     VerifyController validates proof
  │            │     against developer.worldcoin.org
  │            │                   │
  │            │                   ▼
  │            │     Inserts row in oc_bestly_world_verifications
  │            │                   │
  │            │                   ▼
  │            │     Sets session cookie: bestly_wid=1
  │            │                   │
  ▼            ▼                   ▼
Direct join  Lobby join     Direct join + "Verified" badge
(unverified) (with friction) (full caps)
```

---

## 3. The user journey

### Verified human (best case)
1. Taps room link → pre-join screen loads
2. Sees their camera preview + two buttons: "Continue as guest" and "Sign in with World ✓"
3. Taps the World button
4. World App opens, asks to verify for "Bestly Cloud"
5. Taps Verify in World App → returns to browser in ~3 seconds
6. Pre-join screen flips: "Verified ✓ · Continue"
7. Taps Continue → drops into the call with camera/mic active, ✓ Verified badge next to their name in the participant list
8. Can immediately unmute, chat, screenshare

### Unverified guest
1. Taps room link → pre-join screen loads
2. Taps "Continue as guest"
3. Asked for a display name
4. Lands in the lobby: "Waiting for host to admit you. Tip: Sign in with World to skip this wait."
5. Host sees a notification: "Eli is waiting in the lobby. [Admit] [Decline]"
6. Host clicks Admit → guest drops into the call
7. Guest joins with muted mic, no screenshare permission, chat is rate-limited to 1 message per 10 seconds
8. Host can manually upgrade guest's capabilities at any time

### Host (you)
1. Joins normally — your existing Nextcloud account
2. See a small admin panel: room policy = "World-verified fast lane"
3. Sees participants list:
   - "Jared (host)"
   - "✓ Sarah · Verified" (verified guest)
   - "🟡 Eli (lobby)" with [Admit] [Decline] buttons
4. Can right-click any participant → "Upgrade to verified-equivalent" if you know them personally

### Spam bot (worst case for them, best case for you)
1. Bot tries to join via headless browser
2. Lands on pre-join screen — must either click World (which it can't pass — Orb verification is in-person) or click Continue as guest
3. Lands in lobby
4. Host doesn't admit
5. Bot times out after 5 min
6. Bot has burned 5 min + IP + browser-fingerprint without ever touching the call

---

## 4. Implementation phases

### Phase 0 — Plumbing (Day 1, morning, 3 hours)
- Create `bestly-world-id/` repo (sibling to `bestly-multi-ai/`)
- Scaffold the app structure above
- Register at `developer.worldcoin.org` → create "Bestly Cloud" app → get `app_id` + `action_id`
- Add Bestly Cloud's redirect URI to the allow-list

**Deliverable:** empty Nextcloud app that installs cleanly on cloud.bestly.tech and shows up in `occ app:list`.

### Phase 1 — Backend (Day 1, afternoon, 4 hours)
- DB migration: `Version010000Date20260518000000.php` creates `oc_bestly_world_verifications`
- `Verification` entity + `VerificationMapper` (mirrors `bestly-multi-ai`'s pattern)
- `WorldIdService.verifyProof($proof, $nullifierHash)` → POST to `https://developer.worldcoin.org/api/v2/verify/{app_id}` with the proof, action, nullifier_hash, signal
- `VerifyController::verify()` OCS endpoint at `POST /apps/bestly_world_id/api/v1/verify`
  - Accepts: `{ proof, nullifier_hash, verification_level, room_token }`
  - Validates via `WorldIdService`
  - On success: inserts row, sets session attribute `bestly_world_verified=1`, returns 200
  - On failure: returns 400 with reason

**Deliverable:** `curl` against the verify endpoint with a real World proof returns 200 and a DB row exists.

### Phase 2 — Frontend (Day 2, morning, 4 hours)
- `PreJoinVerifyButton.vue` — uses the `@worldcoin/idkit` npm package, renders a button styled to match Bestly Cloud's brand
- Mount the button into spreed's pre-join screen via the `OCA.Talk.Hooks.preJoinActions` extension point (verify this exists; if not, fallback: monkey-patch via DOM injection in `src/main.js`)
- `VerifiedBadge.vue` — small green checkmark + "Verified" label, takes a `level` prop ('orb' or 'device') with different visual treatment
- Hook the badge into spreed's `ParticipantListItem.vue` via a slot or DOM injection
- `LobbyView.vue` — friendly waiting screen for unverified guests with copy: *"Waiting for the host. Sign in with World to skip this wait next time."* and a Sign-in-with-World button

**Deliverable:** end-to-end visual flow on a test room — guest sees the button, signs in, sees the badge.

### Phase 3 — Capability enforcement (Day 2, afternoon, 3 hours)
- `BeforeRoomJoinListener.php` subscribes to `OCA\Talk\Events\BeforeParticipantJoinedRoomEvent`
- If room policy = "world-id-fast-lane" AND attendee is unverified → set initial participant flags:
  - `inCall = 0` (muted)
  - `permissions = read-only or with chat throttle`
  - Adds attendee to a "lobby" attribute (uses Talk's existing lobby state machine — `lobby_state = 1`)
- If verified → no changes, default flags apply
- Host's participant list shows the lobby attendees with Admit/Decline UI (uses Talk's existing lobby admit flow — we don't reinvent)

**Deliverable:** verified guest joins straight to call; unverified guest joins to lobby; host can admit.

### Phase 4 — Per-room policy admin UI (Day 2, late afternoon, 2 hours)
- Add a "Verification policy" setting to the room admin pane
- Options: `none`, `world-id-fast-lane`, `world-id-required`
- Stored as a room property: `oc_talk_rooms.bestly_world_policy` (new column, nullable, default `none`)
- Migration to add the column

**Deliverable:** host can toggle the verification policy per-room from the admin UI.

### Phase 5 — Pilot deployment (Day 2 end of day)
- Build the app via `vite build` (mirrors the `bestly-multi-ai/assistant_multi` pattern)
- Package into tarball
- `scripts/install-on-cloud.sh` deploys to cloud.bestly.tech (cloned from `bestly-multi-ai`'s install script)
- Add to `bestly-bootstrap.sh` for self-heal across container restarts
- Enable on ONE room: a fresh "Bestly Cloud Demo Room" with the policy set to `world-id-fast-lane`
- Public URL of that room: `https://cloud.bestly.tech/call/<token>`

**Deliverable:** real public Talk room with the World ID fast-lane live.

---

## 5. The pilot

### Which room
Recommended: a brand-new room called **"Bestly Cloud Demo · Open Drop-In"**, advertised on:
- The /cloud page footer ("Want a live walkthrough? Drop into our open room every Thursday 2 PM ET")
- The Bestly homepage
- A pinned tweet/LinkedIn post

Not recommended for pilot: any existing customer support room (don't change what's working).

### What we measure
Two weeks. Tracked per-day in `docs/bestly-cloud-worldid-pilot-metrics.md`:

| Metric | Source | Target |
|---|---|---|
| Total unique joiners | `oc_talk_sessions` count distinct session_id where room=demo | baseline-establishing |
| % who attempt World sign-in | front-end click event on Sign-in button | >15% week 1, >25% week 2 |
| % who complete verification | `oc_bestly_world_verifications` rows created | >80% of attempts (drop-off = friction) |
| Time-to-verified | `verified_at - first_seen_at` per session | <30 sec median |
| % spam joins admitted by host | host admit/decline count from Talk audit log | <5% admit rate (proves spam wall works) |
| Verified-vs-unverified conversation length | session duration in call | verified should be ≥2× unverified |
| Verified joiners returning | distinct nullifier_hash with >1 verification row | >10% by end of week 2 |
| Customer complaints | support email + Talk chat | <3 total |

### Expansion gates
After 2 weeks of pilot, expand to a second room IF:
- Verified conversion rate >15%
- Zero customer complaints attributing friction to World ID
- Spam admit rate stays <5%

If any of those misses, keep the pilot running 2 more weeks before deciding to either iterate or sunset.

### Rollback
- **Per-room rollback:** set the room's `bestly_world_policy = none` via the admin UI — instant, no restart needed
- **Per-server rollback:** `occ app:disable bestly_world_id` — World ID UI disappears from all rooms, lobbies revert to Talk's default (open or password-gated based on room settings)
- **Full uninstall:** `occ app:remove bestly_world_id` + migration rollback — DB table dropped, no residual state

---

## 6. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| World ID adoption too low — nobody clicks the button | Medium | Pilot measures this directly. If <5% click rate week 1, sunset the experiment. We've only spent 2 days of build. |
| Spammers find a way to fake World verification | Low | World's protocol uses zero-knowledge proofs verified by their developer API. Faking requires breaking the proof. Not a realistic threat. |
| Host has to manually admit everyone — UX is worse, not better | Medium | The point of Pattern 1 is that verified users skip the lobby. If 0% verify, host IS doing extra work. Solution: only enable the policy on rooms where spam is currently a problem (i.e., rooms where the host is ALREADY managing admits today). |
| World App outage breaks the verify flow | Low | The site still works — the World button just fails gracefully and the visitor falls back to "Continue as guest" → lobby. Net: same as not having the feature. |
| Privacy concern: people don't want to use World | High awareness, low impact | The feature is OPT-IN. Nobody is forced. The non-button path is exactly today's experience. We disclose in the room description: *"This room uses World ID for verified-human access. Optional — you can continue as a guest."* |
| Maintenance burden on the custom app | Low ongoing | We're not forking spreed — we're a sidecar app. Spreed updates won't break us. Our app talks to spreed via documented extension points. |
| World Foundation changes the API | Low | OIDC + IDKit are stable. If they break a contract, we update one service file. We don't depend on undocumented behavior. |
| Performance — verification adds 3 seconds to join | Already true | Verified users opt-in to that 3 seconds in exchange for capability. Unverified users see no delay. |

---

## 7. Open questions (need user answers before kickoff)

1. **Do you want a "Sign in with World" option in the regular Nextcloud account login** (so existing customers can also link a World account), or strictly a guest-flow feature? Recommendation: guest-only for v1.
2. **Is the pilot room a fresh one** (new "Bestly Cloud Demo · Open Drop-In") **or an existing one** (one of the current Talk rooms)?
3. **Acceptable verification levels**: Orb-only (highest trust, smaller eligible audience) or Orb + Device (broader audience, lower per-verification trust)? Recommendation: Both, with Orb users getting a gold ✓ and Device users getting a silver ✓ visual distinction.
4. **Host-side admin UI design** — do you want a one-click "Enable World fast-lane" on the room admin page, or a more granular policy editor (capability-per-tier)? Recommendation: one-click for v1, granular in v3.
5. **Compliance**: any reason we can't disclose in the pilot room's privacy notice that "Bestly Cloud uses World ID, a service of Tools for Humanity, for optional human verification"? Recommendation: standard 1-sentence disclosure, not a separate consent flow.

---

## 8. Timeline summary

| Day | Phase | Hours | Deliverable |
|---|---|---|---|
| Day 1 AM | 0 — Plumbing | 3 | Empty `bestly_world_id` app installed on cloud.bestly.tech |
| Day 1 PM | 1 — Backend | 4 | Verify endpoint works against World API + DB row created |
| Day 2 AM | 2 — Frontend | 4 | End-to-end visual: button → World App → badge |
| Day 2 PM | 3 — Capability enforcement | 3 | Verified joins direct, unverified to lobby |
| Day 2 late | 4 — Per-room admin UI | 2 | Toggle the policy per room |
| Day 2 EOD | 5 — Pilot deploy | 1 | Real public room live |
| **Total** | **2 working days** | **17 hours** | **Pilot room live, metrics tracking started** |

---

## 9. Future phases (post-pilot, if pilot succeeds)

- **Pattern B integration**: World ID nullifier as persistent guest identity across calls (so "Eli" today is server-side the same person as "Eli" last week, without an account)
- **WLD micro-payments for premium rooms** (e.g., "5 WLD to unlock private bespoke consultation slot with Eldora")
- **Cross-feature**: extend `bestly_world_id` to gate Nextcloud Files share links + Forms submissions on World verification
- **Public Mini App version**: take the Bestly AI multi-model chat (separate opusplan) and ship it as a World Mini App, using the same verification infrastructure server-side
- **Analytics dashboard**: a per-room "verification report" — % verified, conversion deltas, spam-saved estimate

---

## 10. References

- Main Bestly Multi-AI pattern we're cloning: `bestly-multi-ai/integration_multi_ai/`
- Install script template: `bestly-multi-ai/scripts/install-on-cloud.sh`
- Bootstrap self-heal: `/mnt/ssd/apps/nextcloud/custom-config/bestly-bootstrap.sh` (on the Pi)
- Talk app source: `/var/www/html/apps/spreed/` (Nextcloud bundled)
- HPB signaling: `/mnt/ssd/apps/talk-hpb/compose.yaml`
- World developer portal: `developer.worldcoin.org`
- World docs: `docs.world.org/mini-apps` (Mini Apps platform) + `docs.world.org/world-id/overview` (the verification SDK we'd use for Talk)
- IDKit JS SDK: `@worldcoin/idkit` on npm (browser-native, no Mini App wrapper required)

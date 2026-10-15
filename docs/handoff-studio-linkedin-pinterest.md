# Handoff: Bestly Studio LinkedIn + Pinterest connectors (2026-10-14)

For a Claude Code session picking this up. Read CLAUDE.md first. Supabase project `rcqfqhguwpmaarseifqg`.
Working memory: `select key, body from bestly_memory where key like 'studio/%2026-10-14' order by updated_at;`

## Goal
Elizabeth (client Centering YOU, brand `client-centering-you`, client slug `centering-you`) connects LinkedIn and Pinterest
from her portal (Settings > Your accounts) with plug-and-play tiles. All instructions live in her portal, never email.
Approved posts go out everywhere (one post per item per platform).

## Done
- **LinkedIn: live.** Posts go to the connected person's own profile (Share on LinkedIn, `w_member_social`). Jared refused a new
  app, and Community Management must be alone on an app, so company Page posting is out for now.
  - `studio-social` v10: `li_start` scopes `openid profile w_member_social`; `li_finish` stores `page_id = urn:li:person:<sub>`.
    Page mode still works if Vault `studio_li_scopes` is set to org scopes later.
  - `bestly-li-poster` v2: author = stored `page_id`; `check` warns 10 days before the 60-day token runs out; dead token makes the account
    inactive, and her tile then shows Reconnect.
  - `studio_li_live()` = true. `linkedin_offered` = true for `client-centering-you`. `connect_platform_help` (linkedin) rewritten.
  - Site commit 4593bb7: `public/connect/linkedin.html`, `linkedin-setup.html` copy.
  - Verified: authorize URL reaches "Authorize | LinkedIn". **Not yet verified: a real sign-in + post.**
- **Cross-posting:** unique index is per `(approval_item_id, platform)`.
- **Pinterest backend:** `studio-social` pin_* ops, `bestly-pin-poster` v1, crons, watchdog all deployed (see bestly_memory).
- **Pinterest app:** "Bestly Studio", **App ID 1624481**, created 2026-10-14. Secret hidden until Pinterest approves **Trial access**.

## To do
1. **Wait for Pinterest Trial approval** (email to Jared). Nothing to build until then.
2. When approved, Jared adds redirect URI `https://www.bestly.tech/connect/pinterest.html` on the app page.
3. Mint a fresh 24-hour setup link (`studio_setup_link_mint`, service role; the old one has expired) and give Jared:
   `https://www.bestly.tech/connect/pinterest-setup.html?s=<new secret>`. He pastes App ID + secret there (never in chat).
4. Check `studio_pin_ready()` = true, then dry-run `pin_start` on test client `zz-connect-test` and confirm Pinterest serves its
   authorize page.
5. Set `pinterest_offered` = true for `client-centering-you` so her tile + to-do appear. Trial access only shows pins to the
   creator, so keep `studio_pin_live()` **false** until Standard access.
6. **Standard access:** Pinterest needs a screen recording of connecting + creating a pin. Record it with Jared's own Pinterest
   business account on the connect page, then submit. When approved, `studio_pin_live_set(true)`.
7. After Elizabeth connects LinkedIn, confirm the first LinkedIn post went out (`social_posts` platform `linkedin`, status `posted`).

## Rules that bite here
- Service-role-only RPCs: run `select set_config('request.jwt.claims','{"role":"service_role"}',true);` first in the same SQL call.
- DROP/destructive SQL from MCP can come back "cancelled"; give Jared the raw SQL to run instead.
- Every alert goes through Scout, signed by Studio Watch. Times 12-hour. No "..." truncation. Short links only for clients.
- Commit + push to main without asking (see CLAUDE.md).
- Log decisions back to `bestly_memory` before finishing.

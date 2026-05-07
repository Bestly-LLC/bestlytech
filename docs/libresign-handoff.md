# Libresign activation — what's left

Updated 2026-05-06 after partial autonomous activation.

## Done autonomously

- Libresign **enabled** (was downloaded but disabled — flipped via OCS API).
- Three template PDFs **uploaded** to Nextcloud Files at
  `/Bestly/Internal/Contracts/Templates/` (`SOW.pdf`, `Acceptance.pdf`,
  `NDA.pdf`). Drafts — replace before a customer signs.
- Webhook secret generated: `aaf484ee0568d7d0e65a55470aadb5d0`.
- Edge functions `cloud-deal-sign` and `cloud-deal-sign-webhook`
  already deployed; they read the env vars below at request time.

## Hard blocker (needs server shell)

Libresign v13 ships **no HTTP API** to install its binary dependencies
(Java, PDFtk, JSignPdf) — those are CLI-only via `occ libresign:install`.
The admin UI just shows the `Run occ libresign:install --java` tips as
plain text. So `/apps/libresign/` returns HTTP 422 until you run:

```sh
ssh root@<cloud.bestly.tech-host>      # or however you shell into the box
sudo -u www-data php /var/www/html/occ libresign:install --java
sudo -u www-data php /var/www/html/occ libresign:install --pdftk
sudo -u www-data php /var/www/html/occ libresign:install --jsignpdf
sudo -u www-data php /var/www/html/occ libresign:configure:openssl \
  --cn="Bestly Cloud Signing CA"
```

(Adjust path to `occ` if you're in a Docker / snap install — `docker
exec -u www-data <container> php occ libresign:install --java` is the
common variant.)

Each step downloads ~30–250 MB into Nextcloud's data dir, so first run
takes a couple of minutes total.

After the four commands succeed, sanity-check:

```sh
curl -s -u jared:'bn2Wj-X5pcn-WnYjk-yopG6-yFrZ8' \
  -H 'OCS-APIRequest: true' -H 'Accept: application/json' \
  https://cloud.bestly.tech/ocs/v2.php/apps/libresign/api/v1/admin/configure-check \
  | python3 -m json.tool
```

Every `status` should now be `success` (or `info` for poppler-utils — that
one is optional, only affects validation page-dimension fallbacks).

## After the SSH step — what I'll handle

Once Libresign reports green and you paste me a Supabase Personal Access
Token (https://supabase.com/dashboard/account/tokens → Generate new
token → name `bestly-bot-libresign-setup` → copy), I'll:

1. Set the 5 Edge Function secrets via Supabase Management API:

   | Name | Value |
   |---|---|
   | `LIBRESIGN_BASE` | `https://cloud.bestly.tech` |
   | `LIBRESIGN_USER` | `jared` |
   | `LIBRESIGN_APP_TOKEN` | `bn2Wj-X5pcn-WnYjk-yopG6-yFrZ8` |
   | `LIBRESIGN_TEMPLATES` | `{"sow":"/Bestly/Internal/Contracts/Templates/SOW.pdf","acceptance":"/Bestly/Internal/Contracts/Templates/Acceptance.pdf","nda":"/Bestly/Internal/Contracts/Templates/NDA.pdf"}` |
   | `LIBRESIGN_WEBHOOK_SECRET` | `aaf484ee0568d7d0e65a55470aadb5d0` |

2. Configure the Libresign callback webhook to POST to
   `https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/cloud-deal-sign-webhook`
   with header `X-Bestly-Sign-Secret: aaf484ee0568d7d0e65a55470aadb5d0`.
   (Workflow Engine flow + per-request callback in the edge function as
   double-belt — whichever fires first.)

3. End-to-end smoke test on a fake deal: create envelope → email arrives
   at your inbox → sign in browser → webhook stamps `sow_signed_at` →
   ntfy push hits your phone.

## If the SSH step is annoying

A managed-Nextcloud host that pre-installs Java + JSignPdf would let
the OCS API path actually work. Otherwise this is the one keystroke we
can't avoid — Libresign's authors deliberately gated binary install
behind `occ` for security reasons (the install service writes to the
data dir as the web user).

## Verification (after env vars + webhook are set)

1. Open any deal at `/admin/cloud/<lead-id>`
2. Advance to Stage 4
3. Click "Record SOW signing request"
4. Click **Send SOW** under "One-click via Libresign API"
5. Toast: "Sent via Libresign — Customer will receive the SOW signing
   link by email"
6. Check the test inbox; sign it
7. Webhook fires; deal stamps `sow_signed_at` automatically
8. ntfy push to your phone confirms it

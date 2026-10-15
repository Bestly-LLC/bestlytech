# Costco Same-Day in the "food's at the door" nag — opusplan (2026-10-14)

Jared: "make sure that Costco deliveries are included in my live activity for Home Assistant for when it's delivered."

## What exists

- Pi job `/opt/bestly/cron/jobs/doordash_pickup.py` (pi_jobs `doordash_pickup`, every minute, owner Scout).
  It reads `bestly_mail` (mailbox `jaredbest@icloud.com`), and for each new
  `no-reply@doordash.com` "Details of your no-contact delivery from <store>" email fires the HA event
  `doordash_delivered {store, store_short, sent_at, mail_id}`.
- HA package `packages/doordash_pickup.yaml` (golden copy `/opt/bestly/doordash/doordash_pickup.yaml`, identical today)
  turns that event into the nag: phone push + **Live Activity** (tag `doordash_pickup_live`, title "Food's at the door",
  message "<store> · N min"), HomePod announce, hallway light pulse, wall banner. Stops when the front door unlocks,
  on "Got it", or after 90 min.

## Why Costco never showed

Costco Same-Day (Instacart) mail comes through an iCloud relay sender
`no-reply_at_costco_com_…@icloud.com` with subjects:

| Email | Subject | Meaning |
|---|---|---|
| Order placed | `Your Costco order is confirmed for October 14, 2026` | in flight ("Delivery Time Today by 8pm") |
| **Delivered** | `Your Costco order receipt` | body: `<Shopper> delivered your order on Oct 1, 2026, 11:49 AM` |
| Refund | `Your $X refund from Costco Same-Day` (from `no-reply_at_instacart_com_…`) | not a delivery |

The job only looks at the DoorDash sender, so Costco never fires the event.

Costco.com shipped orders (`deliverystatus@logistics.costco.com`) only send "on its way" / "out for delivery",
never a delivered email, so they cannot drive this nag. Out of scope.

## Changes

### 1. `doordash_pickup.py` (Pi)

- `fire_deliveries`: widen the mail query to DoorDash no-contact **or** Costco receipts:
  `or=(and(from_addr.eq.no-reply@doordash.com,subject.ilike.*no-contact*),and(from_addr.ilike.*costco*,subject.ilike.*receipt*))`,
  select `id,from_addr,subject,body_text,sent_at,ingested_at`.
  Store = DoorDash regex as today; else if the sender contains `costco` and the body matches
  `delivered your order` → store `Costco`; else skip (advance the watermark). Payload gains `"source": "doordash"|"costco"`.
- New `costco_pending()`: newest Costco email in the last 10 h is "order is confirmed" with no receipt / refund / cancel after it.
  While true, `kick_mail` pulls iCloud at most every 2 min (DoorDash keeps its 50 s).
- Docstring mentions Costco Same-Day.
- Backup `doordash_pickup.py.bak_costco_<stamp>`, `py_compile` before replacing, then a `--dry` run.

### 2. HA package (one line)

HomePod line becomes "Your Costco order is at the door." when the store is `Costco`; DoorDash wording is unchanged.
Patch golden + live copy (backups `.bak_costco_<stamp>`), `check_config` must pass, then reload `script`.

### 3. Records

- `bestly_memory` `house/doordash-pickup-nag`: note the Costco source and undo steps.
- `bestly_agents` `pi-doordash-pickup`: what_it_does mentions Costco Same-Day.

## Test

- Unit check on the Pi: the new matcher fires for receipt mail `369eccd5-…` (Oct 1) and not for the confirm email `3dad71c2-…`.
- `--dry` run is clean.
- Live: the Oct 14 order (#21417337430475044, due by 8 PM) — its receipt email should fire the event within ~2 min.

## Undo

`sudo cp -p <file>.bak_costco_<stamp> <file>` for the job and both YAML copies, then reload `script` in HA.

## Result (2026-10-14, executed)

Shipped as planned.

- `doordash_pickup.py`: all 9 edits applied (each old string matched exactly once), `py_compile` clean before and after writing. Backup `/opt/bestly/cron/jobs/doordash_pickup.py.bak_costco_202610141835`.
- HA package: the one HomePod line patched in both copies. Backups `/mnt/ssd/apps/homeassistant/packages/doordash_pickup.yaml.bak_costco_202610141835` and `/opt/bestly/doordash/doordash_pickup.yaml.bak_costco_202610141835`. `check_config` passed, `script` reloaded, `script.doordash_nag_round` and `script.doordash_nag` still exist.
- Verified: the PostgREST `or=` filter returns the Oct 1 receipt `369eccd5-ce34-4e67-8cc5-53ac330fe4ef` plus the DoorDash no-contact mails; `body_text ~* '\mdelivered your order\M'` is true for `369eccd5-...` and false for the confirm email `3dad71c2-...`; an in-memory dry `fire_deliveries` over history classifies the receipt as store "Costco" (skipped as old); `costco_pending()` is true tonight (order in flight).
- Not done on purpose: no test event, no HA test run.
- Records: `bestly_memory` `house/doordash-pickup-nag` and `bestly_agents` `pi-doordash-pickup` updated.

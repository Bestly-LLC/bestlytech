# todo-autotick -- client to-dos tick themselves off (Pi, hourly)

Any open `client_todos` row whose `source` has `kind: "invoice"` + `mercury_invoice_id`, or
`kind: "contract"` + `libresign_uuid`, is checked every hour and marked done (`done_by = 'auto'`,
evidence in `source.autotick`) when the invoice is Paid or the contract is signed. Stdlib Python,
no AI. Must run on the Pi: the Mercury read-only token only works from the Pi's IPv4 address
(IPv4 is forced, same as `tools/mercury-sync/`).

**Owner:** Tally (`tally`, reports to Scout, pulse `pi_job` / `todo-autotick`).

| What | Path |
| --- | --- |
| Worker | `/opt/bestly/cron/jobs/todo_autotick.py` |
| Wrapper for `runjob.py` | `/opt/bestly/cron/jobs/todo-autotick.py` |
| State | `/opt/bestly/cron/state/todo_autotick.json` (mode dry/live, ids only) |
| DB side | `supabase/migrations/20261015140000_client_todo_autotick.sql` |

## How it decides
- Invoice: `GET https://api.mercury.com/api/v1/ar/invoices/{id}`, `status` == `Paid` (case-insensitive).
- Contract: `GET https://cloud.bestly.tech/apps/libresign/p/sign/{uuid}` (public page), decode the base64
  `initial-state-libresign-signers` / `-status` inputs. Signed when file status is 3, or there is at least one
  signer and every signer has a non-null `signed`. Careful: file status is already 2 "Partially signed" once the
  first party signs (the live Centering YOU page shows 2 signers, 1 signed), so status 2 alone is NOT done.
- Anything unreadable or odd is "unknown" and the to-do stays open. Nothing is ever written to Mercury or LibreSign.

## Auth
Supabase service-role key from `/home/pi/scripts/.env` (same as the other Pi jobs). Mercury token: `.env`
`MERCURY_API_TOKEN`, else Vault `pi:mercury_api_token` (`pi_secret_get`), else `mercury_token_t`.
The two RPCs are service_role only (not on `security_public_rpcs`; anon must never tick a to-do).
The done RPC re-checks open status, source kind, matching id and Paid/signed evidence.

## Running
```sh
/opt/bestly/cron/run.sh todo-autotick
python3 /opt/bestly/cron/jobs/todo_autotick.py --dry           # reads, ticks nothing
python3 /opt/bestly/cron/jobs/todo_autotick.py --live
python3 todo_autotick.py --mock fixture.json                    # no network/DB, forced dry
python3 selftest.py                                             # no network
```

## Install (on the Pi, as pi)
1. `sh install.sh` (copies files, seeds state in DRY mode, adds `7 * * * * /opt/bestly/cron/run.sh todo-autotick`, runs selftest).
2. `python3 /opt/bestly/cron/jobs/todo_autotick.py --dry`: expect `DRY would tick 0, 3 still waiting` while Centering YOU is unpaid/unsigned.
   A `skip:` line names why Mercury could not be read (IP allowlist, token scope).
3. Set `"mode": "live"` in the state file, run `/opt/bestly/cron/run.sh todo-autotick` once, confirm it reports ok.
4. `update pi_jobs set enabled = true where job = 'todo-autotick';`

## Not verified yet
Mercury `GET /ar/invoices/{id}` response shape and the exact `Paid` string (cloud cannot reach Mercury; the first Pi dry run settles it).

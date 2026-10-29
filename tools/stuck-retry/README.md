# stuck-retry -- "Retry now" for employees that run on bestly-pi

The Command Center's stuck card has a **Retry now** button. For an employee whose job runs on bestly-pi (pulse `src: pi_job`),
the database cannot start the job itself, so it queues a row and this one-minute Pi job runs it.

```
card tap -> admin_stuck_run('agent:<slug>', 'retry') -> stuck_run_retry -> insert pi_run_requests (queued)
Pi, every minute -> run_requests.py -> pi_run_claim() -> /opt/bestly/cron/run.sh <job> -> pi_run_finish(id, ok, one line)
card polls admin_stuck_action -> stuck_actions_settle -> "ran fine at 3:05 PM" or the reason it failed
```

| What | Path |
| --- | --- |
| Worker (also the `runjob.py` job, name `run_requests`) | `/opt/bestly/cron/jobs/run_requests.py` |
| DB side | `supabase/migrations/20261028190000_stuck_fix_buttons.sql` (`pi_run_requests`, `pi_run_claim`, `pi_run_finish`, `stuck_run_retry`) |
| Off switch | `touch /opt/bestly/cron/state/run_requests.OFF` (requests wait; the card says the runner may be off after 3 minutes) |

## Rules it follows
- Only the job **name** comes from the database; it must be letters, digits, `_` or `-`, and `run.sh` refuses anything that is not an installed, enabled job.
- `pi_run_claim` only hands out jobs that are enabled in `pi_jobs`, and expires requests older than 10 minutes, so an old tap never runs late.
- It never runs itself. One copy at a time (lock file). At most 3 requests a minute. Each job gets 10 minutes.
- The run is reported to `pi_jobs`, `pi_job_runs` and the employee's check-in by the normal wrapper (`run.sh` -> `runjob.py` -> `pi_job_report`), so the card clears the same way a scheduled run would.
- The one-line result it sends back is the last line of the job's output (the error line), because the card classifies the first line of a summary.

## Install (on the Pi, as pi)
1. `sh install.sh` (runs the selftest, copies the file, adds `* * * * * /opt/bestly/cron/run.sh run_requests`).
2. `/opt/bestly/cron/run.sh run_requests` once: expect `ok nothing waiting`.
3. `update pi_jobs set enabled = true where job = 'run_requests';`

## Test
`python3 selftest.py` (no network; a fake `run.sh` stands in).

## If it is off
The card says "bestly-pi did not pick this up within 3 minutes. Its retry runner may be off." and promotes **Have Scout fix it**.
The 15-minute watchdog (`stuck_feed_selftest`) raises `stuck.feed` if a request has waited 5 minutes.

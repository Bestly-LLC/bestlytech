# Plug Puller (Charging Attendant)

Ends Jared's ChargePoint session the moment the Tesla is done, so ChargePoint idle fees never start.
Hired 2026-10-05. Team card: `plug-puller` (reports to Turo Reader). Admin card: `/admin/turo#plug-puller`.

## Where it runs (bestly-pi)
- `/opt/bestly/cron/jobs/charge_stop.py` (this folder's `charge_stop.py`), cron `* * * * * /opt/bestly/cron/run.sh charge_stop`
  (self-paced: ChargePoint every 1-2 min during a session, every 2 min while plugged in, else every 30 min).
- `/opt/bestly/chargepoint/cp.py` + venv `/opt/bestly/chargepoint/venv` (python-chargepoint 2.3.2, unofficial ChargePoint API).
- Local state: `/opt/bestly/cron/state/charge_stop.json` (error streak, sessions it already ended, venv heal time).

## Rules
- Target = one-off % from the admin card, else the car's own charge limit (Tesla app). One-off resets after the session.
- Ends the session when: car >= target, car says Complete, or ChargePoint shows 0 kW for 10+ min after energy went in.
  Tesla rules only apply when the car is within 800 m of the station.
- Login: ChargePoint email + `coulomb_sess` cookie, pasted on the admin card -> `chargepoint_connect` -> Vault
  `pi:chargepoint:username` / `pi:chargepoint:token`. The job writes back rotated tokens with `pi_secret_put`.

## Watchdog / self-heal
- Every run -> `pi_job_report('charge_stop')`; `pi_jobs.max_gap_min = 10` -> Scout if silent.
- Signed out -> `bestly_raise('chargepoint.signin')` (owned by Plug Puller), resolved on the next good check.
- Stop not confirmed 3x -> time-sensitive push + `chargepoint.stop` issue.
- ChargePoint errors: quiet for 2 in a row, job fails (Scout) on the 3rd. Broken venv -> rebuilt (max every 6 h).
- Car Guard's "done charging, move it" pings stand down while Plug Puller owns the session (`charge_stop_owns_session()`).

Deploy: copy `cp.py` to `/opt/bestly/chargepoint/` and `charge_stop.py` to `/opt/bestly/cron/jobs/`, then
`cd /opt/bestly/cron && python3 runjob.py charge_stop --dry`.

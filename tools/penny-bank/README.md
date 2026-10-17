# penny-bank

Penny (Cost Cutter) weekly Mercury merchant totals -> spend_merchants. Aggregates only.

Lives on bestly-pi as /opt/bestly/cron/jobs/penny_bank.py, run Mondays 7:50 AM by `/opt/bestly/cron/run.sh penny_bank`.

Mercury token order: MERCURY_API_TOKEN in /home/pi/scripts/.env, then Vault pi:mercury_api_token via pi_secret_get, then mercury_token_t with /home/pi/.bestly/db_watchdog_token. Mercury calls run inside force_ipv4 (the allowlisted Pi IPv4).

Install: back up the Pi copy, scp this file over it, `python3 -m py_compile`, then `python3 penny_bank.py --dry`.

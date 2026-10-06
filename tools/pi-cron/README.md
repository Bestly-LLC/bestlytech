# tools/pi-cron

`freellm.py` is the repo copy of `/opt/bestly/cron/freellm.py` on bestly-pi (the free-AI ladder every Pi job imports). The Pi file is the live one; keep this copy in sync after any Pi edit (`sha256sum` both). Last change 2026-10-06: Fireworks rung `fireworks:kimi-k3` (skipped silently until Vault has `fireworks_api_key`; needs the `pi_secret` allowlist line from migration `20261006221500_pi_secret_fireworks.sql`). Pi backup before that change: `/opt/bestly/cron/freellm.py.bak-20261006-fireworks`.

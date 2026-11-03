# App Contract Check

Stops the Bestly Admin iPhone app from shipping buttons that call server functions that do not exist (build 6 lesson, Nov 3 2026).

**What it does.** Reads the iOS source, finds every `AdminAPI.rpc("name", ["p_x": ...])` and `AdminAPI.invoke("fn", ...)`, and checks against the live database:
the function exists, every param key the app sends is an input of it, required inputs are not left out, the signed-in admin (`authenticated`) may execute it, and edge functions exist in `supabase/functions` on `origin/main`.
Exit 0 = match, 1 = mismatch, 2 = could not check (no network or key).

**Where it runs.** Mac mini only (no Claude, no AI, never the MacBook Air).
- Daily 6:40 AM: LaunchAgent `tech.bestly.admin-app-contract` runs `~/Bestly/admin-app-contract/run-daily.sh`. It checks in with Scout (team card `admin-app-contract`) and on a mismatch raises alert `admin.app.contract` (owner Scout) that names each broken call. Clears itself when fixed.
- Before every ship: `ios/BestlySky/scripts/ship-sky.sh` runs it and stops (exit 5, `### CONTRACT CHECK FAILED`) on a mismatch.

**Credentials.** Publishable key from `~/Bestly/sweep/config.json` plus the watchdog token in Keychain (`bestly-db-watchdog`), through token-gated RPCs `admin_app_contract_t` and `admin_app_contract_report_t`. The raw `admin_app_contract(text[])` is service_role only. Nothing secret is printed or stored.

**Run by hand.** `python3 check.py <ios-source-dir> [--daily] [--repo <bestlytech>] [--names] [--contract-json file]`
**Install/update.** `sh install.sh` from this folder. Stop: `launchctl bootout gui/$(id -u)/tech.bestly.admin-app-contract`. Log: `~/Bestly/admin-app-contract/check.log`.

**Not covered.** Calls whose name is built at run time, rpc params passed as a variable (key check skipped), JSON field names inside responses, and direct table reads.

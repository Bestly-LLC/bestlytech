#!/usr/bin/env python3
"""Plug Puller's ChargePoint bridge (runs in /opt/bestly/chargepoint/venv on bestly-pi).

Called by /opt/bestly/cron/jobs/charge_stop.py, which stays stdlib-only. Prints ONE line of JSON.
Login comes from env CP_USERNAME + CP_TOKEN (the coulomb_sess cookie, read from Vault by the job, never logged).

  cp.py status          -> {"ok":true,"session":null | {...},"token":<only if ChargePoint rotated it>}
  cp.py stop <id>       -> {"ok":true,"stopped":true,"session":{...after}}
Errors -> {"ok":false,"kind":"signed_out"|"captcha"|"error","msg":"..."}

ChargePoint has no public driver API: this is the open-source python-chargepoint library (unofficial).
"""
import asyncio
import json
import os
import sys

from python_chargepoint import ChargePoint
from python_chargepoint.exceptions import DatadomeCaptcha, InvalidSession, LoginError


def _sess(s):
    if s is None:
        return None
    return {
        "session_id": s.session_id, "device_id": s.device_id, "device_name": s.device_name,
        "state": s.charging_state, "power_kw": s.power_kw, "energy_kwh": s.energy_kwh,
        "miles_added": s.miles_added, "cost": s.total_amount, "currency": s.currency_iso_code,
        "lat": s.latitude, "lon": s.longitude, "address": s.address, "company": s.company_name,
        "can_stop": bool(s.enable_stop_charging or s.stop_charge_supported),
        "home": s.is_home_charger,
        "start": s.start_time.isoformat() if s.start_time else None,
    }


async def run(cmd, arg):
    user, token = os.environ.get("CP_USERNAME", ""), os.environ.get("CP_TOKEN", "")
    client = await ChargePoint.create(username=user, coulomb_token=token)
    try:
        out = {"ok": True}
        if cmd == "status":
            st = await client.get_user_charging_status()
            if st and st.session_id:
                s = await client.get_charging_session(st.session_id)
                out["session"] = _sess(s)
                out["cp_state"] = st.state
            else:
                out["session"] = None
        elif cmd == "stop":
            s = await client.get_charging_session(int(arg))
            await s.stop()
            await asyncio.sleep(6)
            st = await client.get_user_charging_status()
            after = None
            if st and st.session_id == int(arg):
                after = await client.get_charging_session(st.session_id)
            out["stopped"] = True
            out["session"] = _sess(after)
        else:
            return {"ok": False, "kind": "error", "msg": "unknown command"}
        new = client.coulomb_token
        if new and new != token:
            out["token"] = new
        return out
    finally:
        await client.close()


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    arg = sys.argv[2] if len(sys.argv) > 2 else None
    try:
        out = asyncio.run(run(cmd, arg))
    except (InvalidSession, LoginError) as e:
        out = {"ok": False, "kind": "signed_out", "msg": str(e)[:200]}
    except DatadomeCaptcha as e:
        out = {"ok": False, "kind": "captcha", "msg": str(e)[:200]}
    except Exception as e:  # noqa: BLE001
        out = {"ok": False, "kind": "error", "msg": f"{type(e).__name__}: {e}"[:300]}
    print(json.dumps(out, default=str))


if __name__ == "__main__":
    main()

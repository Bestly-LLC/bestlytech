#!/usr/bin/env python3
"""Plug Puller's ChargePoint bridge (runs in /opt/bestly/chargepoint/venv on Hestia).

Called by /opt/bestly/cron/jobs/charge_stop.py and charge_plan.py, which stay stdlib-only. Prints ONE line of JSON.
Login comes from env CP_USERNAME + CP_TOKEN (the coulomb_sess cookie, read from Vault by the job, never logged).

  cp.py status          -> {"ok":true,"session":null | {...},"token":<only if ChargePoint rotated it>}
  cp.py stop <id>       -> {"ok":true,"stopped":true,"session":{...after}}     (the only write)
  cp.py find <lat> <lon> [pad_deg]  -> read-only: stations on the map around a point (CHARGEPLAN_20261103)
  cp.py station <id>    -> read-only: live port status + time-of-use price schedule (CHARGEPLAN_20261103)
Errors -> {"ok":false,"kind":"signed_out"|"captcha"|"error","msg":"..."}

ChargePoint has no public driver API: this is the open-source python-chargepoint library (unofficial).
"""
import asyncio
import json
import os
import sys

from python_chargepoint import ChargePoint
from python_chargepoint.exceptions import DatadomeCaptcha, InvalidSession, LoginError
from python_chargepoint.global_config import ZoomBounds


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


def _station(d):
    """Compact view of the raw v3/station/info JSON (the library model drops the fee fields we need)."""
    sp = d.get("stationPrice") or {}
    ports = []
    for p in (d.get("portsInfo") or {}).get("ports", []):
        ports.append({"outlet": p.get("outletNumber"), "status": p.get("status"), "status_v2": p.get("statusV2"),
                      "max_kw": (p.get("powerRange") or {}).get("max"), "unit": (p.get("powerRange") or {}).get("unit"),
                      "plugs": [c.get("displayPlugType") or c.get("plugType") for c in p.get("connectorList", [])]})
    tou = [{"day": t.get("day"), "start": t.get("startTime"), "end": t.get("endTime"),
            "amount": (t.get("fee") or {}).get("amount"), "unit": (t.get("fee") or {}).get("unit")}
           for t in (sp.get("energyFee") or {}).get("touFeeList", [])]
    park = ((sp.get("parkingFee") or {}).get("chargingBasedFee") or {})
    return {"device_id": d.get("deviceId"), "name": d.get("name"),
            "address": f"{(d.get('address') or {}).get('address1')}, {(d.get('address') or {}).get('city')}",
            "station_status": d.get("stationStatus"), "status_v2": d.get("stationStatusV2"), "open": d.get("openCloseStatus"),
            "ports": ports, "port_count": (d.get("portsInfo") or {}).get("portCount"), "time_zone": d.get("timeZone"),
            "price": {"currency": sp.get("currencyCode"), "tou": tou,
                      "service_fee": sp.get("serviceFee"), "guest_fee": sp.get("guestFee"),
                      "idle_per_hr": (park.get("whileNotCharging") or {}).get("amount"),
                      "idle_grace_s": park.get("gracePeriod")},
            "lat": d.get("latitude"), "lon": d.get("longitude")}


async def run(cmd, args):
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
            s = await client.get_charging_session(int(args[0]))
            await s.stop()
            await asyncio.sleep(6)
            st = await client.get_user_charging_status()
            after = None
            if st and st.session_id == int(args[0]):
                after = await client.get_charging_session(st.session_id)
            out["stopped"] = True
            out["session"] = _sess(after)
        elif cmd == "find":
            lat, lon = float(args[0]), float(args[1])
            pad = float(args[2]) if len(args) > 2 else 0.004
            b = ZoomBounds(ne_lat=lat + pad, ne_lon=lon + pad, sw_lat=lat - pad, sw_lon=lon - pad)
            res = await client.get_nearby_stations(b)
            out["stations"] = [{"device_id": m.device_id, "name": [m.name1, m.name2], "lat": m.lat, "lon": m.lon,
                                "address": m.address1, "status": m.station_status, "status_v2": m.station_status_v2,
                                "ports": [{"status": p.status, "status_v2": p.status_v2, "outlet": p.outlet_number} for p in m.ports],
                                "payment": m.payment_type, "tou": m.tou_status} for m in res]
        elif cmd == "station":
            url = (client._global_config.endpoints.mapcache_endpoint / "v3/station/info").update_query(
                {"deviceId": str(int(args[0])), "use_cache": "false"})
            resp = await client._request("GET", url)
            await client._raise_for_status(resp, "Failed to get station info.")
            out["station"] = _station(await resp.json())
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
    args = sys.argv[2:]
    try:
        out = asyncio.run(run(cmd, args))
    except (InvalidSession, LoginError) as e:
        out = {"ok": False, "kind": "signed_out", "msg": str(e)[:200]}
    except DatadomeCaptcha as e:
        out = {"ok": False, "kind": "captcha", "msg": str(e)[:200]}
    except Exception as e:  # noqa: BLE001
        out = {"ok": False, "kind": "error", "msg": f"{type(e).__name__}: {e}"[:300]}
    print(json.dumps(out, default=str))


if __name__ == "__main__":
    main()

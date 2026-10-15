#!/usr/bin/env python3
"""Tesla A/C helper for the LAX guest page (tech.bestly.tesla-worker).

Why it runs here: Tesla only accepts climate commands that are signed with the Bestly
virtual key (Vehicle Command Protocol). The tesla-fleet-api library does that signing;
this Mac mini runs it for free instead of a paid proxy.

Loop (every 3 s): tesla_worker_claim() over Supabase REST = heartbeat + next queued job.
A job: refresh the Tesla token if needed -> wake the car -> send the signed command ->
read the car -> tesla_worker_done(). Every billable Tesla call is reserved first with
tesla_worker_spend() (hard monthly cap, Tesla gives $10 free).

Self-healing:
  - launchd KeepAlive restarts this process if it exits or crashes.
  - 20 straight failed polls -> exit(1) so launchd starts it fresh.
  - The database requeues jobs a crashed run left behind, and lax_watchdog() (pg_cron,
    every 5 min) tells Scout if this helper stops checking in.
Secrets: worker token in the macOS Keychain (service bestly-tesla-worker); Tesla tokens and
the private key come from Supabase Vault per job and are only held in memory.
"""
import asyncio, contextlib, ipaddress, json, os, re, shutil, socket, ssl, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

import aiohttp
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from tesla_fleet_api import TeslaFleetApi
from tesla_fleet_api.tesla.vehicle.signed import VehicleSigned
from tesla_fleet_api.exceptions import TeslaFleetError

VERSION = "1.9.0"
SB = "https://rcqfqhguwpmaarseifqg.supabase.co"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"  # publishable key (key switch 2026-09-24)
TOKEN_URL = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token"
F = lambda f: round((f - 32) * 5 / 9, 1)  # Tesla takes Celsius
# 1.9.0: Fleet Telemetry settings need Tesla's own signer (teslamotors/vehicle-command v0.4.1, built on the Pi 2026-10-14).
PROXY_BIN = "/opt/bestly/bin/tesla-http-proxy"
FLEET_NA = "https://fleet-api.prd.na.vn.cloud.tesla.com"


class CarSaidNo(Exception):
    """The car answered but refused the command (tesla-fleet-api returns result=false instead of raising)."""


# 1.8.1 (2026-09-27): the worker used to ignore result=false, so a refused "Cool it down" showed "Done"
# while the A/C stayed off. Reasons we have seen, in plain words.
REASONS = {
    "low_power_mode_low_soc": "The car is in Low Power Mode, so it won't run the A/C remotely. Turn it off on the car's screen (Controls > Charging > Low Power Mode) or in the Tesla app, then try again.",
    "vehicle_busy": "The car was busy with something else. Try again in a minute.",
    "user_present": "Someone is in the car, so it won't take a remote command.",
    "cabin_comfort_remote_settings_not_enabled": "Remote climate is turned off in the car's settings.",
    "not_allowed_over_transport": "The car won't take this command over the internet right now.",
}


def plain_reason(reason):
    r = (reason or "").strip() or "no reason given"
    return REASONS.get(r, f"The car said no ({r.replace('_', ' ')}). Try again in a minute.")


def check_reply(r):
    resp = r.get("response") if isinstance(r, dict) else None
    if isinstance(resp, dict) and resp.get("result") is False:
        raise CarSaidNo(str(resp.get("reason") or ""))
    return r


def log(msg):
    print(time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg, flush=True)


def keychain(service):
    # 1.8.3 (2026-10-03, moved to the Pi): token file first (/opt/bestly/tesla-worker/.token, 0600), macOS Keychain as fallback.
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".token")
    if os.path.exists(p):
        return open(p).read().strip() or None
    r = subprocess.run(["security", "find-generic-password", "-s", service, "-w"], capture_output=True, text=True, timeout=10)
    return r.stdout.strip() or None


def rpc(fn, args, timeout=15):
    req = urllib.request.Request(f"{SB}/rest/v1/rpc/{fn}", data=json.dumps(args).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "apikey": ANON, "Authorization": f"Bearer {ANON}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode() or "null"
        return json.loads(body)


class Worker:
    def __init__(self, token):
        self.token = token

    def spend(self, kind, job):
        # Guest-key jobs are host housekeeping: they use the monthly cap, not the guest's per-trip cap.
        system = job["reservation_id"] is None or job["action"].startswith("key_") or job["action"] in ("charges", "charge_history")
        ok = rpc("tesla_worker_spend", {"p_token": self.token, "p_kind": kind,
                                        "p_reservation": None if system else job["reservation_id"], "p_admin": system})
        if ok is not True:
            raise RuntimeError("Free budget cap reached, so nothing was sent to the car")

    async def access_token(self, session, s):
        # access_note looks like "... expires 2026-09-24 06:28:09+00"
        m = re.search(r"expires (.+)$", s.get("access_note") or "")
        exp = None
        if m:
            try:
                exp = datetime.fromisoformat(m.group(1).strip().replace(" ", "T", 1).replace("+00", "+00:00"))
            except ValueError:
                exp = None
        if s.get("access_token") and exp and exp > datetime.now(timezone.utc) + timedelta(minutes=5):
            return s["access_token"]
        async with session.post(TOKEN_URL, data={"grant_type": "refresh_token", "client_id": s["client_id"],
                                                 "refresh_token": s["refresh_token"]}) as r:
            j = await r.json()
        if "access_token" not in j:
            raise RuntimeError(f"Tesla token refresh failed: {str(j)[:160]}")
        expires = datetime.now(timezone.utc) + timedelta(seconds=j.get("expires_in", 28800))
        rpc("tesla_worker_store_tokens", {"p_token": self.token, "p_refresh": j.get("refresh_token") or s["refresh_token"],
                                          "p_access": j["access_token"], "p_expires_at": expires.isoformat()})
        return j["access_token"]

    def stage(self, job, text):
        try:
            rpc("tesla_worker_stage", {"p_token": self.token, "p_id": job["id"], "p_stage": text}, timeout=8)
        except Exception:
            pass

    async def wait_online(self, car, job, seconds=45):
        """Wake once ($0.02), then check the car's status every 3 s until it's online. Returns the last state seen."""
        self.stage(job, "Waking up the car")
        self.spend("wake", job)
        r = (await car.wake_up()).get("response") or {}
        state = r.get("state")
        waited = 0
        while state != "online" and waited < seconds:
            await asyncio.sleep(3)
            waited += 3
            self.spend("data", job)
            try:
                state = ((await car.vehicle()).get("response") or {}).get("state")
            except (TeslaFleetError, Exception):
                state = None
        return state

    async def read_state(self, car, job):
        self.spend("data", job)
        d = (await car.vehicle_data(["charge_state", "climate_state", "vehicle_state", "drive_state"])).get("response") or {}
        cs, cl, vs = d.get("charge_state") or {}, d.get("climate_state") or {}, d.get("vehicle_state") or {}
        ds = d.get("drive_state") or {}
        c2f = lambda c: None if c is None else round(c * 9 / 5 + 32)
        # Same shape Turo Watch uses (turo_vehicle_state); the database merges it so nothing another source knows is lost.
        return {"battery": cs.get("battery_level"), "range": cs.get("battery_range"), "range_real": cs.get("est_battery_range"),
                "inside_f": c2f(cl.get("inside_temp")), "outside_f": c2f(cl.get("outside_temp")), "locked": vs.get("locked"),
                "climate_on": cl.get("is_climate_on"), "charging": cs.get("charging_state"),
                "plugged_in": (cs.get("charging_state") not in (None, "Disconnected")),
                "odometer": vs.get("odometer"), "software": (vs.get("car_version") or "").split(" ")[0] or None,
                # Is anyone actually sitting in it (Jared 2026-10-05). Guests park, then sit in the car for an hour
                # waiting on a ride; locked-and-shut alone called that a finished return. vehicle_state was already
                # in this response, so these cost no extra Tesla call. turo_handoff_tick reads them to decide
                # whether the guest has really walked away.
                "user_present": vs.get("is_user_present"),
                "doors_open": any(bool(vs.get(k)) for k in ("df", "pf", "dr", "pr")),
                # Gear + speed from drive_state (same single call, no location_data). turo_handoff_detect reads
                # these to see a guest has driven off without waiting on TezLab (Jared 2026-10-11).
                "shift": ds.get("shift_state"), "speed_mph": ds.get("speed"),
                "online": d.get("state") or "online"}

    async def health(self, car, job):
        """Tire pressures (psi) + warnings, pending software update, sentry, odometer. One data read."""
        self.spend("data", job)
        d = (await car.vehicle_data(["vehicle_state", "charge_state"])).get("response") or {}
        vs, cs = d.get("vehicle_state") or {}, d.get("charge_state") or {}
        psi = lambda b: None if b is None else round(b * 14.5038, 1)
        tires = {k: psi(vs.get(f"tpms_pressure_{k}")) for k in ("fl", "fr", "rl", "rr")}
        warn = {k: bool(vs.get(f"tpms_soft_warning_{k}") or vs.get(f"tpms_hard_warning_{k}")) for k in ("fl", "fr", "rl", "rr")}
        su = vs.get("software_update") or {}
        # Windows. They were in this response all along: the same vehicle_state that carries the
        # tyre pressures has fd/fp/rd/rp_window, 0 for shut. Dropping them left the guest-key gate
        # unable to see an open window and the "close the windows when parked" auto-fix waiting on
        # a signal that never arrived, so it had never once fired. Flat keys on purpose: the
        # database matches any key containing "window" and reads a number above zero as open.
        windows = {f"{k}_window": vs.get(f"{k}_window") for k in ("fd", "fp", "rd", "rp")}
        return {"ok": True, "tires": tires, "tire_warn": warn, "tpms_at": vs.get("tpms_last_seen_pressure_time_fl"),
                **windows,
                "doors_open": {k: bool(vs.get(k)) for k in ("df", "pf", "dr", "pr")},
                "trunk_open": bool(vs.get("rt")), "frunk_open": bool(vs.get("ft")), "locked": vs.get("locked"),
                "update": {"status": su.get("status") or None, "version": su.get("version") or None},
                "sentry": vs.get("sentry_mode"), "odometer": vs.get("odometer"), "battery": cs.get("battery_level"),
                "charge_limit": cs.get("charge_limit_soc"), "charging": cs.get("charging_state"),
                "minutes_to_full": cs.get("minutes_to_full_charge"), "fast_charger": cs.get("fast_charger_present")}

    async def nearby(self, car, job):
        """Superchargers near the car with live open-stall counts (Tesla's own data)."""
        self.spend("data", job)
        # A plain data read (the signed-command path rejects it): use the unsigned fleet client.
        r = (await self.api.vehicles.createFleet(car.vin).nearby_charging_sites()).get("response") or {}
        out = []
        for c in r.get("superchargers") or []:
            loc = c.get("location") or {}
            out.append({"name": c.get("name"), "lat": loc.get("lat"), "lon": loc.get("long"), "miles": c.get("distance_miles"),
                        "open": c.get("available_stalls"), "total": c.get("total_stalls"), "closed": bool(c.get("site_closed"))})
        return {"ok": True, "sites": out[:8]}

    async def drivers(self, car, job):
        """Shared drivers on the car (owner not included) as [{id, name}]."""
        self.spend("data", job)
        out = []
        for d in (await car.drivers()).get("response") or []:
            did = d.get("share_user_id") or d.get("user_id_s") or d.get("user_id")
            name = " ".join(x for x in (d.get("driver_first_name"), d.get("driver_last_name")) if x) or "Driver"
            if did is not None:
                out.append({"id": str(did), "name": name})
        return out

    async def keys(self, car, job):
        """Guest Tesla keys (Fleet API share invites). Plain REST: no virtual key or wake needed."""
        a, args = job["action"], job.get("args") or {}
        baseline = {str(x) for x in (args.get("baseline") or [])}
        if a == "key_create":
            before = await self.drivers(car, job)
            self.spend("data", job)
            inv = (await car.share_invites_create()).get("response") or {}
            return {"ok": True, "invite": {"id": str(inv.get("id_s") or inv.get("id") or ""), "code": inv.get("code"),
                                           "share_link": inv.get("share_link"), "expires_at": inv.get("expires_at"),
                                           "state": inv.get("state"), "fields": sorted(inv.keys())},
                    "driver_ids": [d["id"] for d in before], "drivers": before}, None
        if a == "key_check":
            now = await self.drivers(car, job)
            return {"ok": True, "new_drivers": [d for d in now if d["id"] not in baseline], "drivers": now}, None
        if a == "key_remove":
            revoked = None
            if args.get("invite_id"):
                try:
                    self.spend("data", job)
                    await car.share_invites_revoke(args["invite_id"])
                    revoked = args["invite_id"]
                except (TeslaFleetError, Exception) as e:  # already used or expired: fine
                    revoked = f"skip: {str(e)[:80]}"
            removed = []
            only = {str(x) for x in (args.get("only") or [])}
            if job.get("reservation_id") is None and not only:
                # 1.8.2: a removal that belongs to no guest trip (demo / key switch) must name exactly which drivers
                # to take off. Without that list it used to remove every driver added since its baseline, and on
                # 2026-09-29 it kicked a live guest (added by hand) off the car. Revoke the invite only.
                still = [d for d in await self.drivers(car, job) if d["id"] not in baseline]
                return {"ok": True, "revoked": revoked, "removed": [], "still_there": still, "skipped": "no trip and no 'only' list: drivers left alone"}, None
            for d in await self.drivers(car, job):
                if d["id"] in baseline:
                    continue  # was on the car before this trip: never touched
                if only and d["id"] not in only:
                    continue  # demo key: remove just the demo drivers, never a guest's
                self.spend("data", job)
                await car.drivers_remove(d["id"])
                removed.append(d)
            still = [d for d in await self.drivers(car, job) if d["id"] not in baseline and (not only or d["id"] in only)]
            return {"ok": True, "revoked": revoked, "removed": removed, "still_there": still}, None
        raise RuntimeError(f"unknown key action {a}")

    async def charges(self, api, vin, job):
        """Tesla's Supercharger history for the trip window: billed charging + idle fees per session. Never wakes the car."""
        a = job.get("args") or {}
        def iso(v):
            return datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if v else None
        self.stage(job, "Reading Tesla charging history")
        self.spend("data", job)
        r = await api.charging.history(vin=vin, startTime=iso(a.get("start")), endTime=iso(a.get("end")), pageSize=50)
        resp = r if isinstance(r, dict) else {}
        inner = resp.get("response") if isinstance(resp.get("response"), dict) else {}
        data = resp.get("data") or inner.get("data") or (resp.get("response") if isinstance(resp.get("response"), list) else None) or []
        if data:
            log("charge_history sample: " + json.dumps(data[0])[:600])
        out = []
        for d in data:
            fees = d.get("fees") or []
            charge = [f for f in fees if str(f.get("feeType", "")).upper() == "CHARGING"]
            idle = [f for f in fees if str(f.get("feeType", "")).upper() in ("PARKING", "IDLE", "CONGESTION")]
            cost = sum(float(f.get("totalDue") or f.get("netDue") or 0) for f in charge)
            kwh = sum(float(f.get("usageBase") or 0) + float(f.get("usageTier1") or 0) + float(f.get("usageTier2") or 0) + float(f.get("usageTier3") or 0) + float(f.get("usageTier4") or 0)
                      for f in charge if str(f.get("uom", "")).lower() == "kwh")
            out.append({
                "id": str(d.get("sessionId") or d.get("id")), "started_at": d.get("chargeStartDateTime"), "ended_at": d.get("chargeStopDateTime") or d.get("unlatchDateTime"),
                "place": d.get("siteLocationName"), "address": None, "kwh": round(kwh, 2) if kwh else None,
                "cost": round(cost, 2), "idle_fee": round(sum(float(f.get("totalDue") or 0) for f in idle), 2),
                "currency": (fees[0].get("currencyCode") if fees else None) or "USD", "supercharger": True,
                "invoices": [{"id": i.get("contentId"), "name": i.get("fileName")} for i in (d.get("invoices") or [])],
            })
        return {"ok": True, "source": "tesla", "charges": out, "count": len(out)}

    # ---- 1.9.0 (2026-10-14): Tesla Fleet Telemetry settings (live location while the car is driving) ---------------
    # telemetry_push   : send the streaming settings (host, CA, fields, expiry) to the car through Tesla.
    # telemetry_check  : read them back, look for car-side errors, re-send if they are missing / near expiry (only when enabled).
    # telemetry_delete : take the settings off the car.
    # None of these wake the car or use the vehicle-command signer; they only talk to Tesla's servers, so a sleeping car is fine.
    @contextlib.asynccontextmanager
    async def signing_proxy(self, s):
        """tesla-http-proxy (teslamotors/vehicle-command, pinned build in /opt/bestly/bin) on 127.0.0.1 for the length of
        one job. Tesla only accepts fleet_telemetry_config signed by the virtual key, and the Python library can't do that.
        The key and a throwaway TLS key live in a 0700 temp dir on the RAM disk and are removed when the job ends.
        Yields (port, ssl_context)."""
        d = tempfile.mkdtemp(prefix="tg-", dir="/dev/shm" if os.path.isdir("/dev/shm") else None)
        proc = None
        try:
            os.chmod(d, 0o700)
            key_file, tls_key, tls_crt = (os.path.join(d, n) for n in ("cmd.pem", "tls.key", "tls.crt"))
            # The proxy's Go loader wants SEC1 PEM; re-encode whatever the vault holds.
            ck = serialization.load_pem_private_key(s["private_key"].encode(), password=None)
            tk = ec.generate_private_key(ec.SECP256R1())
            for path, key in ((key_file, ck), (tls_key, tk)):
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                              serialization.NoEncryption()))
            name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "tg-proxy-local")])
            now = datetime.now(timezone.utc)
            crt = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(tk.public_key())
                   .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5))
                   .not_valid_after(now + timedelta(days=1))
                   .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
                   .sign(tk, hashes.SHA256()))
            pem = crt.public_bytes(serialization.Encoding.PEM)
            with open(tls_crt, "wb") as f:
                f.write(pem)
            with socket.socket() as sk:
                sk.bind(("127.0.0.1", 0))
                port = sk.getsockname()[1]
            proc = subprocess.Popen([PROXY_BIN, "-host", "127.0.0.1", "-port", str(port), "-tls-key", tls_key, "-cert", tls_crt,
                                     "-key-file", key_file], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, cwd=d)
            for _ in range(50):
                if proc.poll() is not None:
                    raise RuntimeError("The signing helper stopped at startup")
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                        break
                except OSError:
                    await asyncio.sleep(0.2)
            else:
                raise RuntimeError("The signing helper did not start")
            yield port, ssl.create_default_context(cadata=pem.decode())
        finally:
            if proc is not None and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
            shutil.rmtree(d, ignore_errors=True)

    async def tg_http(self, access, method, path, body=None, base=FLEET_NA, ctx=None):
        async with aiohttp.ClientSession() as ses:
            async with ses.request(method, base + path, json=body, headers={"Authorization": "Bearer " + access}, ssl=ctx,
                                   timeout=aiohttp.ClientTimeout(total=40)) as r:
                txt = await r.text()
                status = r.status
        try:
            j = json.loads(txt) if txt else {}
        except ValueError:
            j = {"raw": txt[:300]}
        return status, (j if isinstance(j, dict) else {"raw": str(j)[:300]})

    async def telemetry_push(self, s, access, args, job):
        """Send the settings. The longest allowed expiry is not in Tesla's docs, so try a year, then 180 days, then 30."""
        if not args.get("ca"):
            raise RuntimeError("The telemetry CA certificate is missing from the vault (tesla_telemetry_ca_crt)")
        vin = args["vin"]
        last = ""
        async with self.signing_proxy(s) as (port, ctx):
            for days in (364, 180, 30):
                exp = int(time.time()) + days * 86400
                cfg = {"hostname": args["hostname"], "port": int(args["port"]), "ca": args["ca"], "fields": args["fields"],
                       "alert_types": ["service"], "delivery_policy": "latest", "prefer_typed": True, "exp": exp}
                self.stage(job, "Sending the live-location settings to Tesla")
                self.spend("command", job)
                st, j = await self.tg_http(access, "POST", "/api/1/vehicles/fleet_telemetry_config", {"vins": [vin], "config": cfg},
                                           base=f"https://127.0.0.1:{port}", ctx=ctx)
                resp = j.get("response") if isinstance(j.get("response"), dict) else {}
                text = json.dumps(j)[:400]
                if st == 200 and (resp.get("updated_vehicles") or 0) >= 1:
                    break
                skipped = resp.get("skipped_vehicles") or {}
                if st == 200 and skipped:
                    why = ",".join(sorted(k for k, v in skipped.items() if vin in (v or []))) or "skipped"
                    if "key" in why:
                        rpc("car_telemetry_record", {"p_token": self.token, "p_kind": "check", "p_data": {"problem": "key_missing"}})
                        raise RuntimeError("Tesla says the Bestly virtual key isn't on the car, so the live-location settings can't be sent.")
                    raise RuntimeError(f"Tesla skipped the car ({why}).")
                if st >= 400 and "exp" in text.lower():
                    last = text
                    log(f"job {job['id']} expiry of {days} days refused: {text[:160]}")
                    continue
                raise RuntimeError(f"Tesla refused the live-location settings (HTTP {st}): {text[:200]}")
            else:
                raise RuntimeError(f"Tesla refused every expiry we tried: {last[:200]}")
        await asyncio.sleep(2)
        synced = None
        try:
            self.spend("data", job)
            st2, j2 = await self.tg_http(access, "GET", f"/api/1/vehicles/{vin}/fleet_telemetry_config")
            synced = (j2.get("response") or {}).get("synced")
        except Exception:
            pass
        exp_at = datetime.fromtimestamp(exp, timezone.utc).isoformat()
        out = {"ok": True, "msg": "telemetry settings sent", "exp_at": exp_at, "exp_days": days, "synced": synced}
        rpc("car_telemetry_record", {"p_token": self.token, "p_kind": "push", "p_data": out})
        return out

    async def telemetry_job(self, s, job, access):
        a = job["action"]
        args = rpc("car_telemetry_push_args", {"p_token": self.token})
        vin = args["vin"]
        if a == "telemetry_delete":
            self.spend("command", job)
            st, j = await self.tg_http(access, "DELETE", f"/api/1/vehicles/{vin}/fleet_telemetry_config")
            if st not in (200, 404):
                raise RuntimeError(f"Tesla would not remove the live-location settings (HTTP {st}): {json.dumps(j)[:200]}")
            rpc("car_telemetry_record", {"p_token": self.token, "p_kind": "delete", "p_data": {"status": st}})
            return {"ok": True, "msg": "telemetry settings removed", "http": st}, None
        if a == "telemetry_push":
            return await self.telemetry_push(s, access, args, job), None
        # telemetry_check
        self.stage(job, "Checking the live-location settings")
        self.spend("data", job)
        st, j = await self.tg_http(access, "GET", f"/api/1/vehicles/{vin}/fleet_telemetry_config")
        resp = j.get("response") if isinstance(j.get("response"), dict) else {}
        cfg = resp.get("config") if isinstance(resp.get("config"), dict) else None
        text = json.dumps(j)[:300]
        problem = None
        if st >= 400 and "key" in text.lower() and "missing" in text.lower():
            problem = "key_missing"
        elif st >= 400 and st != 404:
            problem = f"Tesla answered HTTP {st} when asked for the settings"
        exp_ts = None
        if cfg:
            try:
                exp_ts = float(cfg.get("exp"))
            except (TypeError, ValueError):
                exp_ts = None
        enabled = bool(args.get("enabled"))
        why = None
        if enabled and problem is None:
            if not cfg:
                why = "settings missing on the car"
            elif exp_ts is not None and exp_ts - time.time() < 30 * 86400:
                why = "settings expire in under 30 days"
            elif cfg.get("hostname") != args["hostname"] or int(cfg.get("port") or 0) != int(args["port"]):
                why = "settings point somewhere else"
        repushed = None
        if why:
            log(f"job {job['id']} telemetry re-push: {why}")
            repushed = await self.telemetry_push(s, access, args, job)
            exp_ts = datetime.fromisoformat(repushed["exp_at"]).timestamp()
        errs = []
        if problem is None:
            try:
                self.spend("data", job)
                st3, j3 = await self.tg_http(access, "GET", f"/api/1/vehicles/{vin}/fleet_telemetry_errors")
                errs = (j3.get("response") or {}).get("fleet_telemetry_errors") or []
            except Exception:
                errs = []
        if errs and problem is None and not repushed:
            e0 = errs[-1] if isinstance(errs[-1], dict) else {}
            problem = ("The car reported a streaming error: " + str(e0.get("error") or e0.get("name") or errs[-1]))[:240]
        out = {"ok": True, "msg": "telemetry checked", "http": st, "configured": bool(cfg), "synced": resp.get("synced"),
               "exp_at": None if exp_ts is None else datetime.fromtimestamp(exp_ts, timezone.utc).isoformat(),
               "errors": len(errs), "problem": problem, "repushed": why}
        rpc("car_telemetry_record", {"p_token": self.token, "p_kind": "check", "p_data": out})
        return out, None

    async def run(self, claim):
        job, s, vin = claim["job"], claim["secrets"], claim["vin"]
        async with aiohttp.ClientSession() as session:
            api = TeslaFleetApi(session=session, access_token=await self.access_token(session, s), region="na")
            api.private_key = serialization.load_pem_private_key(s["private_key"].encode(), password=None)
            car = VehicleSigned(api, vin)
            self.api = api
            if job["action"] in ("telemetry_push", "telemetry_check", "telemetry_delete"):
                # 1.9.0: Tesla-side settings only. Never wakes the car (and must not fall through to wait_online below).
                return await self.telemetry_job(s, job, await self.access_token(session, s))
            if job["action"].startswith("key_"):
                return await self.keys(car, job)
            if job["action"] in ("charges", "charge_history"):
                return await self.charges(api, vin, job), None
            if job["action"] in ("health", "nearby_sc"):
                # Read-only, never wakes the car: an asleep car just reports "asleep".
                try:
                    return (await (self.health(car, job) if job["action"] == "health" else self.nearby(car, job))), None
                except (TeslaFleetError, Exception) as e:
                    return {"ok": True, "asleep": True, "detail": str(e)[:160]}, None
            if job["action"] == "refresh":
                try:
                    return {"ok": True, "msg": "updated"}, await self.read_state(car, job)
                except (TeslaFleetError, Exception) as e:  # asleep: don't wake it just to read
                    return {"ok": True, "msg": "car is asleep", "detail": str(e)[:120]}, {"online": "asleep"}
            # Wake and wait until it's really online, then send the signed command.
            state = await self.wait_online(car, job)
            if state != "online":
                raise RuntimeError("The car isn't reachable right now (it may be parked with no cell signal). Try again in a few minutes."
                                   if state in (None, "offline") else "The car didn't wake up in time. Try again in a minute.")
            self.stage(job, "Sending to the car")
            steps = {
                "cool": [lambda: car.set_temps(F(68), F(68)), car.auto_conditioning_start],
                "warm": [lambda: car.set_temps(F(74), F(74)), car.auto_conditioning_start],
                "seat": [car.auto_conditioning_start, lambda: car.remote_seat_heater_request(0, 3)],
                "off": [car.auto_conditioning_stop],
                "honk": [car.honk_horn],
                "flash": [car.flash_lights],
                "unlock": [car.door_unlock],
                # Guest "Unlock & Start" (only after their phone key is confirmed + consent, checked by the database).
                "unlock_start": [car.door_unlock, car.remote_start_drive],
                "lock": [car.door_lock],
                "nav_charger": [lambda: car.navigation_gps_request(34.0909484, -118.3418798, 0)],
                "nav_charger_lax": [lambda: car.navigation_gps_request(33.98681, -118.390323, 0)],
                "nav_garage_lax": [lambda: car.navigation_gps_request(33.9472637, -118.3826063, 0)],
                "nav_home": [lambda: car.navigation_gps_request(34.084241, -118.371793, 0)],
                # A Supercharger the guest picked from the live open-stalls list (coordinates checked by the database).
                "nav_point": [lambda: car.navigation_gps_request(float((job.get("args") or {}).get("lat")), float((job.get("args") or {}).get("lon")), 0)],
            }[job["action"]]
            last = None
            for attempt in range(3):  # short retry: the car is already online here
                try:
                    for step in steps:
                        self.spend("command", job)
                        check_reply(await step())
                    last = None
                    break
                except CarSaidNo as e:
                    last = e
                    log(f"job {job['id']} car refused: {e}")
                    if str(e) not in ("Too many retries", "vehicle_busy"):
                        break
                    await asyncio.sleep(3)
                except TeslaFleetError as e:
                    last = e
                    await asyncio.sleep(3)
            if isinstance(last, CarSaidNo):
                raise RuntimeError(plain_reason(str(last)))
            if last is not None:
                raise RuntimeError(f"The car didn't accept the command ({type(last).__name__}). Try again in a minute.")
            self.stage(job, "Done, checking the car")
            want = True if job["action"] in ("cool", "warm", "seat") else False if job["action"] == "off" else None
            state = None
            for i in range(4 if want is not None else 1):
                await asyncio.sleep(2 if i == 0 else 4)
                try:
                    state = await self.read_state(car, job)
                except (TeslaFleetError, Exception):
                    state = None
                if want is None or (state and state.get("climate_on") is want):
                    break
            if want is not None and state and state.get("climate_on") is not want:
                # Save the reading, then fail in plain words (the car accepted it but nothing changed).
                try:
                    rpc("tesla_worker_done", {"p_token": self.token, "p_id": job["id"], "p_ok": False,
                                              "p_result": {"error": "x"}, "p_state": state})
                except Exception:
                    pass
                raise RuntimeError("The car said OK, but the A/C didn't come on. Check the car's screen (Low Power Mode or a low battery can block it)."
                                   if want else "The car said OK, but the A/C is still running. Try Turn off again.")
            return {"ok": True, "msg": job["action"], "climate_on": (state or {}).get("climate_on")}, state


def main():
    token = keychain("bestly-tesla-worker")
    if not token:
        log("No worker token in Keychain (service bestly-tesla-worker); sleeping 5 min then exiting for launchd to retry")
        time.sleep(300)
        sys.exit(1)
    w = Worker(token)
    fails = 0
    # 1.8.2: a network drop (2026-09-28) left the loop stuck forever in a socket/DNS call with no error.
    # If the loop makes no progress for 4 minutes, exit so launchd starts a fresh process.
    beat = [time.time()]
    def guard():
        while True:
            time.sleep(20)
            if time.time() - beat[0] > 240:
                log("stuck for 4 minutes (network hang?): exiting so launchd restarts me")
                os._exit(1)
    threading.Thread(target=guard, daemon=True).start()
    log(f"tesla-worker {VERSION} up")
    while True:
        beat[0] = time.time()
        try:
            claim = rpc("tesla_worker_claim", {"p_token": token, "p_version": VERSION})
            fails = 0
        except Exception as e:
            fails += 1
            log(f"poll failed ({fails}): {str(e)[:160]}")
            if fails >= 20:
                log("20 failed polls in a row: exiting so launchd restarts me")
                sys.exit(1)
            time.sleep(min(60, 3 * fails))
            continue
        if claim:
            job = claim["job"]
            log(f"job {job['id']} {job['action']} (trip {job['reservation_id']})")
            try:
                result, state = asyncio.run(asyncio.wait_for(w.run(claim), 180))  # 1.8.2: never hang on one job
                rpc("tesla_worker_done", {"p_token": token, "p_id": job["id"], "p_ok": True, "p_result": result, "p_state": state})
                log(f"job {job['id']} done")
            except BaseException as e:  # TeslaFleetError is a BaseException
                if isinstance(e, (KeyboardInterrupt, SystemExit)):
                    raise
                msg = str(e)[:300] or type(e).__name__
                log(f"job {job['id']} failed: {msg}")
                try:
                    rpc("tesla_worker_done", {"p_token": token, "p_id": job["id"], "p_ok": False, "p_result": {"error": msg}})
                except Exception:
                    pass
            continue
        time.sleep(3)


if __name__ == "__main__":
    main()

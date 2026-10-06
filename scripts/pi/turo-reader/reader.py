#!/usr/bin/env python3
"""Pi Turo reader (bestly-turo-reader.service) - reads Jared's Turo trips + inbox and pushes them to Supabase.

Why this shape (2026-10-03, docs/pi-move-opusplan-2026-10-03.md):
  - Turo blocks Playwright-launched browsers and the old turo-watch profile ("You've been blocked").
    A plain Chromium with its own profile is not blocked, so run.sh starts plain Chromium in cage
    (headless Wayland) and this script only talks to it over the DevTools port on 127.0.0.1:9334.
  - Reads /api/v2/feeds/upcoming-trips (-> turo-ingest, same as the Mac sync) and
    /api/v2/feeds/conversation (-> turo_inbox_put; new guest messages pop on the wall).
  - 1.1.0 (2026-10-05): sends ONLY the Claims Closer messages Jared approved at /admin/claims
    (claims_send_claim -> POST /api/v2/message/send in the Turo thread -> confirm in the feed -> claims_send_done).
    Approving pokes this reader, so a message goes out within ~15 s. Nothing else is ever sent from here.
  - 1.2.0 (2026-10-06): Claims Closer v2 evidence sync. Every 10 minutes (and on a poke) for each open claim with a Turo incident:
    claims summary + incident (next action, deadline, invoice max), the damage report (guest answers + Jared's report) and the
    before/after photos (downloaded inside this signed-in Chromium, AVIF -> JPEG with ffmpeg, pushed to claims-evidence; a known
    photo uuid is never fetched again). Every Claims call is wrapped so a failure can never stop trip or inbox reading.
  - Every 2 minutes, or within ~15 s when the iPhone Turo shortcut pings (turo_reader_note returns poke).
  - Signed out: the tab goes to Turo's sign-in page and a LAN-only noVNC view starts on :6080 so Jared can
    sign in once from any browser at home; it stops by itself once signed in.
Self-healing: systemd restarts this (and Chromium with it); 30 failed loops in a row -> exit; turo_reader_watchdog
(pg_cron, 5 min) tells Scout when it's stale or signed out, and the Mac mini sync takes over while it's stale.
"""
import asyncio, base64, json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error

import websockets

VERSION = "1.2.0"
SB = "https://rcqfqhguwpmaarseifqg.supabase.co"
PUB = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
CDP = "http://127.0.0.1:9334"
HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = open(os.path.join(HERE, ".token")).read().strip()
FULL_EVERY = 120
TICK = 15
SYNC_EVERY = 600
PHOTO_W, PHOTO_H = 2000, 1500
TRIPS_URL = "https://turo.com/us/en/trips"
LOGIN_URL = "https://turo.com/us/en/login"


def log(msg):
    print(time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg, flush=True)


def post(url, body, headers=None, timeout=30):
    h = {"Content-Type": "application/json", "apikey": PUB}
    h.update(headers or {})
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} {url.rsplit('/', 1)[-1]}: {e.read().decode()[:220]}")


def rpc(fn, args, timeout=20):
    return post(f"{SB}/rest/v1/rpc/{fn}", args, timeout=timeout)


class Tab:
    def __init__(self):
        self.ws = None
        self.n = 0

    async def connect(self):
        tabs = json.load(urllib.request.urlopen(f"{CDP}/json", timeout=10))
        pages = [t for t in tabs if t.get("type") == "page"]
        page = next((t for t in pages if "turo.com" in t.get("url", "")), pages[0] if pages else None)
        if page is None:
            page = json.load(urllib.request.urlopen(urllib.request.Request(f"{CDP}/json/new?{TRIPS_URL}", method="PUT"), timeout=10))
        self.ws = await websockets.connect(page["webSocketDebuggerUrl"], max_size=None, open_timeout=10)

    async def call(self, method, params=None, timeout=40):
        self.n += 1
        my = self.n
        await self.ws.send(json.dumps({"id": my, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            m = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=max(1, end - time.time())))
            if m.get("id") == my:
                if "error" in m:
                    raise RuntimeError(str(m["error"])[:200])
                return m.get("result") or {}
        raise TimeoutError(method)

    async def js(self, body, timeout=40):
        expr = f"(async()=>{{{body}}})()"
        r = await self.call("Runtime.evaluate", {"expression": expr, "awaitPromise": True, "returnByValue": True}, timeout)
        if r.get("exceptionDetails"):
            raise RuntimeError((r["exceptionDetails"].get("exception") or {}).get("description", "js error")[:240])
        return (r.get("result") or {}).get("value")

    async def goto(self, url):
        await self.call("Page.navigate", {"url": url})
        await asyncio.sleep(8)


READ_JS = """
if (!location.host.endsWith('turo.com')) return {where: location.href};
if (/blocked/i.test(document.title)) return {blocked: true};
const a = await fetch('/api/v2/feeds/upcoming-trips?appMode=HOST', {credentials:'include', headers:{accept:'application/json'}});
if (a.status === 401 || a.status === 403) return {signed_out: a.status};
if (!a.ok) return {error: 'upcoming-trips ' + a.status};
const trips = (await a.json()).upcomingTripItems;
const b = await fetch('/api/v2/feeds/conversation?appMode=HOST&itemsPerPage=20&page=1', {credentials:'include'});
const conv = b.ok ? ((await b.json()).list || []) : null;
return {trips, conv};
"""


SEND_JS = """
const fd = new FormData(); fd.append('message', %s); fd.append('reservationId', %s);
const r = await fetch('/api/v2/message/send', {method:'POST', body: fd, credentials:'include'});
const t = await r.text();
if (r.status === 401 || r.status === 403) throw new Error('Turo is signed out on the Pi (' + r.status + ')');
if (!r.ok) throw new Error('send ' + r.status + ': ' + t.slice(0, 160));
return r.status;
"""

VERIFY_JS = """
for (let page = 1; page <= 3; page++) {
  const j = await (await fetch('/api/v2/feeds/conversation?appMode=HOST&itemsPerPage=20&page=' + page, {credentials:'include'})).json();
  for (const c of (j.list || [])) if (c.reservation && c.reservation.id === %s) return JSON.stringify(c.mostRecentMessage || {}).includes(%s);
  if (!j.list || j.list.length < 20) break;
}
return false;
"""


async def send_claims(tab):
    """Claims Closer: send what Jared approved. Each send is claimed first, so it can never go out twice."""
    jobs = rpc("claims_send_claim", {"p_token": TOKEN}) or []
    for j in jobs:
        try:
            await tab.js(SEND_JS % (json.dumps(j["body"]), json.dumps(str(j["reservation_id"]))))
            await asyncio.sleep(2)
            ok = False
            if j.get("snippet"):
                try: ok = bool(await tab.js(VERIFY_JS % (int(j["reservation_id"]), json.dumps(j["snippet"]))))
                except Exception as e: log(f"verify {j['id']}: {e}")
            rpc("claims_send_done", {"p_token": TOKEN, "p_id": j["id"], "p_ok": True, "p_verified": ok})
            log(f"claims: sent to {j['reservation_id']} (verified={ok})")
        except Exception as e:
            log(f"claims: send {j['id']} failed: {e}")
            try: rpc("claims_send_done", {"p_token": TOKEN, "p_id": j["id"], "p_ok": False, "p_error": str(e)[:300]})
            except Exception: pass


# ---------------------------------------------------------------- Claims Closer v2: evidence sync (read-only in Turo)
SYNC_JS = """
const ids = %s;
const out = {summary: null, cases: {}};
const s = await fetch('/api/claims/host/2907746', {credentials:'include'});
if (s.status === 401 || s.status === 403) return {signed_out: s.status};
if (s.ok) { const j = await s.json(); out.summary = j.claimsSummary || (j.claims && j.claims.claimsSummary) || null; }
for (const c of ids) {
  const r = {};
  try { const i = await fetch('/api/v2/incidents/' + c.incident_id, {credentials:'include'}); r.incident = i.ok ? await i.json() : {error: i.status}; } catch (e) { r.incident = {error: String(e)}; }
  await new Promise(x => setTimeout(x, 600));
  try { const f = await fetch('/api/claims/static/fnol/context?reservationId=' + c.reservation_id, {credentials:'include'}); r.fnol = f.ok ? await f.json() : {error: f.status}; } catch (e) { r.fnol = {error: String(e)}; }
  await new Promise(x => setTimeout(x, 600));
  r.photos = {};
  for (const t of ['BEFORE_DAMAGE', 'AFTER_DAMAGE']) {
    try { const p = await fetch('/api/claims/fnol/photos?photoType=' + t + '&reservationId=' + c.reservation_id, {credentials:'include'}); r.photos[t] = p.ok ? ((await p.json()).images || []) : []; } catch (e) { r.photos[t] = []; }
    await new Promise(x => setTimeout(x, 500));
  }
  out.cases[c.case_id] = r;
}
return out;
"""


def money(o):
    try:
        return float(o["amount"]) if o and o.get("amount") is not None else None
    except Exception:
        return None


def parse_fnol(ctx):
    """Turo's damage-report context -> {guest: {submitted, answers}, host: {...}} (plain text only)."""
    out = {"guest": {"answers": {}}, "host": {"answers": {}}}
    try:
        secs = ctx["flows"][0]["screens"][0]["sections"]
    except Exception:
        return None
    who = None
    for sec in secs:
        t = sec.get("sectionType")
        title = sec.get("title")
        cl = sec.get("contentList") or []
        if t == "HEADER":
            tl = (title or "").lower()
            who = "guest" if "response" in tl else "host" if "submitted by" in tl else None
            foot = next((c.get("footer") for c in cl if c.get("footer")), None)
            if who and foot:
                out[who]["submitted"] = foot
            continue
        if who and t == "PLAIN_TEXT" and title:
            txt = " | ".join(str(c.get("descriptionText")) for c in cl if c.get("descriptionText") and c.get("descriptionText") != "-")
            if txt:
                out[who]["answers"][title] = txt[:1200]
        if who == "guest" and t == "PHOTO_DISPLAY":
            out["guest"]["photos"] = " | ".join(str(c.get("descriptionText")) for c in cl if c.get("descriptionText"))[:200] or None
    return out


class ImgTab:
    """A throwaway tab that loads Turo photos as <img> (Turo 303-redirects them to a signed URL that fetch() cannot follow).
    The final image bytes are read with Network.getResponseBody; the tab is always closed."""
    def __init__(self):
        self.ws = None; self.id = None; self.n = 0; self.ev = []

    async def open(self):
        t = json.load(urllib.request.urlopen(urllib.request.Request(f"{CDP}/json/new?https://turo.com/robots.txt", method="PUT"), timeout=10))
        self.id = t["id"]
        self.ws = await websockets.connect(t["webSocketDebuggerUrl"], max_size=None, open_timeout=10)
        await asyncio.sleep(3)
        await self.call("Network.enable")

    async def call(self, method, params=None):
        self.n += 1; my = self.n
        await self.ws.send(json.dumps({"id": my, "method": method, "params": params or {}}))
        while True:
            m = json.loads(await asyncio.wait_for(self.ws.recv(), timeout=30))
            if "id" not in m:
                self.ev.append(m); continue
            if m["id"] == my:
                if "error" in m: raise RuntimeError(str(m["error"])[:200])
                return m.get("result") or {}

    async def photo(self, uuid):
        """-> raw image bytes (AVIF/HEIC/JPEG) or None"""
        self.ev.clear()
        url = f"https://turo.com/api/reservation/imageV2/thumbnail?uuid={uuid}&width={PHOTO_W}&height={PHOTO_H}"
        await self.call("Runtime.evaluate", {"expression": "window.__i = new Image(); window.__i.src = %s; 1" % json.dumps(url)})
        end = time.time() + 25
        got = {}
        while time.time() < end:
            try:
                self.ev.append(json.loads(await asyncio.wait_for(self.ws.recv(), timeout=1)))
            except asyncio.TimeoutError:
                pass
            for e in self.ev:
                m = e.get("method")
                if m == "Network.responseReceived" and "images.turo.com" in e["params"]["response"]["url"]:
                    got[e["params"]["requestId"]] = e["params"]["response"]["status"]
                if m == "Network.loadingFinished" and e["params"]["requestId"] in got and got[e["params"]["requestId"]] == 200:
                    r = await self.call("Network.getResponseBody", {"requestId": e["params"]["requestId"]})
                    return base64.b64decode(r["body"]) if r.get("base64Encoded") else r["body"].encode("latin1")
            self.ev.clear()
        return None

    async def close(self):
        try:
            if self.ws: await self.ws.close()
        except Exception:
            pass
        try:
            if self.id: urllib.request.urlopen(f"{CDP}/json/close/{self.id}", timeout=10)
        except Exception:
            pass


def to_jpeg(raw):
    """AVIF/HEIC/PNG/JPEG bytes -> (jpeg bytes, width, height) via ffmpeg + Pillow"""
    from PIL import Image
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, "in.bin"), os.path.join(d, "out.jpg")
        open(src, "wb").write(raw)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-q:v", "3", dst], check=True, timeout=60)
        data = open(dst, "rb").read()
        w, h = Image.open(dst).size
        return data, w, h


async def sync_claims(tab):
    """Claims Closer evidence sync. Read-only in Turo; failures here are logged and never raised."""
    cases = rpc("claims_sync_list", {"p_token": TOKEN}) or []
    if not cases:
        return
    r = await tab.js(SYNC_JS % json.dumps(cases), timeout=180) or {}
    if r.get("signed_out"):
        log("claims sync: Turo signed out"); return
    summary = {str(x.get("id")): x for x in (r.get("summary") or []) if isinstance(x, dict)}
    img = None
    new_photos = 0
    try:
        for c in cases:
            d = (r.get("cases") or {}).get(c["case_id"]) or {}
            inc = d.get("incident") or {}
            sm = summary.get(str(c["incident_id"])) or {}
            if inc.get("error") and not sm:
                log(f"claims sync {c['reservation_id']}: incident read failed {inc.get('error')}"); continue
            fn = parse_fnol(d.get("fnol") or {}) or {}
            data = {
                "status": sm.get("claimStatus") or inc.get("incidentStatus"),
                "next_action": sm.get("dashboardStatus"),
                "deadline": inc.get("responseEligibilityEndDate") or sm.get("hostResponseEligibilityEndDateForGuestReportedDamage"),
                "invoice_max": money(inc.get("maxAmountAllowedForResolveDirectlyInvoice")),
                "host_deductible": money(inc.get("hostDeductible")),
                "guest_max": money(inc.get("guestOutOfPocketMax")),
                "invoice": inc.get("invoiceDetails"),
                "guest_response": fn.get("guest") if (fn.get("guest") or {}).get("answers") else None,
                "damage_report": fn.get("host") if (fn.get("host") or {}).get("answers") else None,
            }
            rpc("claims_sync_put", {"p_token": TOKEN, "p_case": c["case_id"], "p_data": data})
            known = set(c.get("known") or [])
            for ptype, kind in (("BEFORE_DAMAGE", "before"), ("AFTER_DAMAGE", "after")):
                for p in (d.get("photos") or {}).get(ptype, []):
                    u = p.get("uuid") or p.get("imageId")
                    if not u or u in known:
                        continue
                    try:
                        if img is None:
                            img = ImgTab(); await img.open()
                        raw = await img.photo(u)
                        if not raw:
                            log(f"claims photo {u}: no bytes"); continue
                        jpg, w, h = to_jpeg(raw)
                        taken = ((p.get("takenAtTime") or {}).get("epochMillis"))
                        post(f"{SB}/functions/v1/claims-evidence", {"op": "put", "case_id": c["case_id"], "uuid": u, "kind": kind,
                             "step": p.get("step"), "description": p.get("description"),
                             "taken_at": (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(taken / 1000)) if taken else None),
                             "width": w, "height": h, "jpeg_b64": base64.b64encode(jpg).decode()}, {"x-tesla-worker": TOKEN}, timeout=90)
                        known.add(u); new_photos += 1
                        await asyncio.sleep(1.5)
                    except Exception as e:
                        log(f"claims photo {u}: {e}")
        log(f"claims sync: {len(cases)} case(s), {new_photos} new photo(s)")
    finally:
        if img is not None:
            await img.close()


class NoVNC:
    """LAN-only sign-in view (noVNC -> wayvnc on 127.0.0.1:5911). Only runs while Turo is signed out."""
    def __init__(self):
        self.p = None

    def on(self):
        if self.p and self.p.poll() is None:
            return
        self.p = subprocess.Popen(["websockify", "--web", "/usr/share/novnc", "0.0.0.0:6080", "127.0.0.1:5911"],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log("sign-in view on: http://bestly-pi:6080/vnc.html?autoconnect=1&resize=scale")

    def off(self):
        if self.p and self.p.poll() is None:
            self.p.terminate()
            log("sign-in view off")
        self.p = None


async def main():
    tab = Tab()
    vnc = NoVNC()
    for i in range(30):
        try:
            await tab.connect(); break
        except Exception as e:
            log(f"waiting for Chromium: {e}"); await asyncio.sleep(3)
    else:
        sys.exit(1)
    log(f"turo-reader {VERSION} up")
    last_full = 0.0
    last_sync = 0.0
    last_reload = time.time()
    fails = 0
    signed_out = False
    while True:
        try:
            poke = False
            try:
                poke = bool((rpc("turo_reader_note", {"p_token": TOKEN, "p_signed_in": None, "p_version": VERSION}) or {}).get("poke"))
            except Exception as e:
                log(f"heartbeat failed: {e}")
            gap = 60 if signed_out else FULL_EVERY          # signed out: look every minute, don't hammer the login page
            if (poke and not signed_out) or time.time() - last_full >= gap:
                last_full = time.time()
                if time.time() - last_reload > 1800:      # keep the session warm
                    await tab.goto(TRIPS_URL); last_reload = time.time()
                r = await tab.js(READ_JS) or {}
                if r.get("where"):
                    await tab.goto(TRIPS_URL); r = await tab.js(READ_JS) or {}
                signed_out = bool(r.get("signed_out"))
                if r.get("signed_out"):
                    if "login" not in (await tab.js("return location.href;") or ""):
                        await tab.goto(LOGIN_URL)
                    vnc.on()
                    rpc("turo_reader_note", {"p_token": TOKEN, "p_signed_in": False, "p_error": f"Turo signed out ({r['signed_out']})", "p_version": VERSION})
                    log("Turo is signed out; waiting for sign-in")
                elif r.get("blocked") or r.get("error"):
                    msg = "Turo blocked this browser" if r.get("blocked") else r["error"]
                    rpc("turo_reader_note", {"p_token": TOKEN, "p_signed_in": True, "p_error": msg, "p_version": VERSION})
                    log(msg)
                    if r.get("blocked"):
                        await asyncio.sleep(600)
                else:
                    vnc.off()
                    trips, conv = r.get("trips"), r.get("conv")
                    res = post(f"{SB}/functions/v1/turo-ingest", {"trips": trips}, {"x-tesla-worker": TOKEN}) if isinstance(trips, list) else None
                    inbox = rpc("turo_inbox_put", {"p_token": TOKEN, "p_items": conv}) if isinstance(conv, list) else None
                    rpc("turo_reader_note", {"p_token": TOKEN, "p_signed_in": True, "p_error": None,
                                             "p_trips": isinstance(trips, list), "p_inbox": isinstance(conv, list), "p_version": VERSION})
                    log(f"read: {len(trips or [])} trip items -> {res}; {len(conv or [])} conversations -> {inbox}{' (ping)' if poke else ''}")
                    try:
                        await send_claims(tab)
                    except Exception as e:
                        log(f"claims: {e}")
                    if time.time() - last_sync >= (60 if poke else SYNC_EVERY):
                        last_sync = time.time()
                        try:
                            await sync_claims(tab)
                        except Exception as e:
                            log(f"claims sync: {e}")
            fails = 0
        except Exception as e:
            fails += 1
            log(f"loop failed ({fails}): {e}")
            if fails >= 30:
                sys.exit(1)
            try:
                await tab.ws.close()
            except Exception:
                pass
            try:
                await tab.connect()
            except Exception as e2:
                log(f"reconnect failed: {e2}")
        await asyncio.sleep(TICK)


if __name__ == "__main__":
    asyncio.run(main())

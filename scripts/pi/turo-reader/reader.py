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
  - 1.3.0 (2026-10-06): Claims Closer works the Turo action queue (claims_turo_claim -> claims_turo_done): create_invoice posts the
    resolve-directly invoice (POST /api/incidents/{id}/invoice/create {amount, evidenceIds, incidentNumber, message}, the same call
    Turo's own "Create invoice" form makes). Re-reads the incident first (an invoice already there is never doubled, the amount may
    never exceed Turo's own maxAmountAllowedForResolveDirectlyInvoice) and verifies afterwards. payload.dry_run runs every check and
    posts nothing. Wrapped so a failure never stops trip/inbox reading.
  - 1.4.0 (2026-10-29): Insurance Filer photo job (ins_pi_take -> ins_pi_done). For a guest's insurance claim, downloads the damage-report,
    check-in and return photos the same way (signed-in Chromium, AVIF -> JPEG) and pushes each to the PRIVATE insurance-photos bucket through
    the insurance-filer edge function (op photo_put). Tries every photo type Turo is known or likely to use, logs a count per type so the
    first real run shows which ones exist, and never stops trip/inbox reading. Read-only in Turo.
  - 1.5.0 (2026-10-29): Claims Closer cleaning reports (migration 20261029230000_claims_cleaning.sql). claims_cleaning_take hands out one
    job at a time: 'photos' reads Turo's issue options (/api/reservations/{id}/issue/options) and the trip photo list, sends Jared's
    check-in/check-out and the guest's return photos to the claims-cleaning edge function, asks it for a free-AI read and reports back;
    'file' re-checks that CLEANING_VIOLATION is still AVAILABLE, then posts POST /api/reservations/{id}/issue
    {reservationIssueType: CLEANING_VIOLATION, message, selectedTripPhotos} (the same call Turo's own report-issue page makes) and re-reads
    the options to confirm Turo saved it; 'verify' only re-reads. dry_run posts nothing. Wrapped so a failure never stops trip/inbox reading.
  - Every 2 minutes, or within ~15 s when the iPhone Turo shortcut pings (turo_reader_note returns poke).
  - Signed out: the tab goes to Turo's sign-in page and a LAN-only noVNC view starts on :6080 so Jared can
    sign in once from any browser at home; it stops by itself once signed in.
Self-healing: systemd restarts this (and Chromium with it); 30 failed loops in a row -> exit; turo_reader_watchdog
(pg_cron, 5 min) tells Scout when it's stale or signed out, and the Mac mini sync takes over while it's stale.
"""
import asyncio, base64, json, os, subprocess, sys, tempfile, time, urllib.request, urllib.error

import websockets

VERSION = "1.5.0"
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


# ---------------------------------------------------------------- Claims Closer v2: Turo actions (create invoice)
CREATE_INVOICE_JS = """
const a = %s;
const g = await fetch('/api/v2/incidents/' + a.incident_id, {credentials:'include'});
if (g.status === 401 || g.status === 403) throw new Error('Turo is signed out on the Pi (' + g.status + ')');
if (!g.ok) throw new Error('incident read ' + g.status);
const inc = await g.json();
if (inc.invoiceDetails) return {already: true, invoice: inc.invoiceDetails};
const max = inc.maxAmountAllowedForResolveDirectlyInvoice && inc.maxAmountAllowedForResolveDirectlyInvoice.amount;
if (!(max > 0)) throw new Error('Turo shows no invoice maximum for this incident (' + inc.incidentStatus + ')');
if (!(a.amount > 0) || a.amount > max) throw new Error('amount ' + a.amount + ' is not within 0 and Turo max ' + max);
if (String(inc.incidentNumber) !== String(a.incident_number)) throw new Error('incident number mismatch ' + inc.incidentNumber);
if (!Array.isArray(a.evidence_ids) || !a.evidence_ids.length) throw new Error('no evidence photos');
const list = await (await fetch('/api/reservation/imagesV2?reservationId=' + inc.reservationId, {credentials:'include'})).json();
const have = new Set(((list && list.images) || []).map(x => x.uuid));
const ids = a.evidence_ids.filter(u => have.has(u));
if (!ids.length) throw new Error('none of the evidence photos are on the Turo reservation');
const body = {amount: a.amount, evidenceIds: ids, incidentNumber: String(inc.incidentNumber), message: String(a.message || '').slice(0, 500) || undefined};
if (a.dry_run) return {dry_run: true, would_post: body, max: max, status: inc.incidentStatus};
const r = await fetch('/api/incidents/' + a.incident_id + '/invoice/create', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
const t = await r.text();
if (r.status === 401 || r.status === 403) throw new Error('Turo is signed out on the Pi (' + r.status + ')');
if (!r.ok) throw new Error('create ' + r.status + ': ' + t.slice(0, 200));
let invoice = null;
for (let i = 0; i < 4 && !invoice; i++) {
  await new Promise(x => setTimeout(x, 2500));
  try { const v = await (await fetch('/api/v2/incidents/' + a.incident_id, {credentials:'include'})).json(); invoice = v.invoiceDetails || null; } catch (e) {}
}
return {created: true, http: r.status, verified: !!invoice, invoice: invoice, response: t.slice(0, 200)};
"""


async def turo_actions(tab):
    """Claims Closer: work the queued Turo actions. Each is claimed first (claims_turo_claim) so it can never run twice."""
    jobs = rpc("claims_turo_claim", {"p_token": TOKEN}) or []
    for j in jobs:
        try:
            if j["kind"] != "create_invoice":
                raise RuntimeError(f"the reader does not do '{j['kind']}' yet")
            p = j["payload"] or {}
            arg = {"incident_id": int(j["incident_id"]), "incident_number": str(p.get("incident_number") or ""),
                   "amount": float(p["amount"]), "message": p.get("message") or "",
                   "evidence_ids": p.get("evidence_ids") or [], "dry_run": bool(p.get("dry_run"))}
            res = await tab.js(CREATE_INVOICE_JS % json.dumps(arg), timeout=90) or {}
            rpc("claims_turo_done", {"p_token": TOKEN, "p_id": j["id"], "p_ok": True, "p_result": res})
            log(f"claims: turo {j['kind']} for incident {j['incident_id']} -> {str(res)[:160]}")
        except Exception as e:
            log(f"claims: turo action {j['id']} failed: {e}")
            try: rpc("claims_turo_done", {"p_token": TOKEN, "p_id": j["id"], "p_ok": False, "p_error": str(e)[:300]})
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


# ---------------------------------------------------------------- Insurance Filer: photos for a guest's insurance claim (read-only in Turo)
# photoType -> where it lands. BEFORE_DAMAGE / AFTER_DAMAGE are verified; the others are tried and logged (an unknown type is just an empty list).
INS_TYPES = {"BEFORE_DAMAGE": "before", "AFTER_DAMAGE": "after", "GUEST_DAMAGE": "guest_report", "GUEST_REPORTED_DAMAGE": "guest_report",
             "GUEST_AFTER_DAMAGE": "guest_report", "CHECK_IN": "checkin", "CHECKIN": "checkin", "TRIP_START": "checkin",
             "CHECK_OUT": "return", "CHECKOUT": "return", "RETURN": "return", "TRIP_END": "return"}
INS_JS = """
const c = %s; const types = %s;
const out = {types: {}, errors: {}, incident_photo_paths: []};
const sleep = ms => new Promise(x => setTimeout(x, ms));
for (const t of types) {
  try {
    const p = await fetch('/api/claims/fnol/photos?photoType=' + t + '&reservationId=' + c.reservation_id, {credentials:'include'});
    if (p.status === 401 || p.status === 403) return {signed_out: p.status};
    if (p.ok) { const j = await p.json(); out.types[t] = (j.images || j.photos || []); } else { out.types[t] = []; out.errors[t] = p.status; }
  } catch (e) { out.types[t] = []; out.errors[t] = String(e); }
  await sleep(500);
}
// Photos Turo hangs on the incident itself (guest-submitted ones): walk the JSON for lists of objects that carry a uuid.
try {
  const i = await fetch('/api/v2/incidents/' + c.incident_id, {credentials:'include'});
  if (i.ok) {
    const j = await i.json(); const found = [];
    const walk = (o, path, d) => { if (d > 6 || !o) return;
      if (Array.isArray(o)) { if (o.length && o.every(x => x && typeof x === 'object' && (x.uuid || x.imageId)) && /photo|image|picture/i.test(path)) found.push({path, items: o}); else o.forEach((x, k) => walk(x, path + '[]', d + 1)); }
      else if (typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], path + '.' + k, d + 1); };
    walk(j, '', 0);
    out.incident_photo_paths = found.map(f => f.path + ' x' + f.items.length);
    out.incident_photos = found.flatMap(f => f.items.map(x => ({uuid: x.uuid || x.imageId, path: f.path, description: x.description || null, step: x.step || null})));
  }
} catch (e) { out.errors.incident = String(e); }
return out;
"""


async def ins_photos(tab):
    """Insurance Filer: fetch the photos of one claim. Claimed first (ins_pi_take) so a job never runs twice at once."""
    j = (rpc("ins_pi_take", {"p_token": TOKEN}) or {}).get("job")
    if not j:
        return
    img = None
    try:
        known = set(j.get("known") or [])
        arg = {"reservation_id": j["reservation_id"], "incident_id": j.get("incident_id")}
        r = await tab.js(INS_JS % (json.dumps(arg), json.dumps(list(INS_TYPES))), timeout=150) or {}
        if r.get("signed_out"):
            raise RuntimeError(f"Turo signed out ({r['signed_out']})")
        todo, seen = [], set()
        for ptype, items in (r.get("types") or {}).items():
            for p in items or []:
                u = p.get("uuid") or p.get("imageId")
                if u and u not in seen:
                    seen.add(u); todo.append((u, INS_TYPES.get(ptype, "guest_report"), p, ptype))
        for p in r.get("incident_photos") or []:
            u = p.get("uuid")
            if u and u not in seen:
                seen.add(u); todo.append((u, "guest_report" if "guest" in (p.get("path") or "").lower() else "after", p, "incident"))
        by_type, added, failed = {}, 0, 0
        for u, source, p, ptype in todo:
            by_type[ptype] = by_type.get(ptype, 0) + 1
            if u in known:
                continue
            try:
                if img is None:
                    img = ImgTab(); await img.open()
                raw = await img.photo(u)
                if not raw:
                    failed += 1; log(f"ins photo {u}: no bytes"); continue
                jpg, w, h = to_jpeg(raw)
                taken = ((p.get("takenAtTime") or {}).get("epochMillis"))
                post(f"{SB}/functions/v1/insurance-filer", {"op": "photo_put", "oc_id": j["oc_id"], "source": source, "turo_uuid": u,
                     "step": p.get("step"), "description": p.get("description"),
                     "taken_at": (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(taken / 1000)) if taken else None),
                     "width": w, "height": h, "jpeg_b64": base64.b64encode(jpg).decode()}, {"x-tesla-worker": TOKEN}, timeout=90)
                known.add(u); added += 1
                await asyncio.sleep(1.5)
            except Exception as e:
                failed += 1; log(f"ins photo {u}: {e}")
        res = {"added": added, "failed": failed, "by_type": by_type, "errors": r.get("errors") or {}, "incident_photo_paths": r.get("incident_photo_paths") or []}
        rpc("ins_pi_done", {"p_token": TOKEN, "p_job": j["id"], "p_status": "done", "p_result": res})
        log(f"ins photos {j['reservation_id']}: {res}")
    except Exception as e:
        log(f"ins photos job {j.get('id')} failed: {e}")
        try: rpc("ins_pi_done", {"p_token": TOKEN, "p_job": j["id"], "p_status": "failed", "p_error": str(e)[:300]})
        except Exception: pass
    finally:
        if img is not None:
            await img.close()


# ---------------------------------------------------------------- Claims Closer: cleaning reports (1.5.0)
CLEAN_READ_JS = """
const id = %s;
const o = await fetch('/api/reservations/' + id + '/issue/options', {credentials:'include'});
if (o.status === 401 || o.status === 403) return {signed_out: o.status};
if (!o.ok) throw new Error('issue options ' + o.status);
const opt = ((await o.json()).options || []).find(x => x.issueType === 'CLEANING_VIOLATION') || null;
const i = await fetch('/api/reservation/imagesV2?reservationId=' + id, {credentials:'include'});
if (!i.ok) throw new Error('trip photos ' + i.status);
const imgs = ((await i.json()).images || []).map(x => ({uuid: x.uuid || x.imageId, role: x.photographerDriverRole, step: x.step,
  type: x.imageType, taken: (x.takenAtTime || x.createdTime || {}).epochMillis || null, description: x.description || null}));
return {turo_status: opt ? opt.issueStatus : 'NO_OPTION', images: imgs};
"""

CLEAN_STATUS_JS = """
const o = await fetch('/api/reservations/' + %s + '/issue/options', {credentials:'include'});
if (o.status === 401 || o.status === 403) throw new Error('Turo is signed out on the Pi (' + o.status + ')');
if (!o.ok) throw new Error('issue options ' + o.status);
const opt = ((await o.json()).options || []).find(x => x.issueType === 'CLEANING_VIOLATION') || null;
return {turo_status: opt ? opt.issueStatus : 'NO_OPTION'};
"""

CLEAN_FILE_JS = """
const a = %s;
const read = async () => {
  const o = await fetch('/api/reservations/' + a.reservation_id + '/issue/options', {credentials:'include'});
  if (o.status === 401 || o.status === 403) throw new Error('Turo is signed out on the Pi (' + o.status + ')');
  if (!o.ok) throw new Error('issue options ' + o.status);
  const opt = ((await o.json()).options || []).find(x => x.issueType === 'CLEANING_VIOLATION') || null;
  return opt ? opt.issueStatus : 'NO_OPTION';
};
const before = await read();
if (before === 'EXPIRED' || before === 'NO_OPTION') throw new Error('Turo no longer takes a cleaning report on this trip (' + before + ')');
if (before !== 'AVAILABLE') return {posted: false, already: true, turo_status: before};
const list = await (await fetch('/api/reservation/imagesV2?reservationId=' + a.reservation_id, {credentials:'include'})).json();
const have = new Set(((list && list.images) || []).map(x => x.uuid || x.imageId));
const ids = (a.photo_uuids || []).filter(u => have.has(u));
if (!ids.length) throw new Error('none of the chosen photos are on the Turo trip');
const message = String(a.message || '').slice(0, 500);
const body = {reservationIssueType: 'CLEANING_VIOLATION', message: message, selectedTripPhotos: ids};
if (a.dry_run) return {dry_run: true, would_post: body, turo_status: before};
const r = await fetch('/api/reservations/' + a.reservation_id + '/issue', {method:'POST', credentials:'include',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
const t = await r.text();
if (r.status === 401 || r.status === 403) throw new Error('Turo is signed out on the Pi (' + r.status + ')');
if (!r.ok) throw new Error('report ' + r.status + ': ' + t.slice(0, 200));
let after = before;
for (let i = 0; i < 4 && after === 'AVAILABLE'; i++) { await new Promise(x => setTimeout(x, 2500)); try { after = await read(); } catch (e) {} }
return {posted: true, http: r.status, turo_status: after, message: message, photo_uuids: ids, response: t.slice(0, 200)};
"""


def pick_cleaning_photos(images, trip_start_ms, trip_end_ms):
    """Turo trip photos -> (pre, post, guest_post) lists of image dicts, inside Turo's windows:
    check-in within 24h before the trip starts (pickups can run a few hours late), check-out from trip start to 24h after the end,
    the guest's return photos the same. Odometer shots are left out: they show a screen, not the cabin."""
    H = 3600 * 1000
    pre, post, guest = [], [], []
    for x in images or []:
        if not x.get("uuid") or (x.get("type") or "") == "ODOMETER":
            continue
        t = x.get("taken")
        role, step = x.get("role"), x.get("step")
        if role == "HOST" and step == "OWNER_CHECK_IN" and t and trip_start_ms - 24 * H <= t <= trip_start_ms + 6 * H:
            pre.append(x)
        elif role == "HOST" and step == "OWNER_CHECK_OUT" and t and trip_start_ms <= t <= trip_end_ms + 24 * H:
            post.append(x)
        elif role == "GUEST" and step == "RENTER_CHECK_OUT" and t and trip_start_ms <= t <= trip_end_ms + 24 * H:
            guest.append(x)
    key = lambda x: x.get("taken") or 0
    return sorted(pre, key=key), sorted(post, key=key), sorted(guest, key=key)


def spread(xs, n):
    if len(xs) <= n:
        return list(xs)
    return [xs[round(i * (len(xs) - 1) / (n - 1))] for i in range(n)]


def iso_ms(s):
    from datetime import datetime
    return int(datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp() * 1000)


def small_jpeg(raw):
    """photo bytes -> JPEG at most 1280 px wide (the free AI reads these; full size is not needed)"""
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, "in.bin"), os.path.join(d, "out.jpg")
        open(src, "wb").write(raw)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", dst], check=True, timeout=60)
        return open(dst, "rb").read()


async def cleaning(tab):
    """Claims Closer: one cleaning-report job per pass. Claimed first (claims_cleaning_take) so it never runs twice at once."""
    j = (rpc("claims_cleaning_take", {"p_token": TOKEN}) or {}).get("job")
    if not j:
        return
    res, kind = int(j["reservation_id"]), j["kind"]
    img = None
    try:
        if kind == "verify":
            out = await tab.js(CLEAN_STATUS_JS % res, timeout=60) or {}
        elif kind == "file":
            p = j.get("payload") or {}
            arg = {"reservation_id": res, "message": p.get("message") or "", "photo_uuids": p.get("photo_uuids") or [], "dry_run": bool(j.get("dry_run"))}
            out = await tab.js(CLEAN_FILE_JS % json.dumps(arg), timeout=90) or {}
        else:
            r = await tab.js(CLEAN_READ_JS % res, timeout=90) or {}
            if r.get("signed_out"):
                raise RuntimeError(f"Turo signed out ({r['signed_out']})")
            pre, hpost, guest = pick_cleaning_photos(r.get("images"), iso_ms(j["trip_start"]), iso_ms(j["trip_end"]))
            todo = [(x, "pre") for x in spread(pre, 20)] + [(x, "post") for x in hpost[:20]] + [(x, "guest_post") for x in spread(guest, 10)]
            known = set(j.get("known") or [])
            added, failed = 0, 0
            for x, side in todo:
                if x["uuid"] in known:
                    continue
                try:
                    if img is None:
                        img = ImgTab(); await img.open()
                    raw = await img.photo(x["uuid"])
                    if not raw:
                        failed += 1; continue
                    post_json = {"op": "put", "reservation_id": res, "uuid": x["uuid"], "side": side, "step": x.get("step"),
                                 "taken_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(x["taken"] / 1000)) if x.get("taken") else None,
                                 "jpeg_b64": base64.b64encode(small_jpeg(raw)).decode()}
                    post(f"{SB}/functions/v1/claims-cleaning", post_json, {"x-tesla-worker": TOKEN}, timeout=90)
                    known.add(x["uuid"]); added += 1
                    await asyncio.sleep(1)
                except Exception as e:
                    failed += 1; log(f"cleaning photo {x['uuid']}: {e}")
            out = {"turo_status": r.get("turo_status"), "pre_count": len(pre), "post_count": len(hpost) + len(guest),
                   "counts": {"host_check_in": len(pre), "host_check_out": len(hpost), "guest_return": len(guest), "added": added, "failed": failed}}
            if pre and (hpost or guest):
                chk = post(f"{SB}/functions/v1/claims-cleaning", {"op": "check", "reservation_id": res}, {"x-tesla-worker": TOKEN}, timeout=150) or {}
                if chk.get("ok"):
                    out["check"] = {k: chk.get(k) for k in ("verdict", "confidence", "reasons", "support_uuids", "model")}
                else:
                    out["check_error"] = str(chk.get("error") or "no answer")[:300]
        rpc("claims_cleaning_done", {"p_token": TOKEN, "p_res": res, "p_kind": kind, "p_ok": True, "p_result": out})
        log(f"cleaning {kind} {res}: {str(out)[:220]}")
    except Exception as e:
        log(f"cleaning {kind} {res} failed: {e}")
        try: rpc("claims_cleaning_done", {"p_token": TOKEN, "p_res": res, "p_kind": kind, "p_ok": False, "p_error": str(e)[:300]})
        except Exception: pass
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
                    try:
                        await turo_actions(tab)
                    except Exception as e:
                        log(f"claims turo actions: {e}")
                    try:
                        await ins_photos(tab)
                    except Exception as e:
                        log(f"insurance photos: {e}")
                    try:
                        await cleaning(tab)
                    except Exception as e:
                        log(f"cleaning: {e}")
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

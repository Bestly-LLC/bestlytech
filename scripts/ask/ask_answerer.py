#!/usr/bin/env python3
"""Ask the wall: local answerer (Mac mini, launchd tech.bestly.ask-wall, KeepAlive).

Polls Supabase wall_questions (token RPCs), gathers live context from the wall server on
Hestia, answers with deterministic fast paths or the local Ollama model (qwen3:8b), and
writes answer_text + answer_card back. No paid AI, no Claude at runtime. Stdlib only.
"""
import json, math, os, re, sys, threading, time, urllib.request
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

HOME = os.path.expanduser("~")
SB = "https://rcqfqhguwpmaarseifqg.supabase.co/rest/v1/rpc/"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
TOKEN = open(f"{HOME}/.bestly/ask_wall_token").read().strip() if os.path.exists(f"{HOME}/.bestly/ask_wall_token") else ""
WALL = os.environ.get("ASK_WALL_URL", "http://192.168.1.211:8099")
OLLAMA = os.environ.get("ASK_OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("ASK_MODEL", "qwen3:8b")
HEART = f"{HOME}/.bestly/ask/heartbeat"
LA = ZoneInfo("America/Los_Angeles")
AIRPORTS = {"LAX": (33.9425, -118.4081, "LAX"), "BUR": (34.2007, -118.3585, "Burbank"), "VNY": (34.2098, -118.4899, "Van Nuys"),
            "SMO": (34.0158, -118.4513, "Santa Monica"), "ONT": (34.056, -117.6012, "Ontario"), "LGB": (33.8177, -118.1516, "Long Beach"),
            "HHR": (33.9228, -118.3352, "Hawthorne"), "SNA": (33.6757, -117.8682, "John Wayne")}
CARDINAL = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]


def log(*a):
    print(datetime.now(LA).strftime("%I:%M:%S %p"), *a, flush=True)


# ---------- http ----------
def http_json(url, body=None, headers=None, timeout=3):
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h,
                                 method="POST" if body is not None else "GET")
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def rpc(name, body, timeout=8):
    return http_json(SB + name, body, {"apikey": ANON, "Authorization": "Bearer " + ANON}, timeout)


# ---------- time / text helpers ----------
def t12(dt):
    return dt.astimezone(LA).strftime("%I:%M %p").lstrip("0")


def t12c(dt):
    return t12(dt).replace(":00 ", " ")


def hour12(dt):
    return dt.astimezone(LA).strftime("%I %p").lstrip("0")


def parse_iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def num(n):
    return f"{int(round(n)):,}"


def plural(n, w):
    return f"{n} {w}" + ("" if n == 1 else "s")


def mins_text(m):
    m = int(round(m))
    return "less than a minute" if m < 1 else plural(m, "minute")


def article(w):
    return ("an " if re.match(r"[aeiouAEIOU]", w) else "a ") + w


def compass(b):
    return CARDINAL[int((b % 360) / 45 + 0.5) % 8]


def clean(s):
    s = re.sub(r"<think>.*?</think>", "", s or "", flags=re.S)
    s = re.sub(r"\.{2,}|…", ".", s)
    return re.sub(r"\s+", " ", s).strip()


def hav_mi(a, b):
    R = 3958.8
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


# ---------- live context ----------
def fetch_all():
    paths = {"ac": "/api/aircraft/live", "bus": "/api/bus", "cars": "/api/cars", "data": "/api/data", "sky": "/api/sky-board"}

    def one(k):
        try:
            return k, http_json(WALL + paths[k], timeout=2.5)
        except Exception as e:
            return k, {"_err": str(e)[:80]}
    with ThreadPoolExecutor(5) as ex:
        return dict(ex.map(one, paths))


def airborne(ctx):
    res = []
    for a in (ctx.get("ac") or {}).get("aircraft", []):
        L = a.get("live") or {}
        if L.get("on_ground") or L.get("dist_mi") is None:
            continue
        a["_slant"] = math.sqrt(L["dist_mi"] ** 2 + ((L.get("alt_ft") or 0) / 5280.0) ** 2)
        res.append(a)
    return sorted(res, key=lambda a: a["_slant"])


def pick_subject(ps):
    """Closest aircraft, but prefer an identified one (airline/known) if it is within 2x the slant range."""
    if not ps:
        return None
    ident = [a for a in ps if a.get("tier") in ("airline", "known") and not a["hex"].startswith("~")]
    if ident and ident[0]["_slant"] <= max(ps[0]["_slant"] * 2, 2.0):
        return ident[0]
    return ps[0]


def plane_status(a):
    L, r = a["live"], a.get("route") or {}
    to, frm = r.get("to"), r.get("from")
    vs, alt, spd = L.get("vs_fpm") or 0, L.get("alt_ft") or 0, max(L.get("speed_mph") or 1, 1)
    if to in AIRPORTS and (vs < -300 or alt < 5000) and vs <= 200:
        ap = AIRPORTS[to]
        eta = hav_mi((L["lat"], L["lon"]), (ap[0], ap[1])) / spd * 60
        return f"landing at {ap[2]} in {mins_text(eta)}", eta
    if frm in AIRPORTS and (vs > 300 or alt < 3000):
        return f"departing {AIRPORTS[frm][2]}", None
    if to:
        return f"heading to {r.get('to_city') or to}", None
    return "", None


def describe_plane(a):
    L, r = a["live"], a.get("route") or {}
    alt = int(round((L.get("alt_ft") or 0) / 100.0)) * 100
    name = a.get("label") or a.get("callsign") or "an unidentified aircraft"
    typ = a.get("type_name")
    if a.get("helicopter"):
        kind = (a.get("sublabel") or "").split(" · ")[0] or "Helicopter"
        s = f"That's {name}, {article(kind.lower())}, {num(alt)} feet up, {L['dist_mi']:.0f} miles to the {compass(L.get('bearing', 0))}"
        s += ", hovering" if (L.get("speed_mph") or 0) < 25 else f", flying {compass(L.get('heading', 0))} at {num(L['speed_mph'])} mph"
        return s + "."
    s = f"That's {name}"
    if typ:
        s += f", {article(typ)}"
    if r.get("from_city"):
        s += f" from {r['from_city']}"
    phase, _ = plane_status(a)
    if phase:
        s += (" " if r.get("from_city") else ", ") + phase
    return s + f", {num(alt)} feet."


def card_for_plane(q, a):
    L, r = a["live"], a.get("route") or {}
    phase, _ = plane_status(a)
    l1 = " ".join(x for x in [a.get("type_name") or a.get("sublabel") or "", ("from " + r["from_city"]) if r.get("from_city") else ""] if x)
    l2 = phase or f"{compass(L.get('bearing', 0))} of you"
    l3 = f"{num(round((L.get('alt_ft') or 0) / 100.0) * 100)} feet, {L['dist_mi']:.0f} mi away"
    return {"title": a.get("label") or "Aircraft", "lines": [x for x in [l1, l2, l3] if x][:3],
            "subject": {"type": "aircraft", "id": a["hex"]}, "q": q, "ttl_s": 20}


# ---------- fast paths ----------
def fp_plane(q, ctx):
    ps = airborne(ctx)
    if not ps:
        return "No aircraft are overhead right now.", {"title": "Sky is quiet", "lines": ["No aircraft tracked nearby."], "q": q, "ttl_s": 20}, "fast:plane"
    a = pick_subject(ps)
    return describe_plane(a), card_for_plane(q, a), "fast:plane"


def fp_heli(q, ctx):
    hs = [a for a in airborne(ctx) if a.get("helicopter")]
    if not hs:
        return "No helicopters are overhead right now.", {"title": "No helicopters", "lines": ["None tracked nearby."], "q": q, "ttl_s": 20}, "fast:heli"
    a = hs[0]
    s = describe_plane(a)
    if len(hs) > 1:
        o = hs[1]
        s += f" {o.get('label') or 'Another helicopter'} is also up, {o['live']['dist_mi']:.0f} miles to the {compass(o['live'].get('bearing', 0))}."
    return s, card_for_plane(q, a), "fast:heli"


def fp_bus(q, ctx):
    lines = (ctx.get("bus") or {}).get("lines") or []
    mm = re.search(r"\bmetro\s+(\d+)|\bthe\s+(\d{1,3})\b|\bline\s+(\d+)", q)
    want = next((g for g in mm.groups() if g), None) if mm else None
    best = None
    for L in lines:
        if want and L.get("line") != want:
            continue
        if L.get("line") == "105" and not re.search(r"LAX", " ".join(str(L.get(k) or "") for k in ("toward", "direction", "headsign")), re.I):
            continue    # ASKCARD: same as the wall bus card, only the 105 toward LAX
        for ar in L.get("arrivals", []):
            if ar["mins"] >= (L.get("walk_min") or 0):
                if not best or ar["mins"] < best[1]["mins"]:
                    best = (L, ar)
                break
    if not best:
        return "No buses are coming that you can still catch.", {"title": "No bus soon", "lines": ["Nothing reachable right now."], "q": q, "ttl_s": 20}, "fast:bus"
    L, ar = best
    stop = L["stop"].replace(" / ", " and ")
    leave = max(ar["mins"] - (L.get("walk_min") or 0), 0)
    # ASKCARD: same short form the wall bus card uses (105 -> LAX, "Toward " dropped, "trips" dropped)
    toward = re.sub(r"\s+trips$", "", re.sub(r"^toward\s+", "", (L.get("toward") or "").strip(), flags=re.I), flags=re.I).strip()
    if L.get("line") == "105" and re.search(r"LAX", " ".join(str(L.get(k) or "") for k in ("toward", "direction", "headsign")), re.I):
        toward = "LAX"
    if not toward:
        toward = (L.get("headsign") or L.get("direction") or "").strip()
    s = f"Your next bus is the {L['name']} toward {toward}, {mins_text(ar['mins'])} away at {stop}."
    s += " Leave now." if leave <= 0 else f" Leave in {mins_text(leave)}."
    arr = datetime.fromtimestamp(ar["eta"] / 1000, LA)
    card = {"title": f"{L['name']} {L.get('direction') or ''}".strip(), "lines": [f"Toward {toward}", f"{mins_text(ar['mins'])}, arriving {t12(arr)}",
            f"{stop}, {L.get('walk_min', 0)} min walk"], "subject": {"type": "bus", "id": L["line"]}, "q": q, "ttl_s": 20}
    return s, card, "fast:bus"


def fp_rain(q, ctx):
    w = (ctx.get("data") or {}).get("weather") or {}
    if not w:
        return None
    now = datetime.now(timezone.utc)
    daily, today_la = w.get("daily", []), datetime.now(LA).date()
    if "tomorrow" in q:
        td = [d for d in daily if parse_iso(d["t"]).astimezone(LA).date() > today_la][:1]
        if not td:
            return None
        pop = int(td[0]["pop"])
        return (f"Tomorrow has a {pop} percent chance of rain, with a high of {td[0]['hi']} degrees.",
                {"title": "Rain tomorrow", "lines": [f"{pop}% chance", f"High {td[0]['hi']}°F"], "q": q, "ttl_s": 20}, "fast:rain")
    d_today = next((d for d in daily if parse_iso(d["t"]).astimezone(LA).date() == today_la), None)
    end_today = datetime.now(LA).replace(hour=23, minute=59)
    rest = [h for h in w.get("hourly", []) if now.replace(minute=0, second=0, microsecond=0) <= parse_iso(h["t"]) and parse_iso(h["t"]).astimezone(LA) <= end_today]
    peak = max(rest, key=lambda h: h.get("pop", 0)) if rest else None
    pmax = int(max([h.get("pop", 0) for h in rest] + [d_today.get("pop", 0) if d_today else 0]))
    wet_now = ((w.get("live") or {}).get("radar_wet") or 0) > 0.1
    if wet_now:
        s = "It's raining at your place right now."
    elif pmax >= 30 and peak:
        s = f"Maybe, about a {pmax} percent chance, most likely around {hour12(parse_iso(peak['t']))}."
    else:
        s = f"No, only a {pmax} percent chance of rain today."
    s += f" It's {w['temp_f']} degrees now" + (f", high of {d_today['hi']}." if d_today else ".")
    lines = [f"{pmax}% chance today", f"{w['temp_f']}°F now, {w.get('condition', '')}".rstrip(", "), f"High {d_today['hi']}°F" if d_today else ""]
    return s, {"title": "Rain today", "lines": [x for x in lines if x], "q": q, "ttl_s": 20}, "fast:rain"


def fp_car(q, ctx):
    cars = (ctx.get("cars") or {}).get("cars") or []
    car = next((c for c in cars if c["car"].lower() in q), None) or (cars[0] if cars else None)
    if not car:
        return None
    soc = car.get("soc")
    s = f"{car['car']} is at {soc} percent, about {num(car['range_mi'])} miles of range"
    s += ", and it is charging." if car.get("charging_state") == "Charging" else (", plugged in." if car.get("plugged_in") else ", not plugged in.")
    lines = [f"{soc}%, {num(car['range_mi'])} mi range", "Plugged in" if car.get("plugged_in") else "Not plugged in"]
    plan = car.get("plan_text")
    if plan and not car.get("plugged_in"):
        s += " " + plan.replace(" · est. $", " for about $") + "."
        lines.append(plan.split("·")[0].strip())
    return s, {"title": car["car"], "lines": lines[:3], "q": q, "ttl_s": 20}, "fast:car"


def fp_cal(q, ctx):
    cal = ((ctx.get("data") or {}).get("calendar") or {}).get("events") or []
    nowu = datetime.now(timezone.utc)
    up = [e for e in cal if parse_iso(e["end"]) >= nowu and not e.get("all_day")][:3]
    if not up:
        return "You have nothing coming up on your calendar.", {"title": "Calendar clear", "lines": ["Nothing coming up."], "q": q, "ttl_s": 20}, "fast:cal"

    def when(e):
        st = parse_iso(e["start"]).astimezone(LA)
        d = st.date() - datetime.now(LA).date()
        day = "today" if d.days == 0 else "tomorrow" if d.days == 1 else st.strftime("%A")
        return f"{t12c(st)} {day}"
    s = f"Next up is {up[0]['title']} at {when(up[0])}."
    if len(up) > 1:
        s += f" After that, {up[1]['title']} at {when(up[1])}."
    return s, {"title": "On your calendar", "lines": [(f"{when(e)}: {e['title']}" if len(e["title"]) <= 30 else when(e)) for e in up], "q": q, "ttl_s": 20}, "fast:cal"


FAST = [(re.compile(r"\b(my )?(calendar|schedule|agenda)\b|what.?s next on|what do i have (today|next|coming)|my next (meeting|event|call)"), fp_cal),
        (re.compile(r"helicopter|chopper|\bheli\b|\bcopter\b"), fp_heli),
        (re.compile(r"what('?s| is)? (that|this) (plane|aircraft|jet)|what plane|which plane|what.?s that flying|what is that flying|plane is that"), fp_plane),
        (re.compile(r"\bnext bus\b|when.{0,12}\bbus\b|\bbus\b.{0,15}(coming|next|when)"), fp_bus),
        (re.compile(r"\b(rain|raining|umbrella)\b"), fp_rain),
        (re.compile(r"how (much )?(charged|juice|range|battery)|\bcharged\b|\bcharge level\b|\bbattery\b|blue steel.{0,20}(charge|battery|percent)"), fp_car)]


def fast_path(q, ctx):
    ql = q.lower().strip(" ?!.")
    for rx, fn in FAST:
        if rx.search(ql):
            try:
                r = fn(ql, ctx)
                if r:
                    return r
            except Exception as e:
                log("fast path error", fn.__name__, repr(e))
    return None


# ---------- model path ----------
def context_text(ctx, q=""):
    ql = q.lower()
    want = lambda *k: any(x in ql for x in k)
    topics = {"wx": want("weather", "rain", "temperature", "hot", "cold", "wind", "forecast", "warm", "umbrella", "sun", "tomorrow"),
              "sky": want("plane", "flight", "heli", "jet", "sky", "airport", "lax", "land", "fly", "overhead", "noise", "loud"),
              "bus": want("bus", "metro", "transit", "train"),
              "car": want("car", "tesla", "charge", "battery", "blue steel", "range"),
              "cal": want("calendar", "meeting", "event", "schedule", "appointment", "call", "today", "next", "busy", "free", "agenda")}
    compact = not any(topics.values())
    if compact:
        topics = {k: True for k in topics}
    NP, NB, NH, NC = (3, 3, 3, 2) if compact else (5, 5, 6, 4)
    now = datetime.now(LA)
    out = [f"Now: {now.strftime('%A %B %d')}, {t12(now)} Pacific. Home: West Hollywood."]
    w = (ctx.get("data") or {}).get("weather") or {}
    if w and topics["wx"]:
        out.append(f"Weather now: {w.get('temp_f')} F (feels {w.get('feels_f')}), {w.get('condition')}, wind {w.get('wind_mph')} mph.")
        t0 = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        hh = [h for h in w.get("hourly", []) if parse_iso(h["t"]) >= t0][:NH * 2:2]
        out.append("Next hours: " + "; ".join(f"{hour12(parse_iso(h['t']))} {h['temp_f']} F rain {int(h.get('pop', 0))}%" for h in hh))
        for d in w.get("daily", [])[:(1 if compact else 2)]:
            out.append(f"{parse_iso(d['t']).astimezone(LA).strftime('%A')}: high {d['hi']} F, low {d['lo']} F, rain {int(d.get('pop', 0))}%, {d.get('day_code')}")
    ps = airborne(ctx)[:NP] if topics["sky"] else []
    if topics["sky"]:
        out.append(f"Aircraft overhead ({len(ps)} nearest, closest first):" if ps else "Aircraft overhead: none.")
    for a in ps:
        L, r = a["live"], a.get("route") or {}
        phase, _ = plane_status(a)
        bits = [a.get("label") or a.get("callsign") or "unknown", a.get("sublabel") or "", "helicopter" if a.get("helicopter") else "",
                (f"from {r.get('from_city')}" if r.get("from_city") else ""), phase,
                f"{num(round((L.get('alt_ft') or 0) / 100.0) * 100)} ft", f"{L['dist_mi']:.1f} mi {compass(L.get('bearing', 0))}",
                f"{num(L.get('speed_mph') or 0)} mph", ("climbing" if (L.get("vs_fpm") or 0) > 300 else "descending" if (L.get("vs_fpm") or 0) < -300 else "level"),
                f"hex {a['hex']}"]
        out.append("- " + ", ".join(b for b in bits if b))
    for code, ap in (((ctx.get("sky") or {}).get("airports") or {}).items() if topics["sky"] else []):
        out.append(f"Airport {code}: {ap.get('count15', 0)} arrivals in 15 min, flow {ap.get('flow') or 'none'}, next ETA {ap.get('next_eta') or 'none'}")
    bl = ((ctx.get("bus") or {}).get("lines") or []) if topics["bus"] else []
    for L in bl[:NB]:
        arr = ", ".join(f"{a['mins']} min" for a in L.get("arrivals", [])[:3])
        out.append(f"Bus {L['name']} {L.get('direction', '')} at {L['stop']} ({L.get('walk_min')} min walk): {arr}")
    for al in (((ctx.get("bus") or {}).get("alerts") or [])[:2] if topics["bus"] else []):
        out.append("Transit alert: " + clean(str(al.get("header") or al.get("title") or al))[:160])
    for c in ((ctx.get("cars") or {}).get("cars", []) if topics["car"] else []):
        out.append(f"Car {c['car']}: {c.get('soc')}%, {c.get('range_mi')} mi, {'plugged in' if c.get('plugged_in') else 'not plugged in'}, plan: {c.get('plan_text')}")
    cal = ((ctx.get("data") or {}).get("calendar") or {}).get("events") or []
    nowu = datetime.now(timezone.utc)
    up = [e for e in cal if parse_iso(e["end"]) >= nowu][:NC] if topics["cal"] else []
    for e in up:
        s = parse_iso(e["start"])
        out.append(f"Calendar: {e['title']} at {'all day' if e.get('all_day') else t12(s)} on {s.astimezone(LA).strftime('%A %B %d')}")
    home = (ctx.get("data") or {}).get("home") or {}
    if home.get("severe"):
        out.append("Local alert: severe weather flagged.")
    return "\n".join(out)


SYSTEM = ("You are the voice of the wall in Jared's home. Answer the question using ONLY the live data. "
          "Reply with JSON: {\"say\": string, \"title\": string, \"subject_hex\": string or null}. "
          "'say' is 1-2 short spoken sentences that include the key facts (names, numbers, times), plain words, US units (feet, miles, mph, degrees F), 12-hour times like 3 PM, no emoji, no ellipsis. "
          "'title' is under 28 characters. subject_hex is the hex of the one aircraft the answer is about, else null. "
          "If the LIVE DATA does not contain what is asked (for example traffic, news, sports), say exactly: The wall doesn't have that. Do not guess or reason from general knowledge. Never invent facts. Maximum two sentences.")


SUMMARY = re.compile(r"going on|anything|happening|summary|brief me|status|what.?s up|overview|catch me up|how.?s (it|everything|the house)")
KNOWN = re.compile(r"weather|rain|temperature|forecast|plane|flight|heli|jet|sky|airport|lax|overhead|bus|metro|transit|car|tesla|charge|battery|blue steel|range|calendar|meeting|event|schedule|appointment|today|tomorrow|tonight|agenda|wind|warm|cold|hot|umbrella")


def model_answer(q, ctx):
    if not KNOWN.search(q.lower()) and not SUMMARY.search(q.lower()):
        return ("The wall doesn't have that.", {"title": "Not on the wall", "lines": ["The wall doesn't have that."], "q": q, "ttl_s": 20}, "guard:unknown")
    body = {"model": MODEL, "stream": False, "think": False, "format": "json", "keep_alive": "24h",
            "options": {"temperature": 0.2, "num_predict": 90, "num_ctx": 2048},
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "LIVE DATA\n" + context_text(ctx, q) + "\n\nQUESTION: " + q}]}
    r = http_json(OLLAMA + "/api/chat", body, timeout=14)
    d = json.loads(clean(r["message"]["content"]))
    say = clean(d.get("say", ""))
    if len(say) < 3:
        raise ValueError("empty say")
    # never clip: keep whole sentences within 280 chars
    if len(say) > 280:
        parts, acc = re.split(r"(?<=[.!?])\s+", say), ""
        for p in parts:
            if len(acc) + len(p) + 1 <= 280:
                acc = (acc + " " + p).strip()
        say = acc or parts[0]
    lines = [x for x in re.split(r"(?<=[.!?])\s+", say) if x][:3]
    title = clean(d.get("title", ""))
    card = {"title": title if 0 < len(title) <= 28 else "The wall says", "lines": lines, "q": q, "ttl_s": 20}
    hexid = d.get("subject_hex")
    if hexid and any(a["hex"] == hexid for a in (ctx.get("ac") or {}).get("aircraft", [])):
        card["subject"] = {"type": "aircraft", "id": hexid}
    return say, card, "model:" + MODEL


def fallback_answer(q, ctx):
    ps = airborne(ctx)
    if re.search(r"helicopter|chopper|heli\b", q.lower()):
        hs = [a for a in ps if a.get("helicopter")]
        if hs:
            return describe_plane(hs[0]), card_for_plane(q, hs[0]), "fallback:heli"
        return "No helicopters are overhead right now.", {"title": "No helicopters", "lines": ["None tracked nearby."], "q": q, "ttl_s": 20}, "fallback:heli"
    return ("I couldn't work that one out from what the wall can see right now.",
            {"title": "Not sure", "lines": ["The wall can't answer that yet."], "q": q, "ttl_s": 20}, "fallback")


def answer(q):
    ctx = fetch_all()
    fp = fast_path(q, ctx)
    if fp:
        return fp
    try:
        return model_answer(q, ctx)
    except Exception as e:
        log("model failed:", repr(e)[:160])
        return fallback_answer(q, ctx)


# ---------- main loop ----------
def touch_heart():
    os.makedirs(os.path.dirname(HEART), exist_ok=True)
    with open(HEART, "w") as f:
        f.write(str(time.time()))


def askc_push(row, say, card):
    """ASKCARD: hand the finished answer to the wall (Hestia /api/ask) so the answer card shows it. Best effort, never blocks the answer."""
    try:
        http_json(WALL + "/api/ask", {"id": row["id"], "question": row["question"], "answer_text": say, "answer_card": card}, timeout=3)
    except Exception as e:
        log("askc push failed", repr(e)[:100])


def handle(row):
    t0 = time.time()
    try:
        say, card, method = answer(row["question"])
        say = clean(say)
        rpc("wall_ask_answer_t", {"p_token": TOKEN, "p_id": row["id"], "p_text": say, "p_card": card, "p_method": method})
        askc_push(row, say, card)
        log(f"answered [{method}] {int((time.time() - t0) * 1000)} ms: {row['question']!r} -> {say}")
    except Exception as e:
        log("handle error", repr(e))
        try:
            rpc("wall_ask_answer_t", {"p_token": TOKEN, "p_id": row["id"], "p_text": "The wall hit a snag, try again in a minute.",
                                      "p_card": {"title": "Snag", "lines": ["Try again in a minute."]}, "p_method": "error", "p_error": repr(e)[:250]})
        except Exception:
            pass


def warm():
    try:
        http_json(OLLAMA + "/api/chat", {"model": MODEL, "stream": False, "think": False, "keep_alive": "24h",
                                         "options": {"num_predict": 1}, "messages": [{"role": "user", "content": "hi"}]}, timeout=60)
    except Exception as e:
        log("warm failed", repr(e)[:100])


def main():
    log("ask-wall answerer up; model", MODEL)
    threading.Thread(target=warm, daemon=True).start()
    last_warm = time.time()
    pool = ThreadPoolExecutor(3)
    while True:
        touch_heart()
        try:
            rows = rpc("wall_ask_claim_t", {"p_token": TOKEN}, timeout=6)
            for r in rows:
                pool.submit(handle, r)
        except Exception as e:
            log("claim error", repr(e)[:120])
            time.sleep(3)
        if time.time() - last_warm > 600:
            last_warm = time.time()
            threading.Thread(target=warm, daemon=True).start()
        time.sleep(0.8)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "try":
        c = fetch_all()
        for qq in sys.argv[2:]:
            t = time.time()
            r = answer(qq)
            print(round(time.time() - t, 2), "s", r[2], "|", r[0], "|", json.dumps(r[1]))
    else:
        main()

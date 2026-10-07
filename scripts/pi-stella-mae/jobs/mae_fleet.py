"""Mae, Fleet Maintenance Manager (hourly).

Blue Steel (2020 Model 3, RWD, VIN 5YJ3E1EAXLF658422). Recommend only, with one exception: Costco tires.
- Tire tread: estimated from miles since install (front pair spent 12/11/24-2/11/26 on the rear), corrected by the newest tread
  reading Jared enters. Warn at 4/32", replace at 3/32".
- TPMS: one snapshot an hour; a tire that keeps losing pressure against the other three is flagged as a slow leak.
- Guest maintenance flags (Brakes, Other, ...) from Stella's stats: logged once, with what the car data does and does not show.
- Wipers / cabin filter / washer fluid: age + LA rain season reminders.
- Costco booker: finds the first Culver City slot that clears the next trip by 24+ hours. DRY RUN: it only records "would book".

Never books anything. Never books over a trip. Flags: --dry  compute and print, write nothing
"""
import datetime
import statistics
from zoneinfo import ZoneInfo

import lib

LA = ZoneInfo("America/Los_Angeles")
VIN = "5YJ3E1EAXLF658422"
URL = "https://bestly.tech/admin/turo?tab=maintenance"
AXLE_RATE = {"rear": "wear_drive_per_1000mi", "front": "wear_free_per_1000mi"}
TIRES = {"front_tires": "front", "rear_tires": "rear"}


def notify(title, body, kind, dedupe):
    return lib.rpc("rep_notify", p_agent="mae", p_title=title, p_body=body, p_kind=kind, p_url=URL, p_dedupe=dedupe)


def patch(table, where, body):
    return lib._req("PATCH", f"/rest/v1/{table}?{where}", body)


def event(kind, item, value, text, dedupe):
    try:
        lib._req("POST", "/rest/v1/fleet_maint_events", {"vin": VIN, "kind": kind, "item": item, "value": value, "text": text, "by_agent": "mae", "dedupe": dedupe})
        return True
    except RuntimeError as e:
        if "409" in str(e) or "duplicate" in str(e).lower():
            return False
        raise


def fmt_day(dt):
    dt = dt.astimezone(LA)
    return f"{dt.strftime('%a %b')} {dt.day}, {dt.strftime('%I:%M %p').lstrip('0')}"


def tread_estimate(item, row, odo, cfg):
    """Return (tread_32nds, source, rate_per_1000mi). A reading Jared entered beats the model, unless he replaced the tires after it."""
    meta, axle_now = dict(row.get("meta") or {}), TIRES[item]
    rate_now = float(cfg[AXLE_RATE[axle_now]])
    reads = lib.get("fleet_maint_events", f"select=value,at&kind=eq.tread&item=eq.{item}&order=at.desc&limit=1") or []
    dones = lib.get("fleet_maint_events", f"select=at&kind=eq.done&item=eq.{item}&order=at.desc&limit=1") or []
    if reads and (reads[0].get("value") or {}).get("tread_32nds") is not None and not (dones and dones[0]["at"] > reads[0]["at"]):
        v = reads[0]["value"]
        base, odo0 = float(v["tread_32nds"]), float(v.get("odometer") or odo)
        return round(max(base - max(odo - odo0, 0) / 1000 * rate_now, 0), 1), "measured", rate_now
    segs = meta.get("segments") or []
    if row.get("installed_miles") is not None and (not segs or float(segs[0]["from_miles"]) != float(row["installed_miles"])):
        segs = [{"axle": axle_now, "from_miles": row["installed_miles"]}]      # tires replaced since the seeded history
    lost = 0.0
    for seg in segs:
        a, b = float(seg["from_miles"]), float(seg.get("to_miles") or odo)
        lost += max(min(b, odo) - a, 0) / 1000 * float(cfg[AXLE_RATE[seg["axle"]]])
    return round(max(float(cfg["new_32nds"]) - lost, 0), 1), "model", rate_now


def miles_per_day(row, odo):
    if row.get("installed_on") and row.get("installed_miles"):
        days = max((datetime.date.today() - datetime.date.fromisoformat(row["installed_on"])).days, 30)
        return max((odo - float(row["installed_miles"])) / days, 20)
    return 60.0


def find_window(cfg, trips, now):
    """First 3-hour slot (starting 10 AM LA) that does not touch a trip and clears the next trip by min_gap_hours."""
    appt = datetime.timedelta(hours=float(cfg["appointment_hours"]))
    gap = datetime.timedelta(hours=float(cfg["min_gap_hours"]))
    busy = sorted((datetime.datetime.fromisoformat(t["starts_at"]), datetime.datetime.fromisoformat(t["ends_at"])) for t in trips)
    day = (now.astimezone(LA) + datetime.timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    for i in range(21):
        s = day + datetime.timedelta(days=i)
        e = s + appt
        s_u, e_u = s.astimezone(datetime.timezone.utc), e.astimezone(datetime.timezone.utc)
        if any(s_u < b_end + datetime.timedelta(hours=1) and e_u > b_start for b_start, b_end in busy):
            continue
        nxt = [b_start for b_start, _ in busy if b_start >= e_u]
        if nxt and nxt[0] - e_u < gap:
            continue
        return s, e, ((nxt[0] - e_u).total_seconds() / 3600 if nxt else None)
    return None


def main(argv):
    dry = "--dry" in argv
    now = datetime.datetime.now(datetime.timezone.utc)
    cfg = lib.get("fleet_maint_settings", "select=*&id=eq.true")[0]
    cw = lib.get("car_watch", "select=health,health_at&id=eq.1")[0]
    health = cw.get("health") or {}
    odo = float(health.get("odometer") or 0)
    if not odo:
        return "skip: no odometer from the car yet"
    items = {r["item"]: r for r in lib.get("fleet_maintenance", f"select=*&vin=eq.{VIN}")}
    trips = lib.get("turo_trips", f"select=reservation_id,guest_first,starts_at,ends_at,status&status=in.(BOOKED,IN_PROGRESS)&ends_at=gt.{now.strftime('%Y-%m-%dT%H:%M:%SZ')}") or []
    out, tire_due = [], []

    # ---- TPMS snapshot + slow-leak watch
    psi = health.get("tires") or {}
    if psi and not dry:
        stamp = now.astimezone(LA).strftime("%Y%m%d%H")
        event("tpms", None, {**psi, "odometer": odo}, None, f"tpms-{stamp}")
    hist = lib.get("fleet_maint_events", "select=at,value&kind=eq.tpms&order=at.desc&limit=200") or []
    days = {}
    for h in hist:
        v = h["value"] or {}
        if all(k in v for k in ("fl", "fr", "rl", "rr")):
            days.setdefault(h["at"][:10], []).append(v)
    if len(days) >= 4:
        ks = sorted(days)[-7:]
        for tire in ("fl", "fr", "rl", "rr"):
            rel = []
            for d in ks:
                vals = days[d]
                rel.append(statistics.median([v[tire] - statistics.mean(v[o] for o in ("fl", "fr", "rl", "rr") if o != tire) for v in vals]))
            half = len(rel) // 2
            drop = statistics.mean(rel[:half]) - statistics.mean(rel[half:])
            if drop >= 1.5:
                name = {"fl": "front left", "fr": "front right", "rl": "rear left", "rr": "rear right"}[tire]
                out.append(f"{name} leaking {drop:.1f} psi")
                if not dry:
                    notify(f"Slow leak, {name} tire", f"It has lost about {drop:.1f} psi against the other three over {len(ks)} days. Worth a look at the next tire visit.",
                           "recap", f"leak-{tire}-{now.date().isocalendar()[1]}")

    # ---- tires
    for item in ("front_tires", "rear_tires"):
        row = items.get(item)
        if not row:
            continue
        tread, src, rate = tread_estimate(item, row, odo, cfg)
        warn, rep = float(cfg["warn_32nds"]), float(cfg["replace_32nds"])
        status = "overdue" if tread < rep else "due" if tread <= rep + 0.25 else "watch" if tread <= warn else "ok"
        mi_left = max((tread - rep) / rate * 1000, 0) if rate else None
        due_by = None
        if mi_left is not None:
            due_by = (datetime.date.today() + datetime.timedelta(days=int(mi_left / miles_per_day(row, odo)))).isoformat()
        note = (f"Estimated {tread}/32\" from miles ({'your last reading' if src == 'measured' else 'odometer baseline derived, not from the receipt'}). "
                f"Replace at {rep:g}/32\". Confirm with a penny test or a gauge.")
        out.append(f"{item} {tread}/32 {status}")
        if not dry:
            patch("fleet_maintenance", f"id=eq.{row['id']}", {"tread_32nds": tread, "tread_source": src, "status": status, "due_by": due_by,
                                                              "est_remaining_mi": int(mi_left) if mi_left is not None else None,
                                                              "est_remaining_pct": round(max(tread - rep, 0) / max(float(cfg["new_32nds"]) - rep, 1) * 100, 1),
                                                              "last_check": now.isoformat(), "notes": note, "updated_at": now.isoformat()})
        if status in ("due", "overdue"):
            tire_due.append((item, row, tread, status))
        elif status == "watch" and not dry:
            notify(f"{row['label'].split(' (')[0]} getting low", f"About {tread}/32\" left by the estimate. Replace at {rep:g}/32\". I will line up a Costco slot when it is time.",
                   "recap", f"tirewatch-{item}-{now.date().isocalendar()[1]}")

    # ---- Costco booker (dry run) + the one interrupt Jared allowed: maintenance due with a bookable gap
    if tire_due:
        win = find_window(cfg, trips, now)
        names = " and ".join(r["label"].split(" (")[0].lower() for _, r, _, _ in tire_due)
        worst = min(t for _, _, t, _ in tire_due)
        if win:
            s, e, clear = win
            clears = f" and clears your next trip by {clear:.0f} hrs" if clear is not None else ", no trip booked after it"
            line = f"{cfg['tire_vendor']}, {fmt_day(s)} to {e.astimezone(LA).strftime('%I:%M %p').lstrip('0')}{clears}."
            value = {"mode": cfg["costco_mode"], "start": s.astimezone(datetime.timezone.utc).isoformat(), "end": e.astimezone(datetime.timezone.utc).isoformat(),
                     "link": cfg["costco_waitwhile"], "items": [i for i, *_ in tire_due]}
            out.append("costco window " + fmt_day(s))
            if not dry:
                if cfg["costco_mode"] == "live":
                    # Live booking is not wired up: the booking flow has never been walked through with Jared's go-ahead.
                    value["mode"] = "link_only"
                event("booking", tire_due[0][0], value, ("Would book: " if value["mode"] == "dry_run" else "Open slot: ") + line, f"costco-{tire_due[0][0]}-{value['start'][:13]}")
                notify(f"{names.capitalize()} due, slot found",
                       f"Estimate {worst}/32\". {line} Dry run only, nothing is booked. Book it here: {cfg['costco_waitwhile']}",
                       "maint_due", f"maint-{tire_due[0][0]}-{now.date().isocalendar()[1]}")
        else:
            out.append("no bookable gap in 21 days")
            if not dry:
                notify(f"{names.capitalize()} due, no gap yet", f"Estimate {worst}/32\". No 3-hour slot in the next 3 weeks clears your trips by 24 hrs. I will keep looking.",
                       "recap", f"maint-nogap-{now.date().isocalendar()[1]}")

    # ---- guest flags (Stella's stats)
    st = (lib.get("turo_host_stats", "select=flags,ratings&order=taken_at.desc&limit=1") or [{}])[0]
    for name, cnt in (st.get("flags") or {}).items():
        if dry or "location" in name.lower():      # car location is a listing/pickup issue, not maintenance
            continue
        item = "brakes" if "brake" in name.lower() else None
        text = (f"Guests flagged {name} {cnt} time(s) in the last 365 days (of {st.get('ratings')} ratings). "
                + ("Tesla reports no brake alert in the car data I can see, so it reads as a one-off. Ask for a brake check at the next tire visit."
                   if item == "brakes" else "No matching alert in the car data I can see, so it reads as a one-off. I will log it and watch for a repeat."))
        if event("guest_flag", item, {"flag": name, "count": cnt}, text, f"flag-{name}-{cnt}"):
            notify(f"Guest flag: {name}", text, "recap", f"flag-{name}-{cnt}")

    # ---- wipers / cabin filter / washer fluid: age + LA rain season (Oct to Mar)
    month = datetime.date.today().month
    for item in ("wipers", "cabin_filter", "washer_fluid"):
        row = items.get(item)
        if not row or dry:
            continue
        if row.get("installed_on"):
            age_m = (datetime.date.today() - datetime.date.fromisoformat(row["installed_on"])).days / 30.4
            life = float((row.get("meta") or {}).get("life_months") or 12)
            st_new = "overdue" if age_m > life * 1.15 else "due" if age_m > life * 0.9 else "ok"
        else:
            st_new = "watch" if month in (10, 11, 12, 1, 2, 3) else "unknown"
        if st_new != row["status"]:
            patch("fleet_maintenance", f"id=eq.{row['id']}", {"status": st_new, "last_check": now.isoformat(), "updated_at": now.isoformat()})
        if st_new in ("watch", "due", "overdue") and item != "cabin_filter":
            tail = "no install date on file, so check before the first rain" if not row.get("installed_on") else "past their normal life"
            event("recommendation", item, {"status": st_new}, f"{row['label']}: {tail}.", f"rain-{item}-{now.year}")
    return "ok: " + ("; ".join(out) if out else "nothing to do")

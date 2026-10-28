import os, json, sys, time
os.environ["CITIZEN_DIR"] = "/tmp/citizen-test"; os.environ["CITIZEN_TEST_ANY_AGE"] = "1"
sys.path.insert(0, "/tmp/citizen-test")
import citizen_common as C, citizen_adapters as AD
def show(name, its, n=6):
    print("==", name, len(its))
    for i in its[:n]:
        print("  ", i.get("category"), "|", i["short"], "|", (i.get("sub") or "").replace(" ", "_"), "|", i["level"], "| ping", i.get("ping"), "| place", i.get("place"), "|", i["lat"], i["lng"])
which = sys.argv[1:]
if "usgs" in which:
    its = AD.fetch_usgs(); show("usgs", its)
    print("rules", AD.felt_rules(3.6, 40), AD.felt_rules(3.4, 40), AD.felt_rules(5.1, 140), AD.felt_rules(4.2, 120))
if "lafd" in which:
    import urllib.request
    t = C.http_get("https://www.lafd.org/alerts")[1].decode()
    rows = AD.parse_lafd(t); print("lafd rows", len(rows)); print(rows[0])
    its = AD.fetch_lafd(); show("lafd", its)
if "nixle" in which:
    t = C.http_get(AD.NIXLE_URL)[1].decode()
    rows = AD.parse_nixle_list(t); print("nixle rows", len(rows)); print(rows[:3])
    its = AD.fetch_nixle({}); show("nixle", its, 9)
if "synthetic" in which:
    # sce record
    q = AD.sce_time("10/28/2026 05:00:00 PM"); print("sce_time", q, C.t12(q).replace(" ", "_"))
    # conflict
    ctx = [{"label": "Blue Steel", "lat": 34.0836, "lon": -118.3699, "from_ms": time.time()*1000, "to_ms": time.time()*1000+86400000}]
    print("conflict", C.conflict_for(34.0839, -118.3701, time.time()*1000, time.time()*1000+3600000, ctx), C.conflict_for(34.1, -118.3, time.time()*1000, time.time()*1000+3600000, ctx))
    print("dist", C.fmt_dist(820).replace(" ", "_"), C.fmt_dist(2112).replace(" ", "_"), C.fmt_dist(26400*3).replace(" ", "_"), C.where_text(34.2, -118.1).replace(" ", "_"))
    print("short", C.short_text("KNOCKDOWN Structure Fire in the Hollywood Hills area".title()), "|", C.short_text("Santa Monica Blvd closure between Doheny and La Cienega"))
    print("aqi", AD.aqi_label(155))
    print("trips", json.dumps(C.trips_context())[:500])
    print("out_on_trip", C.blue_steel_out_on_trip())
    print("geocode", C.geocode("9900 N Reseda Blvd, Northridge, Los Angeles, CA"), C.geocode("8300 Santa Monica Blvd, West Hollywood, CA"))

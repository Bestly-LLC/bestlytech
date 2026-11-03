import time, shutil
P="/opt/bestly/cron/jobs/charge_plan_watch.py"
src=open(P).read()
shutil.copy(P, P+".bak_carcard_"+time.strftime("%Y%m%d-%H%M"))
def sub(a,b):
    global src
    assert src.count(a)==1,(src.count(a),a[:60])
    src=src.replace(a,b)
sub('''    # report new problems (digest + quiet Scout row), clear solved ones''','''    # 5. CARCARD_20261103: the wall Cars card feed (/api/cars on the wall server) must carry data under 30 min old
    try:
        import urllib.request
        wc = json.load(urllib.request.urlopen("http://127.0.0.1:8099/api/cars", timeout=8))
        ups = [cp.ts(r.get("updated_at")) for r in (wc.get("cars") or [])]
        ups = [u for u in ups if u]
        newest = max(ups) if ups else None
        fetched = wc.get("fetched_at")
        f_age = (now.timestamp() - fetched) / 60 if fetched else None
        if (newest and now - newest > datetime.timedelta(minutes=30)) or (f_age is not None and f_age > 30) or wc.get("error"):
            age = int((now - newest).total_seconds() // 60) if newest else None
            lead = (f"The Cars page on the projector wall is showing data {age} min old. " if age is not None
                    else "The Cars page on the projector wall has no fresh data. ")
            problems["car.charge.wall"] = ("The wall Cars card data is old",
                                           lead + (str(wc.get("error"))[:120] if wc.get("error") else "The planner or the feed is behind; I re-run the planner and it clears on its own."))
            if not dry and not any("planner re-run" in h for h in healed):
                try:
                    cp.main(["--force"])
                    healed.append("planner re-run (wall card data old)")
                except Exception as e:  # noqa: BLE001
                    print(f"  re-run failed: {e}", flush=True)
    except Exception as e:  # noqa: BLE001
        problems["car.charge.wall"] = ("The wall Cars card feed is not answering", f"/api/cars on the wall server failed: {type(e).__name__}: {str(e)[:100]}")

    # report new problems (digest + quiet Scout row), clear solved ones''')
open(P,"w").write(src); print("watch patched")

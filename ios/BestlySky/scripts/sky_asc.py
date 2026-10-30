#!/usr/bin/env python3
"""App Store Connect helper for Bestly Sky (uses ~/Developer/arrivekey/scripts/asc.py for auth).

  sky_asc.py profiles          create or reuse the two App Store provisioning profiles and install them
  sky_asc.py app               exit 0 and print the app id once an ASC app record for tech.bestly.sky exists, else exit 2
  sky_asc.py testflight <n>    wait for build <n> to finish processing, then put it in the internal group "Bestly"

filter[identifier] is a fuzzy match in the API, so every lookup re-checks the exact identifier.
"""
import base64, hashlib, os, plistlib, re, subprocess, sys, time
sys.path.insert(0, os.path.expanduser("~/Developer/arrivekey/scripts"))
import asc

HOME = os.path.expanduser("~")
KC = f"{HOME}/Library/Keychains/arrivekey-build.keychain-db"
BUNDLE = "tech.bestly.sky"
PROFILES = [(BUNDLE, "Bestly Sky App Store"), ("tech.bestly.sky.widgets", "Bestly Sky Widgets App Store")]
GROUP = "Bestly"


def bundle_resource(identifier):
    r = asc.call("GET", "/v1/bundleIds?filter[identifier]=%s&limit=200" % identifier)
    for b in r["data"]:
        if b["attributes"]["identifier"] == identifier:
            return b["id"]
    sys.exit("bundle id not found: " + identifier)


def dist_cert_id():
    out = subprocess.check_output(["security", "find-identity", "-v", "-p", "codesigning", KC]).decode()
    m = re.search(r"\b([0-9A-F]{40})\b\s+\"Apple Distribution", out)
    if not m:
        sys.exit("no Apple Distribution identity in the arrivekey-build keychain")
    sha = m.group(1)
    r = asc.call("GET", "/v1/certificates?limit=200")
    for c in r["data"]:
        if c["attributes"].get("certificateType") not in ("DISTRIBUTION", "IOS_DISTRIBUTION"):
            continue
        der = base64.b64decode(c["attributes"]["certificateContent"])
        if hashlib.sha1(der).hexdigest().upper() == sha:
            return c["id"]
    sys.exit("the local Apple Distribution certificate is not in App Store Connect")


def install(profile):
    data = base64.b64decode(profile["attributes"]["profileContent"])
    uuid = profile["attributes"]["uuid"]
    for d in (f"{HOME}/Library/MobileDevice/Provisioning Profiles", f"{HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles"):
        os.makedirs(d, exist_ok=True)
        with open(f"{d}/{uuid}.mobileprovision", "wb") as f:
            f.write(data)
    p = subprocess.run(["security", "cms", "-D"], input=data, capture_output=True)
    ents = plistlib.loads(p.stdout).get("Entitlements", {}) if p.returncode == 0 else {}
    print("  installed", profile["attributes"]["name"], uuid, "| aps-environment:", ents.get("aps-environment", "(none)"),
          "| app id:", ents.get("application-identifier", "?"))


def profiles():
    cid = dist_cert_id()
    existing = asc.call("GET", "/v1/profiles?limit=200")["data"]
    for ident, name in PROFILES:
        bid = bundle_resource(ident)
        keep = None
        for p in existing:
            a = p["attributes"]
            if a["name"] != name:
                continue
            if a["profileState"] == "ACTIVE" and a["profileType"] == "IOS_APP_STORE":
                certs = [c["id"] for c in asc.call("GET", "/v1/profiles/%s/certificates" % p["id"])["data"]]
                b = asc.call("GET", "/v1/profiles/%s/bundleId" % p["id"])["data"]["id"]
                if cid in certs and b == bid:
                    keep = p
                    break
            asc.call("DELETE", "/v1/profiles/%s" % p["id"])
        if keep:
            print("reusing profile", name)
            install(asc.call("GET", "/v1/profiles/%s" % keep["id"])["data"])
            continue
        body = {"data": {"type": "profiles", "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
                         "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bid}},
                                           "certificates": {"data": [{"type": "certificates", "id": cid}]}}}}
        print("creating profile", name)
        install(asc.call("POST", "/v1/profiles", body)["data"])


def app_id(bundle=BUNDLE, quiet=False):
    r = asc.call("GET", "/v1/apps?filter[bundleId]=%s&limit=50" % bundle)
    for a in r["data"]:
        if a["attributes"]["bundleId"] == bundle:
            return a["id"]
    return None


def testflight(build):
    aid = app_id()
    if not aid:
        sys.exit("no app record for " + BUNDLE)
    bid = None
    for _ in range(60):
        r = asc.call("GET", "/v1/builds?filter[app]=%s&filter[version]=%s&limit=5" % (aid, build))
        if r["data"]:
            st = r["data"][0]["attributes"]["processingState"]
            print("build", build, "state", st)
            if st == "VALID":
                bid = r["data"][0]["id"]
                break
            if st in ("FAILED", "INVALID"):
                sys.exit("build processing " + st)
        else:
            print("build", build, "not visible yet")
        time.sleep(30)
    if not bid:
        sys.exit("build still processing after 30 minutes")
    gid = None
    for g in asc.call("GET", "/v1/apps/%s/betaGroups?limit=50" % aid)["data"]:
        if g["attributes"]["name"] == GROUP:
            gid = g["id"]
    if not gid:
        body = {"data": {"type": "betaGroups", "attributes": {"name": GROUP, "isInternalGroup": True, "hasAccessToAllBuilds": True},
                         "relationships": {"app": {"data": {"type": "apps", "id": aid}}}}}
        gid = asc.call("POST", "/v1/betaGroups", body)["data"]["id"]
        print("created internal group", GROUP)
    # testers: copy the people from Arrivekey's "Bestly" group
    ak = app_id("app.arrivekey.host")
    testers = []
    if ak:
        for g in asc.call("GET", "/v1/apps/%s/betaGroups?limit=50" % ak)["data"]:
            if g["attributes"]["name"] == GROUP:
                testers = asc.call("GET", "/v1/betaGroups/%s/betaTesters?limit=50" % g["id"])["data"]
    print("testers found in the Arrivekey group:", len(testers))
    if testers:
        asc.call("POST", "/v1/betaGroups/%s/relationships/betaTesters" % gid,
                 {"data": [{"type": "betaTesters", "id": t["id"]} for t in testers]})
    try:
        asc.call("POST", "/v1/builds/%s/relationships/betaGroups" % bid, {"data": [{"type": "betaGroups", "id": gid}]})
    except Exception as e:
        print("(adding the build to the group by hand was not needed or not allowed:", str(e)[:80], ")")
    print("TESTFLIGHT OK: build", build, "is in group", GROUP, "with", len(testers), "tester(s)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "profiles":
        profiles()
    elif cmd == "app":
        a = app_id()
        print(a or "no app record yet")
        sys.exit(0 if a else 2)
    elif cmd == "testflight":
        testflight(sys.argv[2])
    else:
        sys.exit(__doc__)

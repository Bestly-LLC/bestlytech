#!/usr/bin/env python3
"""App Contract Check: does every server call in the Bestly Admin iPhone app match the live database?

Reads the iOS source, finds every AdminAPI.rpc("name", ["p_x": ...]) and AdminAPI.invoke("fn", ...), then checks
  - the rpc exists in the public schema,
  - every param key the app sends is an input of that function (some overload),
  - the signed-in admin ('authenticated') may execute it,
  - the edge function folder exists in supabase/functions/.
Exit 0 = all match, 1 = mismatch, 2 = could not check (no network, no key).

  check.py <ios-source-dir> [--daily] [--repo <bestlytech checkout>] [--names] [--contract-json <file>]
  --daily          also check in with Scout (heartbeat) and raise/clear the admin.app.contract alert on a mismatch
  --names          print the extracted calls as JSON and stop (no network)
  --contract-json  compare against a saved admin_app_contract rows file instead of calling the database

No AI, no Claude. The Mac mini holds the publishable key (~/Bestly/sweep/config.json) and the watchdog token in Keychain
(bestly-db-watchdog), the same as the other Mac tools. Nothing secret is printed or stored.
"""
import json, os, re, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")
LOG = os.path.join(HOME, "Bestly", "admin-app-contract", "check.log")


def log(msg):
    import time
    line = time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------- extraction
def balanced(text, start):
    """text[start] is '('. Return index just past the matching ')', skipping strings."""
    depth, i, n = 0, start, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            i += 1
            while i < n and text[i] != '"':
                i += 2 if text[i] == "\\" else 1
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def top_level_keys(arg):
    """Keys of a Swift dictionary literal '[ "k": v, ... ]' (depth 1 only). None when arg is not a literal."""
    arg = arg.strip()
    if not arg.startswith("["):
        return None
    if arg == "[:]":
        return []
    keys, depth, i, n, prev = [], 0, 0, len(arg), ""
    while i < n:
        c = arg[i]
        if c == '"':
            j = i + 1
            while j < n and arg[j] != '"':
                j += 2 if arg[j] == "\\" else 1
            s = arg[i + 1:j]
            # a dictionary key follows '[' or ',' (a ternary "a" : "b" does not)
            if depth == 1 and prev in ("[", ",") and re.match(r"\s*:", arg[j + 1:]):
                keys.append(s)
            prev = '"'
            i = j + 1
            continue
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        if not c.isspace():
            prev = c
        i += 1
    return keys


def split_args(inner):
    """Split call arguments at depth 0 commas."""
    out, depth, cur, i, n = [], 0, "", 0, len(inner)
    while i < n:
        c = inner[i]
        if c == '"':
            j = i + 1
            while j < n and inner[j] != '"':
                j += 2 if inner[j] == "\\" else 1
            cur += inner[i:j + 1]
            i = j
        elif c == "'":
            j = i + 1
            while j < n and inner[j] != "'":
                j += 1
            cur += inner[i:j + 1]
            i = j
        elif c in "([{":
            depth += 1; cur += c
        elif c in ")]}":
            depth -= 1; cur += c
        elif c == "," and depth == 0:
            out.append(cur); cur = ""
        else:
            cur += c
        i += 1
    if cur.strip():
        out.append(cur)
    return out


def extract(src_dir):
    rpcs, fns, unparsed = [], [], []
    for root, _, files in os.walk(src_dir):
        if "Generated" in root or ".build" in root:
            continue
        for fn in sorted(files):
            if not fn.endswith(".swift"):
                continue
            path = os.path.join(root, fn)
            text = open(path, encoding="utf-8", errors="replace").read()
            for m in re.finditer(r"AdminAPI\s*\.\s*(rpc|invoke)\s*\(", text):
                kind = m.group(1)
                end = balanced(text, m.end() - 1)
                args = split_args(text[m.end():end - 1])
                line = text.count("\n", 0, m.start()) + 1
                where = "%s:%d" % (os.path.relpath(path, src_dir), line)
                first = args[0].strip() if args else ""
                lits = re.findall(r'"([A-Za-z0-9_\-]+)"', first)
                if not lits or (len(lits) > 1 and "?" not in first) or "\\(" in first:
                    unparsed.append({"kind": kind, "at": where, "arg": first[:60]})
                    continue
                if not re.fullmatch(r'"[A-Za-z0-9_\-]+"', first) and "?" not in first:
                    unparsed.append({"kind": kind, "at": where, "arg": first[:60]})
                    continue
                for nm in lits:                     # a ternary ("a" : "b") checks both names
                    if kind == "rpc":
                        keys = top_level_keys(args[1]) if len(args) > 1 else []
                        rpcs.append({"name": nm, "keys": keys, "at": where})
                    else:
                        fns.append({"name": nm, "at": where})
    return rpcs, fns, unparsed


# ---------------------------------------------------------------- contract
def arg_names(identity):
    names = set()
    for part in split_args(identity or ""):
        toks = part.strip().split()
        while toks and toks[0].upper() in ("IN", "OUT", "INOUT", "VARIADIC"):
            toks = toks[1:]
        if toks:
            names.add(toks[0].strip('"'))
    return names


def required_names(identity):
    req = set()
    for part in split_args(identity or ""):
        toks = part.strip().split()
        while toks and toks[0].upper() in ("IN", "OUT", "INOUT", "VARIADIC"):
            toks = toks[1:]
        if toks and " DEFAULT " not in " " + part.upper() + " ":
            req.add(toks[0].strip('"'))
    return req


def edge_functions(repo):
    """Names under supabase/functions on origin/main (fetched first) when repo is a git checkout, else the folder's own listing.
    A stale local checkout must not hide a missing function, so git wins."""
    if not repo:
        return None
    if os.path.exists(os.path.join(repo, ".git")):
        try:
            subprocess.run(["git", "-C", repo, "fetch", "-q", "origin", "main"], capture_output=True, timeout=60)
            r = subprocess.run(["git", "-C", repo, "ls-tree", "-d", "--name-only", "origin/main", "supabase/functions/"],
                               capture_output=True, text=True, timeout=30)
            names = {l.split("/")[-1] for l in r.stdout.split() if l.strip()}
            if names:
                return names
        except Exception:
            pass
    d = os.path.join(repo, "supabase", "functions")
    return set(os.listdir(d)) if os.path.isdir(d) else None


def compare(rpcs, fns, rows, repo):
    by = {}
    for r in rows:
        by.setdefault(r["name"], []).append(r)
    problems = []
    for c in rpcs:
        ov = by.get(c["name"])
        if not ov:
            problems.append({"at": c["at"], "call": c["name"], "why": "missing",
                             "say": "%s (%s) calls the server function %s, which does not exist." % (c["at"], "rpc", c["name"])})
            continue
        if not any(o["authed"] for o in ov):
            problems.append({"at": c["at"], "call": c["name"], "why": "not_allowed",
                             "say": "%s calls %s, but the signed-in admin is not allowed to run it." % (c["at"], c["name"])})
        if c["keys"] is not None:
            ok = any(set(c["keys"]) <= arg_names(o["args"]) for o in ov)
            if not ok:
                best = max(ov, key=lambda o: len(set(c["keys"]) & arg_names(o["args"])))
                bad = sorted(set(c["keys"]) - arg_names(best["args"]))
                problems.append({"at": c["at"], "call": c["name"], "why": "params",
                                 "say": "%s sends %s to %s, but the server function only takes (%s)." % (
                                     c["at"], ", ".join(bad), c["name"], best["args"] or "nothing")})
            else:
                # the best-fitting overload must not need an input the app leaves out
                fits = [o for o in ov if set(c["keys"]) <= arg_names(o["args"])]
                if not any(required_names(o["args"]) <= set(c["keys"]) for o in fits):
                    need = sorted(required_names(fits[0]["args"]) - set(c["keys"]))
                    problems.append({"at": c["at"], "call": c["name"], "why": "missing_params",
                                     "say": "%s calls %s without %s, which the server requires." % (c["at"], c["name"], ", ".join(need))})
    edge = edge_functions(repo)
    for f in fns:
        if edge is not None and f["name"] not in edge:
            problems.append({"at": f["at"], "call": f["name"], "why": "edge_missing",
                             "say": "%s calls the edge function %s, which is not in supabase/functions." % (f["at"], f["name"])})
    return problems


# ---------------------------------------------------------------- database (publishable key + watchdog token)
def keychain(service):
    r = subprocess.run(["security", "find-generic-password", "-s", service, "-w"], capture_output=True, text=True)
    return r.stdout.strip()


def cfg():
    p = os.path.join(HOME, "Bestly", "sweep", "config.json")
    with open(p) as f:
        return json.load(f)


def call(name, body):
    c = cfg()
    req = urllib.request.Request(c["supabase_url"].rstrip("/") + "/rest/v1/rpc/" + name, data=json.dumps(body).encode(),
                                 method="POST", headers={"Content-Type": "application/json", "apikey": c["publishable"],
                                                         "Authorization": "Bearer " + c["publishable"]})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or "null")


def main():
    a = sys.argv[1:]
    if not a or a[0].startswith("--"):
        print(__doc__); return 2
    src = a[0]
    daily = "--daily" in a
    repo = os.path.abspath(os.path.join(HERE, "..", ".."))
    if "--repo" in a:
        repo = a[a.index("--repo") + 1]
    rpcs, fns, unparsed = extract(src)
    if "--names" in a:
        print(json.dumps({"rpcs": rpcs, "fns": fns, "unparsed": unparsed}, indent=1)); return 0
    names = sorted({r["name"] for r in rpcs})
    try:
        if "--contract-json" in a:
            rows = json.load(open(a[a.index("--contract-json") + 1]))
        else:
            tok = keychain("bestly-db-watchdog")
            if not tok:
                raise RuntimeError("no watchdog token in Keychain")
            rows = call("admin_app_contract_t", {"p_token": tok, "p_fns": names})
    except Exception as e:
        log("could not check: %s" % e)
        return 2
    problems = compare(rpcs, fns, rows, repo)
    log("%d rpc calls (%d functions), %d edge calls, %d not checkable (name built at run time), %d mismatches" % (
        len(rpcs), len(names), len(fns), len(unparsed), len(problems)))
    for p in problems:
        log("MISMATCH " + p["say"])
    if daily:
        ok = not problems
        summary = "All %d server calls in the app match the server." % len(rpcs) if ok else "%d broken server calls in the app." % len(problems)
        body = ""
        if not ok:
            body = ("These buttons in the Admin app will fail because the app and the server disagree. " +
                    " ".join(p["say"] for p in problems[:12]) +
                    ("" if len(problems) <= 12 else " And %d more." % (len(problems) - 12)) +
                    " Scout asked for them to be fixed in the next build.")
        try:
            tok = keychain("bestly-db-watchdog")
            call("admin_app_contract_report_t", {"p_token": tok, "p_ok": ok, "p_summary": summary, "p_body": body})
        except Exception as e:
            log("could not tell Scout: %s" % e)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

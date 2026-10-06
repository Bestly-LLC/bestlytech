"""Content playbook for every Pi content writer (2026-10-06).

Jared 2026-10-06: the scroll-stopping-creative and just-scrape skills are what Spark and Studio use for ALL content.
The skills live in Supabase (bestly_skills + studio_content_skills); studio_content_playbook(role) renders them as one
prompt block. Every writer appends it to its system prompt with playbook.add(system):
  brand_maker (Cookie Yeti, InventoryProof), hoku_maker, bestly_social, cy_maker, studio_regen, Montage (_common, hoku).
Spark (studio-chat) reads the same RPC, so one table drives every writer. Add a skill there; nothing here changes.

Deployed at /opt/bestly/cron/playbook.py. Cached for an hour in /opt/bestly/cron/state/playbook-<role>.txt; if Supabase
is unreachable the last cached copy is used (any age), and a writer never fails because of the playbook.
`python3 playbook.py [role]` prints the current block (health check).
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state")
TTL = 3600


def rules(role="writing"):
    path = os.path.join(STATE, f"playbook-{role}.txt")
    try:
        if time.time() - os.path.getmtime(path) < TTL:
            with open(path) as f:
                return f.read()
    except OSError:
        pass
    try:
        text = lib.rpc("studio_content_playbook", p_role=role)
        if isinstance(text, str):
            os.makedirs(STATE, exist_ok=True)
            with open(path + ".tmp", "w") as f:
                f.write(text)
            os.replace(path + ".tmp", path)
            return text
    except Exception as e:  # noqa: BLE001 - the playbook must never stop a writer
        print(f"playbook: could not read {role} from Supabase ({e}); using the cached copy", file=sys.stderr)
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return ""


def add(system, role="writing"):
    pb = rules(role)
    return f"{system}\n\n{pb}" if pb else system


if __name__ == "__main__":
    r = sys.argv[1] if len(sys.argv) > 1 else "writing"
    out = rules(r)
    print(out if out else f"(empty playbook for {r})")
    sys.exit(0 if out else 1)

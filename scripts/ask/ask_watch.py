#!/usr/bin/env python3
"""Ask the wall watchdog (launchd tech.bestly.ask-wall-watch, every 60 s).
Restarts the answerer if it is down or its heartbeat is stale; restarts or re-pulls Ollama if the
model is unavailable. Reports to Scout via wall_ask_beat_t (digest-only: a healed restart is an FYI,
an unrecoverable failure is a no-push card owned by Wall Watchdog)."""
import json, os, subprocess, sys, time, urllib.request

HOME = os.path.expanduser("~")
UID = os.getuid()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
LABEL = "tech.bestly.ask-wall"
HEART = f"{HOME}/.bestly/ask/heartbeat"
STATE = f"{HOME}/.bestly/ask/watch_state.json"
MODEL = os.environ.get("ASK_MODEL", "qwen3:8b")
OLLAMA = "http://127.0.0.1:11434"
SB = "https://rcqfqhguwpmaarseifqg.supabase.co/rest/v1/rpc/"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
TOKEN = open(f"{HOME}/.bestly/ask_wall_token").read().strip()
BREW = "/opt/homebrew/bin/brew"
OLLAMA_BIN = "/opt/homebrew/bin/ollama"


def sh(cmd, t=60):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=t)


def jget(url, body=None, t=5):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=t))


def beat(ok, summary, healed=False):
    body = {"p_token": TOKEN, "p_ok": ok, "p_summary": summary, "p_healed": healed}
    req = urllib.request.Request(SB + "wall_ask_beat_t", data=json.dumps(body).encode(), method="POST",
                                 headers={"apikey": ANON, "Authorization": "Bearer " + ANON, "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:
        print("beat failed", e)


def ollama_ok(generate=False):
    try:
        names = [m["name"] for m in jget(OLLAMA + "/api/tags")["models"]]
        if MODEL not in names:
            return "model missing"
        if generate:
            jget(OLLAMA + "/api/chat", {"model": MODEL, "stream": False, "think": False, "keep_alive": "24h", "options": {"num_predict": 1},
                                        "messages": [{"role": "user", "content": "hi"}]}, t=40)
        return None
    except Exception as e:
        return "ollama down: " + repr(e)[:80]


def answerer_ok():
    try:
        age = time.time() - float(open(HEART).read())
    except Exception:
        return "no heartbeat"
    return None if age < 30 else f"heartbeat {int(age)} s old"


def main():
    try:
        st = json.load(open(STATE))
    except Exception:
        st = {}
    now = time.time()
    healed = []
    gen = now - st.get("last_gen", 0) > 300
    if gen:
        st["last_gen"] = now

    prob = ollama_ok(generate=gen)
    if prob:
        if prob == "model missing":
            sh(f"{OLLAMA_BIN} pull {MODEL}", 1500)
        else:
            sh(f"launchctl kickstart -k gui/{UID}/sh.brew.ollama", 30)
            time.sleep(8)
        again = ollama_ok(generate=True)
        if again:
            sh(f"{BREW} services restart ollama", 60)
            time.sleep(10)
            again = ollama_ok(generate=True)
        if again:
            beat(False, f"Local model unavailable on the Mac mini ({prob}). Restart did not fix it.")
            json.dump(st, open(STATE, "w"))
            return
        healed.append("Ollama")

    prob = answerer_ok()
    if prob:
        sh(f"launchctl kickstart -k gui/{UID}/{LABEL}", 30)
        time.sleep(6)
        if answerer_ok():
            sh(f"launchctl bootstrap gui/{UID} {HOME}/Library/LaunchAgents/{LABEL}.plist", 30)
            time.sleep(6)
        again = answerer_ok()
        if again:
            beat(False, f"Ask the wall answerer on the Mac mini is down ({prob}). Restart did not fix it.")
            json.dump(st, open(STATE, "w"))
            return
        healed.append("answerer")

    if healed:
        beat(True, "Mac mini restarted " + " and ".join(healed) + " for Ask the wall; answering again.", True)
    else:
        beat(True, "Ask the wall is answering (" + MODEL + ").")
    json.dump(st, open(STATE, "w"))


if __name__ == "__main__":
    main()

"""Run one ask through the deployed admin-chat as the service (the way fix-ladder does: autopilot:true, a fresh thread) and
measure it: tool calls, seconds, models, reply. Usage: python3 scout_probe.py "<ask>". Questions only; never sends mail.
Reads thread rows afterwards from admin_chat_messages / admin_chat_actions / ai_spend."""
import json, os, sys, time, urllib.request
sys.path.insert(0, "/opt/bestly/cron")
import lib

ask = sys.argv[1]
admin = lib.get("user_roles", "select=user_id&role=eq.admin&limit=1")[0]["user_id"]
req = urllib.request.Request(lib.URL + "/rest/v1/admin_chat_threads", method="POST",
    data=json.dumps({"user_id": admin, "title": "TEST " + ask[:50]}).encode(),
    headers={"apikey": lib.KEY, "Content-Type": "application/json", "Prefer": "return=representation", **({"Authorization": "Bearer " + lib.KEY} if lib.KEY.startswith("eyJ") else {})})
tid = json.load(urllib.request.urlopen(req))[0]["id"]
t0 = time.time()
r = urllib.request.Request(lib.URL + "/functions/v1/admin-chat", method="POST", data=json.dumps({"body": ask, "autopilot": True, "thread_id": tid}).encode(),
    headers={"apikey": lib.KEY, "Content-Type": "application/json", **({"Authorization": "Bearer " + lib.KEY} if lib.KEY.startswith("eyJ") else {})})
try:
    out = urllib.request.urlopen(r, timeout=170).read().decode()
except Exception as e:
    out = "ERR " + str(e)[:200]
secs = round(time.time() - t0, 1)
acts = lib.get("admin_chat_actions", f"select=tool,ok&thread_id=eq.{tid}&order=created_at")
msgs = lib.get("admin_chat_messages", f"select=role,body&thread_id=eq.{tid}&order=created_at")
spend = lib.get("ai_spend", f"select=model,provider,ok&ref=eq.{tid}")
models = {}
for s in spend:
    k = f"{s['provider']}:{s['model']}:{'ok' if s['ok'] else 'fail'}"
    models[k] = models.get(k, 0) + 1
print(json.dumps({"thread": tid, "seconds": secs, "tool_calls": len(acts), "tools": [a["tool"] for a in acts], "models": models,
                  "replies": [m["body"] for m in msgs if m["role"] == "assistant"]}, indent=1))

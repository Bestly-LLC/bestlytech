"""Model Prober (Pi cron, free, no Claude). Sends every candidate FreeLLM model one tool-calling request plus one
tool-result follow-up, and records pass/fail in public.llm_model_health so Scout's ladder only uses models that
really call tools. Plan: docs/scout-chief-of-staff-opusplan.md section 1.3.

  model_prober.py            probe the vetted candidate list (daily)
  model_prober.py all        probe every 'ready' model that is not on the denylist (slow; on demand)
  model_prober.py <model>... probe just these

A model FAILS if: it answers a tool request with text-encoded calls (<invoke, *_function_call, ```json {"name"...}),
returns no real tool_calls, returns wrong/unparseable arguments, or gives an empty / think-out-loud final answer.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request

import lib

FREELLM = "http://127.0.0.1:3001"
CANDIDATES = [
    "gpt-oss-120b", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite",
    "deepseek-v4-flash", "nemotron-3-super-120b", "nemotron-3-ultra", "qwen3.8-27b", "qwen3-coder-30b-a3b-instruct",
    "qwen3-30b-a3b-instruct-2507", "llama-4-maverick", "llama-4-scout", "command-a-2", "command-a", "poolside-laguna-s-2.1",
    "agnes-2.5-flash", "north-mini-code", "gemma-4-31b-it", "gpt-oss-20b", "kilo-auto", "free-router", "qwen2.5-72b-instruct",
    "kimi-k2-instruct-0905", "qwen3-coder-480b", "glm-4.6", "deepseek-v3.2",
]
DENY = re.compile(r"^(dots|ling-|auto|fusion|claude-|.*note-preview|.*qwen3\.\d+-flash|.*-safety|.*guard|.*nemoguard|.*uncensored|.*heretic|cerebras|pythia|tiny-aya|riva-|llama-3\.2-1b|qwen3\.5-0\.8b|qwen3-0\.6b)", re.I)
TEXT_CALL = re.compile(r"<invoke\b|<\w*function_call>|<tool_call>|\"name\"\s*:\s*\"get_weather\"|NEEDS_TOOLS", re.I)
TOOLS = [{"type": "function", "function": {
    "name": "get_weather", "description": "Get the current weather for a city.",
    "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}]


def post(key, body, timeout=45):
    req = urllib.request.Request(FREELLM + "/v1/chat/completions", data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def probe(key, model):
    t0 = time.time()
    msgs = [{"role": "system", "content": "You are a helpful assistant. Use tools when needed."},
            {"role": "user", "content": "What is the weather in Paris right now? Use the tool."}]
    try:
        j = post(key, {"model": model, "messages": msgs, "tools": TOOLS, "tool_choice": "auto", "max_tokens": 400})
        m = j["choices"][0]["message"]
        tcs = m.get("tool_calls") or []
        content = (m.get("content") or "")
        if not tcs:
            why = "text-encoded tool call" if TEXT_CALL.search(content) else "no tool_calls"
            return False, why, int((time.time() - t0) * 1000)
        fn = tcs[0]["function"]
        args = json.loads(fn.get("arguments") or "{}")
        if str(fn.get("name", "")).replace("functions.", "") != "get_weather" or "paris" not in str(args.get("city", "")).lower():
            return False, "wrong tool or args", int((time.time() - t0) * 1000)
        msgs += [{"role": "assistant", "content": content or "", "tool_calls": tcs},
                 {"role": "tool", "tool_call_id": tcs[0].get("id", "call_1"), "content": json.dumps({"city": "Paris", "temp_f": 61, "sky": "cloudy"})}]
        j2 = post(key, {"model": model, "messages": msgs, "tools": TOOLS, "tool_choice": "auto", "max_tokens": 300})
        m2 = j2["choices"][0]["message"]
        final = (m2.get("content") or "").strip()
        if m2.get("tool_calls") and not final:
            return False, "kept calling tools after result", int((time.time() - t0) * 1000)
        if not final:
            return False, "empty final answer", int((time.time() - t0) * 1000)
        if TEXT_CALL.search(final):
            return False, "tool syntax in answer", int((time.time() - t0) * 1000)
        if "61" not in final and "cloud" not in final.lower():
            return False, "ignored tool result", int((time.time() - t0) * 1000)
        return True, "ok", int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        code = e.code
        return None, f"http {code}", int((time.time() - t0) * 1000)   # None = inconclusive (rate limit / outage), keep old verdict
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {str(e)[:80]}", int((time.time() - t0) * 1000)


def main(argv):
    argv = [a for a in argv if not a.startswith("--")]
    key = lib.rpc("pi_secret", p_name="Scout-FreeLLM")
    r = urllib.request.Request(FREELLM + "/v1/models?execution_status=ready", headers={"Authorization": "Bearer " + key})
    ready = [m["id"] for m in json.load(urllib.request.urlopen(r, timeout=30))["data"] if m.get("execution_status") == "ready"]
    if argv and argv[0] == "all":
        todo = [m for m in ready if not DENY.match(m)]
    elif argv:
        todo = argv
    else:
        todo = [m for m in CANDIDATES if m in ready]
    rows, passed, failed, unsure = [], [], [], []
    for model in todo:
        ok, why, ms = probe(key, model)
        if ok is None:
            time.sleep(2)
            ok, why, ms = probe(key, model)   # one retry for a 429 / hiccup
        if ok is None:
            unsure.append(model)
            continue
        rows.append({"model": model, "ok": ok, "note": why, "ms": ms})
        lib.rpc("llm_model_health_report", p_rows=[rows[-1]])   # report as we go: a slow run must not lose its results
        print(f"  {model}: {'PASS' if ok else 'FAIL'} {why} {ms}ms", flush=True)
        (passed if ok else failed).append(model if ok else f"{model} ({why})")
        time.sleep(1.5)
    # Denylisted models seen as ready are recorded as failed so they show in the table and stay benched.
    for model in ready:
        if DENY.match(model) and model not in ("auto", "fusion") and not model.startswith("claude-"):
            rows.append({"model": model, "ok": False, "note": "denylist", "ms": 0})
    deny_rows = [r for r in rows if r["note"] == "denylist"]
    if deny_rows:
        lib.rpc("llm_model_health_report", p_rows=deny_rows)
    return f"ok probed {len(todo)}: pass {len(passed)} [{', '.join(passed)}]; fail {len(failed)} [{'; '.join(failed)}]; inconclusive {len(unsure)}"

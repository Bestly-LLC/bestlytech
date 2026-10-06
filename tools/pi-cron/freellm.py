"""Free AI ladder for Pi jobs. v2 (2026-10-03, Jared: FreeLLM first): FreeLLM on this Pi (127.0.0.1:3001, 257 free models;
code jobs ask for qwen3-coder-480b first) -> Gemini Flash -> Groq gpt-oss-120b -> Gemini Flash-Lite -> Groq gpt-oss-20b -> Cloudflare.

Same providers Scout's free agent uses (keys in Vault, read via pi_secret). OpenAI-style chat with
native tool calls. Lessons carried over from Scout v29 (bestly_memory house/admin/scout-v29-native-tools):
- declare tools natively, never describe them in prose
- a 429 benches only that model; wait if the wait is short, else move down the ladder
- Cloudflare wants assistant content "" (not null) and reasoning_effort low
- Groq free tier rejects requests over ~8K tokens/min, so callers must keep context small
"""
import json
import re
import time
import urllib.error
import urllib.request

import lib

_keys = {}


def _secret(name):
    if name not in _keys:
        _keys[name] = lib.rpc("pi_secret", p_name=name) or ""
    return _keys[name]


def _secret_optional(name):
    """Like _secret but never raises: a name that is not allowlisted yet, or an RPC hiccup, just means "no key"."""
    try:
        return _secret(name)
    except Exception:  # noqa: BLE001
        _keys[name] = ""
        return ""


FIREWORKS = "https://api.fireworks.ai/inference/v1/chat/completions"  # managed open models on AMD Instinct (AMD dev program credits)
FREELLM = "http://127.0.0.1:3001/v1/chat/completions"  # FreeLLMAPI runs on this Pi (systemd bestly-freellm)


def _ladder(code=False, text=False):
    acct = _secret("cloudflare_account_id")
    gem = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    fl = _secret("Scout-FreeLLM")
    # Fireworks AI (AMD developer program credits). No key in Vault yet -> empty key -> chat() skips the rung, no error.
    fw = ("fireworks:kimi-k3", FIREWORKS, _secret_optional("fireworks_api_key"), "accounts/fireworks/models/kimi-k3")
    # Plain writing (no tools): FreeLLM "auto" often lands on a thinking model that dumps its reasoning
    # into the reply, so name a strong non-reasoning writer first.
    first = (([("freellm:qwen3-coder-480b", FREELLM, fl, "qwen3-coder-480b")] if code else [])
             + ([("freellm:gemini-3.5-flash", FREELLM, fl, "gemini-3.5-flash"),
                 ("freellm:gpt-oss-120b", FREELLM, fl, "gpt-oss-120b"),
                 ("freellm:kimi-k2-instruct", FREELLM, fl, "kimi-k2-instruct-0905")] if text and not code else [])
             + ([fw] if text and not code else [])  # plain writing: right after the named FreeLLM writers
             + [("freellm:auto", FREELLM, fl, "auto")]
             + ([fw] if not (text and not code) else []))  # code / tool calls: only after FreeLLM auto (Kimi K3 does tools)
    return first + [
        # Gemini first: big context and a daily allowance Scout doesn't already spend (Scout leans on Groq).
        ("gemini:flash-latest", gem, _secret("lax_ask_gemini_key"), "gemini-flash-latest"),
        ("groq:gpt-oss-120b", "https://api.groq.com/openai/v1/chat/completions", _secret("groq_api_key"), "openai/gpt-oss-120b"),
        ("gemini:flash-lite-latest", gem, _secret("lax_ask_gemini_key"), "gemini-flash-lite-latest"),
        ("groq:gpt-oss-20b", "https://api.groq.com/openai/v1/chat/completions", _secret("groq_api_key"), "openai/gpt-oss-20b"),
        ("cf:gpt-oss-120b", f"https://api.cloudflare.com/client/v4/accounts/{acct}/ai/v1/chat/completions",
         _secret("cloudflare_ai_token"), "@cf/openai/gpt-oss-120b"),
    ]


_bench = {}  # model label -> unix time it may be used again
_last_call = {}  # model label -> unix time of the last request
MIN_GAP = {"gemini": 6.5}  # seconds between calls per provider
last_errors = []  # why higher rungs were skipped on the last successful call


def _clean(messages):
    out = []
    for m in messages:
        m = dict(m)
        if m.get("role") == "assistant" and m.get("content") is None:
            m["content"] = ""
        m.pop("reasoning", None)
        out.append(m)
    return out


def chat(messages, tools=None, max_tokens=1500, deadline=None, code=False, json_mode=False):
    """Return (assistant_message_dict, provider_label). Raises RuntimeError if every rung fails.
    code=True puts FreeLLM's coding model (qwen3-coder-480b) first.
    json_mode=True asks every rung for a JSON object (response_format) and skips FreeLLM "auto", which can land on a
    model that writes its reasoning instead of the answer."""
    errors = []
    for label, url, key, model in _ladder(code, text=not tools):
        if not key or _bench.get(label, 0) > time.time():
            continue
        if json_mode and label == "freellm:auto":
            continue
        body = {"model": model, "messages": _clean(messages), "temperature": 0.2, "max_tokens": max_tokens}
        if "gpt-oss" in model:
            body["reasoning_effort"] = "low"
        if tools:
            body["tools"], body["tool_choice"] = tools, "auto"
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        for attempt in range(2):
            if deadline and time.time() > deadline:
                raise RuntimeError("free AI deadline reached")
            # Gemini's free tier allows ~10 requests/min per model: space calls out instead of tripping it.
            gap = MIN_GAP.get(label.split(":")[0], 0) - (time.time() - _last_call.get(label, 0))
            if gap > 0:
                time.sleep(gap)
            _last_call[label] = time.time()
            # Groq sits behind Cloudflare, which 403s (error 1010) Python's default user-agent.
            req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
                "Authorization": "Bearer " + key, "Content-Type": "application/json",
                "User-Agent": "bestly-pi-cron/1.0 (+https://bestly.tech)"})
            try:
                # FreeLLM rungs get 40 s: a slow upstream should fall through to the next rung, not stall a job.
                with urllib.request.urlopen(req, timeout=40 if label.startswith("freellm") else 120) as r:
                    j = json.load(r)
                msg = (j.get("choices") or [{}])[0].get("message") or {}
                if msg.get("content") and "</think>" in msg["content"]:
                    msg["content"] = msg["content"].split("</think>")[-1].strip()
                if not msg.get("content") and not msg.get("tool_calls"):
                    errors.append(f"{label}: empty reply")
                    break
                global last_errors
                last_errors = errors
                return msg, label
            except urllib.error.HTTPError as e:
                text = e.read().decode()[:800]
                if e.code in (429, 503) and label.startswith("freellm"):
                    # FreeLLM: "All models exhausted ... Soonest reset ~87s / ~21h". Never sleep on it: bench the
                    # model for that long (max 1 h) and go down the ladder at once.
                    m = re.search(r"reset ~(\d+)([smh])", text)
                    secs = int(m.group(1)) * {"s": 1, "m": 60, "h": 3600}[m.group(2)] if m else 600
                    _bench[label] = time.time() + min(max(secs, 60), 3600)
                    errors.append(f"{label}: HTTP {e.code} {text[:120]}")
                    break
                if e.code == 429:
                    # Groq: "try again in 7.5s"; Gemini: "Please retry in 17.9s" / retryDelay "17s"
                    m = re.search(r"(?:try again|retry) in ([\d.]+)(m?s)", text) or re.search(r'retryDelay"?:\s*"([\d.]+)(s)', text)
                    wait = float(m.group(1)) / (1000 if m and m.group(2) == "ms" else 1) if m else 60
                    daily = ("per day" in text) or ("daily" in text) or ("quota" in text and not m)
                    if wait <= 65 and attempt == 0 and not daily and (not deadline or time.time() + wait < deadline):
                        time.sleep(wait + 1)
                        continue
                    _bench[label] = time.time() + (3600 if daily else wait)
                if label.startswith("fireworks") and e.code in (401, 402, 403):
                    _bench[label] = time.time() + 3600  # bad key / credits spent: stop asking for an hour
                errors.append(f"{label}: HTTP {e.code} {text[:160]}")
                break
            except Exception as e:  # noqa: BLE001
                errors.append(f"{label}: {e}")
                if label.startswith("freellm:qwen3-coder") and "timed out" in str(e):
                    _bench[label] = time.time() + 600  # coder model slow right now: skip it for 10 min
                break
    raise RuntimeError("all free models failed: " + " | ".join(errors))

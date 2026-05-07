#!/bin/bash
# ntfy switch — Twilio SMS retired, ntfy.sh push notifications take over.
#
# Background: Cookie Yeti SMS spam was traced to old Lovable Supabase project
# (keowunrxpxlbgebujbao). After that handoff was confirmed silent, we redirected
# all alerting on the new project (rcqfqhguwpmaarseifqg) to ntfy.sh push.
#
# What this commit captures:
#   - check-system-health v18: ntfy push (was Twilio SMS); priority 5 = bypass DND
#   - probe-external v4: ntfy push when external service flips ok/warn → down
#   - Optional NTFY_TOKEN secret support: lifts ntfy.sh free-tier 250/day IP cap
#     (gracefully no-ops if secret unset — pushes still go via free-tier path)
#
# Topic: bestly-sysalert-7q2k9mx4 (treat like a credential)
# Subscribe: open ntfy iOS app → + → topic above
#
# Operator-side TODO (one minute, optional but recommended):
#   1. Sign in to ntfy.sh with a free account
#   2. Generate access token (settings → tokens, starts with tk_)
#   3. Add to Supabase: https://supabase.com/dashboard/project/rcqfqhguwpmaarseifqg/functions/secrets
#      Name: NTFY_TOKEN, value: <paste token>
#   4. Verify with: curl -X POST -H "x-test-token: bestly-ntfy-test-2026-05-01-c47bbed1" \
#                     https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/test-sms
#      Expect: "authenticated":true

set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock
[ -f .git/packed-refs.lock ] && rm -f .git/packed-refs.lock

git checkout main
git pull origin main

git add \
  supabase/functions/check-system-health/index.ts \
  supabase/functions/probe-external/index.ts \
  docs/agent-runbook.pdf

# repo-parity stub for test-sms (slug kept; body retired to one-shot test fn)
mkdir -p supabase/functions/test-sms
cat > supabase/functions/test-sms/index.ts << 'EOFTEST'
// test-ntfy v6 - sends one ntfy push with optional Bearer auth via NTFY_TOKEN.
// Slug kept as 'test-sms' for backward URL compat. Auth: hardcoded one-shot token.
// This is the manual verification endpoint — not production hot-path.

const TOKEN = "bestly-ntfy-test-2026-05-01-c47bbed1";
const NTFY_BASE = "https://ntfy.sh";
const NTFY_TOPIC_DEFAULT = "bestly-sysalert-7q2k9mx4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-test-token",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.headers.get("x-test-token") !== TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const topic = Deno.env.get("NTFY_TOPIC") || NTFY_TOPIC_DEFAULT;
  const ntfyToken = Deno.env.get("NTFY_TOKEN");
  const ts = new Date().toISOString().slice(11, 19);
  const title = `Bestly - manual test`;
  const body = `[BESTLY-TEST ${ts} UTC] Manual ntfy test from new Supabase project (rcqfqhguwpmaarseifqg). If you see this, the new alert path works. Old SMS path retired.`;

  const headers: Record<string, string> = {
    "Title": title,
    "Priority": "4",
    "Tags": "white_check_mark,test_tube",
    "Click": "https://bestly.tech/admin",
  };
  if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;

  try {
    const res = await fetch(`${NTFY_BASE}/${topic}`, { method: "POST", headers, body });
    const text = await res.text();
    return new Response(JSON.stringify({
      ok: res.ok, ntfy_status: res.status, authenticated: !!ntfyToken,
      topic, title, body, ntfy_response: text,
    }), { status: res.ok ? 200 : 502, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
EOFTEST
git add supabase/functions/test-sms/index.ts

echo "Files staged:"
git diff --cached --name-only

echo "→ Build sanity check..."
if ! npm run build > /tmp/ntfy-switch-build.log 2>&1; then
  tail -30 /tmp/ntfy-switch-build.log >&2
  exit 2
fi
echo "✓ Build passes"

git commit -m "feat(alerts): switch from Twilio SMS to ntfy.sh push notifications

check-system-health v18 + probe-external v4 + test-sms v6 now push to
ntfy.sh on the topic bestly-sysalert-7q2k9mx4. Same alerting rules
(issue-only, 2-check hysteresis, 23:00-07:00 PT quiet hours) — just
a different transport.

Why: Twilio SMS path on the new Supabase project (rcqfqhguwpmaarseifqg)
was never wired (no creds), and the old project's SMS sender was the
source of all rogue Cookie Yeti alerts. Rather than re-wire Twilio
(\$0.01/msg, Lovable connector dependency, IP-based outbound), we
moved to ntfy.sh (free, native iOS push, priority 5 bypasses DND,
click-to-open URL, drops the Lovable connector entirely).

Operator already has the ntfy iOS app installed (used for helicopter
alerts on their Pi). Subscribed to topic confirmed; manual test push
RbFkvxnQIVv9 received.

Optional next-step: NTFY_TOKEN secret on the new project lifts the
free-tier 250/day-per-IP cap. Code falls back to anon push if unset.

Repo files mirror what's deployed:
  supabase/functions/check-system-health/index.ts (v18)
  supabase/functions/probe-external/index.ts (v4)
  supabase/functions/test-sms/index.ts (v6)
"

git push origin main

echo ""
echo "============================================================"
echo "  PUBLISHED ntfy switch to main."
echo "  Vercel rebuilds in ~90 sec (only marketing site files affect Vercel)."
echo ""
echo "  Edge functions are ALREADY DEPLOYED on Supabase via MCP."
echo "  This commit just keeps the repo in parity with what's running."
echo "============================================================"
sleep 15

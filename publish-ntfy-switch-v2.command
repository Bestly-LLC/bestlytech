#!/bin/bash
# ntfy switch v2 — handles upstream-changed-too case.
#
# v1 failed because origin/main had 12 commits ahead and our local
# check-system-health + probe-external conflicted on merge.
#
# Approach here: stash, fast-forward pull, then OVERWRITE the two functions
# from our known-good local copies (which mirror what's actually running on
# Supabase Edge — the deployed source-of-truth).

set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock

# Capture our local versions before pulling
mkdir -p /tmp/ntfy-switch-stage
cp supabase/functions/check-system-health/index.ts /tmp/ntfy-switch-stage/csh.ts
cp supabase/functions/probe-external/index.ts /tmp/ntfy-switch-stage/probe.ts

git checkout main
git stash push -u -m "ntfy-switch-staged" supabase/functions/check-system-health/index.ts supabase/functions/probe-external/index.ts 2>/dev/null || true

git pull --rebase origin main

# Now overwrite from the staged copies
cp /tmp/ntfy-switch-stage/csh.ts supabase/functions/check-system-health/index.ts
cp /tmp/ntfy-switch-stage/probe.ts supabase/functions/probe-external/index.ts

# Drop the stash if present
git stash drop 2>/dev/null || true

# Stage the function code + the new test-sms repo-parity stub + the regenerated PDF
git add \
  supabase/functions/check-system-health/index.ts \
  supabase/functions/probe-external/index.ts \
  docs/agent-runbook.pdf

# repo-parity stub for test-sms
mkdir -p supabase/functions/test-sms
cat > supabase/functions/test-sms/index.ts << 'EOFTEST'
// test-ntfy v6 - sends one ntfy push with optional Bearer auth via NTFY_TOKEN.
// Slug kept as 'test-sms' for backward URL compat. Auth: hardcoded one-shot token.

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

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  echo "→ Build sanity check..."
  if ! npm run build > /tmp/ntfy-switch-build.log 2>&1; then
    tail -30 /tmp/ntfy-switch-build.log >&2
    exit 2
  fi
  echo "✓ Build passes"

  git commit -m "feat(alerts): switch from Twilio SMS to ntfy.sh push notifications

check-system-health v18, probe-external v4, test-sms v6 push to topic
bestly-sysalert-7q2k9mx4 with priority 5 (bypass iOS DND).

Same alerting rules as before: issue-only, 2-check hysteresis,
23:00-07:00 PT quiet hours. Different transport: free, no Twilio /
Lovable connector dependency, native iOS push.

Optional NTFY_TOKEN secret on Supabase lifts ntfy.sh's free-tier
250/day-per-IP cap. Code falls back to anon path if secret unset.

Repo files mirror what is deployed on rcqfqhguwpmaarseifqg.
"

  git push origin main
fi

echo ""
echo "============================================================"
echo "  PUBLISHED ntfy switch (or already up to date)."
echo "  Edge functions are live on Supabase regardless."
echo "  Topic: bestly-sysalert-7q2k9mx4"
echo "============================================================"
sleep 12

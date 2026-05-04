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

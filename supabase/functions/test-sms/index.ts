// test-ntfy v6 - sends one ntfy push with optional Bearer auth via NTFY_TOKEN.
// Slug kept as 'test-sms' for backward URL compat. Auth: hardcoded one-shot token.

import { corsWith } from "../_shared/cors.ts";
import { pushNtfy, resolveNtfyTopic } from "../_shared/ntfy.ts";

const TOKEN = "bestly-ntfy-test-2026-05-01-c47bbed1";

const cors = corsWith({ headers: "authorization, x-client-info, apikey, content-type, x-test-token" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.headers.get("x-test-token") !== TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const topic = resolveNtfyTopic();
  const ntfyToken = Deno.env.get("NTFY_TOKEN");
  const ts = new Date().toISOString().slice(11, 19);
  const title = `Bestly - manual test`;
  const body = `[BESTLY-TEST ${ts} UTC] Manual ntfy test from new Supabase project (rcqfqhguwpmaarseifqg). If you see this, the new alert path works. Old SMS path retired.`;

  const res = await pushNtfy({
    title,
    body,
    topic,
    priority: 4,
    tags: "white_check_mark,test_tube",
    click: "https://bestly.tech/admin",
  });
  // pushNtfy never throws; status 0 means the request never reached ntfy.
  if (res.status === 0) {
    return new Response(JSON.stringify({ error: res.text }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({
    ok: res.ok, ntfy_status: res.status, authenticated: !!ntfyToken,
    topic, title, body, ntfy_response: res.text,
  }), { status: res.ok ? 200 : 502, headers: { ...cors, "Content-Type": "application/json" } });
});

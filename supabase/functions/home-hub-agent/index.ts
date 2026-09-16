// Home Hub on-prem agent endpoint.
//
// The Pi has no inbound route from the internet, so control is a queue rather than
// a direct call: the admin enqueues a row in home_hub_commands, the agent running
// on the LAN polls this function, executes locally, and posts the result back.
// Nothing in the browser ever touches the LAN.
//
// Auth: shared secret in x-api-key (HOME_HUB_AGENT_KEY). Not the anon key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const presented = req.headers.get("x-api-key");
  if (!presented) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // The key lives in Vault so it never has to be pasted into function settings.
  // An env var still wins if one is set, for local runs.
  const expected =
    Deno.env.get("HOME_HUB_AGENT_KEY") ??
    (await supabase.rpc("get_home_hub_agent_key")).data;
  if (!expected) return json({ error: "Server not configured" }, 500);
  if (presented !== expected) return json({ error: "Unauthorized" }, 401);

  const op = String(body.op ?? "");
  const agent = String(body.agent ?? "home-hub");

  const beat = async () => {
    await supabase.from("home_hub_agent_state").upsert({
      agent,
      last_seen_at: new Date().toISOString(),
      version: body.version ? String(body.version) : null,
      info: (body.info as Record<string, unknown>) ?? null,
    });
  };

  if (op === "heartbeat") {
    await beat();
    return json({ ok: true });
  }

  // Claim up to `max` pending commands and hand them to this agent.
  if (op === "poll") {
    await beat();
    await supabase.rpc("expire_stale_home_hub_commands");

    const max = Math.min(Number(body.max ?? 5) || 5, 20);
    const { data: pending, error: selErr } = await supabase
      .from("home_hub_commands")
      .select("id, target, action, payload")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(max);

    if (selErr) return json({ error: selErr.message }, 500);
    if (!pending?.length) return json({ commands: [] });

    const ids = pending.map((c) => c.id);
    const { data: claimed, error: claimErr } = await supabase
      .from("home_hub_commands")
      .update({ status: "running", claimed_at: new Date().toISOString() })
      .in("id", ids)
      .eq("status", "pending")
      .select("id, target, action, payload");

    if (claimErr) return json({ error: claimErr.message }, 500);
    return json({ commands: claimed ?? [] });
  }

  // Report the outcome of one command.
  if (op === "result") {
    await beat();
    const id = String(body.id ?? "");
    if (!id) return json({ error: "Missing id" }, 400);

    const ok = body.status === "done";
    const { error } = await supabase
      .from("home_hub_commands")
      .update({
        status: ok ? "done" : "failed",
        result: ok ? ((body.result as Record<string, unknown>) ?? {}) : null,
        error: ok ? null : String(body.error ?? "Agent reported failure"),
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: `Unknown op: ${op}` }, 400);
});

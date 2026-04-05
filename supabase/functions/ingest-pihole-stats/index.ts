import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = req.headers.get("x-api-key");
  const expected = Deno.env.get("PIHOLE_INGEST_KEY");
  if (!apiKey || apiKey !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { status, total_queries, queries_blocked, percent_blocked, domains_on_blocklist, active_clients, top_permitted, top_blocked, query_types, hourly_chart } = body;

  if (typeof status !== "string" || typeof total_queries !== "number" || typeof queries_blocked !== "number" || typeof percent_blocked !== "number" || typeof domains_on_blocklist !== "number" || typeof active_clients !== "number") {
    return new Response(JSON.stringify({ error: "Missing or invalid required fields: status (string), total_queries, queries_blocked, percent_blocked, domains_on_blocklist, active_clients (numbers)" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase.from("home_hub_pihole_stats").insert({
    status,
    total_queries,
    queries_blocked,
    percent_blocked,
    domains_on_blocklist,
    active_clients,
    top_permitted: top_permitted ?? null,
    top_blocked: top_blocked ?? null,
    query_types: query_types ?? null,
    hourly_chart: hourly_chart ?? null,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

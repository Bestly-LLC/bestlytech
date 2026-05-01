const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-maintenance-secret",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  return new Response(
    JSON.stringify({
      status: "retired",
      forwarded_to: "rcqfqhguwpmaarseifqg",
      retired_on: "2026-05-01",
      message: "This Lovable project has been retired. See the new Supabase project (rcqfqhguwpmaarseifqg) managed via the bestlytech repo.",
    }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
  );
});

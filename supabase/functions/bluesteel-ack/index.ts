// Street-sweeping alert acknowledgment for Blue Steel.
// Auth: unguessable key in the URL (?k=...). Only effect: calls public.bluesteel_sweep_ack,
// which records the ack (stops the remaining alerts) and sends one confirmation push via pg_net
// (ntfy.sh rate-limits the shared edge IPs, but the database's outbound IP works).
// Deployed with verify_jwt = false: the ntfy iOS app can't attach a Supabase JWT to a tap.
const KEY = "tR4c_gX-TGd7_acCgz0cI_EA";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("k") !== KEY) return new Response("Not found", { status: 404 });
  const via = (url.searchParams.get("via") ?? "tap").slice(0, 20);

  let ok = false;
  let detail = "";
  try {
    const base = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const r = await fetch(`${base}/rest/v1/rpc/bluesteel_sweep_ack`, {
      method: "POST",
      headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_via: via }),
    });
    ok = r.ok;
    if (!ok) detail = ` (${r.status})`;
  } catch (e) {
    detail = ` (${e})`;
  }

  const msg = ok
    ? "GOT IT. Blue Steel sweeping alerts are off for this morning. You can close this."
    : `DIDN'T GO THROUGH${detail}. Tap again, or just move the car.`;
  return new Response(msg, {
    status: ok ? 200 : 502,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
});

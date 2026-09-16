// Street-sweeping alert acknowledgment for Blue Steel.
// Auth: unguessable key in the URL (?k=...). The key lives in Vault (secret "bluesteel_ack_key"),
// read through the service-role-only RPC public.bluesteel_ack_key(), so it is not in git.
// Only effect: calls public.bluesteel_sweep_ack, which records the ack (stops the remaining alerts)
// and sends one confirmation push via pg_net.
// Deployed with verify_jwt = false: the ntfy iOS app can't attach a Supabase JWT to a tap.

const base = Deno.env.get("SUPABASE_URL")!;
const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svcHeaders = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

let cachedKey: string | null = null;
async function ackKey(): Promise<string | null> {
  if (cachedKey) return cachedKey;
  const r = await fetch(`${base}/rest/v1/rpc/bluesteel_ack_key`, { method: "POST", headers: svcHeaders, body: "{}" });
  if (!r.ok) return null;
  const k = await r.json();
  if (typeof k === "string" && k.length >= 16) cachedKey = k;
  return cachedKey;
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const given = url.searchParams.get("k") ?? "";
  const key = await ackKey();
  if (!key) return text("DIDN'T GO THROUGH (key unavailable). Tap again, or just move the car.", 502);
  if (!given || !sameString(given, key)) return text("Not found", 404);
  const via = (url.searchParams.get("via") ?? "tap").slice(0, 20);

  let ok = false;
  let detail = "";
  try {
    const r = await fetch(`${base}/rest/v1/rpc/bluesteel_sweep_ack`, {
      method: "POST",
      headers: svcHeaders,
      body: JSON.stringify({ p_via: via }),
    });
    ok = r.ok;
    if (!ok) detail = ` (${r.status})`;
  } catch (e) {
    detail = ` (${e})`;
  }

  return ok
    ? text("GOT IT. Blue Steel sweeping alerts are off for this morning. You can close this.", 200)
    : text(`DIDN'T GO THROUGH${detail}. Tap again, or just move the car.`, 502);
});

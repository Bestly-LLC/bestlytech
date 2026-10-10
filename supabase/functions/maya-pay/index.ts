// maya-pay: bestly.tech/pay/<token> -> a fresh Stripe Billing Portal session for the customer the link was made for.
// Maya's send_pay_link tool emails the link. The Stripe session is created when the link is opened, so it never
// goes stale in the inbox. A token is tied to one customer, lasts 24 hours and opens at most 5 times.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const text = (s: string, status: number) => new Response(s, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const GONE = "This link has expired. Call Bestly at (213) 641-0074 and Maya can send you a new one.";

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const token = (u.searchParams.get("t") ?? u.pathname.split("/").filter(Boolean).pop() ?? "").toLowerCase();
  if (!/^[a-z0-9]{10,32}$/.test(token)) return text("Not found", 404);

  const { data: row } = await sb.from("maya_pay_links").select("*").eq("token", token).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now() || row.uses >= 5) return text(GONE, 410);
  // Count the open first, only if it is still under the limit, so two quick opens cannot both pass.
  const { data: bumped } = await sb.from("maya_pay_links").update({ uses: row.uses + 1 }).eq("token", token).eq("uses", row.uses).select("token");
  if (!bumped?.length) return text(GONE, 410);

  let key = "";
  try { const { data } = await sb.rpc("stripe_secret", { p_name: "stripe_secret_key" }); if (typeof data === "string") key = data; } catch (_) { /* env fallback */ }
  if (!key) key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!key) return text("Something went wrong. Call Bestly at (213) 641-0074.", 500);

  const r = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ customer: row.stripe_customer_id, return_url: "https://bestly.tech" }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.url) {
    await sb.rpc("bestly_raise", { p_key: "maya.billing", p_kind: "problem", p_severity: "warning", p_title: "Maya: a card-update link would not open", p_body: `Stripe ${r.status} ${String(j?.error?.message ?? "").slice(0, 150)}`, p_area: "maya" }).then(() => {}, () => {});
    return text("Something went wrong. Call Bestly at (213) 641-0074 and Maya will help.", 502);
  }
  return new Response(null, { status: 302, headers: { Location: String(j.url), "Cache-Control": "no-store" } });
});

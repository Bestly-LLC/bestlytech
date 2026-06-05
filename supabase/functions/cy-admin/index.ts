// CY-ADMIN-02: Admin-gated proxy to the Cookie Yeti PRODUCTION project
// (keowunrx...). The website project (this one) holds admin auth via
// user_roles/has_role; production holds the real CY data behind RLS.
//
// Flow: verify the caller is an authenticated admin on THIS project, then
// use the production service-role key (stored as the CY_PROD_SERVICE_KEY
// function secret — never in the repo) to perform RLS-restricted reads and
// grant/revoke writes against production via its REST API.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CY_PROD_URL = "https://keowunrxpxlbgebujbao.supabase.co";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function prodFetch(path: string, serviceKey: string, init: RequestInit = {}) {
  const res = await fetch(`${CY_PROD_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1. Verify caller is an authenticated admin on THIS (website) project.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const localUrl = Deno.env.get("SUPABASE_URL")!;
  const localAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authed = createClient(localUrl, localAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authed.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

  const { data: isAdmin } = await authed.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  if (!isAdmin) return json({ error: "forbidden" }, 403);

  // 2. Production service key (function secret).
  const serviceKey = Deno.env.get("CY_PROD_SERVICE_KEY");
  if (!serviceKey) {
    return json(
      { error: "not_configured", message: "CY_PROD_SERVICE_KEY secret is not set on this function." },
      503,
    );
  }

  // 3. Dispatch.
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action ?? "");

  try {
    if (action === "list_granted") {
      const r = await prodFetch(
        "granted_access?select=*&order=created_at.desc",
        serviceKey,
      );
      return json({ ok: r.ok, data: r.data }, r.ok ? 200 : 502);
    }

    if (action === "grant") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const reason = String(body.reason ?? "admin grant");
      if (!email || !email.includes("@")) return json({ error: "invalid_email" }, 400);
      const r = await prodFetch("granted_access", serviceKey, {
        method: "POST",
        headers: { Prefer: "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify({ email, reason }),
      });
      return json({ ok: r.ok, data: r.data }, r.ok ? 200 : 502);
    }

    if (action === "revoke") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!email) return json({ error: "invalid_email" }, 400);
      const r = await prodFetch(
        `granted_access?email=eq.${encodeURIComponent(email)}`,
        serviceKey,
        { method: "DELETE", headers: { Prefer: "return=representation" } },
      );
      return json({ ok: r.ok, data: r.data }, r.ok ? 200 : 502);
    }

    if (action === "list_activation_codes") {
      const r = await prodFetch(
        "activation_codes?select=*&order=created_at.desc&limit=100",
        serviceKey,
      );
      return json({ ok: r.ok, data: r.data }, r.ok ? 200 : 502);
    }

    return json({ error: "unknown_action", action }, 400);
  } catch (e) {
    return json({ error: "proxy_error", message: String(e) }, 500);
  }
});

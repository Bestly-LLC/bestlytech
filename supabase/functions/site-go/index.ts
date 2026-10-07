// site-go — bestly.tech/s/<slug> short links for sites the Code Worker builds. GET -> 302 to the live site.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const keys = (() => { try { return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as string[]; } catch { return [] as string[]; } })();
const SB_SECRET = keys[0] ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
Deno.serve(async (req) => {
  const u = new URL(req.url);
  const slug = (u.searchParams.get("s") ?? u.pathname.split("/").filter(Boolean).pop() ?? "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) return new Response("Not found", { status: 404 });
  const { data: url } = await db.rpc("site_link_get", { p_slug: slug });
  if (!url) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: String(url), "Cache-Control": "no-store" } });
});

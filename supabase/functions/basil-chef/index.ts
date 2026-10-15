// basil-chef — the Kitchen page's "Ask the chef" (Jared, 2026-10-15). Admin JWT or the service key.
// POST { ask?: string, count?: 1-4 }
//   -> { ok, recipes: [{ name, how, chef_note, minutes, serves, omni, omni_why }], spoken (Hey Scout), markdown, model }
// The chef lives in _shared/chef.ts (free AI only); recipes land in pantry_recipes, so the page opens them with the
// usual recipe view and cook mode. Scout chat (kitchen_chef tool) and Hey Scout (voice-ask) call the same module.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { SECRET_KEY, isServiceRequest } from "../_shared/keys.ts";
import { corsWith } from "../_shared/cors.ts";
import { chefCook, chefMarkdown, chefSpoken } from "../_shared/chef.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRET_KEY!, { auth: { persistSession: false } });
const CORS = corsWith({ headers: "authorization, content-type, apikey, x-client-info", methods: "POST, OPTIONS" });
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  if (!(await isServiceRequest(req))) {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const { data: who } = jwt ? await db.auth.getUser(jwt) : { data: null };
    const uid = who?.user?.id;
    if (!uid) return J({ ok: false, error: "unauthorized" }, 401);
    const { data: isAdmin } = await db.rpc("has_role", { _user_id: uid, _role: "admin" });
    if (!isAdmin) return J({ ok: false, error: "admin only" }, 403);
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  try {
    const r = await chefCook(db, { ask: String(body.ask ?? ""), count: Number(body.count) || 3, job: "basil-chef", deadlineMs: 70_000 });
    return J({
      ok: true, model: r.model, spoken: chefSpoken(r), markdown: chefMarkdown(r),
      recipes: r.recipes.map((x) => ({ name: x.name, how: x.how, chef_note: x.chef_note, minutes: x.minutes, serves: x.serves,
        omni: !!x.omni_steps, omni_why: x.omni_why ?? "" })),
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const busy = /free-llm|all_failed|budget|paid_never/i.test(msg);
    return J({ ok: false, error: busy ? "The free chefs are all busy. Try again in a minute." : msg }, busy ? 503 : 500);
  }
});

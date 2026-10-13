// agent-onboard: the setup questions a buyer answers after paying for Bestly Agent (/agent/welcome?o=<token>).
// Token-bound like cloud-intake (docs/maya-sales-opusplan.md, part 7). The 48-hex token lives on the agent_orders row and is the only credential.
//
//   GET   ?token=<>                         -> { ok, order }  plan, company, status and the saved answers (never the email, phone or Stripe ids)
//   PATCH { token, data: { ...answers } }   -> auto-save: merges the answers it knows, ignores the rest. Only while status is "paid".
//   POST  { token }                         -> submit: status becomes setup_done; the answers are locked and Maya tells Jared.
//
// While the Stripe webhook has not marked the order paid yet (status checkout_started), GET says so and the page waits for it.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";
import { AGENT_PLANS, isPlanId, dollars } from "../_shared/agent-plans.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_KEY: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const cors = corsWith({ headers: "authorization, x-client-info, apikey, content-type", methods: "GET, POST, PATCH, OPTIONS" });
const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => out({ ok: false, error, ...extra }, status);

const TOKEN_RE = /^[0-9a-f]{48}$/;
const MAX_BODY = 40_000;

// ---- the answers we accept (anything else is dropped) ----
type Kind = "text" | "long" | "pick" | "multi" | "list";
const FIELDS: Record<string, { kind: Kind; max: number; options?: string[]; items?: number }> = {
  company: { kind: "text", max: 120 },
  website: { kind: "text", max: 200 },
  current_phone: { kind: "text", max: 40 },
  phone_plan: { kind: "pick", max: 20, options: ["forward", "new"] },
  hours: { kind: "long", max: 400 },
  timezone: { kind: "text", max: 60 },
  call_goal: { kind: "multi", max: 20, options: ["book", "message", "ticket", "transfer"] },
  transfer_name: { kind: "text", max: 100 },
  transfer_phone: { kind: "text", max: 40 },
  apps: { kind: "list", max: 60, items: 40 },
  faqs: { kind: "long", max: 4000 },
  never: { kind: "long", max: 2000 },
  voice: { kind: "pick", max: 20, options: ["warm", "calm", "upbeat"] },
  agent_name: { kind: "text", max: 60 },
};
const REQUIRED: [string, string][] = [["company", "business name"], ["current_phone", "the phone number callers use"], ["call_goal", "what most calls should end in"]];

const oneLine = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const multiLine = (s: unknown, n: number) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);

function cleanValue(key: string, v: unknown): string | string[] | null | undefined {
  const f = FIELDS[key];
  if (!f) return undefined;
  switch (f.kind) {
    case "text": { const s = oneLine(v, f.max); return s || null; }
    case "long": { const s = multiLine(v, f.max); return s || null; }
    case "pick": { const s = oneLine(v, f.max).toLowerCase(); return f.options!.includes(s) ? s : null; }
    case "multi": {
      const arr = (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => oneLine(x, f.max).toLowerCase()).filter((x) => f.options!.includes(x));
      const uniq = [...new Set(arr)];
      return uniq.length ? uniq : null;
    }
    case "list": {
      const arr = (Array.isArray(v) ? v : String(v ?? "").split(/[,\n;]/)).map((x) => oneLine(x, f.max)).filter(Boolean);
      const uniq = [...new Set(arr)].slice(0, f.items ?? 20);
      return uniq.length ? uniq : null;
    }
  }
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try { const j = JSON.parse(text); return j && typeof j === "object" && !Array.isArray(j) ? j : null; } catch { return null; }
}

type Order = { id: string; plan: string; status: string; company: string | null; name: string | null; setup: Record<string, unknown> | null; setup_done_at: string | null; kickoff_at: string | null; paid_at: string | null };
const COLS = "id, plan, status, company, name, setup, setup_done_at, kickoff_at, paid_at";

async function load(token: unknown): Promise<{ order: Order } | Response> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return bad("not found", 404);
  const { data, error } = await sb.from("agent_orders").select(COLS).eq("token", token).maybeSingle();
  if (error) return bad("could not load", 500);
  if (!data) return bad("not found", 404);
  return { order: data as Order };
}

function view(o: Order) {
  const plan = AGENT_PLANS.find((p) => p.id === o.plan);
  return {
    plan: o.plan,
    plan_name: plan?.name ?? "Bestly Agent",
    price: plan ? `${dollars(plan.monthlyCents)} a month` : null,
    company: o.company,
    first_name: (o.name ?? "").split(" ")[0] || null,
    status: o.status,
    setup: o.setup ?? {},
    setup_done_at: o.setup_done_at,
    kickoff_at: o.kickoff_at,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  // ---- GET ----
  if (req.method === "GET") {
    const r = await load(new URL(req.url).searchParams.get("token"));
    if (r instanceof Response) return r;
    return out({ ok: true, order: view(r.order) });
  }

  if (req.method !== "PATCH" && req.method !== "POST") return bad("method not allowed", 405);
  const body = await readBody(req);
  if (!body) return bad("That request wasn't readable.");
  const r = await load(body.token);
  if (r instanceof Response) return r;
  const o = r.order;

  if (o.status === "checkout_started") return bad("Payment is still confirming.", 409, { status: o.status });
  if (o.status !== "paid" && o.status !== "setup_done") return bad("This order is no longer active.", 409, { status: o.status });

  // ---- PATCH: auto-save ----
  if (req.method === "PATCH") {
    if (o.status === "setup_done") return bad("already submitted", 409, { status: o.status });
    const data = body.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return bad("data must be an object");
    const next: Record<string, unknown> = { ...(o.setup ?? {}) };
    let saved = 0;
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const c = cleanValue(k, v);
      if (c === undefined) continue; // not a question we ask
      if (c === null) delete next[k]; else next[k] = c;
      saved++;
    }
    const { error } = await sb.from("agent_orders").update({ setup: next }).eq("id", o.id).eq("status", "paid");
    if (error) { console.error("agent-onboard: save failed", error.code); return bad("could not save", 500); }
    return out({ ok: true, saved });
  }

  // ---- POST: submit ----
  if (o.status === "setup_done") return out({ ok: true, already: true });
  const setup = o.setup ?? {};
  const missing = REQUIRED.filter(([k]) => {
    const v = setup[k];
    return v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === "");
  }).map(([, label]) => label);
  if (missing.length) return bad(`Please add ${missing.join(", ")}.`, 422, { missing });

  const { data: done, error } = await sb.from("agent_orders")
    .update({ status: "setup_done", setup_done_at: new Date().toISOString() })
    .eq("id", o.id).eq("status", "paid").select("id");
  if (error) { console.error("agent-onboard: submit failed", error.code); return bad("could not submit", 500); }
  if (!done?.length) return out({ ok: true, already: true }); // a second tap landed first

  const plan = isPlanId(o.plan) ? AGENT_PLANS.find((p) => p.id === o.plan) : null;
  try {
    await sb.rpc("maya_sales_note", {
      p_title: `Setup answers are in: ${o.company ?? "a new customer"}${plan ? ` (${plan.name})` : ""}`,
      p_body: "They finished the Bestly Agent setup questions. Build their agent, then book the practice calls.",
      p_url: "/admin/maya", p_dedupe: `agent-setup-${o.id}`, p_push: false,
    });
  } catch (_) { /* a note must never fail the submit */ }
  return out({ ok: true });
});

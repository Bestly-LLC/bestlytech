// Cookie Yeti — guided fix wizard backend (admin only).
//
// POST /functions/v1/cy-guide   Authorization: Bearer <admin session JWT>
//   { action: "inspect", domain, url?, steps?, viewport? }  screenshot + clickable boxes after replaying steps
//   { action: "test",    domain, url?, steps,  viewport? }  replay every click, did the banner go away?
//   { action: "save",    domain, url?, steps,  viewport?, force? }
//        re-tests server-side (never trusts the browser), then stores the pattern and closes the report.
//
// steps = [{ selector, action }]; every step but the last is "next", the last is what the click does
// (accept | reject | necessary | save | close). The robot browser key never reaches the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const RENDER_URL = Deno.env.get("CY_RENDER_URL") ?? "https://www.bestly.tech/api/cy-render";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FINAL_ACTIONS = new Set(["accept", "reject", "necessary", "save", "close"]);

type Step = { selector: string; action?: string };

// First match wins, so the order matters ("Reject non-essential" is a reject, "Necessary only" isn't).
const GUESSES: [string, RegExp][] = [
  ["reject", /reject|decline|deny|refuse|disagree|opt.?out|do not (sell|share)|without accepting|continue without|ablehnen|refuser|rechazar|rifiuta|weiger|avvisa/i],
  ["necessary", /necessary|essential|required only|strictly|notwendig|nécessaires|necesarias/i],
  ["save", /save|confirm (my )?(choice|selection|preference)|submit preference|speichern|enregistrer|guardar/i],
  ["close", /^(close|dismiss|no thanks|×|x|✕)$|close (banner|dialog|notice|preference)/i],
  ["next", /manage|setting|preference|option|customi[sz]e|more info|choices|einstellungen|paramètres|personnaliser|configurar/i],
  ["accept", /accept|agree|allow|got it|^ok(ay)?$|i understand|akzeptieren|accepter|aceptar|zustimmen|accetta/i],
];
const guess = (text: string) => GUESSES.find(([, re]) => re.test(text.trim()))?.[0] ?? null;

async function isAdmin(req: Request, svc: any): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) return false;
  const { data } = await svc.auth.getUser(token);
  if (!data?.user) return false;
  const { data: ok } = await svc.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return ok === true;
}

async function engine(key: string, body: Record<string, unknown>) {
  try {
    const res = await fetch(RENDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-render-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(62_000),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.ok) return { ok: false, error: out?.error || `Robot browser answered ${res.status}` };
    return out;
  } catch (e) {
    return { ok: false, error: `Robot browser didn't answer: ${String(e).slice(0, 120)}` };
  }
}

function cleanSteps(raw: unknown, requireActions: boolean): Step[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 6) return "Too many steps (max 6).";
  const steps: Step[] = [];
  for (let i = 0; i < raw.length; i++) {
    const selector = String(raw[i]?.selector ?? "").trim();
    const action = raw[i]?.action ? String(raw[i].action) : undefined;
    if (!selector || selector.length > 500) return `Step ${i + 1} has no button.`;
    if (requireActions) {
      const last = i === raw.length - 1;
      if (last && !FINAL_ACTIONS.has(action ?? "")) return "The last click must be Reject, Accept, Necessary only, Save or Close.";
      if (!last && action !== "next") return `Step ${i + 1} must be Next step.`;
    }
    steps.push({ selector, action });
  }
  return steps;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const svc = createClient(SUPABASE_URL, SERVICE);
  if (!(await isAdmin(req, svc))) return json({ error: "Unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action || "");
  const domain = String(body.domain || "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return json({ error: "domain required" }, 400);
  const viewport = body.viewport === "phone" ? "phone" : "desktop";
  // Screenshot height that matches the admin panel's shape (the robot clamps it to 560-1600).
  const height = Number.isFinite(Number(body.height)) ? Number(body.height) : undefined;

  const { data: key } = await svc.rpc("cy_render_key");
  if (!key) return json({ error: "Robot browser key missing" }, 503);

  const { data: report } = await svc.from("missed_banner_reports").select("id,page_url").eq("domain", domain).maybeSingle();
  const url = /^https?:\/\//i.test(String(body.url || "")) ? String(body.url) : (report?.page_url || `https://${domain}`);

  if (action === "inspect") {
    const steps = cleanSteps(body.steps, false);
    if (typeof steps === "string") return json({ error: steps }, 400);
    const out = await engine(String(key), { action: "inspect", url, viewport, height, steps: steps.map((s) => ({ selector: s.selector })) });
    if (!out.ok) return json({ error: out.error, url }, 502);
    const elements = (out.elements || []).map((e: any) => ({ ...e, guess: guess(e.text || "") }));
    return json({ url, viewport, shot: out.shot, vw: out.vw, vh: out.vh, elements, failedStep: out.failedStep, frames: out.frames, shadow: out.shadow });
  }

  if (action === "test" || action === "save") {
    const steps = cleanSteps(body.steps, action === "save");
    if (typeof steps === "string") return json({ error: steps }, 400);
    if (!steps.length) return json({ error: "Pick at least one button." }, 400);
    const test = await engine(String(key), { action: "test", url, viewport, height, steps: steps.map((s) => ({ selector: s.selector })) });
    if (!test.ok) return json({ error: test.error, url }, 502);
    const verdict = { dismissed: !!test.dismissed, failedStep: test.failedStep ?? null, before: test.before, after: test.after };

    if (action === "test") return json({ url, ...verdict });
    if (!verdict.dismissed && !body.force) return json({ saved: false, url, ...verdict });

    const last = steps[steps.length - 1];
    const multi = steps.length > 1;
    const { error: upErr } = await svc.rpc("upsert_pattern", {
      _domain: domain, _selector: last.selector, _action_type: last.action, _cmp_fingerprint: "guided", _source: "admin_guided",
    });
    if (upErr) return json({ error: `Couldn't save: ${upErr.message}` }, 500);
    const now = new Date().toISOString();
    const { data: saved, error: rowErr } = await svc.from("cookie_patterns").update({
      confidence: verdict.dismissed ? 9 : 5,
      is_active: true,
      validated_at: verdict.dismissed ? now : null,
      validation_status: verdict.dismissed ? "passed" : "guided_unverified",
      strategy: multi ? "sequence" : null,
      steps: multi ? steps.map((s) => ({ selector: s.selector, action: s.action })) : null,
    }).eq("domain", domain).eq("selector", last.selector).eq("action_type", last.action).select("id");
    if (rowErr || !saved?.length) return json({ error: `Couldn't confirm the save: ${rowErr?.message ?? "no row"}` }, 500);

    if (report) {
      await svc.from("missed_banner_reports").update({
        resolved: true, resolved_at: now, has_working_pattern: true,
        autofix_outcome: "fixed", autofix_last_at: now,
        autofix_note: `Guided fix by Jared (${viewport}, ${steps.length} click${multi ? "s" : ""})${verdict.dismissed ? ", robot-tested" : ", saved without a passing test"}.`,
      }).eq("id", report.id);
    }
    return json({ saved: true, patternId: saved[0].id, multi, url, ...verdict });
  }

  return json({ error: "Unknown action" }, 400);
});

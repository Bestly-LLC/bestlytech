// eli-agenda-run: nightly (~9:47 PM PT) + pre-call (45-75 min before a booked Eli call) pass that drafts
// "Your prep" items in the partner portal from new bestly_memory rows. Free AI only (privacy: "private",
// paid: "never"); never reads bestly_private_memory; skips every bestly_private_areas area; keeps the rest
// only when it names an Eli-shared project. Prep-first: items land as partner_agenda.status='prep', which
// only admin can see -- Jared taps "Add to agenda" to actually share one with Eli.
//
// Internal only: invoked by public.eli_agenda_tick() via invoke_edge_function (service-role JWT).
// verify_jwt = true -- deploy with that flag, no separate key check needed here.
//
// Plan: bestly_memory area=eli key=plan/eli-auto-agenda-2026-11-02. Build note: area=eli key=partner/auto-agenda-2026-11-02.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { llm } from "../_shared/free-llm.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SECRET = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROSTER = "eli";
const TZ = "America/Los_Angeles";
const BACKFILL_MS = 14 * 86_400_000;

// Eli-shared projects (the plan's allowlist). Matched against area + tags + title, case-insensitively.
const PROJECTS: [string, RegExp][] = [
  ["Studio", /\b(bestly )?studio\b|centering you/i],
  ["Vesta", /\bvesta\b/i],
  ["HOKU", /\bhoku\b/i],
  ["El Dora", /\bel ?dora\b/i],
  ["InventoryProof", /\binventoryproof\b/i],
  ["Real Estate", /\breal estate\b|\bstudio re\b/i],
  ["RoofGuard", /\broofguard\b|\bhunter\b/i],
  ["Bestly Labs", /\bbestly labs\b/i],
  ["Maya / Sales", /\bmaya\b/i],
];
// Defensive double-check even for a non-private area: never Turo, pay, or secrets.
const DROP_RE = /\bturo\b|\bpayroll\b|\bsalary\b|jared'?s pay\b|\bsecret(s)?\b|\bpassword\b|\btoken\b|\bapi[_ ]?key\b/i;

type MemRow = { id: string; area: string; title: string; body: string | null; kind: string; tags: string[] | null; updated_at: string };
type Candidate = MemRow & { project: string };

function svc(): SupabaseClient {
  return createClient(SB_URL, SB_SECRET, { auth: { persistSession: false } });
}

function laParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(d).filter((x) => x.type !== "literal").map((x) => [x.type, x.value])) as Record<string, string>;
  return { hour: Number(p.hour), minute: Number(p.minute), ymd: `${p.year}-${p.month}-${p.day}` };
}

/** Eli's next booked call, via the same next-meeting edge function the app uses (worker-key auth, no new secret). */
async function nextEliCall(db: SupabaseClient): Promise<Date | null> {
  const { data: wk } = await db.rpc("_eli_worker_key");
  if (!wk) return null;
  const r = await fetch(`${SB_URL}/functions/v1/next-meeting`, {
    method: "POST", headers: { "content-type": "application/json", "x-worker-key": wk as string }, body: "{}",
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null) as { events?: { title: string; start: string; text: string }[] } | null;
  const hit = (j?.events ?? []).find((e) => /\beli\b|bdcuniversal/i.test(e.text ?? e.title ?? ""));
  return hit ? new Date(hit.start) : null;
}

async function heartbeat(db: SupabaseClient, ok: boolean, summary: string, ms: number) {
  try { await db.rpc("pi_job_report", { p_job: "eli-agenda", p_ok: ok, p_summary: summary.slice(0, 2000), p_duration_ms: Math.round(ms) }); }
  catch { /* heartbeat is best-effort */ }
}

function projectOf(r: MemRow): string | null {
  const hay = `${r.area} ${r.title} ${(r.tags ?? []).join(" ")}`;
  for (const [name, re] of PROJECTS) if (re.test(hay)) return name;
  return null;
}

const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

Deno.serve(async (_req) => {
  const t0 = Date.now();
  const db = svc();
  try {
    const { hour, minute, ymd } = laParts();
    const { data: state } = await db.from("partner_agenda_auto_state").select("cursor, last_result").eq("roster", ROSTER).maybeSingle();
    const cursor = (state?.cursor as string) ?? new Date(Date.now() - BACKFILL_MS).toISOString();
    const lastResult = (state?.last_result ?? {}) as Record<string, unknown>;
    const nightlyDue = hour === 21 && minute >= 47 && lastResult.nightly_date !== ymd;

    const callAt = await nextEliCall(db);
    const minutesUntil = callAt ? Math.round((callAt.getTime() - Date.now()) / 60_000) : null;
    const precallDue = minutesUntil !== null && minutesUntil >= 45 && minutesUntil <= 75;

    if (!nightlyDue && !precallDue) {
      await heartbeat(db, true, "skip: outside window", Date.now() - t0);
      return J({ ok: true, skipped: true });
    }

    const { data: privRows } = await db.from("bestly_private_areas").select("area");
    const privateAreas = new Set((privRows ?? []).map((r: { area: string }) => r.area));

    const { data: rows, error } = await db.from("bestly_memory")
      .select("id, area, title, body, kind, tags, updated_at")
      .eq("active", true).gt("updated_at", cursor).order("updated_at", { ascending: true }).limit(200);
    if (error) throw new Error(`bestly_memory read failed: ${error.message}`);

    const candidates: Candidate[] = ((rows ?? []) as MemRow[])
      .filter((r) => !privateAreas.has(r.area))
      .filter((r) => !DROP_RE.test(`${r.title} ${r.body ?? ""}`))
      .flatMap((r) => { const p = projectOf(r); return p ? [{ ...r, project: p }] : []; });

    const newCursor = (rows ?? []).length ? (rows as MemRow[])[rows!.length - 1].updated_at : cursor;

    let items: { title: string; note: string; kind: string; project: string; memory_ids: string[] }[] = [];
    let aiUsed = false;
    if (candidates.length) {
      try {
        const system = "You write short call-prep items for a plain-English partner meeting. Reply with JSON only: "
          + '{"items":[{"title":"<=60 chars, plain English, never ends in ...","note":"1-2 plain sentences for a non-technical reader",'
          + '"kind":"shipped|decide|question|fyi","project":"<one of the given projects>","memory_ids":["<only ids from the rows given>"]}]}. '
          + "At most 8 items. Merge rows about the same topic into one item. memory_ids must only contain ids that appear in the input. Never invent facts not in the rows.";
        const user = JSON.stringify(candidates.slice(0, 60).map((r) => ({ id: r.id, project: r.project, memory_kind: r.kind, title: r.title, body: (r.body ?? "").slice(0, 600) })));
        const res = await llm({ task: "write", system, user, json: true, maxTokens: 1800, job: "eli-agenda", fn: "eli-agenda-run", privacy: "private", paid: "never" });
        const parsed = res.json ?? JSON.parse(res.text);
        const valid = new Set(candidates.map((c) => c.id));
        items = (Array.isArray(parsed?.items) ? parsed.items : []).slice(0, 8).map((it: any) => ({
          title: String(it?.title ?? "").slice(0, 60),
          note: String(it?.note ?? "").slice(0, 1000),
          kind: ["shipped", "decide", "question", "fyi"].includes(it?.kind) ? it.kind : "fyi",
          project: typeof it?.project === "string" ? it.project : "",
          memory_ids: Array.isArray(it?.memory_ids) ? it.memory_ids.filter((id: unknown) => valid.has(String(id))) : [],
        })).filter((it: { title: string }) => it.title.length > 0);
        aiUsed = true; // the call succeeded; zero items is a legitimate "nothing worth surfacing"
      } catch {
        aiUsed = false; // free_llm threw (every rung failed) -- fall back below
      }
    } else {
      aiUsed = true; // nothing to ask the AI about; an empty item list is correct, not a failure
    }
    if (!aiUsed) {
      // fallback: one cleaned item per row, no AI, no ellipsis
      items = candidates.map((r) => ({
        title: r.title.length > 60 ? r.title.slice(0, 60).replace(/\s+\S*$/, "") : r.title,
        note: (r.body ?? "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 300),
        kind: "fyi", project: r.project, memory_ids: [r.id],
      }));
    }

    const result = { nightly_date: nightlyDue ? ymd : lastResult.nightly_date, ai_used: aiUsed, candidates: candidates.length };
    const { data: add } = await db.rpc("partner_agenda_auto_add", { p_roster: ROSTER, p_items: items, p_cursor: newCursor, p_result: result });
    const added = (add as { added?: number; merged?: number } | null)?.added ?? 0;
    const merged = (add as { added?: number; merged?: number } | null)?.merged ?? 0;

    if (precallDue && callAt) {
      const { count } = await db.from("partner_agenda").select("id", { count: "exact", head: true }).eq("roster", ROSTER).eq("status", "prep");
      const n = count ?? 0;
      if (n > 0) {
        const when = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(callAt);
        await db.rpc("scout_notify", {
          p_title: `Eli call at ${when} - ${n} thing${n === 1 ? "" : "s"} ready to go over`,
          p_body: "Your prep is waiting in the partner portal. Tap to add what you want on the agenda.",
          p_severity: "info", p_push: true, p_url: "/partner?as=eli", p_dedupe: `eli-agenda-precall-${callAt.toISOString()}`,
        });
      }
    }

    await heartbeat(db, true, `ok: ${added} added, ${merged} merged (${aiUsed ? "AI" : "fallback"}, ${candidates.length} candidates)`, Date.now() - t0);
    return J({ ok: true, added, merged, aiUsed, candidates: candidates.length });
  } catch (e) {
    await heartbeat(db, false, String((e as Error)?.message ?? e).slice(0, 300), Date.now() - t0);
    return J({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

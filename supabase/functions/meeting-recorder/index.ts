// meeting-recorder — Scout's remote control for the call recorder on the Mac mini.
//
// Two callers, two kinds of auth:
//   admin (the /admin SPA, Scout)  Supabase JWT + has_role('admin')
//     op: start {roster[]} | stop | selftest | state | transcript {id|name} | recent
//   agent (~/MeetingRec/agent.py)   header x-recorder-key, checked against
//                                    meeting_recorder_state.key_sha256
//     op: poll {state} | result {command_id, ok, result, error} | ingest {...}
//         | health {key, kind: problem|resolved, severity, title, body, healed}
//           -> bestly_raise('recorder.<key>'), so the monitor, the bell, ntfy and
//              Scout's incident list all see recorder trouble the same way.
//         | job_output {id, output} -> {cancel} | job_done {id, exit_code, output, error}
//   Every poll also hands over one approved mac_jobs row (a shell job Jared
//   tapped Run on). Scout can only propose those; see the mac_jobs migration.
//
// verify_jwt is OFF for the same reason as admin-chat: with it on, the CORS
// preflight is 401'd by the platform. Auth is done here, for both callers.

import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-recorder-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// A name as the Mac will use it: lower-case letters, digits, dash. "Cooper M." -> "cooper-m"
function cleanName(n: unknown): string {
  return String(n ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 32);
}

const AGENT_FRESH_S = 30; // the agent polls every ~3s; 30s quiet = not there

async function state() {
  const { data } = await db
    .from("meeting_recorder_state")
    .select("status, current_name, roster, started_at, stage, known_voices, last_seen_at, version, info")
    .eq("id", 1)
    .single();
  const seen = data?.last_seen_at ? (Date.now() - new Date(data.last_seen_at).getTime()) / 1000 : Infinity;
  const online = seen < AGENT_FRESH_S;
  const { data: pending } = await db
    .from("meeting_recorder_commands")
    .select("id, action, status, created_at")
    .in("status", ["pending", "claimed"])
    .order("created_at");
  const { data: last } = await db
    .from("meeting_recorder_commands")
    .select("id, action, status, error, completed_at")
    .in("status", ["done", "failed"])
    .order("completed_at", { ascending: false })
    .limit(1);
  return {
    ...(data ?? {}),
    status: online ? data?.status ?? "idle" : "offline",
    online,
    seconds_since: Number.isFinite(seen) ? Math.round(seen) : null,
    pending: pending ?? [],
    last_command: last?.[0] ?? null,
  };
}

async function queue(action: "start" | "stop" | "selftest", payload: Record<string, unknown>, by: string) {
  // Expire anything the agent never picked up, so a stale click can't fire later.
  await db
    .from("meeting_recorder_commands")
    .update({ status: "expired", completed_at: new Date().toISOString() })
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - 2 * 60_000).toISOString());
  const { data: open } = await db
    .from("meeting_recorder_commands")
    .select("id")
    .eq("action", action)
    .in("status", ["pending", "claimed"])
    .limit(1);
  if (open?.length) return { ok: true, id: open[0].id, note: "already queued" };
  const { data, error } = await db
    .from("meeting_recorder_commands")
    .insert({ action, payload, requested_by: by })
    .select("id")
    .single();
  return error ? { ok: false, error: error.message } : { ok: true, id: data.id };
}

const JOB_OUT_MAX = 290_000;
const clip = (s: unknown) => {
  const t = String(s ?? "");
  return t.length > JOB_OUT_MAX ? "[... start cut ...]\n" + t.slice(-JOB_OUT_MAX) : t;
};

// One approved job at a time. Proposals nobody tapped within an hour expire,
// and an approval the Mac never picked up within 10 minutes does too.
async function claimJob() {
  const now = new Date().toISOString();
  await db.from("mac_jobs").update({ status: "expired", finished_at: now })
    .eq("status", "proposed").lt("created_at", new Date(Date.now() - 3600_000).toISOString());
  await db.from("mac_jobs").update({ status: "expired", finished_at: now })
    .eq("status", "approved").lt("approved_at", new Date(Date.now() - 600_000).toISOString());
  // A job the Mac lost track of (it never reported back) cannot hold the queue forever.
  await db.from("mac_jobs").update({ status: "failed", finished_at: now })
    .eq("status", "running").lt("started_at", new Date(Date.now() - 3720_000).toISOString());
  const { data: busy } = await db.from("mac_jobs").select("id").eq("status", "running").limit(1);
  if (busy?.length) return null;
  const { data: next } = await db.from("mac_jobs").select("id").eq("status", "approved").order("approved_at").limit(1);
  if (!next?.length) return null;
  const { data: claimed } = await db.from("mac_jobs")
    .update({ status: "running", started_at: now }).eq("id", next[0].id).eq("status", "approved")
    .select("id, title, script, cwd, timeout_s");
  return claimed?.[0] ?? null;
}

async function asAdmin(req: Request, body: Record<string, any>) {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return J({ ok: false, error: "unauthorized" }, 401);
  const { data: who, error } = await db.auth.getUser(jwt);
  if (error || !who?.user) return J({ ok: false, error: "unauthorized" }, 401);
  const { data: isAdmin } = await db.rpc("has_role", { _user_id: who.user.id, _role: "admin" });
  if (!isAdmin) return J({ ok: false, error: "admin only" }, 403);

  const op = String(body.op ?? "state");
  switch (op) {
    case "state":
      return J({ ok: true, state: await state() });

    case "start": {
      const s = await state();
      if (!s.online) return J({ ok: false, error: "The Mac mini isn't answering, so it can't start recording.", state: s });
      if (s.status === "recording") return J({ ok: false, error: "Already recording.", state: s });
      if (s.status === "transcribing") return J({ ok: false, error: "Still transcribing the last call. Give it a minute.", state: s });
      const roster = (Array.isArray(body.roster) ? body.roster : String(body.roster ?? "").split(","))
        .map(cleanName)
        .filter((n: string) => n && n !== "jared");
      const q = await queue("start", { roster: [...new Set(roster)] }, "scout");
      return J({ ...q, state: await state() });
    }

    case "stop": {
      const s = await state();
      if (!s.online) return J({ ok: false, error: "The Mac mini isn't answering, so it can't stop the recording.", state: s });
      if (s.status !== "recording") return J({ ok: false, error: "Nothing is recording.", state: s });
      const q = await queue("stop", {}, "scout");
      return J({ ...q, state: await state() });
    }

    case "selftest": {
      const s = await state();
      if (!s.online) return J({ ok: false, error: "The Mac mini isn't answering.", state: s });
      if (s.status !== "idle") return J({ ok: false, error: `The recorder is ${s.status}; the self-test runs when it's idle.`, state: s });
      const q = await queue("selftest", {}, String(body.by ?? "scout"));
      return J({ ...q, state: await state() });
    }

    case "recent": {
      const { data } = await db
        .from("meeting_recordings")
        .select("id, name, started_at, stopped_at, roster, speakers, line_count, debriefed_at")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(Math.min(Number(body.limit ?? 10), 50));
      return J({ ok: true, recordings: data ?? [] });
    }

    case "transcript": {
      let q = db.from("meeting_recordings").select("id, name, started_at, stopped_at, roster, speakers, transcript, line_count");
      q = body.id ? q.eq("id", String(body.id)) : body.name ? q.eq("name", String(body.name)) : q.order("started_at", { ascending: false });
      const { data } = await q.limit(1);
      if (!data?.length) return J({ ok: false, error: "not_found" }, 404);
      return J({ ok: true, recording: data[0] });
    }
  }
  return J({ ok: false, error: `unknown op ${op}` }, 400);
}

async function asAgent(key: string, body: Record<string, any>) {
  const { data: row } = await db.from("meeting_recorder_state").select("key_sha256").eq("id", 1).single();
  if (!row?.key_sha256 || (await sha256(key)) !== row.key_sha256) return J({ ok: false, error: "bad key" }, 401);

  const op = String(body.op ?? "poll");
  const now = new Date().toISOString();

  if (op === "poll") {
    const s = (body.state ?? {}) as Record<string, any>;
    await db
      .from("meeting_recorder_state")
      .update({
        last_seen_at: now,
        updated_at: now,
        version: s.version ?? null,
        status: s.status ?? "idle",
        current_name: s.current_name ?? null,
        roster: Array.isArray(s.roster) ? s.roster : [],
        started_at: s.started_at ?? null,
        stage: s.stage ?? null,
        known_voices: Array.isArray(s.known_voices) ? s.known_voices : [],
        info: s.info ?? {},
      })
      .eq("id", 1);

    // Hand over the oldest pending command, if any. Anything older than two
    // minutes is stale: a click from before the Mac woke up should not fire.
    const { data: cmd } = await db
      .from("meeting_recorder_commands")
      .select("id, action, payload, created_at")
      .eq("status", "pending")
      .order("created_at")
      .limit(1);
    const job = body.can_run_jobs ? await claimJob() : null;
    if (!cmd?.length) return J({ ok: true, command: null, job });
    const c = cmd[0];
    if (Date.now() - new Date(c.created_at).getTime() > 2 * 60_000) {
      await db.from("meeting_recorder_commands").update({ status: "expired", completed_at: now }).eq("id", c.id);
      return J({ ok: true, command: null, job });
    }
    const { data: claimed } = await db
      .from("meeting_recorder_commands")
      .update({ status: "claimed", claimed_at: now })
      .eq("id", c.id)
      .eq("status", "pending")
      .select("id, action, payload");
    return J({ ok: true, command: claimed?.[0] ?? null, job });
  }

  if (op === "job_output" || op === "job_done") {
    const id = String(body.id ?? "");
    const { data: j } = await db.from("mac_jobs").select("status").eq("id", id).single();
    if (!j) return J({ ok: false, error: "no such job" }, 404);
    const patch: Record<string, unknown> = { output: clip(body.output) };
    if (op === "job_done") {
      patch.exit_code = typeof body.exit_code === "number" ? body.exit_code : null;
      patch.finished_at = now;
      if (body.error) patch.output = clip(`${body.output ?? ""}\n[agent] ${String(body.error).slice(0, 2000)}`);
      if (j.status === "running") patch.status = body.exit_code === 0 && !body.error ? "done" : "failed";
    }
    if (j.status !== "running" && j.status !== "cancelled") return J({ ok: true, cancel: true });
    await db.from("mac_jobs").update(patch).eq("id", id);
    return J({ ok: true, cancel: j.status === "cancelled" });
  }

  if (op === "result") {
    await db
      .from("meeting_recorder_commands")
      .update({
        status: body.ok ? "done" : "failed",
        result: body.result ?? null,
        error: body.error ? String(body.error).slice(0, 2000) : null,
        completed_at: now,
      })
      .eq("id", String(body.command_id ?? ""));
    return J({ ok: true });
  }

  if (op === "health") {
    const key = String(body.key ?? "").replace(/[^a-z0-9._-]/gi, "").slice(0, 60);
    if (!key) return J({ ok: false, error: "key required" }, 400);
    const kind = body.kind === "resolved" ? "resolved" : "problem";
    const { data, error } = await db.rpc("bestly_raise", {
      p_key: `recorder.${key}`,
      p_kind: kind,
      p_severity: String(body.severity ?? (kind === "resolved" ? "info" : "warning")),
      p_title: String(body.title ?? "").slice(0, 200) || null,
      p_body: body.body ? String(body.body).slice(0, 4000) : null,
      p_area: "recorder",
      p_needs_jared: body.needs_jared ? String(body.needs_jared).slice(0, 300) : null,
      p_healed: !!body.healed,
    });
    return error ? J({ ok: false, error: error.message }, 500) : J({ ok: true, result: data });
  }

  if (op === "ingest") {
    const name = String(body.name ?? "");
    if (!/^meeting-\d{8}-\d{4}/.test(name)) return J({ ok: false, error: "bad name" }, 400);
    const transcript = String(body.transcript ?? "").slice(0, 2_000_000);
    const { error } = await db.from("meeting_recordings").upsert(
      {
        name,
        started_at: body.started_at ?? null,
        stopped_at: body.stopped_at ?? null,
        roster: Array.isArray(body.roster) ? body.roster : [],
        speakers: body.speakers ?? {},
        transcript,
        line_count: transcript ? transcript.split("\n").filter((l) => l.startsWith("[")).length : 0,
      },
      { onConflict: "name" },
    );
    if (error) return J({ ok: false, error: error.message }, 500);
    return J({ ok: true });
  }

  return J({ ok: false, error: `unknown op ${op}` }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return J({ ok: false, error: "json body required" }, 400);
  }
  const key = req.headers.get("x-recorder-key");
  try {
    return key ? await asAgent(key, body) : await asAdmin(req, body);
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 500);
  }
});

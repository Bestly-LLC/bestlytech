// mac-agent — the server half of the agent running on Jared's Mac.
//
// The Mac is the only host that can reach IMAP (993 times out from every cloud
// sandbox), so the mail queue has to be drained from there. Before this, nothing
// drained it at all: 22 archive jobs sat pending from 2026-09-03 to 2026-09-19
// because the "worker" was always a person running a session by hand.
//
// Auth: the agent sends a key it generated itself; only sha256(key) is stored,
// so the secret has never been anywhere but that machine. verify_jwt is off
// because the agent is not a signed-in user; the key check below is the gate.
//
// Actions are a fixed allowlist in the agent, not arbitrary shell. Adding one is
// a code change that goes through review, not a row someone can insert.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-agent-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

const MAIL_HOST = "mail.privateemail.com";
const BATCH = 200;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }

  const key = req.headers.get("x-agent-key") ?? "";
  if (!key) return J({ ok: false, error: "unauthorized" }, 401);

  const hash = await sha256Hex(key.trim());
  const { data: agent } = await db.from("mac_agents").select("name").eq("key_sha256", hash).maybeSingle();
  if (!agent?.name) return J({ ok: false, error: "unauthorized" }, 401);
  const me = agent.name as string;

  await db.from("mac_agents").update({
    last_seen_at: new Date().toISOString(),
    version: String(body.version ?? "").slice(0, 40) || null,
  }).eq("name", me);

  const op = String(body.op ?? "poll");

  // ---------------------------------------------------------------- poll
  // Hand back work. A mail_drain command is filled in here with the rows the
  // agent should act on, so the agent never needs database credentials.
  if (op === "poll") {
    const { data: cmds } = await db
      .from("mac_commands")
      .select("id, action, payload")
      .eq("agent", me)
      .eq("status", "pending")
      .order("created_at")
      .limit(5);

    const out = [];
    for (const c of cmds ?? []) {
      await db.from("mac_commands").update({ status: "claimed", claimed_at: new Date().toISOString() }).eq("id", c.id);

      if (c.action === "mail_drain") {
        const mailbox = String((c.payload as any)?.mailbox ?? "jared@bestly.tech");
        const { data: jobs } = await db
          .from("bestly_mail_queue")
          .select("id, folder, uid, action, target")
          .eq("status", "pending")
          .eq("mailbox", mailbox)
          .order("created_at")
          .limit(BATCH);
        out.push({ id: c.id, action: c.action, payload: { mailbox, host: MAIL_HOST, jobs: jobs ?? [] } });
      } else {
        out.push({ id: c.id, action: c.action, payload: c.payload });
      }
    }

    return J({ ok: true, agent: me, commands: out });
  }

  // ---------------------------------------------------------------- result
  if (op === "result") {
    const id = String(body.id ?? "");
    if (!id) return J({ ok: false, error: "id required" }, 400);
    const ok = body.ok !== false;
    const result = body.result ?? null;

    // A mail_drain reports which queue rows actually went through. Rows whose
    // UID was already gone from the folder count as done: the mail is where it
    // was meant to end up, and retrying forever helps nobody.
    const done: string[] = Array.isArray(result?.done) ? result.done : [];
    const gone: string[] = Array.isArray(result?.missing) ? result.missing : [];
    const failed: string[] = Array.isArray(result?.failed) ? result.failed : [];

    if (done.length) {
      await db.from("bestly_mail_queue")
        .update({ status: "done", claimed_at: new Date().toISOString(), error: null })
        .in("id", done);
    }
    if (gone.length) {
      await db.from("bestly_mail_queue")
        .update({ status: "done", claimed_at: new Date().toISOString(), error: "uid no longer in folder" })
        .in("id", gone);
    }
    if (failed.length) {
      for (const fid of failed) {
        const { data: row } = await db.from("bestly_mail_queue").select("attempts").eq("id", fid).maybeSingle();
        await db.from("bestly_mail_queue").update({
          status: (row?.attempts ?? 0) >= 4 ? "failed" : "pending",
          attempts: (row?.attempts ?? 0) + 1,
          error: String(result?.error ?? "move failed").slice(0, 400),
        }).eq("id", fid);
      }
    }

    await db.from("mac_commands").update({
      status: ok ? "done" : "failed",
      result,
      error: ok ? null : String(body.error ?? "").slice(0, 400),
      completed_at: new Date().toISOString(),
    }).eq("id", id);

    return J({ ok: true });
  }

  // ---------------------------------------------------------------- heartbeat
  // Nothing queued? The agent still asks whether the mail queue has work, so a
  // stalled queue heals itself without anyone noticing it was stalled.
  if (op === "mail_check") {
    const mailbox = String(body.mailbox ?? "jared@bestly.tech");
    const { data: jobs } = await db
      .from("bestly_mail_queue")
      .select("id, folder, uid, action, target")
      .eq("status", "pending")
      .eq("mailbox", mailbox)
      .order("created_at")
      .limit(BATCH);
    return J({ ok: true, mailbox, host: MAIL_HOST, jobs: jobs ?? [] });
  }

  return J({ ok: false, error: `unknown op ${op}` }, 400);
});

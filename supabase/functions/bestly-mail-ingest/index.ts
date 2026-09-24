// bestly-mail-ingest — receives messages from the local IMAP puller.
//
// The puller runs on Jared's own machine, holds the mailbox passwords there, and
// posts new messages here. Claude then reads them through the Supabase connection
// it already has. No third-party mail service, no per-call quota, and no password
// ever travels.
//
// The puller's key is its own, deliberately not the shared PROXY_KEY (that one also
// unlocks the Instagram poster); worst case here is junk rows in one table. Since
// 2026-09-22 the key lives in Vault (bestly_mail_proxy_key) and is checked through
// bestly_mail_key_ok() — same value as before, so the installed puller keeps working,
// but no secret sits in this source any more. Rotating it means updating the puller
// on Jared's Mac in the same pass.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-proxy-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

async function keyOk(k: string | null): Promise<boolean> {
  if (!k) return false;
  const { data, error } = await db.rpc("bestly_mail_key_ok", { p_key: k });
  return !error && data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (!(await keyOk(req.headers.get("x-proxy-key")))) return J({ error: "unauthorized" }, 401);

  try {
    const body = await req.json();
    const action = body.action ?? "ingest";
    const folder = body.folder ?? "INBOX";

    // Where did we get to last time? The puller asks before it scans.
    // uidValidity comes back too: if the server's value no longer matches, every
    // stored uid is meaningless and the puller must re-backfill instead of
    // silently syncing nothing forever.
    if (action === "state") {
      const { data } = await db.from("bestly_mail_state").select("*")
        .eq("mailbox", body.mailbox).eq("folder", folder).maybeSingle();
      return J({ lastUid: data?.last_uid ?? 0, uidValidity: data?.uid_validity ?? null });
    }

    // The puller saw UIDVALIDITY change. Stored uids for this folder are now
    // garbage, so drop them and let the next pass rebuild from scratch.
    if (action === "reset") {
      if (!body.mailbox) return J({ error: "mailbox required" }, 400);
      await db.from("bestly_mail").delete()
        .eq("mailbox", body.mailbox).eq("folder", folder);
      await db.from("bestly_mail_state").upsert({
        mailbox: body.mailbox,
        folder,
        last_uid: 0,
        uid_validity: body.uidValidity ?? null,
        last_run_at: new Date().toISOString(),
        last_error: "uidvalidity changed; folder resynced",
      }, { onConflict: "mailbox,folder" });
      return J({ ok: true, reset: true });
    }

    if (action === "ingest") {
      const msgs = Array.isArray(body.messages) ? body.messages : [];
      if (!body.mailbox) return J({ error: "mailbox required" }, 400);

      let stored = 0;
      if (msgs.length) {
        const rows = msgs.map((m: Record<string, unknown>) => ({
          mailbox: body.mailbox,
          folder,
          uid: m.uid,
          message_id: m.messageId ?? null,
          from_addr: m.fromAddr ?? null,
          from_name: m.fromName ?? null,
          to_addrs: m.toAddrs ?? null,
          subject: m.subject ?? null,
          sent_at: m.sentAt ?? null,
          // Bodies can be enormous; the useful part is always near the top.
          body_text: typeof m.bodyText === "string" ? m.bodyText.slice(0, 40000) : null,
          has_attach: !!m.hasAttach,
          seen: !!m.seen,
          raw_headers: m.headers ?? null,
        }));
        const { error } = await db.from("bestly_mail")
          .upsert(rows, { onConflict: "mailbox,folder,uid" });
        if (error) return J({ error: error.message }, 500);
        stored = rows.length;
      }

      const state: Record<string, unknown> = {
        mailbox: body.mailbox,
        folder,
        last_uid: body.lastUid ?? 0,
        last_run_at: new Date().toISOString(),
        last_error: body.error ?? null,
      };
      if (body.uidValidity != null) state.uid_validity = body.uidValidity;

      await db.from("bestly_mail_state").upsert(state, { onConflict: "mailbox,folder" });

      if (Math.random() < 0.05) await db.rpc("purge_old_bestly_mail");

      return J({ ok: true, stored, lastUid: body.lastUid ?? 0 });
    }

    return J({ error: "unknown action" }, 400);
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});

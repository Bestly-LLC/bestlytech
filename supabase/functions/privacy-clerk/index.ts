// privacy-clerk: Vera, the Privacy Clerk (docs/privacy-clerk-opusplan.md).
// Carries out the privacy requests Maya files as support_tickets (kind = 'privacy').
//
//   tick (cron, every 10 min)   opens a case for every open privacy ticket, emails the confirmation link, reminds after
//                               3 days, gives up after 14, scans after they confirm, then (privacy_clerk_state.auto_execute,
//                               on by default since 2026-10-26) approves and runs the request herself; with the switch off she
//                               pushes Jared once and waits for his tap. Then emails the person, closes the ticket, redacts
//                               the record, checks the data map daily.
//   {run:"case",    code}       work one case right now (called by privacy-verify and the admin RPCs)
//   {run:"execute", code}       same, after Jared taps Delete now
//
// Rules she never breaks: nothing runs before the person has confirmed by email (or Jared marked them verified); status
// 'approved' is set only by admin_privacy_approve or privacy_auto_approve (switch on); the owner guard and the 25-row blast
// guard live in SQL (privacy_scan / privacy_auto_approve / privacy_execute) and always stop the run for Jared, switch or not;
// she never emails a denial. Every alert is signed "Vera:". Only the service key (or an admin) may call her.
import { createClient } from "jsr:@supabase/supabase-js@2";

const AGENT_ID = "agent_3701m4jbjnyef6ga4ys73xtbz37s";   // Maya's ElevenLabs agent: only her call records are touched
const XI = "https://api.elevenlabs.io/v1";
const SITE = "https://bestly.tech";
const NB = "\u00A0";
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const sb = createClient(SB_URL, SB_SECRET, { auth: { persistSession: false } });
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

type Case = {
  id: string; ticket_code: string; action: "delete" | "export" | "correct" | "opt_out" | null; email: string | null; phone: string | null;
  token: string | null; token_expires_at: string | null; verify_sent_at: string | null; reminded_at: string | null; verified_at: string | null;
  scan: Record<string, any> | null; review_ticked: string[]; approved_at: string | null; executed_at: string | null; result: Record<string, any> | null;
  export_path: string | null; export_expires_at: string | null; downloaded_at: string | null; confirm_sent_at: string | null; done_at: string | null;
  redacted_at: string | null; status: string; note: string | null; attempts: number; last_error: string | null; created_at: string;
  auto_approved?: boolean; pending_calls?: string[]; pending_files?: string[];
};
type Ticket = { code: string; name: string | null; email: string | null; phone: string | null; issue: string | null; status: string; conversation_id: string | null; created_at: string };

// ---------------------------------------------------------------- small helpers
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const last10 = (s: string | null | undefined) => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : null; };
const firstName = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "";
const pacificDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const pacificHour = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(d));
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }).format(new Date(iso));
const fmtPhone = (p: string | null) => { const d = last10(p); return d ? `(${d.slice(0, 3)})${NB}${d.slice(3, 6)}-${d.slice(6)}` : (p ?? ""); };
const count = (n: number, one: string, many = one + "s") => `${n}${NB}${n === 1 ? one : many}`;
const plainError = (e: unknown) => String((e as { message?: string })?.message ?? e).replace(/\s+/g, " ").slice(0, 240);

const ASK: Record<string, string> = {
  delete: "delete your data", export: "send you a copy of your data", opt_out: "stop sending you marketing", correct: "correct your data",
};
const THEY_ASKED: Record<string, string> = {
  delete: "delete their data", export: "get a copy of their data", opt_out: "stop being marketed to", correct: "correct their data",
};

const issueOpen = async (key: string) => (await sb.from("monitor_issues").select("status").eq("key", key).maybeSingle()).data?.status === "open";
async function raiseIssue(key: string, title: string, body: string | null, needs: string | null, severity: "warning" | "info" = "warning", once = true) {
  try {
    if (once && await issueOpen(key)) return;
    await sb.rpc("bestly_raise", { p_key: key, p_kind: "problem", p_severity: severity, p_title: title, p_body: body, p_area: "privacy", p_needs_jared: needs });
  } catch { /* an alert must never be the thing that fails the run */ }
}
async function resolveIssue(key: string, title: string) {
  try { if (await issueOpen(key)) await sb.rpc("bestly_raise", { p_key: key, p_kind: "resolved", p_severity: "info", p_title: title, p_area: "privacy" }); } catch { /* same */ }
}
/** Good news: a "success" bell row, so it lands in the 7 PM recap instead of interrupting. */
async function recap(code: string, title: string, body: string) {
  try { await sb.rpc("admin_notify", { p_kind: "vera", p_title: title, p_body: body, p_url: "/admin/maya", p_entity_key: `privacy:${code}`, p_severity: "success", p_dedupe_key: `vera-done-${code}` }); } catch { /* same */ }
}

async function sendEmail(templateName: string, to: string, key: string, data: Record<string, unknown>) {
  const r = await fetch(`${SB_URL}/functions/v1/send-transactional-email`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_SECRET}`, apikey: SB_SECRET },
    body: JSON.stringify({ templateName, recipientEmail: to, idempotencyKey: key, templateData: data }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j?.success !== false, suppressed: j?.reason === "email_suppressed", status: r.status, error: j?.error as string | undefined };
}

async function setCase(c: Case, patch: Record<string, unknown>, progressed = false) {
  const { error } = await sb.from("privacy_cases").update({ ...patch, ...(progressed ? { attempts: 0, last_error: null } : {}), updated_at: new Date().toISOString() }).eq("id", c.id);
  if (error) throw new Error(`could not save the case: ${error.message}`);
  Object.assign(c, patch);
}
async function closeTicket(code: string, note: string) {
  const { data } = await sb.from("support_tickets").select("note").eq("code", code).maybeSingle();
  const joined = [data?.note, note].filter(Boolean).join("\n");
  await sb.from("support_tickets").update({ status: "done", resolved_at: new Date().toISOString(), note: joined }).eq("code", code);
}

// ---------------------------------------------------------------- ElevenLabs (Maya's call records)
async function elKey(): Promise<string> {
  const { data } = await sb.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  if (typeof data !== "string" || !data) throw new Error("the ElevenLabs key is missing from the vault");
  return data;
}
/** Maya's conversations whose caller number matches. Reads at most the 300 most recent. */
async function mayaConversationsFor(key: string, p10: string | null): Promise<string[]> {
  if (!p10) return [];
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const r: Response = await fetch(`${XI}/convai/conversations?agent_id=${AGENT_ID}&page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: { "xi-api-key": key } });
    if (!r.ok) throw new Error(`ElevenLabs answered ${r.status} when listing Maya's calls`);
    const j = await r.json().catch(() => ({}));
    for (const c of (j.conversations ?? []) as { conversation_id: string }[]) ids.push(c.conversation_id);
    if (!j.has_more || !j.next_cursor) break;
    cursor = j.next_cursor;
  }
  const hits: string[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(5, ids.length) }, async () => {
    while (i < ids.length) {
      const id = ids[i++];
      const r = await fetch(`${XI}/convai/conversations/${id}`, { headers: { "xi-api-key": key } });
      if (!r.ok) continue;
      const d = await r.json().catch(() => ({}));
      if (d?.agent_id === AGENT_ID && last10(d?.metadata?.phone_call?.external_number) === p10) hits.push(id);
    }
  }));
  return hits;
}
async function deleteConversation(key: string, id: string): Promise<boolean> {
  if (!/^conv_[A-Za-z0-9]+$/.test(id)) return false;
  const r = await fetch(`${XI}/convai/conversations/${id}`, { method: "DELETE", headers: { "xi-api-key": key } });
  return r.ok || r.status === 404;
}

// ---------------------------------------------------------------- automatic approval (the switch)
/** With auto_execute on, approve a verified, scanned case ourselves. Returns true when the case is now 'approved'.
 *  The owner guard and blast guard still stop it (they hand the case to Jared), exactly as they would after a tap. */
async function tryAuto(c: Case, who: string): Promise<boolean> {
  const { data: st } = await sb.from("privacy_clerk_state").select("auto_execute").eq("id", true).maybeSingle();
  if (!st?.auto_execute) return false;
  const { data: a, error } = await sb.rpc("privacy_auto_approve", { p_case: c.id });
  if (error) throw new Error(`could not approve the request: ${error.message}`);
  if (a?.approved) { Object.assign(c, { status: "approved", scan: a.scan, approved_at: new Date().toISOString(), auto_approved: true }); return true; }
  const code = c.ticket_code;
  if (a?.reason === "owner") {
    await setCase(c, { status: "needs_jared", note: "This request names one of your own addresses or numbers, so I did not touch it." }, true);
    await raiseIssue("privacy.guard", `Vera: I stopped on ${who}`, `${code}: this names one of your own addresses or numbers. Nothing was changed.`, `Open ${code} in Maya.`, "warning", false);
  } else if (a?.reason === "blast") {
    const where = (a.scan?.blast ?? []).map((b: { table: string; rows: number }) => `${b.table} (${b.rows}${NB}rows)`).join(", ");
    await setCase(c, { status: "needs_jared", scan: a.scan, scanned_at: new Date().toISOString(), note: `More than 25 rows for one person in ${where}. I stopped.` }, true);
    await raiseIssue("privacy.guard", `Vera: I stopped on ${who}`, `${code}: more than 25 rows for one person in ${where}. Nothing was changed.`,
      "Look at the records before anything is deleted; this is a bigger footprint than one customer should have.", "warning", false);
  }
  return false;
}

// ---------------------------------------------------------------- one case
async function work(c: Case, t: Ticket) {
  const who = t.name?.trim() || fmtPhone(c.phone ?? t.phone) || "Someone";
  const code = c.ticket_code;
  const verb = THEY_ASKED[c.action ?? ""] ?? "change their data";
  const issueKey = `privacy.case.${code}`;

  switch (c.status) {
    case "no_email": {
      await raiseIssue(issueKey, `Vera: ${who} asked to ${verb} but left no email`, "Call them back to get one.",
        `Call ${fmtPhone(c.phone ?? t.phone) || "them"} back for an email, then open ${code} in Maya and tap I verified them, or Cancel request.`);
      return;
    }
    case "needs_jared": {
      await raiseIssue(issueKey, `Vera: ${code} needs you`, c.note ?? t.issue, "Open the ticket in Maya.");
      return;
    }
    case "could_not_verify": return;

    case "awaiting_verification": {
      if (!c.email || !c.token) { await setCase(c, { status: "no_email", note: "No email was left, so I cannot send a confirmation link." }, true); return; }
      const send = (key: string) => sendEmail("privacy-verify", c.email!, key, {
        first_name: firstName(t.name), ask: ASK[c.action ?? "delete"], requested_on: shortDate(t.created_at),
        short_link: `bestly.tech/p/${c.token}`, code,
      });
      if (!c.verify_sent_at) {
        const r = await send(`privacy-verify-${code}-${c.token}`);
        if (r.suppressed) {
          await setCase(c, { status: "needs_jared", note: "Their address is on our do-not-email list, so I cannot email the confirmation link." }, true);
          await raiseIssue(issueKey, `Vera: ${who} cannot be emailed`, "Their address is on our do-not-email list, so I could not send the confirmation link.",
            `Call them to confirm, then open ${code} in Maya.`);
          return;
        }
        if (!r.ok) throw new Error(`the confirmation email did not send (${r.error ?? r.status})`);
        await setCase(c, { verify_sent_at: new Date().toISOString() }, true);
        return;
      }
      const sentAgo = Date.now() - Date.parse(c.verify_sent_at);
      if (sentAgo >= 14 * 86400_000 || (c.token_expires_at && Date.parse(c.token_expires_at) < Date.now())) {
        await setCase(c, { status: "could_not_verify", note: "They never tapped the link in 14 days." }, true);
        await raiseIssue(issueKey, `Vera: ${who} never confirmed their request`,
          `${code}: I emailed the link ${shortDate(c.verify_sent_at)} and sent a reminder; nothing came back. I have not emailed them a denial.`,
          `Call them back, then tap I verified them, Resend link or Cancel request on ${code} in Maya.`);
        return;
      }
      if (!c.reminded_at && sentAgo >= 3 * 86400_000) {
        const r = await send(`privacy-remind-${code}`);
        if (!r.ok && !r.suppressed) throw new Error(`the reminder email did not send (${r.error ?? r.status})`);
        await setCase(c, { reminded_at: new Date().toISOString() });
      }
      return;
    }

    case "verified": {
      await resolveIssue(issueKey, `Vera: ${code} moved on`);
      if (c.action === "correct") {
        await setCase(c, { status: "needs_jared", note: `They confirmed. They want this corrected: ${t.issue ?? "no details were recorded"}` }, true);
        await raiseIssue(issueKey, `Vera: ${who} confirmed they want their data corrected`, t.issue ?? "No details were recorded.",
          `Make the change, then mark ${code} done in Maya.`);
        return;
      }
      if (c.action === "opt_out") { await finishOptOut(c, t, who); return; }
      if (c.action !== "delete" && c.action !== "export") { await setCase(c, { status: "needs_jared", note: "I do not know what this request is." }, true); return; }

      if (c.action === "export" && !c.email) {
        await setCase(c, { status: "needs_jared", note: "They want a copy of their data but left no email to send it to." }, true);
        await raiseIssue(issueKey, `Vera: ${who} wants a copy of their data but has no email`, "I have nowhere to send the file.", `Get an email from them, or cancel ${code} in Maya.`);
        return;
      }
      const { data: scan, error } = await sb.rpc("privacy_scan", { p_case: c.id });
      if (error) throw new Error(`the scan failed: ${error.message}`);
      let convs = 0;
      try { convs = (await mayaConversationsFor(await elKey(), last10(c.phone))).length + (t.conversation_id ? 1 : 0); } catch { /* the call count is a bonus; the delete step retries */ }
      scan.conversations = convs;
      if (scan.owner) {
        await setCase(c, { status: "needs_jared", scan, scanned_at: new Date().toISOString(), note: "This request names one of your own addresses or numbers, so I did not look." }, true);
        await raiseIssue(issueKey, `Vera: ${code} names one of your own addresses`, "I did not scan or touch anything.", `Open ${code} in Maya.`);
        return;
      }
      if ((scan.blast ?? []).length > 0) {
        const where = scan.blast.map((b: { table: string; rows: number }) => `${b.table} (${b.rows}${NB}rows)`).join(", ");
        await setCase(c, { status: "needs_jared", scan, scanned_at: new Date().toISOString(), note: `More than 25 rows for one person in ${where}. I stopped.` }, true);
        await raiseIssue("privacy.guard", `Vera: I stopped on ${who}`, `${code}: more than 25 rows for one person in ${where}. Nothing was changed.`,
          "Look at the records before anything is deleted; this is a bigger footprint than one customer should have.", "warning", false);
        return;
      }
      await setCase(c, { status: "ready", scan, scanned_at: new Date().toISOString() }, true);
      if (await tryAuto(c, who)) { await work(c, t); return; }
      if (c.status !== "ready") return;
      const body = c.action === "export"
        ? `Tap to send their data file: ${count(scan.total, "record")} in ${count(scan.places, "place")}. Ticket ${code}.`
        : `Tap to delete their data: ${count(scan.total, "record")} in ${count(scan.places, "place")}${convs ? `, plus ${count(convs, "call recording")}` : ""}. Ticket ${code}.`;
      await sb.rpc("notify_route", {
        p_title: `Vera: ${who} confirmed and is waiting for you`, p_body: body, p_level: "time-sensitive", p_source: "Vera",
        p_url: `${SITE}/admin/maya`, p_tag: `privacy-ready-${code}`,
      });
      return;
    }

    case "ready": {
      // waiting for a tap; if the switch was turned on since, or her guard cleared, she goes ahead
      if (await tryAuto(c, who)) await work(c, t);
      return;
    }

    case "approved": {
      if (c.action === "export") { await finishExport(c, t, who); return; }
      await finishDelete(c, t, who);
      return;
    }

    case "done": {
      if (c.redacted_at) return;
      const now = Date.now();
      if (c.action === "export") {
        if (c.export_expires_at && Date.parse(c.export_expires_at) < now) {
          if (c.export_path) await sb.storage.from("privacy-exports").remove([c.export_path]);
          await setCase(c, { export_path: null });
          const { error } = await sb.rpc("privacy_redact", { p_case: c.id });
          if (error) throw new Error(`the redaction failed: ${error.message}`);
        }
        return;
      }
      // give the email queue a few minutes to finish with their address, then forget it
      if (c.confirm_sent_at && now - Date.parse(c.confirm_sent_at) >= 20 * 60_000) {
        const { error } = await sb.rpc("privacy_redact", { p_case: c.id });
        if (error) throw new Error(`the redaction failed: ${error.message}`);
      }
      return;
    }
  }
}

async function finishOptOut(c: Case, t: Ticket, who: string) {
  // Tell them first: once they are on the suppression list our own mailer refuses to write to them.
  if (c.email && !c.confirm_sent_at) {
    const r = await sendEmail("privacy-done", c.email, `privacy-done-${c.ticket_code}`, { kind: "opt_out", first_name: firstName(t.name), code: c.ticket_code });
    if (!r.ok && !r.suppressed) throw new Error(`the confirmation email did not send (${r.error ?? r.status})`);
    await setCase(c, { confirm_sent_at: new Date().toISOString() });
  }
  if (c.email) {
    const e = c.email.toLowerCase().trim();
    const { data } = await sb.from("suppressed_emails").select("id").eq("email", e).maybeSingle();
    if (!data) { const { error } = await sb.from("suppressed_emails").insert({ email: e, reason: "unsubscribe", metadata: { via: "privacy_opt_out", ticket: c.ticket_code } }); if (error) throw new Error(`could not add them to the email suppression list: ${error.message}`); }
  }
  const p10 = last10(c.phone);
  if (p10) {
    const { data } = await sb.from("rg_dnc").select("phone").like("phone", `%${p10}`).limit(1);
    if (!data?.length) { const { error } = await sb.from("rg_dnc").insert({ phone: `+1${p10}`, reason: "privacy_opt_out" }); if (error) throw new Error(`could not add them to the call list: ${error.message}`); }
  }
  await setCase(c, { status: "done", done_at: new Date().toISOString(), confirm_sent_at: c.confirm_sent_at ?? new Date().toISOString(), note: "Opt-out recorded." }, true);
  await closeTicket(c.ticket_code, "Vera: added to the do-not-contact lists and confirmed");
  await recap(c.ticket_code, `Vera: ${who} is off our lists`, `${c.ticket_code}: opt-out recorded and confirmed.`);
}

async function finishDelete(c: Case, t: Ticket, who: string) {
  const code = c.ticket_code;
  const issueKey = `privacy.case.${code}`;
  const fail = async (e: unknown): Promise<void> => {
    const msg = plainError(e);
    if (/OWNER_GUARD/.test(msg)) {
      await setCase(c, { status: "needs_jared", last_error: msg, note: "This request names one of your own addresses or numbers. I stopped." }, true);
      await raiseIssue("privacy.guard", `Vera: I stopped on ${who}`, `${code}: this names one of your own addresses or numbers. Nothing was changed.`, `Open ${code} in Maya.`, "warning", false);
    } else if (/BLAST_GUARD/.test(msg)) {
      await setCase(c, { status: "needs_jared", last_error: msg, note: msg.replace(/^.*BLAST_GUARD:\s*/, "") }, true);
      await raiseIssue("privacy.guard", `Vera: I stopped on ${who}`, `${code}: ${msg.replace(/^.*BLAST_GUARD:\s*/, "")}. Nothing was changed.`,
        "Look at the records before anything is deleted.", "warning", false);
    } else if (/COUNT_MISMATCH/.test(msg)) {
      const { data: scan } = await sb.rpc("privacy_scan", { p_case: c.id });
      await setCase(c, { status: "ready", scan: { ...(scan ?? {}), conversations: c.scan?.conversations ?? 0 }, scanned_at: new Date().toISOString(), last_error: msg, approved_at: null }, true);
      await raiseIssue("privacy.guard", `Vera: ${who}'s records changed after you tapped`, `${code}: I did nothing and rolled back. The numbers are updated.`,
        `Open ${code} in Maya, check the new numbers, and tap again.`, "warning", false);
    } else throw e instanceof Error ? e : new Error(msg);
  };

  if (!c.executed_at) {
    // save the call ids and uploaded-file paths of THIS person's rows first: once the rows are gone the ids are too
    const { error: ce } = await sb.rpc("privacy_collect", { p_case: c.id });
    if (ce) { await fail(ce); return; }
    const { data, error } = await sb.rpc("privacy_execute", { p_case: c.id });
    if (error) { await fail(error); return; }
    c.executed_at = new Date().toISOString(); c.result = data;
    await resolveIssue("privacy.guard", "Vera: the guard is clear");
  }
  const result = (c.result ?? (await sb.from("privacy_cases").select("result").eq("id", c.id).single()).data?.result ?? {}) as Record<string, any>;

  const { data: pend } = await sb.from("privacy_cases").select("pending_calls,pending_files").eq("id", c.id).single();
  const pendingCalls = (pend?.pending_calls ?? []) as string[];
  const pendingFiles = (pend?.pending_files ?? []) as string[];

  // Call recordings in ElevenLabs (DELETE /v1/convai/conversations/{id}). Only ids that came from THIS person's own rows
  // (matched by their exact number or email before the rows were removed), Maya's calls from their number, and the call the
  // ticket was filed on. 404 means it is already gone.
  if (!result.calls_done) {
    const key = await elKey();
    const ids = new Set<string>(pendingCalls);
    for (const id of await mayaConversationsFor(key, last10(c.phone))) ids.add(id);
    if (t.conversation_id) ids.add(t.conversation_id);
    let gone = 0;
    for (const id of ids) { if (await deleteConversation(key, id)) gone++; else throw new Error(`could not delete the call ${id} from ElevenLabs`); }
    result.calls_deleted = gone; result.calls_done = true;
    await sb.from("privacy_cases").update({ result, updated_at: new Date().toISOString() }).eq("id", c.id);
    c.result = result;
  }

  // Uploaded documents (seller onboarding ID and bank papers) live in Storage, not in the table that was just cleared
  if (!result.files_done) {
    if (pendingFiles.length) {
      const { error: fe } = await sb.storage.from("intake-documents").remove(pendingFiles);
      if (fe) throw new Error(`could not remove their uploaded documents: ${fe.message}`);
    }
    result.files_deleted = pendingFiles.length; result.files_done = true;
    await sb.from("privacy_cases").update({ result, pending_calls: [], pending_files: [], updated_at: new Date().toISOString() }).eq("id", c.id);
    c.result = result;
  }

  const places = Number(result.places ?? 0) + (result.calls_deleted > 0 ? 1 : 0) + (result.files_deleted > 0 ? 1 : 0);
  const keeps = [...new Set(((result.keep ?? []) as { reason: string }[]).map((k) => k.reason).filter(Boolean))];
  let emailed = true;
  if (c.email && !c.confirm_sent_at) {
    const r = await sendEmail("privacy-done", c.email, `privacy-done-${code}`, { kind: "delete", first_name: firstName(t.name), places, keeps, code });
    if (!r.ok && !r.suppressed) throw new Error(`the confirmation email did not send (${r.error ?? r.status})`);
    if (r.suppressed) emailed = false;
  }
  const changed = Number(result.deleted ?? 0) + Number(result.blanked ?? 0);
  await setCase(c, { status: "done", done_at: new Date().toISOString(), confirm_sent_at: c.confirm_sent_at ?? new Date().toISOString(), note: `Deleted ${changed} records.` }, true);
  await closeTicket(code, `Vera: deleted ${changed} records${result.calls_deleted ? ` and ${result.calls_deleted} call recordings` : ""}`);
  await resolveIssue(issueKey, `Vera: ${code} is done`);
  await recap(code, `Vera: deleted ${who}'s data`, `${code}: ${count(changed, "record")} in ${count(Number(result.places ?? 0), "place")}${result.calls_deleted ? `, ${count(result.calls_deleted, "call recording")}` : ""}. ${c.auto_approved ? "Done automatically. " : ""}${emailed ? "They were emailed." : "They are on the do-not-email list, so I could not tell them. Call them if you want them to know."}`);
}

async function finishExport(c: Case, t: Ticket, who: string) {
  const code = c.ticket_code;
  if (!c.export_path) {
    const { data, error } = await sb.rpc("privacy_export", { p_case: c.id });
    if (error) { if (/OWNER_GUARD/.test(error.message)) { await setCase(c, { status: "needs_jared", note: "This request names one of your own addresses or numbers. I stopped." }, true); return; } throw new Error(`the export failed: ${error.message}`); }
    const path = `${c.id}.json`;
    const up = await sb.storage.from("privacy-exports").upload(path, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    if (up.error) throw new Error(`could not save the data file: ${up.error.message}`);
    const now = Date.now();
    await setCase(c, { export_path: path, export_expires_at: new Date(now + 30 * 86400_000).toISOString(), token_expires_at: new Date(now + 7 * 86400_000).toISOString() });
  }
  if (c.email && !c.confirm_sent_at) {
    const r = await sendEmail("privacy-done", c.email, `privacy-done-${code}`, { kind: "export", first_name: firstName(t.name), short_link: `bestly.tech/p/${c.token}`, code });
    if (!r.ok && !r.suppressed) throw new Error(`the confirmation email did not send (${r.error ?? r.status})`);
  }
  await setCase(c, { status: "done", done_at: new Date().toISOString(), confirm_sent_at: c.confirm_sent_at ?? new Date().toISOString(), note: "Data file sent." }, true);
  await closeTicket(code, "Vera: emailed their data file");
  await recap(code, `Vera: sent ${who} their data file`, `${code}: the download link works for 7${NB}days.`);
}

// ---------------------------------------------------------------- run one case with retries and an honest alert
async function safely(c: Case, t: Ticket, errors: string[]) {
  try { await work(c, t); }
  catch (e) {
    const msg = plainError(e);
    const attempts = (c.attempts ?? 0) + 1;
    await sb.from("privacy_cases").update({ attempts, last_error: msg, updated_at: new Date().toISOString() }).eq("id", c.id);
    errors.push(`${c.ticket_code}: ${msg}`);
    if (attempts >= 3) await raiseIssue("privacy.clerk", `Vera: I'm stuck on ${c.ticket_code}`, `${msg}. I have tried ${attempts} times and will keep trying every 10 minutes.`,
      "If this does not clear on its own, open the ticket in Maya.", "warning", true);
  }
}

async function loadTicket(code: string): Promise<Ticket | null> {
  const { data } = await sb.from("support_tickets").select("code,name,email,phone,issue,status,conversation_id,created_at").eq("code", code).maybeSingle();
  return (data as Ticket | null);
}

async function runOne(code: string, errors: string[]) {
  const { data: c } = await sb.from("privacy_cases").select("*").eq("ticket_code", code).maybeSingle();
  if (!c) { const { data: id } = await sb.rpc("privacy_open_case", { p_code: code }); if (!id) return; return runOne(code, errors); }
  const t = await loadTicket(code);
  if (t) await safely(c as Case, t, errors);
}

async function mapCheck() {
  const today = pacificDay(new Date());
  const { data: st } = await sb.from("privacy_clerk_state").select("last_map_check_on").eq("id", true).maybeSingle();
  if (pacificHour(new Date()) < 7 || st?.last_map_check_on === today) return;
  const { data, error } = await sb.rpc("privacy_unmapped");
  if (error) throw new Error(`the map check failed: ${error.message}`);
  const rows = (data ?? []) as { table_name: string; column_name: string }[];
  if (rows.length) {
    const list = rows.map((r) => `${r.table_name}.${r.column_name}`).join(", ");
    await raiseIssue("privacy.map", `Vera: ${count(rows.length, "place")} hold personal data and aren't on my map yet`, `${list}.`,
      "Add rows to privacy_data_map for each, or tell me they are not personal.", "info", false);
  } else await resolveIssue("privacy.map", "Vera: my map covers every place that holds an email or phone");
  await sb.from("privacy_clerk_state").update({ last_map_check_on: today }).eq("id", true);
}

async function tick() {
  const errors: string[] = [];
  const now = new Date().toISOString();
  await sb.from("privacy_clerk_state").update({ last_tick_at: now }).eq("id", true);
  try {
    // 1. every open privacy ticket gets a case
    const { data: open } = await sb.from("support_tickets").select("code").eq("kind", "privacy").eq("status", "open");
    const { data: have } = await sb.from("privacy_cases").select("ticket_code");
    const haveSet = new Set((have ?? []).map((x: { ticket_code: string }) => x.ticket_code));
    for (const o of (open ?? []) as { code: string }[]) if (!haveSet.has(o.code)) {
      const { error } = await sb.rpc("privacy_open_case", { p_code: o.code });
      if (error) errors.push(`${o.code}: ${plainError(error.message)}`);
    }
    // 2. work every case that is not finished
    const { data: cases } = await sb.from("privacy_cases").select("*").is("redacted_at", null);
    for (const c of (cases ?? []) as Case[]) {
      // a cancelled case still holds their email and phone until it is redacted: keep trying until it is
      if (c.status === "cancelled") {
        const { error } = await sb.rpc("privacy_redact", { p_case: c.id });
        if (error) errors.push(`${c.ticket_code}: ${plainError(error.message)}`);
        continue;
      }
      const t = await loadTicket(c.ticket_code);
      if (!t) continue;
      // closed by hand while unfinished: stand down
      if (t.status !== "open" && !["done"].includes(c.status) && !c.executed_at) {
        await sb.from("privacy_cases").update({ status: "cancelled", note: "The ticket was closed by hand.", done_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", c.id);
        await resolveIssue(`privacy.case.${c.ticket_code}`, `Vera: ${c.ticket_code} was closed by hand`);
        const { error } = await sb.rpc("privacy_redact", { p_case: c.id });
        if (error) errors.push(`${c.ticket_code}: ${plainError(error.message)}`);
        continue;
      }
      await safely(c, t, errors);
    }
    await mapCheck();
  } catch (e) { errors.push(plainError(e)); }

  const ok = errors.length === 0;
  await sb.from("privacy_clerk_state").update({ ...(ok ? { last_ok_at: new Date().toISOString() } : {}), last_error: ok ? null : errors.join(" | ").slice(0, 500) }).eq("id", true);
  if (ok) await resolveIssue("privacy.clerk", "Vera: back on track");
  return { ok, errors };
}

// ---------------------------------------------------------------- entry
async function allowed(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (bearer && SERVICE_KEYS.has(bearer)) return true;
  if (!bearer) return false;
  const { data: { user } } = await sb.auth.getUser(bearer);
  if (!user) return false;
  const { data } = await sb.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return J({ ok: false, error: "method not allowed" }, 405);
  if (!(await allowed(req))) return J({ ok: false, error: "unauthorized" }, 401);
  let p: Record<string, unknown> = {};
  try { p = await req.json(); } catch { /* empty body means tick */ }
  const run = String(p.run ?? "tick");
  const code = String(p.code ?? "");
  if ((run === "case" || run === "execute") && /^[A-Z]-\d{4}$/.test(code)) {
    const errors: string[] = [];
    await runOne(code, errors);
    return J({ ok: errors.length === 0, errors });
  }
  return J(await tick());
});

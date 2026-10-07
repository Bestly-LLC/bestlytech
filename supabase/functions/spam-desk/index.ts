// spam-desk: the employee that handles spam and phishing in Jared's two mailboxes (2026-10-07).
// Plan: docs/scout-vision-spam-opusplan.md Part C. Damages research: docs/spam-damages.md.
//
// Three kinds of caller, three kinds of auth (verify_jwt is OFF, auth is done here, same as meeting-recorder):
//   admin   Supabase JWT + has_role('admin')   the /admin pages
//   service the service key                    pg_cron (op auto) and Scout (op mark through admin-chat)
//   agent   header x-recorder-key              the Mac mini worker (scripts/meetingrec/mailspam.py); the key is
//                                              checked as sha256 against meeting_recorder_state.key_sha256
//
//   admin / service ops
//     mark {draft_id | mail_id | from [+subject], verdict?}   the Spam button: report, junk, block, teach the drafter
//     undo {id} (= not_spam)     "Not spam" on a report, any time: unblock + protect the sender, mark it legit, the Mac mini
//                                moves the email back to the inbox, and if reports already went out each desk gets a short
//                                "sent in error, please disregard" note (2026-10-07, after Mom and esearch were junked)
//     protect {draft_id | mail_id | from}   "Not spam": the sender joins bestly_mail_protected, the card is dismissed
//     unprotect {from, mail_id}             its undo
//     list | blocklist | unblock {id} | retry {id}
//     draft_letter {claim_id}    free AI writes the demand letter (nothing is sent)
//     claim_edit {claim_id, ...} | set_status {claim_id, status, notes?}
//     approve_send {claim_id, to, confirm:true}   ADMIN JWT ONLY. The only thing here that mails a business, and only
//                                                 after Jared's confirm dialog. Scout and the cron can never call it.
//   service op
//     auto                       hourly: judge new mail, report clear phishing, make Spam? cards, junk blocked senders, watchdog
//   agent ops
//     claim | source {id, eml_b64} | junked {id} | fail {id, error, code} | restored {id, missing?} | disposed {id, missing?}
//
// Guardrails (tightened 2026-10-07 after Mom and esearch.com were wrongly reported): never touch anyone in his iCloud
// contacts (mail_contacts, synced daily), a protected sender, a sender he emailed, a forward, or a sender who has written
// before; auto-report only at confidence >= 0.95, and every "Not spam" undo becomes a lesson the classifier reads next
// hour. Replies from the abuse desks are moved to Trash by the Mac mini and become a silent note instead (spam_desk_replies).
// Original rules: reports go plain (no signature) from
// jared@bestly.tech, one per recipient, at most 8 recipients per email and 60 report emails a day; every send is in
// email_send_log (template spam-report); scams and phishing are only ever reported, never claimed.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { SECRET_KEY, isServiceRequest } from "../_shared/keys.ts";
import { corsWith } from "../_shared/cors.ts";
import { llm, LlmUnavailable } from "../_shared/free-llm.ts";
import { sendAsJared } from "../_shared/bestly-signature.ts";
import { fetchContactEmails } from "../ava-assistant/contacts.ts";
import {
  FREEMAIL, STATUTE_NOTE, addrOf, domainOf, isBlocked, laTime, matchesProtected, parseHeaders, rdapEmail, registrable, sendingIp,
  type BlockRow, relayOrigin, senderIsBrand } from "../_shared/spam-rules.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRET_KEY, { auth: { persistSession: false } });
const CORS = corsWith({ headers: "authorization, content-type, apikey, x-client-info, x-recorder-key", methods: "POST, OPTIONS" });
// deno-lint-ignore no-explicit-any
type A = Record<string, any>;
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

const BUCKET = "spam-mail";
const MAX_RECIPIENTS = 8;
const DAILY_REPORT_CAP = 60;
const MAX_EML = 9 * 1024 * 1024;
const OWN = /(^|@)(jared(best)?@|bestly\.tech$)/i;
const TZ = "America/Los_Angeles";
const laDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ───────────────────────── small database helpers ───────────────────────── */

async function activeBlocklist(): Promise<BlockRow[]> {
  const { data } = await db.from("mail_blocklist").select("pattern, kind").eq("active", true).limit(5000);
  return (data ?? []) as BlockRow[];
}
async function protectedPatterns(): Promise<string[]> {
  const { data } = await db.from("bestly_mail_protected").select("pattern").limit(2000);
  return (data ?? []).map((r: A) => String(r.pattern));
}
/** Which of these addresses has Jared ever written to (bestly_sent_mail.to_addrs is plain text)? */
async function emailedSet(addrs: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const list = [...new Set(addrs.filter(Boolean))];
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    const { data } = await db.from("bestly_sent_mail").select("to_addrs")
      .or(chunk.map((a) => `to_addrs.ilike."%${a.replace(/[%"\\]/g, "")}%"`).join(",")).limit(200);
    const hay = (data ?? []).map((r: A) => String(r.to_addrs ?? "").toLowerCase()).join("\n");
    for (const a of chunk) if (hay.includes(a)) out.add(a);
  }
  return out;
}
async function notifyDone(title: string, body: string, key: string, url = "/admin/spam") {
  // success + silent: it never buzzes, and the 7 PM recap counts it under Spam Desk. url deep-links to the report's Not spam button.
  await db.from("admin_notifications").upsert(
    { kind: "mail.spam", title: clip(title, 200), body: clip(body, 500), url, severity: "success", silent: true, agent_slug: "spam-desk", dedupe_key: key },
    { onConflict: "dedupe_key", ignoreDuplicates: true });
}
const raise = (key: string, kind: "problem" | "resolved", title: string, body: string, needs?: string) =>
  db.rpc("bestly_raise", { p_key: key, p_kind: kind, p_severity: "warning", p_title: title, p_body: body, p_area: "mail", p_needs_jared: needs ?? null, p_healed: false });

/* ───────────────────────── contacts, lessons, desk replies (2026-10-07) ───────────────────────── */

const AUTO_MIN_CONFIDENCE = 0.95;

async function vaultSecret(name: string): Promise<string | null> {
  const { data, error } = await db.rpc("ava_secret", { p_name: name });
  return error || typeof data !== "string" || !data ? null : data;
}

/** Jared's iCloud contacts' email addresses into mail_contacts, at most once every 20 hours. Never throws. */
async function syncContacts(out: A): Promise<void> {
  try {
    const { data: last } = await db.from("mail_contacts").select("synced_at").order("synced_at", { ascending: false }).limit(1);
    if (last?.[0] && Date.now() - new Date(last[0].synced_at).getTime() < 20 * 3600e3) return;
    const [user, pass] = await Promise.all([vaultSecret("ava_caldav_icloud_user"), vaultSecret("ava_caldav_icloud_pass")]);
    if (!user || !pass) { out.contacts = "no iCloud login saved"; return; }
    const start = new Date().toISOString();
    const trace: string[] = [];
    const { emails } = await fetchContactEmails({ user, pass }, trace);
    if (!emails.length) { out.contacts = `none found (${trace.join(" | ")})`; return; }
    for (let i = 0; i < emails.length; i += 500) {
      await db.from("mail_contacts").upsert(emails.slice(i, i + 500).map((e) => ({ email: e.email, name: e.name, synced_at: start })));
    }
    await db.from("mail_contacts").delete().lt("synced_at", start);      // removed from his contacts: drop it
    out.contacts = emails.length;
  } catch (e) {
    console.error("contacts sync", e);
    out.contacts = `failed: ${(e as Error).message}`.slice(0, 120);
  }
}

async function contactSet(addrs: string[]): Promise<Set<string>> {
  const list = [...new Set(addrs.filter(Boolean).map((a) => a.toLowerCase()))];
  if (!list.length) return new Set();
  const { data } = await db.from("mail_contacts").select("email").in("email", list);
  return new Set((data ?? []).map((r: A) => String(r.email)));
}

/** Senders who wrote before this week: not strangers, so never auto-reported (esearch.com had mailed him for months). */
async function knownSenders(addrs: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const before = new Date(Date.now() - 3 * 86400e3).toISOString();
  for (const a of [...new Set(addrs.filter(Boolean))]) {
    const { count } = await db.from("bestly_mail").select("id", { count: "exact", head: true }).ilike("from_addr", `%${a}%`).lt("sent_at", before);
    if ((count ?? 0) > 0) out.add(a);
  }
  return out;
}

/** What Jared has said was NOT spam, newest first: shown to the classifier so the same mistake is not made twice. */
async function lessons(): Promise<string> {
  const { data } = await db.from("spam_reports").select("from_name, from_addr, subject").eq("status", "undone").order("updated_at", { ascending: false }).limit(20);
  if (!data?.length) return "";
  return `\nJared marked these NOT spam after they were wrongly flagged. Treat them, and mail like them from the same senders, as legit:\n` +
    data.map((r: A) => `- ${r.from_name ? `${r.from_name} ` : ""}<${r.from_addr}>: ${clip(r.subject, 100)}`).join("\n") + "\n";
}

/** Every address Spam Desk has ever sent a report or a retraction to, plus the standing target list. */
async function deskAddresses(): Promise<Set<string>> {
  const [t, l] = await Promise.all([
    db.from("spam_report_targets").select("email"),
    db.from("email_send_log").select("recipient_email").in("template_name", ["spam-report", "spam-retract"]).limit(2000),
  ]);
  return new Set([...(t.data ?? []).map((r: A) => String(r.email).toLowerCase()), ...(l.data ?? []).map((r: A) => String(r.recipient_email).toLowerCase())]);
}

const DESK_LOCAL = /abuse|phish|trust|safety|report|spam|complain|security|noreply|no-reply|support/i;
const DESK_SUBJECT = /(abuse|phish|spam|report|case|ticket|complaint|incident|disregard|trust\s*(and|&)\s*safety)/i;
/** A reply from an abuse desk to one of Spam Desk's reports (or a retraction). */
function isDeskReply(m: A, desks: Set<string>, deskDomains: Set<string>): boolean {
  const a = addrOf(m.from_addr);
  if (!a || !DESK_SUBJECT.test(String(m.subject ?? ""))) return false;
  if (desks.has(a)) return true;
  return deskDomains.has(registrable(domainOf(a))) && DESK_LOCAL.test(a.split("@")[0]);
}

/* ───────────────────────── classifying ───────────────────────── */

const SPAM_CLASSES = new Set(["phishing", "commercial", "spam"]);

/** Cheap first guess when Jared taps Spam: the free AI refines it before the report goes out. */
function guessVerdict(m: A): "phishing" | "commercial" | "spam" {
  const t = `${m.subject ?? ""} ${String(m.body_text ?? "").slice(0, 1500)}`.toLowerCase();
  const unsub = /unsubscribe|opt[- ]?out|manage (your )?preferences/.test(t);
  const phishy = /(verify your|confirm your|account (has been )?(suspended|locked|limited|on hold)|unusual (sign|activity)|password (will )?(expire|reset)|click (here|below|the link) to|delivery (failed|attempt|notification)|re-?schedule (the |your )?delivery|customs fee|parcel|package (is|has|could)|gift ?card|wire transfer|payment (failed|declined)|security alert)/.test(t);
  if (phishy && !unsub) return "phishing";
  if (unsub) return "commercial";
  return "spam";
}

type Verdict = { verdict: string; confidence: number; brand: string; reasons: string[]; business: string; us_business: boolean | null };

const links = (body: string) => [...new Set([...body.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()))].slice(0, 5);

/** One batch of emails -> verdicts, on free AI only ("triage", paid never). */
async function classify(mails: A[]): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  if (!mails.length) return out;
  const items = mails.map((m, i) => {
    const body = String(m.body_text ?? "");
    return {
      i, from: (() => {
        const orig = relayOrigin(addrOf(m.from_addr));
        return orig ? `${m.from_name ?? ""} <${orig}> (forwarded by Apple Hide My Email)` : `${m.from_name ?? ""} <${m.from_addr}>`;
      })(), subject: clip(m.subject, 160), to: m.mailbox, link_domains: links(body),
      has_unsubscribe: /unsubscribe/i.test(body), snippet: body.replace(/\s+/g, " ").slice(0, 420),
    };
  });
  const system =
    `You triage email for Jared Best, founder of Bestly LLC (a small product studio in West Hollywood). For each email give a verdict:\n` +
    `legit = a real person, a business he works with, a receipt, an account or shipping notice he would expect. When in doubt, legit or unsure, never phishing.\n` +
    `phishing = pretends to be a brand, agency or person to steal logins, money or data (fake parcel or delivery notices, fake invoices, fake account or security alerts, gift-card or crypto scams, extortion, a link-only body from a sender whose domain does not match the brand).\n` +
    `commercial = an advertisement or cold sales pitch selling something, from a business he has no evident relationship with.\n` +
    `unsure = cannot tell.\n` +
    `Apple Hide My Email relay addresses are normal and never a sign of phishing: judge the original sender shown. Mail whose sender domain belongs to the brand it names (robinhood.com for Robinhood) is that brand's real mail, not phishing.\n` +
    `confidence 0 to 1. brand = the brand being impersonated or advertised, else "". reasons = up to 3 short concrete reasons. ` +
    `business = the advertiser's company name for commercial, else "". us_business = true if the advertiser appears US-based, false if clearly not, null if unknown.\n` +
    `A forwarded email ("Fwd:") from a person is that person sharing something with Jared: legit, even if what they forwarded looks like a scam.\n` +
    (await lessons()) +
    `Return JSON only: {"items":[{"i":0,"verdict":"legit","confidence":0.9,"brand":"","reasons":[],"business":"","us_business":null}]}`;
  try {
    const r = await llm({
      task: "triage", system, user: JSON.stringify(items), json: true, job: "spam-desk", fn: "spam-desk", scope: "background", paid: "never",
      maxTokens: 400 + items.length * 120, deadlineMs: 50_000,
      validate: (j) => (Array.isArray(j?.items) ? null : "no items array"),
    });
    for (const it of r.json.items as A[]) {
      const m = mails[Number(it.i)];
      if (!m) continue;
      const v = String(it.verdict ?? "").toLowerCase();
      out.set(m.id, {
        verdict: ["legit", "phishing", "commercial", "unsure"].includes(v) ? v : "unsure",
        confidence: Math.max(0, Math.min(1, Number(it.confidence) || 0)),
        brand: clip(it.brand, 60), reasons: (Array.isArray(it.reasons) ? it.reasons : []).map((x: unknown) => clip(x, 140)).slice(0, 3),
        business: clip(it.business, 80), us_business: typeof it.us_business === "boolean" ? it.us_business : null,
      });
    }
  } catch (e) {
    if (!(e instanceof LlmUnavailable)) console.error("classify", e);
    else console.error("classify: free AI unavailable", e.reason);
  }
  return out;
}

/* ───────────────────────── finding the email ───────────────────────── */

const MAIL_COLS = "id, mailbox, folder, message_id, from_addr, from_name, to_addrs, subject, sent_at, body_text";

async function findMail(a: A): Promise<{ mail?: A; draft?: A | null; error?: string }> {
  let draft: A | null = null;
  let mailId = a.mail_id ? String(a.mail_id) : "";
  if (a.draft_id) {
    const { data } = await db.from("scout_daily").select("id, source_key, status, action").eq("id", String(a.draft_id)).maybeSingle();
    if (!data) return { error: "That card no longer exists." };
    draft = data;
    mailId = String(data.source_key ?? "").replace(/^mail:/, "");
  }
  let mail: A | null = null;
  if (mailId) {
    const { data } = await db.from("bestly_mail").select(MAIL_COLS).eq("id", mailId).maybeSingle();
    mail = data;
  } else if (a.from || a.subject) {
    let q = db.from("bestly_mail").select(MAIL_COLS).eq("folder", "INBOX");
    const clean = (s: string) => s.replace(/[^\w@.\- ]/g, "").slice(0, 80);
    if (a.from) q = q.or(`from_addr.ilike.%${clean(String(a.from))}%,from_name.ilike.%${clean(String(a.from))}%`);
    if (a.subject) q = q.ilike("subject", `%${clean(String(a.subject))}%`);
    const { data } = await q.order("sent_at", { ascending: false }).limit(1);
    mail = data?.[0] ?? null;
  }
  if (!mail) return { error: "I couldn't find that email in the synced mail." };
  if (!draft) {
    const { data } = await db.from("scout_daily").select("id, source_key, status, action").eq("kind", "draft").eq("source_key", `mail:${mail.id}`).eq("status", "open").limit(1);
    draft = data?.[0] ?? null;
  }
  return { mail, draft };
}

/* ───────────────────────── claims (damages file) ───────────────────────── */

/** Rebuild the damages file for one advertiser from its commercial reports (idempotent; undo and refine call it too). */
async function recomputeClaim(domain: string, v?: { business?: string; us_business?: boolean | null }) {
  if (!domain || FREEMAIL.has(domain)) return;
  const { data } = await db.from("spam_reports").select("id, from_addr, sent_at, created_at, status, verdict")
    .eq("verdict", "commercial").neq("status", "undone").ilike("from_addr", `%${domain}%`).limit(500);
  const rows = (data ?? []).filter((r: A) => registrable(domainOf(addrOf(r.from_addr))) === domain);
  const { data: ex } = await db.from("spam_claims").select("*").eq("advertiser_domain", domain).maybeSingle();
  if (!rows.length) {
    if (ex && ex.status === "open") await db.from("spam_claims").update({ report_ids: [], email_count: 0, amount_claimed: 0, updated_at: new Date().toISOString() }).eq("id", ex.id);
    return;
  }
  if (v?.us_business === false && !ex) return;                    // clearly not a US business: nothing to collect
  const times = rows.map((r: A) => Date.parse(r.sent_at ?? r.created_at)).filter(Number.isFinite);
  const patch = {
    email_count: rows.length, report_ids: rows.map((r: A) => r.id), amount_claimed: rows.length * 1000,
    first_at: new Date(Math.min(...times)).toISOString(), last_at: new Date(Math.max(...times)).toISOString(),
    statute_note: STATUTE_NOTE, updated_at: new Date().toISOString(),
  };
  if (ex) {
    await db.from("spam_claims").update({ ...patch, business_name: ex.business_name ?? (v?.business || null) }).eq("id", ex.id);
  } else {
    await db.from("spam_claims").insert({
      advertiser_domain: domain, business_name: v?.business || null, status: "open", ...patch,
      notes: v?.us_business === null || v?.us_business === undefined ? "US business not confirmed yet." : null,
    });
    await notifyDone(`Spam Desk opened a damages file on ${domain}`, "Commercial spam from a business. A demand letter can be drafted on the Spam page; nothing is sent without your yes.", `spam-claim-open-${domain}`);
  }
}

/* ───────────────────────── creating a report (tap, auto, blocked) ───────────────────────── */

type Created = { report: A; blocked: string[]; already?: boolean };

async function createReport(m: A, o: {
  verdict: string; how: "tap" | "auto" | "blocked"; reasons?: string[]; brand?: string; draft?: A | null; by?: string | null;
  status?: "queued" | "junk_only"; v?: Verdict | null; block?: boolean; protectedPats?: string[]; emailed?: Set<string>;
}): Promise<Created> {
  const msgId = m.message_id || `id:${m.id}`;
  const { data: ex } = await db.from("spam_reports").select("*").eq("mailbox", m.mailbox).eq("message_id", msgId).maybeSingle();
  if (ex && ex.status !== "undone") return { report: ex, blocked: [], already: true };

  const base = {
    mail_id: m.id, mailbox: m.mailbox, message_id: msgId, from_addr: addrOf(m.from_addr) || m.from_addr, from_name: m.from_name ?? null,
    subject: clip(m.subject, 300), sent_at: m.sent_at ?? null, verdict: o.verdict, how: o.how, brand: o.brand || null,
    reasons: o.reasons ?? [], status: o.status ?? "queued", draft_id: o.draft?.id ?? null, created_by: o.by ?? null,
    error: null, error_code: null, tries: 0, claimed_at: null, junked_at: null, eml_path: null, targets: [], sent_to: [], sent_at_report: null,
    updated_at: new Date().toISOString(),
  };
  const { data: rep, error } = ex
    ? await db.from("spam_reports").update(base).eq("id", ex.id).select().single()
    : await db.from("spam_reports").insert(base).select().single();
  if (error || !rep) throw new Error(`could not save the report: ${error?.message}`);

  // block: the address always, the whole domain unless it is a mail provider, ours, protected, or someone he wrote to
  const undo: A = { blocked: [] as string[], drafts: [] as A[], verdict_inserted: false };
  const blockedPatterns: string[] = [];
  if (o.block !== false) {
    const addr = addrOf(m.from_addr);
    const dom = registrable(domainOf(addr));
    const pats = o.protectedPats ?? await protectedPatterns();
    const emailed = o.emailed ?? await emailedSet([addr]);
    const want: { pattern: string; kind: "address" | "domain" }[] = [];
    if (addr && !OWN.test(addr)) want.push({ pattern: addr, kind: "address" });
    if (dom && !FREEMAIL.has(dom) && dom !== "bestly.tech" && !matchesProtected(pats, `x@${dom}`) && !matchesProtected(pats, addr) && !emailed.has(addr)) {
      want.push({ pattern: dom, kind: "domain" });
    }
    for (const w of want) {
      const { data: have } = await db.from("mail_blocklist").select("id, active").eq("pattern", w.pattern).maybeSingle();
      if (have?.active) continue;
      const reason = `${o.how === "auto" ? "Caught automatically" : "You tapped Spam"}: ${o.verdict}${m.subject ? ` ("${clip(m.subject, 60)}")` : ""}`;
      const { data: row } = have
        ? await db.from("mail_blocklist").update({ active: true, reason, report_id: rep.id }).eq("id", have.id).select("id").single()
        : await db.from("mail_blocklist").insert({ pattern: w.pattern, kind: w.kind, reason, report_id: rep.id }).select("id").single();
      if (row) { undo.blocked.push(row.id); blockedPatterns.push(w.pattern); }
    }
  }

  // the Replies ready card goes away; every open card for this email does
  const { data: cards } = await db.from("scout_daily").select("id, status").eq("source_key", `mail:${m.id}`).eq("kind", "draft").in("status", ["open", "snoozed"]);
  for (const c of cards ?? []) {
    await db.from("scout_daily").update({ status: "dismissed", done_at: new Date().toISOString() }).eq("id", c.id);
    undo.drafts.push({ id: c.id, prev: c.status });
  }
  if (o.draft && !undo.drafts.some((d: A) => d.id === o.draft!.id)) {
    await db.from("scout_daily").update({ status: "dismissed", done_at: new Date().toISOString() }).eq("id", o.draft.id);
    undo.drafts.push({ id: o.draft.id, prev: o.draft.status ?? "open" });
  }

  // teach the drafter: scout-daily skips any email that has a spam verdict, and any blocked sender
  const { data: hadVerdict } = await db.from("mail_verdicts").select("mail_id").eq("mail_id", m.id).maybeSingle();
  await db.from("mail_verdicts").upsert({
    mail_id: m.id, verdict: o.verdict, confidence: o.how === "tap" ? 1 : (o.v?.confidence ?? null), brand: o.brand || null,
    reasons: o.reasons ?? [], business: o.v?.business ?? null, us_business: o.v?.us_business ?? null, at: new Date().toISOString(),
  });
  undo.verdict_inserted = !hadVerdict;
  await db.from("spam_reports").update({ undo }).eq("id", rep.id);

  if (o.verdict === "commercial" && o.how !== "tap") {        // a tap waits for the free AI's second look (opSource)
    await recomputeClaim(registrable(domainOf(addrOf(m.from_addr))), { business: o.v?.business || o.brand || undefined, us_business: o.v?.us_business ?? null });
  }
  return { report: { ...rep, undo }, blocked: blockedPatterns };
}

/* ───────────────────────── admin ops ───────────────────────── */

async function opMark(a: A, by: string | null): Promise<Response> {
  const f = await findMail(a);
  if (!f.mail) return J({ ok: false, error: f.error });
  const m = f.mail;
  if (OWN.test(addrOf(m.from_addr))) return J({ ok: false, error: "That email is from you or Bestly, so I won't report it." });
  const { data: known } = await db.from("mail_verdicts").select("verdict, brand, reasons, business, us_business, confidence").eq("mail_id", m.id).maybeSingle();
  const given = SPAM_CLASSES.has(String(a.verdict)) ? String(a.verdict) : "";
  const verdict = given || (known && SPAM_CLASSES.has(known.verdict) ? known.verdict : guessVerdict(m));
  const reasons: string[] = known?.reasons?.length ? known.reasons : ["Jared tapped Spam"];
  const c = await createReport(m, {
    verdict, how: "tap", reasons, brand: known?.brand ?? "", draft: f.draft, by,
    v: known ? { ...known, confidence: 1 } as Verdict : null,
  });
  if (c.already) return J({ ok: true, already: true, report: c.report, message: "Already reported." });
  return J({ ok: true, report: { id: c.report.id, verdict, status: c.report.status }, blocked: c.blocked, message: "Reported as spam. Sender blocked." });
}

/** "Not spam" on a report, at any stage. Everything the report did gets reversed as far as it can be:
 *  blocks off, sender protected and marked legit, drafts back, the email moved out of Junk by the Mac mini,
 *  and when report emails already went out, each desk gets a one-line "sent in error" note. Idempotent. */
async function opUndo(a: A): Promise<Response> {
  const { data: r } = await db.from("spam_reports").select("*").eq("id", String(a.id ?? "")).maybeSingle();
  if (!r) return J({ ok: false, error: "No such report." }, 404);
  const u = { ...((r.undo ?? {}) as A) };
  const addr = addrOf(r.from_addr ?? "");

  // 1. unblock: the rows this report made, plus anything else blocking this sender or its domain
  for (const id of u.blocked ?? []) await db.from("mail_blocklist").update({ active: false }).eq("id", id);
  if (addr) {
    await db.from("mail_blocklist").update({ active: false }).eq("pattern", addr);
    const dom = domainOf(addr);
    if (dom && !FREEMAIL.has(dom)) await db.from("mail_blocklist").update({ active: false }).eq("pattern", registrable(dom));
  }
  // 2. protect the sender so the hourly check never judges them again
  if (addr && !OWN.test(addr)) {
    const { data: have } = await db.from("bestly_mail_protected").select("pattern").eq("pattern", addr).maybeSingle();
    if (!have) await db.from("bestly_mail_protected").insert({ pattern: addr, reason: "Not spam (you undid a Spam Desk report)" });
  }
  // 3. the verdict and any drafts the report dismissed
  if (r.mail_id) await db.from("mail_verdicts").upsert({ mail_id: r.mail_id, verdict: "legit", confidence: 1, reasons: ["Jared said not spam"], at: new Date().toISOString() });
  for (const d of u.drafts ?? []) await db.from("scout_daily").update({ status: d.prev ?? "open", done_at: null }).eq("id", d.id).eq("status", "dismissed");
  // 4. the Mac mini moves it back to the inbox (it searches the inbox too, so a never-junked one just gets un-flagged)
  if (!u.restore || u.restore === "failed") u.restore = "queued";
  u.undone_at = u.undone_at ?? new Date().toISOString();
  // 5. reports that already went out: tell each desk to disregard it
  const sentTo: string[] = r.sent_to ?? [];
  const retracted = new Set<string>(u.retracted ?? []);
  for (const to of sentTo) {
    if (retracted.has(to)) continue;
    const text =
      `Hello,\n\nPlease disregard my earlier report about this email. It was sent in error by my automated filter. ` +
      `The sender is legitimate and no action is needed.\n\n` +
      `From: ${r.from_name ? `${r.from_name} ` : ""}<${r.from_addr}>\nSubject: ${r.subject ?? "(no subject)"}\n` +
      (r.sent_at_report ? `My report was sent: ${laTime(r.sent_at_report)} PT\n` : "") +
      `\nSorry for the noise.\n\nJared Best\njared@bestly.tech`;
    const sent = await sendAsJared(db, {
      to: [to], subject: clip(`Please disregard: report sent in error (${r.subject ?? "no subject"})`, 200), text,
      key: `spam-retract-${r.id}-${to}`, signature: false, bcc: false,
    });
    await db.from("email_send_log").insert({
      message_id: sent.id ?? `spam-retract-${r.id}-${to}`, template_name: "spam-retract", recipient_email: to,
      status: sent.ok ? "sent" : "failed", error_message: sent.ok ? null : sent.error, metadata: { report_id: r.id },
    });
    if (sent.ok) retracted.add(to);
    await new Promise((res) => setTimeout(res, 600));
  }
  u.retracted = [...retracted];
  await db.from("spam_reports").update({ status: "undone", undo: u, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", r.id);
  if (r.verdict === "commercial") await recomputeClaim(registrable(domainOf(addr)));
  const left = sentTo.filter((t) => !retracted.has(t));
  return J({
    ok: true, retracted: u.retracted, retract_failed: left,
    message: `Undone. ${addr || "The sender"} is unblocked and protected; the email is going back to your inbox.` +
      (u.retracted.length ? ` Told ${u.retracted.length} report desk${u.retracted.length === 1 ? "" : "s"} it was a mistake.` : "") +
      (left.length ? ` Could not reach ${left.join(", ")}.` : ""),
  });
}

async function opProtect(a: A): Promise<Response> {
  const f = await findMail(a);
  if (!f.mail) return J({ ok: false, error: f.error });
  const addr = addrOf(f.mail.from_addr);
  if (!addr) return J({ ok: false, error: "No sender address on that email." });
  const { data: have } = await db.from("bestly_mail_protected").select("pattern").eq("pattern", addr).maybeSingle();
  if (!have) await db.from("bestly_mail_protected").insert({ pattern: addr, reason: "Not spam (you tapped Not spam on a Spam? card)" });
  await db.from("mail_verdicts").upsert({ mail_id: f.mail.id, verdict: "legit", confidence: 1, reasons: ["Jared said not spam"], at: new Date().toISOString() });
  await db.from("mail_blocklist").update({ active: false }).eq("pattern", addr);
  if (f.draft) await db.from("scout_daily").update({ status: "dismissed", done_at: new Date().toISOString() }).eq("id", f.draft.id);
  return J({ ok: true, protected: addr, added: !have, mail_id: f.mail.id });
}

/** Undo for "Not spam": take the sender back out of bestly_mail_protected (only the row Not spam added). */
async function opUnprotect(a: A): Promise<Response> {
  const addr = addrOf(String(a.from ?? ""));
  if (!addr) return J({ ok: false, error: "from required" }, 400);
  await db.from("bestly_mail_protected").delete().eq("pattern", addr).like("reason", "Not spam%");
  if (a.mail_id) await db.from("mail_verdicts").delete().eq("mail_id", String(a.mail_id)).eq("verdict", "legit").contains("reasons", ["Jared said not spam"]);
  return J({ ok: true });
}

async function opList(): Promise<Response> {
  const [r, c, b] = await Promise.all([
    db.from("spam_reports").select("id, from_addr, from_name, subject, verdict, how, status, sent_to, error, created_at").order("created_at", { ascending: false }).limit(50),
    db.from("spam_claims").select("id, advertiser_domain, business_name, email_count, amount_claimed, status").order("updated_at", { ascending: false }).limit(20),
    db.from("mail_blocklist").select("id, pattern, kind, created_at").eq("active", true).order("created_at", { ascending: false }).limit(200),
  ]);
  return J({ ok: true, reports: r.data ?? [], claims: c.data ?? [], blocklist: b.data ?? [] });
}

async function opRetry(a: A): Promise<Response> {
  const { data: r } = await db.from("spam_reports").select("id, status, eml_path").eq("id", String(a.id ?? "")).maybeSingle();
  if (!r) return J({ ok: false, error: "No such report." }, 404);
  if (r.status === "sent" || r.status === "undone") return J({ ok: false, error: `It is already ${r.status}.` });
  const next = r.eml_path && r.status === "failed" ? "ready" : "queued";
  await db.from("spam_reports").update({ status: next, error: null, error_code: null, tries: 0, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", r.id);
  if (next === "ready") return J({ ok: true, ...(await sendReports(r.id)) });
  return J({ ok: true, status: next });
}

/* ───────────────────────── damages file ───────────────────────── */

const BUSINESS = { name: "Bestly LLC", person: "Jared Best", address: "733 North Kings Road #205, Los Angeles, CA 90069", email: "jared@bestly.tech" };

async function claimEvidence(claimId: string) {
  const { data: claim } = await db.from("spam_claims").select("*").eq("id", claimId).maybeSingle();
  if (!claim) return null;
  const ids = (claim.report_ids ?? []) as string[];
  const { data: reps } = ids.length
    ? await db.from("spam_reports").select("id, mailbox, from_addr, from_name, subject, sent_at, created_at, message_id").in("id", ids).order("sent_at", { ascending: true }).limit(200)
    : { data: [] as A[] };
  return { claim, reps: (reps ?? []) as A[] };
}

function templateLetter(claim: A, reps: A[]): string {
  const list = reps.map((r, i) => `${i + 1}. ${laTime(r.sent_at ?? r.created_at)} PT, to ${r.mailbox}, from ${r.from_name ? `${r.from_name} ` : ""}<${r.from_addr}>, subject "${r.subject}"`).join("\n");
  const who = claim.business_name || claim.advertiser_domain;
  return `${laTime(new Date())}

${who}
${claim.contact_address ?? ""}

Re: Unsolicited commercial email sent to ${[...new Set(reps.map((r) => r.mailbox))].join(", ")} (California Business and Professions Code section 17529.5)

To whom it may concern,

I received ${reps.length} unsolicited commercial email${reps.length === 1 ? "" : "s"} advertising ${who}. I never asked for them and I have no business relationship with you.

${list}

[Jared: add one sentence on what is wrong with the header or subject line, for example "the sender name hides who you are" or "the subject line says X but the message sells Y". The statute only applies to a forged header, a third party's domain, or a misleading subject line.]

California Business and Professions Code section 17529.5 lets a recipient recover $1,000 for each unsolicited commercial email that violates it, plus attorney's fees and costs. For ${reps.length} email${reps.length === 1 ? "" : "s"} that is $${(reps.length * 1000).toLocaleString("en-US")}.

Please stop sending email to my addresses, and within 14 days tell me in writing whether you will resolve this. If I do not hear from you I may take further steps.

Sincerely,
${BUSINESS.person}
${BUSINESS.name}
${BUSINESS.address}
${BUSINESS.email}`;
}

async function opDraftLetter(a: A): Promise<Response> {
  const ev = await claimEvidence(String(a.claim_id ?? ""));
  if (!ev) return J({ ok: false, error: "No such claim." }, 404);
  const { claim, reps } = ev;
  if (!reps.length) return J({ ok: false, error: "This claim has no emails in it." });
  let letter = "";
  let by = "free AI";
  try {
    const r = await llm({
      task: "write", json: false, job: "spam-desk-letter", fn: "spam-desk", scope: "background", paid: "never", maxTokens: 900, deadlineMs: 60_000,
      system:
        `You write a short, plain, firm demand letter for Jared Best (Bestly LLC, ${BUSINESS.address}, ${BUSINESS.email}) to a business that sent him unsolicited commercial email. ` +
        `Rules: use ONLY the facts given; invent nothing (no dates, names, amounts or claims about what the emails contain beyond what is listed). ` +
        `Cite California Business and Professions Code section 17529.5: $1,000 liquidated damages per unsolicited commercial email that violates it, plus reasonable attorney's fees and costs. ` +
        `List each email (date and time Pacific, sender, subject). State the total ($1,000 times the number of emails). Ask them to stop emailing him and to answer in writing within 14 days. ` +
        `Do not threaten anything except the legal remedy. Do not give legal advice. Do not use emoji. No headings. ` +
        `Where only Jared can say what makes the email unlawful (forged sender, someone else's domain, misleading subject line), leave ONE bracketed sentence for him to fill in, starting with [Jared:. ` +
        `Start with the date, then the business name, then "Re:" line, then the letter, sign off "Sincerely," with his name, company, address and email.`,
      user: JSON.stringify({
        today: laTime(new Date()), business: claim.business_name ?? claim.advertiser_domain, advertiser_domain: claim.advertiser_domain,
        business_address: claim.contact_address ?? null, email_count: reps.length, total_usd: reps.length * 1000,
        emails: reps.map((r) => ({ received_pacific: laTime(r.sent_at ?? r.created_at), to: r.mailbox, from: `${r.from_name ?? ""} <${r.from_addr}>`, subject: r.subject })),
      }),
    });
    letter = r.text.trim();
    if (letter.length < 250 || !/17529\.5/.test(letter)) letter = "";
  } catch (e) {
    if (!(e instanceof LlmUnavailable)) console.error("draft_letter", e);
  }
  if (!letter) { letter = templateLetter(claim, reps); by = "template"; }
  await db.from("spam_claims").update({ demand_letter: letter, status: claim.status === "open" ? "drafted" : claim.status, updated_at: new Date().toISOString() }).eq("id", claim.id);
  return J({ ok: true, letter, drafted_by: by, note: "Scout is not a lawyer. Read it, fill the [Jared: ...] line, and check that you never signed up with this business before you send it." });
}

async function opClaimEdit(a: A): Promise<Response> {
  const patch: A = { updated_at: new Date().toISOString() };
  for (const k of ["business_name", "contact_email", "contact_address", "demand_letter", "notes"]) if (k in a) patch[k] = a[k] === "" ? null : clip(a[k], k === "demand_letter" ? 12000 : 500);
  const { error } = await db.from("spam_claims").update(patch).eq("id", String(a.claim_id ?? ""));
  return error ? J({ ok: false, error: error.message }, 500) : J({ ok: true });
}

async function opSetStatus(a: A): Promise<Response> {
  const status = String(a.status ?? "");
  if (!["open", "drafted", "approved", "paid", "closed"].includes(status)) return J({ ok: false, error: "Status can be open, drafted, approved, paid or closed. Sent happens only through Send." }, 400);
  const patch: A = { status, updated_at: new Date().toISOString() };
  if ("notes" in a) patch.notes = clip(a.notes, 500);
  const { error } = await db.from("spam_claims").update(patch).eq("id", String(a.claim_id ?? ""));
  return error ? J({ ok: false, error: error.message }, 500) : J({ ok: true });
}

/** The only send to a business. Admin JWT only, explicit confirm, signed as Jared with the Bestly signature. */
async function opApproveSend(a: A): Promise<Response> {
  if (a.confirm !== true) return J({ ok: false, error: "confirm:true is required." }, 400);
  const to = String(a.to ?? "").trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(to)) return J({ ok: false, error: "A valid email address to send to is required." }, 400);
  const ev = await claimEvidence(String(a.claim_id ?? ""));
  if (!ev) return J({ ok: false, error: "No such claim." }, 404);
  const { claim, reps } = ev;
  if (!claim.demand_letter || claim.demand_letter.length < 100) return J({ ok: false, error: "Draft the letter first." });
  if (/\[Jared:/i.test(claim.demand_letter)) return J({ ok: false, error: "The letter still has a [Jared: ...] line to fill in." });
  if (claim.status === "sent" || claim.status === "paid") return J({ ok: false, error: `Already ${claim.status}.` });
  const r = await sendAsJared(db, {
    to: [to], subject: `Unsolicited commercial email to ${[...new Set(reps.map((x) => x.mailbox))][0] ?? "my address"}: California B&P 17529.5`,
    text: claim.demand_letter, key: `spam-claim-${claim.id}`,
  });
  await db.from("email_send_log").insert({
    message_id: r.id ?? `spam-claim-${claim.id}`, template_name: "spam-claim", recipient_email: to, status: r.ok ? "sent" : "failed",
    error_message: r.ok ? null : r.error, metadata: { claim_id: claim.id, domain: claim.advertiser_domain, emails: reps.length },
  });
  if (!r.ok) return J({ ok: false, error: r.error ?? "The send failed." });
  await db.from("spam_claims").update({ status: "sent", sent_at: new Date().toISOString(), sent_to: to, contact_email: claim.contact_email ?? to, updated_at: new Date().toISOString() }).eq("id", claim.id);
  return J({ ok: true, sent_to: to });
}

/* ───────────────────────── reporting: targets, RDAP, sending ───────────────────────── */

const kwRe = (k: string) => new RegExp(`(^|[^a-z0-9])${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);

async function rdap(url: string): Promise<A | null> {
  try {
    const r = await fetch(url, { headers: { Accept: "application/rdap+json, application/json" }, redirect: "follow", signal: AbortSignal.timeout(9000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

type Target = { email: string; source: string; subject?: string };

async function buildTargets(r: A, headers: [string, string][], body: string): Promise<{ targets: Target[]; ip: string | null }> {
  const phish = r.verdict === "phishing";
  const { data: cfg } = await db.from("spam_report_targets").select("email, applies, mailbox, brand_keywords, subject_override").eq("active", true);
  const hay = `${r.from_name ?? ""} ${r.from_addr ?? ""} ${r.subject ?? ""} ${r.brand ?? ""} ${body.slice(0, 3000)}`.toLowerCase();
  const out: Target[] = [];
  for (const t of (cfg ?? []) as A[]) {
    if (!(t.applies === "all" || (phish ? t.applies === "phishing" : t.applies === "spam"))) continue;
    if (t.mailbox && t.mailbox !== r.mailbox) continue;
    const kws = (t.brand_keywords ?? []) as string[];
    if (kws.length && !kws.some((k) => kwRe(k).test(hay))) continue;
    out.push({ email: String(t.email).toLowerCase(), source: "list", subject: t.subject_override ?? undefined });
  }
  const ip = sendingIp(headers);
  if (ip) {
    const j = await rdap(`https://rdap.org/ip/${ip}`);
    const e = j ? rdapEmail(j.entities, "abuse") : null;
    if (e) out.push({ email: e, source: `network ${ip}` });
  }
  const dom = registrable(domainOf(addrOf(r.from_addr)));
  if (dom && !FREEMAIL.has(dom)) {
    const j = await rdap(`https://rdap.org/domain/${dom}`);
    const e = j ? rdapEmail(j.entities, "abuse") : null;
    if (e) out.push({ email: e, source: `registrar of ${dom}` });
  }
  // dedupe; never the spammer's own address, never ourselves; at most 8
  const seen = new Set<string>();
  const final = out.filter((t) => {
    if (seen.has(t.email) || t.email === addrOf(r.from_addr) || OWN.test(t.email)) return false;
    seen.add(t.email);
    return true;
  }).slice(0, MAX_RECIPIENTS);
  return { targets: final, ip };
}

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Send every pending report email for one report (status ready). Safe to call again: sent recipients are skipped. */
async function sendReports(id: string): Promise<A> {
  const { data: r } = await db.from("spam_reports").select("*").eq("id", id).maybeSingle();
  if (!r) return { error: "no such report" };
  if (r.status !== "ready") return { skipped: r.status };
  if (!r.eml_path) return { error: "no source stored" };
  const { data: file, error: dl } = await db.storage.from(BUCKET).download(r.eml_path);
  if (dl || !file) {
    await db.from("spam_reports").update({ status: "failed", error: `could not read the stored email: ${dl?.message}`, updated_at: new Date().toISOString() }).eq("id", id);
    return { error: "download failed" };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const headers = parseHeaders(new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 60_000)));
  const { data: mail } = r.mail_id ? await db.from("bestly_mail").select("body_text").eq("id", r.mail_id).maybeSingle() : { data: null };
  const { targets, ip } = await buildTargets(r, headers, String(mail?.body_text ?? ""));

  const sinceDay = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { count } = await db.from("email_send_log").select("id", { count: "exact", head: true }).eq("template_name", "spam-report").eq("status", "sent").gte("created_at", sinceDay);
  let budget = DAILY_REPORT_CAP - (count ?? 0);

  const already = new Set<string>(r.sent_to ?? []);
  const results: A[] = ((r.targets ?? []) as A[]).filter((t) => t.ok);
  const phish = r.verdict === "phishing";
  const kind = phish ? "Phishing report" : "Spam report";
  const why = r.reasons?.length ? r.reasons.join("; ") : phish ? "it looks like phishing" : "it is unsolicited";
  let capped = false;
  for (const t of targets) {
    if (already.has(t.email)) continue;
    if (budget <= 0) { capped = true; break; }
    const text =
      `Hello,\n\nI am reporting an unwanted email. The original message is attached as original.eml with its full headers.\n\n` +
      `Received: ${laTime(r.sent_at ?? r.created_at)} PT, at ${r.mailbox}\n` +
      `From: ${r.from_name ? `${r.from_name} ` : ""}<${r.from_addr}>\nSubject: ${r.subject}\n` +
      (r.message_id && !r.message_id.startsWith("id:") ? `Message-ID: ${r.message_id}\n` : "") +
      (ip ? `Connecting network: ${ip}\n` : "") +
      `\nWhy I am reporting it: ${why}.${r.brand && phish ? ` It pretends to be ${r.brand}.` : ""}\n\n` +
      `I did not ask for this email and have no business relationship with the sender. Please investigate and act on the sender or the network that sent it.\n\n` +
      `Thank you,\nJared Best\njared@bestly.tech`;
    const sent = await sendAsJared(db, {
      to: [t.email], subject: clip(t.subject ?? `${kind}: ${r.subject ?? "(no subject)"}`, 200), text, key: `spam-report-${r.id}-${t.email}`,
      attachments: [{ filename: "original.eml", content: b64(bytes), content_type: "message/rfc822" }], signature: false, bcc: false,
    });
    await db.from("email_send_log").insert({
      message_id: sent.id ?? `spam-report-${r.id}-${t.email}`, template_name: "spam-report", recipient_email: t.email,
      status: sent.ok ? "sent" : "failed", error_message: sent.ok ? null : sent.error, metadata: { report_id: r.id, source: t.source },
    });
    results.push({ email: t.email, source: t.source, ok: sent.ok, error: sent.ok ? undefined : sent.error });
    if (sent.ok) { already.add(t.email); budget--; }
    await new Promise((res) => setTimeout(res, 600));      // Resend allows 2 requests a second
  }

  const sentTo = [...already];
  const patch: A = { targets: results, sent_to: sentTo, updated_at: new Date().toISOString() };
  if (capped) {
    patch.error = `Daily report limit (${DAILY_REPORT_CAP}) reached. The rest go out when the limit resets.`;
  } else if (sentTo.length) {
    patch.status = "sent"; patch.sent_at_report = new Date().toISOString(); patch.error = null;
  } else if (!targets.length) {
    patch.status = "junk_only"; patch.error = "No one to report to: no abuse contact found for this email.";
  } else {
    patch.status = "failed"; patch.error = `The report emails failed: ${results.map((x) => x.error).filter(Boolean)[0] ?? "unknown"}`;
  }
  await db.from("spam_reports").update(patch).eq("id", id);
  return { sent: sentTo.length, capped, targets: targets.map((t) => t.email) };
}

/* ───────────────────────── agent ops (Mac mini) ───────────────────────── */

async function opClaim(): Promise<Response> {
  const now = new Date();
  // a worker that died mid-job: give the job back (5 tries, then it fails for good)
  await db.from("spam_reports").update({ status: "queued", claimed_at: null })
    .eq("status", "fetching").lt("claimed_at", new Date(now.getTime() - 10 * 60e3).toISOString()).lt("tries", 5);
  await db.from("spam_reports").update({ status: "failed", error: "The Mac mini kept failing on this one.", error_code: "gave_up" })
    .in("status", ["queued", "fetching"]).gte("tries", 5);
  const { data: q } = await db.from("spam_reports").select("id, mailbox, message_id, tries").eq("status", "queued").order("created_at").limit(10);
  const jobs: A[] = [];
  for (const r of q ?? []) {
    const { data: got } = await db.from("spam_reports").update({ status: "fetching", claimed_at: now.toISOString(), tries: r.tries + 1 })
      .eq("id", r.id).eq("status", "queued").select("id").maybeSingle();
    if (got) jobs.push({ id: r.id, mailbox: r.mailbox, message_id: r.message_id, junk_only: false });
  }
  const room = 10 - jobs.length;
  if (room > 0) {
    const stale = new Date(now.getTime() - 10 * 60e3).toISOString();
    const { data: jo } = await db.from("spam_reports").select("id, mailbox, message_id, tries").eq("status", "junk_only").is("junked_at", null)
      .or(`claimed_at.is.null,claimed_at.lt.${stale}`).lt("tries", 5).order("created_at").limit(room);
    for (const r of jo ?? []) {
      await db.from("spam_reports").update({ claimed_at: now.toISOString(), tries: r.tries + 1 }).eq("id", r.id);
      jobs.push({ id: r.id, mailbox: r.mailbox, message_id: r.message_id, junk_only: true });
    }
  }
  // "Not spam" undos: move the email back out of Junk (stale claims are retried after 10 min, 5 tries)
  const room2 = 10 - jobs.length;
  if (room2 > 0) {
    const stale = new Date(now.getTime() - 10 * 60e3).toISOString();
    const { data: rs } = await db.from("spam_reports").select("id, mailbox, message_id, undo").eq("status", "undone").eq("undo->>restore", "queued")
      .or(`claimed_at.is.null,claimed_at.lt.${stale}`).order("updated_at").limit(room2);
    for (const r of rs ?? []) {
      const u = (r.undo ?? {}) as A;
      const tries = Number(u.restore_tries ?? 0) + 1;
      if (tries > 5) { await db.from("spam_reports").update({ undo: { ...u, restore: "failed" } }).eq("id", r.id); continue; }
      await db.from("spam_reports").update({ claimed_at: now.toISOString(), undo: { ...u, restore_tries: tries } }).eq("id", r.id);
      jobs.push({ id: r.id, mailbox: r.mailbox, message_id: r.message_id, restore: true });
    }
  }
  // desk replies: off to Trash
  const room3 = 10 - jobs.length;
  if (room3 > 0) {
    const stale = new Date(now.getTime() - 10 * 60e3).toISOString();
    await db.from("spam_desk_replies").update({ status: "failed" }).eq("status", "queued").gte("tries", 5);
    const { data: ds } = await db.from("spam_desk_replies").select("mail_id, mailbox, message_id, tries").eq("status", "queued")
      .or(`claimed_at.is.null,claimed_at.lt.${stale}`).order("created_at").limit(room3);
    for (const d of ds ?? []) {
      await db.from("spam_desk_replies").update({ claimed_at: now.toISOString(), tries: d.tries + 1 }).eq("mail_id", d.mail_id);
      jobs.push({ id: d.mail_id, mailbox: d.mailbox, message_id: d.message_id, dispose: true });
    }
  }
  return J({ ok: true, jobs });
}

async function opDisposed(a: A): Promise<Response> {
  await db.from("spam_desk_replies").update({ status: a.missing ? "missing" : "done", done_at: new Date().toISOString(), claimed_at: null }).eq("mail_id", String(a.id ?? ""));
  await workerWorks();
  return J({ ok: true });
}

async function opRestored(a: A): Promise<Response> {
  const { data: r } = await db.from("spam_reports").select("id, undo").eq("id", String(a.id ?? "")).maybeSingle();
  if (!r) return J({ ok: false, error: "no such report" }, 404);
  const u = (r.undo ?? {}) as A;
  await db.from("spam_reports").update({ undo: { ...u, restore: a.missing ? "missing" : "done", restored_at: new Date().toISOString() }, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", r.id);
  await workerWorks();
  return J({ ok: true });
}

async function workerWorks() {
  await raise("mail.spam.automation", "resolved", "Mail automation is allowed again", "The Mac mini worker can read and junk mail.");
}

async function opSource(a: A): Promise<Response> {
  const id = String(a.id ?? "");
  const { data: r } = await db.from("spam_reports").select("*").eq("id", id).maybeSingle();
  if (!r) return J({ ok: false, error: "no such report" }, 404);
  if (r.status === "undone") return J({ ok: true, skipped: "undone" });
  if (r.status === "sent") return J({ ok: true, skipped: "sent" });
  const raw = String(a.eml_b64 ?? "");
  if (!raw) return J({ ok: false, error: "eml_b64 required" }, 400);
  if (raw.length > MAX_EML * 1.4) {
    await db.from("spam_reports").update({ status: "failed", error: "The email is too large to attach (over 9 MB).", error_code: "too_big" }).eq("id", id);
    return J({ ok: false, error: "too_big" });
  }
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)); } catch { return J({ ok: false, error: "bad base64" }, 400); }
  const path = `${String(r.created_at).slice(0, 7)}/${r.id}.eml`;
  const { error: up } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "message/rfc822", upsert: true });
  if (up) return J({ ok: false, error: `storage: ${up.message}` }, 500);
  await db.from("spam_reports").update({ status: "ready", eml_path: path, error: null, error_code: null, junked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  await workerWorks();

  // Jared's tap decided "spam"; the free AI only sharpens it into phishing / commercial for targeting and claims
  let verdict: string = r.verdict;
  let biz: { business?: string; us_business?: boolean | null } | undefined;
  if (r.how === "tap" && r.mail_id && !r.reasons?.some((x: string) => x !== "Jared tapped Spam")) {
    const { data: m } = await db.from("bestly_mail").select(MAIL_COLS).eq("id", r.mail_id).maybeSingle();
    const v = m ? (await classify([m])).get(m.id) : undefined;
    if (v && (v.verdict === "phishing" || v.verdict === "commercial") && v.confidence >= 0.6) {
      verdict = v.verdict;
      biz = { business: v.business, us_business: v.us_business };
      await db.from("spam_reports").update({ verdict, brand: v.brand || null, reasons: v.reasons.length ? v.reasons : r.reasons }).eq("id", id);
      await db.from("mail_verdicts").upsert({ mail_id: r.mail_id, verdict, confidence: 1, brand: v.brand || null, reasons: v.reasons, business: v.business || null, us_business: v.us_business, at: new Date().toISOString() });
    } else if (v?.reasons.length) {
      await db.from("spam_reports").update({ reasons: v.reasons, brand: v.brand || r.brand }).eq("id", id);
    }
  }
  // a tap opens (or feeds) the damages file only now that the verdict is settled
  if (r.how === "tap" && (verdict === "commercial" || r.verdict === "commercial")) {
    if (!biz && r.mail_id) {
      const { data: kv } = await db.from("mail_verdicts").select("business, us_business").eq("mail_id", r.mail_id).maybeSingle();
      if (kv) biz = { business: kv.business ?? undefined, us_business: kv.us_business };
    }
    await recomputeClaim(registrable(domainOf(addrOf(r.from_addr))), biz);
  }
  const sent = await sendReports(id);
  return J({ ok: true, ...sent });
}

async function opJunked(a: A): Promise<Response> {
  const { data: r } = await db.from("spam_reports").select("id, status").eq("id", String(a.id ?? "")).maybeSingle();
  if (!r) return J({ ok: false, error: "no such report" }, 404);
  await db.from("spam_reports").update({ junked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", r.id);
  await workerWorks();
  return J({ ok: true });
}

async function opFail(a: A): Promise<Response> {
  const id = String(a.id ?? "");
  const code = clip(a.code, 40);
  const error = clip(a.error, 500);
  const { data: r } = await db.from("spam_reports").select("id, status, tries").eq("id", id).maybeSingle();
  if (!r) return J({ ok: false, error: "no such report" }, 404);
  if (code === "automation_denied") {
    // macOS has not let the worker script control Mail yet: nothing is lost, the job waits and Jared clicks Allow once
    await db.from("spam_reports").update({ status: r.status === "fetching" ? "queued" : r.status, claimed_at: null, tries: Math.max(0, r.tries - 1), error, error_code: code }).eq("id", id);
    await raise("mail.spam.automation", "problem", "Mail needs your OK on the Mac mini",
      "The spam worker on the Mac mini is not allowed to control Mail yet, so reported spam can't be moved to Junk or sent to Apple and the others.",
      "Click Allow on the Mac mini for Mail (System Settings, Privacy & Security, Automation: turn on Mail for Terminal or python3).");
    return J({ ok: true });
  }
  if (code === "not_found" && r.status === "fetching" && r.tries < 4) {
    // Apple Mail may not have synced it yet, or it already moved: try again a few times before giving up
    await db.from("spam_reports").update({ status: "queued", claimed_at: null, error }).eq("id", id);
    return J({ ok: true, retry: true });
  }
  const patch: A = { error, error_code: code, updated_at: new Date().toISOString() };
  if (r.status === "fetching" || r.status === "queued") patch.status = "failed";
  await db.from("spam_reports").update(patch).eq("id", id);
  return J({ ok: true });
}

/* ───────────────────────── the hourly job ───────────────────────── */

async function opAuto(): Promise<Response> {
  const t0 = Date.now();
  const since = new Date(Date.now() - 3 * 3600e3).toISOString();
  const out: A = { blocked_junked: 0, judged: 0, auto_reported: 0, spam_cards: 0, resent: 0, desk_replies: 0 };
  await syncContacts(out);
  const [block, pats] = await Promise.all([activeBlocklist(), protectedPatterns()]);
  const { data: mailRows } = await db.from("bestly_mail").select(MAIL_COLS).eq("folder", "INBOX").gte("sent_at", since).order("sent_at", { ascending: false }).limit(200);
  const mail = (mailRows ?? []) as A[];
  const ids = mail.map((m) => m.id);
  const { data: vrows } = ids.length ? await db.from("mail_verdicts").select("mail_id").in("mail_id", ids) : { data: [] as A[] };
  const judged = new Set((vrows ?? []).map((v: A) => v.mail_id));
  const { data: rrows } = ids.length ? await db.from("spam_reports").select("mail_id").in("mail_id", ids) : { data: [] as A[] };
  const reported = new Set((rrows ?? []).map((v: A) => v.mail_id));

  const contacts = await contactSet(mail.map((m) => addrOf(m.from_addr)));

  // (c) replies from the abuse desks: off to Trash on the Mac mini, a silent note for Jared instead
  const desks = await deskAddresses();
  const deskDomains = new Set([...desks].map((d) => registrable(domainOf(d))).filter(Boolean));
  for (const m of mail) {
    if (judged.has(m.id) || reported.has(m.id) || !isDeskReply(m, desks, deskDomains)) continue;
    const subj = String(m.subject ?? "");
    const { data: reps } = await db.from("spam_reports").select("id, subject").not("subject", "is", null).order("created_at", { ascending: false }).limit(200);
    const rep = (reps ?? []).find((r: A) => r.subject && subj.replace(/\s+/g, " ").includes(String(r.subject).replace(/\s+/g, " ").slice(0, 40)));
    const { error } = await db.from("spam_desk_replies").insert({ mail_id: m.id, mailbox: m.mailbox, message_id: m.message_id, from_addr: addrOf(m.from_addr), subject: clip(subj, 300), report_id: rep?.id ?? null });
    await db.from("mail_verdicts").upsert({ mail_id: m.id, verdict: "legit", confidence: 1, reasons: ["reply from an abuse desk to a Spam Desk report"], at: new Date().toISOString() });
    judged.add(m.id);
    if (error) continue;                                            // already queued
    out.desk_replies++;
    const desk = registrable(domainOf(addrOf(m.from_addr))) || addrOf(m.from_addr);
    await notifyDone(`Spam Desk: ${desk} answered a report`, `${clip(subj.replace(/\s+/g, " "), 160)}. Moved to Trash so it stays out of your inbox.`, `spam-desk-reply-${m.id}`, rep ? `/admin/spam?r=${rep.id}` : "/admin/spam");
  }

  // (b) new mail from a blocked sender: junk it (no report email), and a commercial sender's mail counts toward the claim
  for (const m of mail) {
    if (reported.has(m.id) || judged.has(m.id) || !isBlocked(block, m.from_addr)) continue;
    if (contacts.has(addrOf(m.from_addr)) || matchesProtected(pats, addrOf(m.from_addr))) continue;
    const b = isBlocked(block, m.from_addr)!;
    const { data: bl } = await db.from("mail_blocklist").select("report_id").eq("pattern", b.pattern).maybeSingle();
    const { data: first } = bl?.report_id ? await db.from("spam_reports").select("verdict, brand").eq("id", bl.report_id).maybeSingle() : { data: null };
    try {
      await createReport(m, { verdict: first?.verdict ?? "spam", how: "blocked", status: "junk_only", brand: first?.brand ?? "", reasons: ["Sender is blocked"], block: false });
      out.blocked_junked++;
    } catch (e) { console.error("blocked", e); }
    reported.add(m.id); judged.add(m.id);
  }

  // (a) judge new mail
  const fresh = mail.filter((m) => !judged.has(m.id) && !reported.has(m.id)).slice(0, 60);
  const emailed = await emailedSet(fresh.map((m) => addrOf(m.from_addr)));
  const toJudge: A[] = [];
  for (const m of fresh) {
    const addr = addrOf(m.from_addr);
    const skip = !addr ? "no address" : OWN.test(addr) ? "ours" : contacts.has(addr) ? "in Jared's contacts" : matchesProtected(pats, addr) ? "protected sender" : emailed.has(addr) ? "Jared has emailed this sender" : "";
    if (skip) {
      await db.from("mail_verdicts").upsert({ mail_id: m.id, verdict: "legit", confidence: 1, reasons: [`not judged: ${skip}`], at: new Date().toISOString() });
      continue;
    }
    toJudge.push(m);
  }
  const known = await knownSenders(toJudge.map((m) => addrOf(m.from_addr)));
  const BATCH = 8;
  for (let i = 0; i < toJudge.length; i += BATCH) {
    if (Date.now() - t0 > 100_000) break;                       // stay inside the 150 s function limit; the rest wait for the next hour
    const batch = toJudge.slice(i, i + BATCH);
    const res = await classify(batch);
    for (const m of batch) {
      const v = res.get(m.id);
      if (!v) continue;                                          // AI had no answer: no verdict row, so the next hour tries again
      out.judged++;
      await db.from("mail_verdicts").upsert({
        mail_id: m.id, verdict: v.verdict, confidence: v.confidence, brand: v.brand || null, reasons: v.reasons,
        business: v.business || null, us_business: v.us_business, at: new Date().toISOString(),
      });
      if (v.verdict === "legit") continue;
      const sender = m.from_name && m.from_name.length <= 40 ? m.from_name : addrOf(m.from_addr);
      // Guards (2026-10-06 false positive): never auto-report relayed mail or mail sent from the named brand's own domain.
      const orig = relayOrigin(addrOf(m.from_addr)) ?? addrOf(m.from_addr);
      if (v.verdict === "phishing" && senderIsBrand(orig, v.brand)) {
        await db.from("mail_verdicts").update({ verdict: "legit", reasons: [...v.reasons, "sender domain is the brand's own"] }).eq("mail_id", m.id);
        continue;
      }
      // Forwards are a person passing something along (2026-10-07: Mom's "Fwd:" got auto-reported). Never auto-report one;
      // it becomes a Spam? card at most.
      const forwarded = /^\s*(fwd?|fw)\s*:/i.test(String(m.subject ?? ""));
      // "Auto only when certain" (Jared, 2026-10-07): a stranger, not a forward, not relayed, and 0.95+ sure. Anything less is a card.
      const stranger = !known.has(addrOf(m.from_addr));
      if (v.verdict === "phishing" && v.confidence >= AUTO_MIN_CONFIDENCE && stranger && out.auto_reported < 10 && !relayOrigin(addrOf(m.from_addr)) && !forwarded) {
        try {
          const { data: draft } = await db.from("scout_daily").select("id, status").eq("source_key", `mail:${m.id}`).eq("kind", "draft").eq("status", "open").limit(1);
          const c = await createReport(m, { verdict: "phishing", how: "auto", reasons: v.reasons, brand: v.brand, draft: draft?.[0] ?? null, v, protectedPats: pats, emailed });
          if (!c.already) {
            out.auto_reported++;
            await notifyDone(`Spam Desk reported a phishing email from ${sender}`, `${clip(m.subject, 120)}${v.brand ? ` (pretending to be ${v.brand})` : ""}. Reported, moved to Junk, sender blocked. Not spam? Tap to undo.`, `spam-auto-${c.report.id}`, `/admin/spam?r=${c.report.id}`);
          }
        } catch (e) { console.error("auto report", e); }
      } else {
        // unsure, commercial, or phishing it isn't sure enough about: a Spam? card instead of a reply draft
        const { error } = await db.from("scout_daily").upsert({
          day: laDay(), kind: "draft", title: clip(`Spam? ${sender}: ${m.subject ?? "(no subject)"}`, 140),
          why: clip(v.reasons.join("; ") || `Looks like ${v.verdict}.`, 300), body: "", source_key: `mail:${m.id}`,
          action: { to: addrOf(m.from_addr), to_name: m.from_name, subject: m.subject, mailbox: m.mailbox, message_id: m.message_id, received: m.sent_at,
                    spam_suspect: true, verdict: v.verdict, confidence: v.confidence, reasons: v.reasons },
        }, { onConflict: "day,kind,source_key", ignoreDuplicates: true });
        if (!error) out.spam_cards++;
      }
    }
  }

  // reports whose emails were held back by the daily limit, or whose send failed halfway: try again
  const { data: pending } = await db.from("spam_reports").select("id").eq("status", "ready").lt("updated_at", new Date(Date.now() - 10 * 60e3).toISOString()).limit(10);
  for (const p of pending ?? []) { const s = await sendReports(p.id); if (s.sent) out.resent++; }

  // (c) watchdog: reports the Mac mini worker never picked up
  const twoH = new Date(Date.now() - 2 * 3600e3).toISOString();
  const { data: stuckA } = await db.from("spam_reports").select("id, created_at").in("status", ["queued", "fetching"]).lt("created_at", twoH).order("created_at").limit(50);
  const { data: stuckB } = await db.from("spam_reports").select("id, created_at").eq("status", "junk_only").is("junked_at", null).lt("created_at", twoH).order("created_at").limit(50);
  const stuck = [...(stuckA ?? []), ...(stuckB ?? [])];
  if (stuck.length) {
    const oldest = stuck.map((s: A) => s.created_at).sort()[0];
    await raise("mail.spam.worker", "problem", "Spam reports are stuck: the Mac mini worker isn't picking them up",
      `${stuck.length} spam report${stuck.length === 1 ? "" : "s"} waited over 2 hours (oldest ${laTime(oldest)} PT). The worker is scripts/meetingrec/mailspam.py inside the recorder agent on the Mac mini; check ~/MeetingRec/agent.log.`);
  } else {
    await raise("mail.spam.worker", "resolved", "Spam reports are flowing again", "No spam report has waited over 2 hours.");
  }
  out.stuck = stuck.length;
  try { await db.rpc("agent_beat", { p_slug: "spam-desk", p_ok: true, p_summary: clip(`judged ${out.judged}, auto-reported ${out.auto_reported}, cards ${out.spam_cards}, junked ${out.blocked_junked}, stuck ${out.stuck}`, 200) }); } catch { /* the team card also watches the cron job */ }
  return J({ ok: true, ...out });
}

/* ───────────────────────── entry ───────────────────────── */

const AGENT_OPS = new Set(["claim", "source", "junked", "fail", "restored", "disposed"]);
// not_spam is a service op too, so Scout can undo a report the moment Jared says "that's not spam" in chat.
const SERVICE_OPS = new Set(["auto", "mark", "list", "blocklist", "not_spam"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  let body: A = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }
  const op = String(body.op ?? "");

  try {
    // agent: the Mac mini worker
    const agentKey = req.headers.get("x-recorder-key");
    if (agentKey) {
      const { data: row } = await db.from("meeting_recorder_state").select("key_sha256").eq("id", 1).single();
      if (!row?.key_sha256 || (await sha256(agentKey)) !== row.key_sha256) return J({ ok: false, error: "bad key" }, 401);
      if (!AGENT_OPS.has(op)) return J({ ok: false, error: `unknown op ${op}` }, 400);
      return op === "claim" ? await opClaim() : op === "source" ? await opSource(body) : op === "junked" ? await opJunked(body) : op === "restored" ? await opRestored(body) : op === "disposed" ? await opDisposed(body) : await opFail(body);
    }

    // service: pg_cron and Scout
    if (await isServiceRequest(req)) {
      if (!SERVICE_OPS.has(op)) return J({ ok: false, error: op === "approve_send" ? "Sending a demand letter needs Jared's own tap." : `op ${op} is for admins` }, 403);
      if (op === "auto") return await opAuto();
      if (op === "mark") return await opMark(body, null);
      if (op === "not_spam") return await opUndo(body);
      return op === "list" ? await opList() : J({ ok: true, blocklist: (await activeBlocklist()) });
    }

    // admin
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!jwt) return J({ ok: false, error: "unauthorized" }, 401);
    const { data: who, error } = await db.auth.getUser(jwt);
    if (error || !who?.user) return J({ ok: false, error: "unauthorized" }, 401);
    const { data: isAdmin } = await db.rpc("has_role", { _user_id: who.user.id, _role: "admin" });
    if (!isAdmin) return J({ ok: false, error: "admin only" }, 403);

    switch (op) {
      case "mark": return await opMark(body, who.user.id);
      case "undo": case "not_spam": return await opUndo(body);
      case "protect": return await opProtect(body);
      case "unprotect": return await opUnprotect(body);
      case "list": return await opList();
      case "blocklist": return J({ ok: true, blocklist: (await db.from("mail_blocklist").select("*").eq("active", true).order("created_at", { ascending: false }).limit(500)).data ?? [] });
      case "unblock": {
        const { error: e } = await db.from("mail_blocklist").update({ active: false }).eq("id", String(body.id ?? ""));
        return e ? J({ ok: false, error: e.message }, 500) : J({ ok: true });
      }
      case "retry": return await opRetry(body);
      case "draft_letter": return await opDraftLetter(body);
      case "claim_edit": return await opClaimEdit(body);
      case "set_status": return await opSetStatus(body);
      case "approve_send": return await opApproveSend(body);
      default: return J({ ok: false, error: `unknown op ${op}` }, 400);
    }
  } catch (e) {
    console.error("spam-desk", op, e);
    return J({ ok: false, error: (e as Error).message }, 500);
  }
});

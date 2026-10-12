// leo-10dlc: files and tracks Leo's US carrier texting registration (Telnyx 10DLC) for +1 310 622 7052, so Bestly LLC may text Turo guests.
// Service key only (called by the hourly pg_cron wrapper public.leo_sms_tick() and by the admin card's EIN save). Idempotent: every step
// looks before it creates, so re-running never makes a second brand or campaign.
//
// Steps: brand (needs the business EIN from Vault home_hub_leo_sms_ein, saved once on the Leo texting card) -> campaign (CUSTOMER_CARE) ->
// assign the number (trip-voice sms_check heals/assigns once leo_settings.sms_campaign_id is set) -> when ready: owner-only test text to
// Jared's own business number, then sms_mode live. Everything is signed Leo (bestly_raise key leo.sms.filing).
// Spend guard: brand + campaign are refused if the carrier's quoted one-time fees add up to more than $50.
import { createClient } from "npm:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
type Any = Record<string, any>;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const LEO_FROM = "+13106227052";
const FILING_KEY = "leo.sms.filing";
const isService = (req: Request) => { const a = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return !!a && (a === SB_SECRET || a === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "\0")); };

const txKey = async () => { const { data } = await sb.rpc("ava_secret", { p_name: "telnyx_api_key" }); return typeof data === "string" ? data : null; };
const tx = async (path: string, init: RequestInit = {}) => {
  const k = await txKey(); if (!k) throw new Error("no telnyx key");
  const r = await fetch(`https://api.telnyx.com/v2${path}`, { ...init, signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${k}`, "content-type": "application/json" } });
  return { status: r.status, j: (await r.json().catch(() => ({}))) as Any };
};
const errText = (j: Any) => clip(((j.errors as Any[]) ?? []).map((e) => e.detail ?? e.title ?? e.code).filter(Boolean).join("; ") || JSON.stringify(j).slice(0, 300), 300);

// ---- What we tell the carrier (kept in code so a re-file after a rejection starts from the same reviewed text) ----
const BRAND = {
  entityType: "PRIVATE_PROFIT", displayName: "Bestly", companyName: "Bestly LLC",
  phone: "+18165007236", street: "733 North Kings Road #205", city: "Los Angeles", state: "CA", postalCode: "90069", country: "US",
  email: "jared@bestly.tech", website: "https://www.bestly.tech", vertical: "TRANSPORTATION",
};
const CAMPAIGN = {
  usecase: "CUSTOMER_CARE",
  description: "Bestly LLC hosts Tesla rentals on Turo. Its trip assistant, Leo, texts guests about their own booked trip only: pickup steps, phone key status, return reminders, and asking whether they have finished early. Messages go only to guests who gave Bestly their mobile number on their personal trip page or who texted or called Leo first. No marketing.",
  messageFlow: "Turo guests get a personal link in their Turo booking message (https://www.bestly.tech/turo-key or https://www.bestly.tech/turo-lax) that opens their trip page at https://www.bestly.tech/t/... . The guest types their mobile number and last name to sign in and get trip updates. Directly under the number box the page says: We'll text this number about your trip. Msg & data rates may apply. Reply STOP to opt out. Guests can also call or text Leo at (310) 622-7052 first. Texts go only to numbers a guest gave on that page or on a call or text with Leo. STOP ends all texts, HELP gives support info.",
  sample1: "Leo from Bestly: your pickup guide: bestly.tech/t/abc1234#pickup Reply STOP to opt out.",
  sample2: "Leo from Bestly: your Tesla key is ready on your trip page: bestly.tech/t/abc1234",
  sample3: "Leo from Bestly: Finished early? Reply YES or NO. Reply STOP to opt out.",
  helpKeywords: "HELP,INFO",
  helpMessage: "Leo for Bestly Turo trips. Help: (310) 622-7052. Reply STOP to opt out.",
  optoutKeywords: "STOP,STOPALL,UNSUBSCRIBE,CANCEL,END,QUIT",
  optoutMessage: "You're unsubscribed from Bestly trip texts. Reply START to resubscribe.",
  optinKeywords: "START,YES,UNSTOP",
  optinMessage: "You're subscribed to Bestly trip texts from Leo. Msg & data rates may apply. Reply STOP to opt out, HELP for help.",
  subscriberOptin: true, subscriberOptout: true, subscriberHelp: true,
  embeddedLink: true, embeddedPhone: true, numberPool: false, ageGated: false, directLending: false, affiliateMarketing: false, termsAndConditions: true,
};
const ONE_TIME_CAP_USD = 50;

const settings = async () => (await sb.from("leo_settings").select("sms_mode, sms_ready, sms_campaign_id, sms_filing, sms_detail").eq("id", 1).maybeSingle()).data as Any | null;
const saveFiling = async (patch: Any) => {
  const cur = ((await settings())?.sms_filing ?? {}) as Any;
  await sb.from("leo_settings").update({ sms_filing: { ...cur, ...patch, at: new Date().toISOString() } }).eq("id", 1);
};
const raise = (kind: "problem" | "resolved", sev: string, title: string, body: string, needs: string | null = null, healed = false) =>
  sb.rpc("bestly_raise", { p_key: FILING_KEY, p_kind: kind, p_severity: sev, p_title: title, p_body: clip(body, 500), p_area: "agents", p_needs_jared: needs, p_healed: healed }).then(() => {}, () => {});

/** Read-only look at the account: brands, campaigns, fees. Never prints the key or the EIN. */
async function inspect(): Promise<Any> {
  const out: Any = {};
  const b = await tx("/10dlc/brand?page=1&recordsPerPage=50");
  out.brands_status = b.status;
  out.brands = ((b.j.records ?? b.j.data ?? []) as Any[]).map((r) => ({ brandId: r.brandId, displayName: r.displayName, companyName: r.companyName, entityType: r.entityType,
    identityStatus: r.identityStatus, status: r.status, vertical: r.vertical, createDate: r.createDate, keys: Object.keys(r).slice(0, 40) }));
  const c = await tx("/10dlc/campaign?page=1&recordsPerPage=50");
  out.campaigns_status = c.status;
  out.campaigns = ((c.j.records ?? c.j.data ?? []) as Any[]).map((r) => ({ campaignId: r.campaignId, brandId: r.brandId, usecase: r.usecase, status: r.status ?? r.campaignStatus,
    failureReasons: r.failureReasons ?? null, createDate: r.createDate }));
  const cost = await tx("/10dlc/campaignBuilder/usecase/CUSTOMER_CARE/cost");
  out.usecase_cost = { status: cost.status, body: cost.j };
  const asg = await tx(`/10dlc/phone_number_campaigns/${encodeURIComponent(LEO_FROM)}`);
  out.assignment = { status: asg.status, body: asg.j };
  const v = await tx("/10dlc/enum/vertical");
  out.verticals = { status: v.status, body: Array.isArray(v.j) ? v.j.slice(0, 60) : (v.j.data ?? v.j) };
  return out;
}

async function readEin(): Promise<string | null> {
  const { data } = await sb.rpc("leo_sms_secret", { p_name: "home_hub_leo_sms_ein" });
  const d = String(data ?? "").replace(/\D/g, "");
  return /^\d{9}$/.test(d) ? d : null;
}

/** One idempotent pass through the filing. Returns where it stands. */
async function advance(): Promise<Any> {
  const s = await settings();
  const steps: string[] = [];
  const brandList = await tx("/10dlc/brand?page=1&recordsPerPage=50");
  if (brandList.status >= 300) { await saveFiling({ step: "brand_lookup_failed", error: errText(brandList.j) }); return { ok: false, step: "brand_lookup_failed", status: brandList.status }; }
  const brands = ((brandList.j.records ?? brandList.j.data ?? []) as Any[]);
  let brand = brands.find((r) => /bestly/i.test(String(r.companyName ?? r.displayName ?? "")));

  // ---- Brand ----
  if (!brand) {
    const ein = await readEin();
    if (!ein) {
      await saveFiling({ step: "need_ein", note: "Texting registration is waiting for Bestly LLC's EIN" });
      await raise("problem", "warning", "Leo: I need Bestly's EIN to register texting",
        "Carriers require the business tax ID (EIN) before Leo's number can text guests. Nothing is filed or charged until it is saved.",
        "Open Turo settings > Leo texting and paste the EIN once", false);
      return { ok: true, step: "need_ein" };
    }
    // A rejected brand is not re-posted every hour: only when the EIN on file changed since the rejection.
    const sig = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("leo" + ein)))].slice(0, 6).map((x) => x.toString(16).padStart(2, "0")).join("");
    const prev = (s?.sms_filing ?? {}) as Any;
    if (prev.step === "brand_rejected" && prev.ein_sig === sig) return { ok: true, step: "brand_rejected_waiting_for_new_ein" };
    // Spend guard: if the carrier quotes a one-time campaign cost over the cap, stop (the quote endpoint is best-effort; Telnyx's usual
    // one-time fees are brand $4 + campaign vetting $15, well under the cap).
    const cost = await tx("/10dlc/campaignBuilder/usecase/CUSTOMER_CARE/cost");
    const quoted = Number((cost.j.data ?? cost.j)?.upFrontCost ?? 0) || 0;
    if (quoted > ONE_TIME_CAP_USD) {
      await saveFiling({ step: "cost_over_cap", quoted });
      await raise("problem", "warning", "Leo: texting registration costs more than expected", `The carrier quotes $${quoted} up front for the campaign, over the $${ONE_TIME_CAP_USD} limit. I stopped before filing.`, "Say yes to the higher fee or I leave it", false);
      return { ok: true, step: "cost_over_cap", quoted };
    }
    const r = await tx("/10dlc/brand", { method: "POST", body: JSON.stringify({ ...BRAND, ein }) });
    if (r.status >= 300) {
      const why = errText(r.j);
      await saveFiling({ step: "brand_rejected", error: why, ein_sig: sig });
      await raise("problem", "warning", "Leo: the carrier rejected Bestly's brand registration", `${why}. Fix the detail named above and save the EIN again; I will re-file by myself.`, "Re-check the EIN on the Leo texting card", false);
      return { ok: false, step: "brand_rejected", error: why };
    }
    brand = (r.j.data ?? r.j) as Any; steps.push("brand created");
    await saveFiling({ step: "brand_created", brand_id: brand.brandId, quoted_campaign_fee: quoted });
  }
  const brandId = String(brand.brandId ?? "");
  const ident = String(brand.identityStatus ?? "");
  const bstatus = String(brand.status ?? "");
  await saveFiling({ brand_id: brandId, brand_status: bstatus, identity_status: ident });
  if (/fail|reject|suspend/i.test(bstatus) || /fail|reject/i.test(ident)) {
    await raise("problem", "warning", "Leo: the carrier did not accept Bestly's brand", `Brand status ${bstatus || "unknown"} / identity ${ident || "unknown"}. ${errText(brand)}`.slice(0, 400), "Re-check the business name and EIN on the Leo texting card", false);
    return { ok: false, step: "brand_not_accepted", bstatus, ident };
  }

  // ---- Campaign ----
  const cl = await tx(`/10dlc/campaign?brandId=${encodeURIComponent(brandId)}&page=1&recordsPerPage=50`);
  const camps = ((cl.j.records ?? cl.j.data ?? []) as Any[]).filter((c) => /CUSTOMER_CARE/i.test(String(c.usecase)));
  // newest not-failed campaign first; a failed one only counts if it is the only one
  const alive = camps.filter((c) => !/fail|reject|expire|deactiv/i.test(String(c.status ?? c.campaignStatus)));
  let camp = alive[0] ?? null;
  if (!camp) {
    const failed = camps[0];
    if (failed && (((await settings())?.sms_filing as Any)?.refiled_for === failed.campaignId)) {
      // Already tried again for this rejection: leave it for a person instead of looping on carrier fees.
      return { ok: true, step: "campaign_failed_waiting", campaign: failed.campaignId };
    }
    const r = await tx("/10dlc/campaignBuilder", { method: "POST", body: JSON.stringify({ ...CAMPAIGN, brandId }) });
    if (r.status >= 300) {
      const why = errText(r.j);
      await saveFiling({ step: "campaign_rejected", error: why });
      await raise("problem", "warning", "Leo: the carrier rejected the texting campaign", `${why}`.slice(0, 400), null, false);
      return { ok: false, step: "campaign_rejected", error: why };
    }
    camp = (r.j.data ?? r.j) as Any; steps.push("campaign created");
    await saveFiling({ step: "campaign_created", campaign_id: camp.campaignId, ...(failed ? { refiled_for: failed.campaignId } : {}) });
  }
  const campaignId = String(camp.campaignId ?? "");
  const detail = await tx(`/10dlc/campaign/${campaignId}`);
  const cd = (detail.j.data ?? detail.j ?? {}) as Any;
  const cstatus = String(cd.status ?? cd.campaignStatus ?? camp.status ?? "");
  await saveFiling({ campaign_id: campaignId, campaign_status: cstatus, failure_reasons: cd.failureReasons ?? null });
  await sb.from("leo_settings").update({ sms_campaign_id: campaignId }).eq("id", 1).is("sms_campaign_id", null);

  if (/fail|reject/i.test(cstatus)) {
    const why = clip(JSON.stringify(cd.failureReasons ?? cd.reason ?? cstatus), 380);
    await raise("problem", "warning", "Leo: the carrier rejected my texting campaign", `Reason: ${why}. I filed the same text twice already at most; I stop here so no more fees are charged.`, "Tell Claude to adjust the campaign wording and re-file", false);
    return { ok: true, step: "campaign_rejected_by_tcr", status: cstatus, why };
  }
  await raise("problem", "info", "Leo: texting registration is with the carrier", `Brand ${bstatus || "submitted"}, campaign ${cstatus || "submitted"}. Approval usually takes a few days; I check every hour and turn texting on by myself.`, null, true);
  return { ok: true, step: "waiting_for_carrier", brandId, campaignId, cstatus, steps };
}

/** Pull carrier-side opt-outs (STOP texts) into leo_sms_optouts so sendSms refuses them even before the carrier would. Best-effort. */
async function syncOptouts(): Promise<number> {
  try {
    const sha = async (v: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const r = await tx("/messaging_optouts?page[size]=100");
    if (r.status >= 300) return 0;
    let n = 0;
    for (const o of ((r.j.data ?? []) as Any[])) {
      if (String(o.from ?? "") !== LEO_FROM) continue;
      const d = String(o.to ?? "").replace(/\D/g, "").slice(-10);
      if (d.length !== 10) continue;
      const { error } = await sb.from("leo_sms_optouts").upsert({ phone_hash: await sha("+1" + d), source: "telnyx_" + clip(o.keyword ?? "stop", 20).toLowerCase() }, { onConflict: "phone_hash", ignoreDuplicates: true });
      if (!error) n++;
    }
    return n;
  } catch { return 0; }
}

/** Runs hourly. Files/advances until ready; once ready does the owner-only test and goes live. */
async function tick(): Promise<Any> {
  const s = await settings();
  if (!s) return { ok: false, error: "no settings" };
  if (s.sms_ready) await syncOptouts();
  const callSelf = async (op: string) => {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/trip-voice`, { method: "POST", signal: AbortSignal.timeout(45_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB_SECRET}`, apikey: SB_SECRET }, body: JSON.stringify({ op }) });
    return await r.json().catch(() => ({})) as Any;
  };
  if (!s.sms_ready) {
    const a = await advance();
    // once a campaign id is saved, trip-voice's own check assigns the number and flips sms_ready
    const now = await settings();
    if (now?.sms_campaign_id) await callSelf("sms_check");
    const after = await settings();
    if (!after?.sms_ready) return { ok: true, ready: false, filing: a };
  }
  // Ready. Approved campaign + assigned number.
  const cur = await settings();
  const fstep = (cur?.sms_filing as Any)?.step;
  // trip-voice's watchdog says ready as soon as the number is assigned to a campaign the registry accepted; texting only goes live once the
  // carriers themselves have provisioned it (Telnyx: MNO_PROVISIONED / MNO_ACCEPTED / ACTIVE), never while any pending/failed word is in the status.
  const cst = String((cur?.sms_detail as Any)?.campaign_status ?? "");
  const carriersOk = /(mno_provisioned|mno_accepted|^active|^approved|^registered)/i.test(cst) && !/(pending|fail|reject|suspend|expire)/i.test(cst);
  if (cur?.sms_ready && !carriersOk) return { ok: true, ready: true, waiting_for_carriers: true, campaign_status: cst };
  if (cur?.sms_ready && fstep && ((cur.sms_mode === "off") || (cur.sms_mode === "owner_only" && fstep === "approved_test_failed"))) {
    await sb.rpc("leo_sms_mode_set", { p_mode: "owner_only" });
    const t = await callSelf("sms_test");
    if (t.ok) {
      await sb.rpc("leo_sms_mode_set", { p_mode: "live" });
      await saveFiling({ step: "live", live_at: new Date().toISOString() });
      await raise("problem", "info", "Leo: texting is approved", "Carrier approved the campaign.", null, true);
      await raise("resolved", "info", "Leo: texting is approved, I'll text guests now", "The carrier approved the campaign, my number is assigned, and a test text to Jared's business number went through. Guest texts are on.", null, true);
      return { ok: true, ready: true, live: true };
    }
    await saveFiling({ step: "approved_test_failed", test: clip(JSON.stringify(t), 200) });
    await raise("problem", "warning", "Leo: texting is approved but my test text failed", `The carrier approved the campaign, but the test text to Jared's business number failed (${clip(JSON.stringify(t), 120)}). Guest texts stay off (owner-only).`, null, false);
    return { ok: false, ready: true, live: false, test: t };
  }
  return { ok: true, ready: !!cur?.sms_ready, mode: cur?.sms_mode };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!isService(req)) return json({ ok: false, error: "service key only" }, 401);
  const b = (await req.json().catch(() => ({}))) as Any;
  try {
    if (b.op === "inspect") return json(await inspect());
    if (b.op === "file") return json(await advance());
    if (b.op === "tick") return json(await tick());
  } catch (e) { return json({ ok: false, error: clip((e as Error)?.message, 200) }, 500); }
  return json({ ok: false, error: "unknown op" }, 400);
});

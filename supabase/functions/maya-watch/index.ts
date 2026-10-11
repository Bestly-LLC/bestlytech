// Maya watch (every 10 min): phone line + support desk.
// Line: ElevenLabs agent, number assignment (heals), Telnyx FQDN (heals), number on connection.
// Desk: file_ticket tool still attached (heals by re-attaching), ticket endpoint alive, overdue tickets.
// Billing (Phase 3): the six billing tools still attached (heals by re-attaching), maya-billing refuses a fake call,
// and maya-billing's own health check (Stripe key, portal, tables, email, ElevenLabs key) passes.
// Website: her two site tools (navigate_site_page, open_site_modal) still attached, and the widget allowlist still
// holds bestly.tech + www.bestly.tech (heals both). Alert key maya.site.
import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_ID = "agent_3701m4jbjnyef6ga4ys73xtbz37s";
const EL_PHONE_ID = "phnum_2501m4jea1d1enjt3tkyq4nps914";
const TICKET_TOOL = "tool_7901m4m0e2dvf0x9y469gf3cb4zn";
const BILLING_TOOLS = [
  "tool_0901m4m3jga1fr99d0sv8kxr5saw", // verify_start
  "tool_9701m4m3jjxpf2jsf44rh3tt858x", // verify_check
  "tool_3201m4m3jnjffkd9rd6tp7hsmqbd", // billing_status
  "tool_5801m4m3jradf2nvg595bypbcv89", // send_pay_link
  "tool_8901m4m3jtvwfdb82kta0c5jmsv8", // cancel_or_pause
  "tool_3101m4m3jx58f4s9cdq89qavw7av", // refund
];
const SITE_TOOLS = [
  "tool_5301m4p1ran1f7z97a2ky50g2z15", // navigate_site_page (client tool, bestly.tech widget)
  "tool_9401m4p1rvxkeg6tt8k0zjbeat0h", // open_site_modal (client tool, bestly.tech widget)
];
const SITE_HOSTS = ["bestly.tech", "www.bestly.tech"];
const TELNYX_CONN = "3067494961063659261";
const NUMBER = "+12136410074";
const EL_FQDN = "sip.rtc.elevenlabs.io";

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const problems: string[] = [];
  const fixed: string[] = [];
  const desk: string[] = [];
  const billing: string[] = [];
  const site: string[] = [];
  try {
    const { data: elKey } = await sb.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
    const { data: tnKey } = await sb.rpc("ava_secret", { p_name: "telnyx_api_key" });
    const el = { "xi-api-key": String(elKey), "Content-Type": "application/json" };
    const tn = { Authorization: `Bearer ${tnKey}`, "Content-Type": "application/json" };

    // 1. Agent exists, and the ticket tool is still attached (heal: re-attach)
    const a = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, { headers: el });
    if (!a.ok) problems.push(`Her ElevenLabs agent did not answer (${a.status}).`);
    else {
      const aj = await a.json();
      const ids: string[] = aj?.conversation_config?.agent?.prompt?.tool_ids ?? [];
      const missing = [TICKET_TOOL, ...BILLING_TOOLS, ...SITE_TOOLS].filter((t) => !ids.includes(t));
      if (missing.length) {
        const fix = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, { method: "PATCH", headers: el,
          body: JSON.stringify({ conversation_config: { agent: { prompt: { tool_ids: [...ids, ...missing] } } } }) });
        const ticketGone = missing.includes(TICKET_TOOL);
        const billingGone = missing.some((t) => BILLING_TOOLS.includes(t));
        const siteGone = missing.some((t) => SITE_TOOLS.includes(t));
        if (fix.ok) fixed.push(`Re-attached ${missing.length} of my tools${ticketGone ? " (ticket)" : ""}${billingGone ? " (billing)" : ""}${siteGone ? " (website)" : ""}.`);
        else {
          if (ticketGone) desk.push("My ticket tool came off and re-attaching failed, so callers' requests aren't being saved.");
          if (billingGone) billing.push("My billing tools came off and re-attaching failed, so I can't help with accounts on calls.");
          if (siteGone) site.push("My website tools came off and re-attaching failed, so I can't move visitors around bestly.tech.");
        }
      }
      // Widget allowlist: if it drifts, the Talk to Maya button on bestly.tech stops connecting (heal: add the hosts back).
      const auth = aj?.platform_settings?.auth ?? {};
      const list: { hostname: string }[] = Array.isArray(auth.allowlist) ? auth.allowlist : [];
      const lacking = SITE_HOSTS.filter((h) => !list.some((x) => x?.hostname === h));
      if (list.length && lacking.length) {
        const fix = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, { method: "PATCH", headers: el,
          body: JSON.stringify({ platform_settings: { auth: { ...auth, allowlist: [...list, ...lacking.map((hostname) => ({ hostname }))] } } }) });
        if (fix.ok) fixed.push(`Put ${lacking.join(" and ")} back on my website allowlist.`);
        else site.push(`My website allowlist lost ${lacking.join(" and ")} and re-adding failed, so Talk to Maya won't connect there.`);
      }
    }

    // 2. Phone number points at Maya (heal: reassign)
    const p = await fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${EL_PHONE_ID}`, { headers: el });
    if (!p.ok) problems.push(`Her phone number is missing in ElevenLabs (${p.status}).`);
    else {
      const pj = await p.json();
      if (pj?.assigned_agent?.agent_id !== AGENT_ID) {
        const fix = await fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${EL_PHONE_ID}`,
          { method: "PATCH", headers: el, body: JSON.stringify({ agent_id: AGENT_ID }) });
        if (fix.ok) fixed.push("Reassigned her phone number to Maya.");
        else problems.push("Her phone number is not assigned to Maya, and reassigning failed.");
      }
    }

    // 3. Telnyx route has the ElevenLabs FQDN (heal: re-add it)
    const f = await fetch(`https://api.telnyx.com/v2/fqdns?filter[connection_id]=${TELNYX_CONN}`, { headers: tn });
    if (!f.ok) problems.push(`Telnyx did not answer (${f.status}).`);
    else {
      const fj = await f.json();
      if (!(fj?.data ?? []).some((x: any) => x?.fqdn === EL_FQDN)) {
        const add = await fetch("https://api.telnyx.com/v2/fqdns", { method: "POST", headers: tn,
          body: JSON.stringify({ connection_id: TELNYX_CONN, fqdn: EL_FQDN, port: 5060, dns_record_type: "a" }) });
        if (add.ok) fixed.push("Re-added the ElevenLabs route in Telnyx.");
        else problems.push("The Telnyx route to ElevenLabs is missing, and re-adding it failed.");
      }
    }

    // 4. Number is on that Telnyx connection (alert only)
    const n = await fetch(`https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(NUMBER)}`, { headers: tn });
    if (n.ok) {
      const conn = (await n.json())?.data?.[0]?.connection_id;
      if (conn && String(conn) !== TELNYX_CONN) problems.push("Her number moved to a different Telnyx connection, so calls will not reach her.");
    }

    // 5. Ticket endpoint is up (a bogus call must be refused with 401, not 5xx)
    const t = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/maya-ticket`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation_id: "conv_watchprobe", kind: "support", issue: "probe" }) });
    if (t.status !== 401) desk.push(`My ticket endpoint answered ${t.status} instead of refusing a fake call.`);

    // 5b. Billing endpoint: a fake call must be refused with 401, and its own health check must pass.
    const b = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/maya-billing`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "billing_status", conversation_id: "conv_watchprobe" }) });
    if (b.status !== 401) billing.push(`My billing endpoint answered ${b.status} instead of refusing a fake call.`);
    const h = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/maya-billing`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` }, body: JSON.stringify({ action: "health" }) });
    if (!h.ok) {
      const hj = await h.json().catch(() => ({}));
      billing.push(`My billing health check failed (${h.status})${hj?.problems?.length ? ": " + hj.problems.join("; ") : ""}.`);
    } else {
      const hj = await h.json().catch(() => ({}));
      if (hj?.ok === false) billing.push(`My billing health check found: ${(hj.problems ?? []).join("; ")}.`);
    }
  } catch (e) {
    problems.push(`Check crashed: ${String(e).slice(0, 200)}`);
  }

  // 6. Overdue tickets
  const { data: late } = await sb.from("support_tickets").select("code,kind,name,due_at").eq("status", "open").lt("due_at", new Date().toISOString()).order("due_at");
  const { data: privSoon } = await sb.from("support_tickets").select("code,name,due_at").eq("status", "open").eq("kind", "privacy")
    .lt("due_at", new Date(Date.now() + 10 * 86400000).toISOString()).gte("due_at", new Date().toISOString());

  const ok = problems.length === 0;
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { source: "maya", ok, problems: [...problems, ...fixed, ...desk, ...billing, ...site], healed: fixed.length > 0, checked_at: now };
  if (ok) row.last_ok_at = now;
  await sb.from("ava_line_health").upsert(row, { onConflict: "source" });

  if (ok) await sb.rpc("bestly_raise", { p_key: "maya.line", p_kind: "resolved", p_severity: "info",
    p_title: fixed.length ? "Maya: I fixed my phone line" : "Maya: line OK", p_body: fixed.join(" ") || null, p_area: "maya", p_healed: fixed.length > 0 });
  else await sb.rpc("bestly_raise", { p_key: "maya.line", p_kind: "problem", p_severity: "warning",
    p_title: "Maya: calls can't reach me", p_body: problems.join(" "), p_area: "maya" });

  if (desk.length) await sb.rpc("bestly_raise", { p_key: "maya.desk", p_kind: "problem", p_severity: "warning",
    p_title: "Maya: caller requests may not be saving", p_body: desk.join(" "), p_area: "maya" });
  else await sb.rpc("bestly_raise", { p_key: "maya.desk", p_kind: "resolved", p_severity: "info", p_title: "Maya: ticket desk OK", p_area: "maya" });

  if (billing.length) await sb.rpc("bestly_raise", { p_key: "maya.billing.health", p_kind: "problem", p_severity: "warning",
    p_title: "Maya: my account and billing tools may not be working", p_body: billing.join(" ").slice(0, 400), p_area: "maya", p_needs_jared: "Check Stripe, the email sender and the ElevenLabs tools; calls fall back to billing tickets meanwhile." });
  else await sb.rpc("bestly_raise", { p_key: "maya.billing.health", p_kind: "resolved", p_severity: "info", p_title: "Maya: billing tools OK", p_area: "maya" });

  if (site.length) await sb.rpc("bestly_raise", { p_key: "maya.site", p_kind: "problem", p_severity: "warning",
    p_title: "Maya: my bestly.tech chat may not be working", p_body: site.join(" ").slice(0, 400), p_area: "maya" });
  else await sb.rpc("bestly_raise", { p_key: "maya.site", p_kind: "resolved", p_severity: "info", p_title: "Maya: website tools OK", p_area: "maya" });

  if (late?.length) await sb.rpc("bestly_raise", { p_key: "maya.overdue", p_kind: "problem", p_severity: "warning",
    p_title: `Maya: ${late.length} caller${late.length > 1 ? "s are" : " is"} past the follow-up time I promised`,
    p_body: late.slice(0, 5).map((x: any) => `${x.code} ${x.kind}${x.name ? " " + x.name : ""}`).join(", "), p_area: "maya", p_needs_jared: "Follow up, then mark the ticket done." });
  else await sb.rpc("bestly_raise", { p_key: "maya.overdue", p_kind: "resolved", p_severity: "info", p_title: "Maya: no overdue callers", p_area: "maya" });

  if (privSoon?.length) await sb.rpc("bestly_raise", { p_key: "maya.privacy", p_kind: "problem", p_severity: "warning",
    p_title: `Maya: ${privSoon.length} privacy request${privSoon.length > 1 ? "s are" : " is"} due within 10 days`,
    p_body: privSoon.map((x: any) => `${x.code}${x.name ? " " + x.name : ""}`).join(", "), p_area: "maya", p_needs_jared: "Legal deadline (CCPA, 45 days)." });
  else await sb.rpc("bestly_raise", { p_key: "maya.privacy", p_kind: "resolved", p_severity: "info", p_title: "Maya: privacy requests on track", p_area: "maya" });

  return new Response(JSON.stringify({ ok, problems, fixed, desk, billing, site, overdue: late?.length ?? 0 }), { headers: { "Content-Type": "application/json" } });
});

// Maya watch (every 10 min): phone line + support desk.
// Line: ElevenLabs agent, number assignment (heals), Telnyx FQDN (heals), number on connection.
// Desk: file_ticket tool still attached (heals by re-attaching), ticket endpoint alive, overdue tickets.
import { createClient } from "npm:@supabase/supabase-js@2";

const AGENT_ID = "agent_3701m4jbjnyef6ga4ys73xtbz37s";
const EL_PHONE_ID = "phnum_2501m4jea1d1enjt3tkyq4nps914";
const TICKET_TOOL = "tool_7901m4m0e2dvf0x9y469gf3cb4zn";
const TELNYX_CONN = "3067494961063659261";
const NUMBER = "+12136410074";
const EL_FQDN = "sip.rtc.elevenlabs.io";

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const problems: string[] = [];
  const fixed: string[] = [];
  const desk: string[] = [];
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
      if (!ids.includes(TICKET_TOOL)) {
        const fix = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, { method: "PATCH", headers: el,
          body: JSON.stringify({ conversation_config: { agent: { prompt: { tool_ids: [...ids, TICKET_TOOL] } } } }) });
        if (fix.ok) fixed.push("Re-attached my ticket tool.");
        else desk.push("My ticket tool came off and re-attaching failed, so callers' requests aren't being saved.");
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
  } catch (e) {
    problems.push(`Check crashed: ${String(e).slice(0, 200)}`);
  }

  // 6. Overdue tickets
  const { data: late } = await sb.from("support_tickets").select("code,kind,name,due_at").eq("status", "open").lt("due_at", new Date().toISOString()).order("due_at");
  const { data: privSoon } = await sb.from("support_tickets").select("code,name,due_at").eq("status", "open").eq("kind", "privacy")
    .lt("due_at", new Date(Date.now() + 10 * 86400000).toISOString()).gte("due_at", new Date().toISOString());

  const ok = problems.length === 0;
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { source: "maya", ok, problems: [...problems, ...fixed, ...desk], healed: fixed.length > 0, checked_at: now };
  if (ok) row.last_ok_at = now;
  await sb.from("ava_line_health").upsert(row, { onConflict: "source" });

  if (ok) await sb.rpc("bestly_raise", { p_key: "maya.line", p_kind: "resolved", p_severity: "info",
    p_title: fixed.length ? "Maya: I fixed my phone line" : "Maya: line OK", p_body: fixed.join(" ") || null, p_area: "maya", p_healed: fixed.length > 0 });
  else await sb.rpc("bestly_raise", { p_key: "maya.line", p_kind: "problem", p_severity: "warning",
    p_title: "Maya: calls can't reach me", p_body: problems.join(" "), p_area: "maya" });

  if (desk.length) await sb.rpc("bestly_raise", { p_key: "maya.desk", p_kind: "problem", p_severity: "warning",
    p_title: "Maya: caller requests may not be saving", p_body: desk.join(" "), p_area: "maya" });
  else await sb.rpc("bestly_raise", { p_key: "maya.desk", p_kind: "resolved", p_severity: "info", p_title: "Maya: ticket desk OK", p_area: "maya" });

  if (late?.length) await sb.rpc("bestly_raise", { p_key: "maya.overdue", p_kind: "problem", p_severity: "warning",
    p_title: `Maya: ${late.length} caller${late.length > 1 ? "s are" : " is"} past the follow-up time I promised`,
    p_body: late.slice(0, 5).map((x: any) => `${x.code} ${x.kind}${x.name ? " " + x.name : ""}`).join(", "), p_area: "maya", p_needs_jared: "Follow up, then mark the ticket done." });
  else await sb.rpc("bestly_raise", { p_key: "maya.overdue", p_kind: "resolved", p_severity: "info", p_title: "Maya: no overdue callers", p_area: "maya" });

  if (privSoon?.length) await sb.rpc("bestly_raise", { p_key: "maya.privacy", p_kind: "problem", p_severity: "warning",
    p_title: `Maya: ${privSoon.length} privacy request${privSoon.length > 1 ? "s are" : " is"} due within 10 days`,
    p_body: privSoon.map((x: any) => `${x.code}${x.name ? " " + x.name : ""}`).join(", "), p_area: "maya", p_needs_jared: "Legal deadline (CCPA, 45 days)." });
  else await sb.rpc("bestly_raise", { p_key: "maya.privacy", p_kind: "resolved", p_severity: "info", p_title: "Maya: privacy requests on track", p_area: "maya" });

  return new Response(JSON.stringify({ ok, problems, fixed, desk, overdue: late?.length ?? 0 }), { headers: { "Content-Type": "application/json" } });
});

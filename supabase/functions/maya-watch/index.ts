// Maya watch (every 10 min): phone line + support desk.
// Line: ElevenLabs agent, number assignment (heals), Telnyx FQDN (heals), number on connection.
// Desk: file_ticket tool still attached (heals by re-attaching), ticket endpoint alive, overdue tickets.
// Billing (Phase 3): the six billing tools still attached (heals by re-attaching), maya-billing refuses a fake call,
// and maya-billing's own health check (Stripe key, portal, tables, email, ElevenLabs key) passes.
// Website: her four site tools (navigate_site_page, open_site_modal, show_section, describe_screen) attached, the
// agent private (enable_auth) with bestly.tech + www.bestly.tech allowed, the maya-session door minting, the prompt
// carrying the current "Website presenter" block, and her "bestly.tech site map" knowledge matching the live
// /maya/site-index.json (rebuilt whenever its generated_at changes). Heals all of these. Alert key maya.site.
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
  "tool_5001m4p4de4qefx8wcd9d9jqn9w7", // show_section (client tool, presenter)
  "tool_3901m4p4dgffew580sm8prn3r2c1", // describe_screen (client tool, presenter)
];
const SITE_INDEX_URL = "https://www.bestly.tech/maya/site-index.json";
const SITE_KB_PREFIX = "Maya KB - bestly.tech site map";
const PRESENTER_START = "# Website presenter (website visitors only)";
const PRESENTER_END = "# End website presenter";
// Kept in this file so it is versioned with the tools it describes. Line Check writes it into her prompt if missing
// or different, replacing the old "Website Actions (Client Tools)" tail.
const PRESENTER_BLOCK = `${PRESENTER_START}
On the website (page_product is not "none") you are also the visitor's guide to bestly.tech, like someone presenting slides.
- Show, don't just tell. When they ask to see something, ask where something is, or ask about anything that might be on the site (a product, pricing, the Bestly Cloud savings calculator, Jared, how something works), call show_section with their words. Then talk about what the tool says is on screen in a sentence or two and ask one question.
- To change pages without a specific section, use navigate_site_page. For contact, booking, pricing or a product tour, use open_site_modal.
- When they ask what they are looking at, or after they scroll, call describe_screen and talk about that.
- The "bestly.tech site map" knowledge is what is on the website. Jared Best is the founder; his About page is public, so answer questions about him from it and offer to show it. If something is not in the site map, say plainly it is not on the website and offer what is. Never invent a page, a calculator, an event or a price.
- Keep moving the visitor toward something useful: one short answer, show it, one question.
- On phone calls none of these tools work; never call them there.
${PRESENTER_END}`;
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
      // Private agent + allowlist: if either drifts, anyone with her agent id could run up minutes, or bestly.tech
      // could stop connecting (heal: switch auth back on, add the hosts back).
      const auth = aj?.platform_settings?.auth ?? {};
      const list: { hostname: string }[] = Array.isArray(auth.allowlist) ? auth.allowlist : [];
      const lacking = SITE_HOSTS.filter((h) => !list.some((x) => x?.hostname === h));
      if (lacking.length || auth.enable_auth !== true) {
        const fix = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, { method: "PATCH", headers: el,
          body: JSON.stringify({ platform_settings: { auth: { ...auth, enable_auth: true, allowlist: [...list, ...lacking.map((hostname) => ({ hostname }))] } } }) });
        const what = [auth.enable_auth !== true ? "made my agent private again" : "", lacking.length ? `put ${lacking.join(" and ")} back on my allowlist` : ""].filter(Boolean).join(" and ");
        if (fix.ok) fixed.push(`I ${what}.`);
        else site.push(`My web security drifted (${what} failed), so my agent id may be usable from anywhere.`);
      }

      // Presenter block in her prompt (heal: replace the old tail / stale block with the current one).
      const prompt = String(aj?.conversation_config?.agent?.prompt?.prompt ?? "");
      if (prompt && !prompt.includes(PRESENTER_BLOCK)) {
        let base = prompt;
        const a1 = base.indexOf(PRESENTER_START), a2 = base.indexOf(PRESENTER_END);
        if (a1 >= 0 && a2 > a1) base = base.slice(0, a1) + base.slice(a2 + PRESENTER_END.length);
        const old = base.indexOf("Website Actions (Client Tools)");
        if (old >= 0) base = base.slice(0, old);
        const next = `${base.trimEnd()}\n\n${PRESENTER_BLOCK}\n`;
        const fix = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, { method: "PATCH", headers: el,
          body: JSON.stringify({ conversation_config: { agent: { prompt: { prompt: next } } } }) });
        if (fix.ok) fixed.push("Updated my website presenter instructions.");
        else site.push("I couldn't update my website presenter instructions.");
      }

      // Site map knowledge, kept in step with the live site index.
      try {
        const ir = await fetch(SITE_INDEX_URL, { headers: { "Cache-Control": "no-cache" } });
        if (!ir.ok) site.push(`The site index at bestly.tech/maya/site-index.json answered ${ir.status}, so I can't find sections to show.`);
        else {
          const idx = await ir.json() as { generated_at?: string; pages?: { path: string; name: string; sections: { heading: string; label?: string; text: string }[] }[] };
          const stamp = String(idx.generated_at ?? "").slice(0, 16);
          const ageDays = (Date.now() - Date.parse(String(idx.generated_at ?? 0))) / 86400_000;
          if (!(ageDays < 14)) site.push(`My site index is ${Math.round(ageDays)} days old; re-run tools/maya-site-index/build.mjs so I know the current pages.`);
          const want = `${SITE_KB_PREFIX} ${stamp}`;
          const refs = (aj?.conversation_config?.agent?.prompt?.knowledge_base ?? []) as { type: string; name: string; id: string; usage_mode?: string }[];
          if (stamp && !refs.some((r) => r.name === want)) {
            const text = [
              "# bestly.tech site map", "",
              "Every public page on bestly.tech and what each section says. If something is not here, it is not on the website.", "",
              ...(idx.pages ?? []).flatMap((p) => [
                `## ${p.name} (${p.path === "/" ? "home page" : p.path})`, "",
                ...p.sections.flatMap((s) => [`### ${s.heading}${s.label ? ` (${s.label})` : ""}`, s.text || "(heading only)", ""]),
              ]),
            ].join("\n");
            const kr = await fetch("https://api.elevenlabs.io/v1/convai/knowledge-base/text", { method: "POST", headers: el,
              body: JSON.stringify({ name: want, text }) });
            const kj = await kr.json().catch(() => ({}));
            if (!kr.ok || !kj?.id) site.push(`I couldn't refresh my site map knowledge (${kr.status}).`);
            else {
              // She uses RAG: index the new doc right away so the first visitor after a refresh gets answers.
              await fetch(`https://api.elevenlabs.io/v1/convai/knowledge-base/${kj.id}/rag-index`, { method: "POST", headers: el,
                body: JSON.stringify({ model: "e5_mistral_7b_instruct" }) }).catch(() => {});
              const stale = refs.filter((r) => r.name.startsWith(SITE_KB_PREFIX));
              const nextRefs = [...refs.filter((r) => !r.name.startsWith(SITE_KB_PREFIX)), { type: "text", name: want, id: kj.id, usage_mode: "auto" }];
              const pr = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`, { method: "PATCH", headers: el,
                body: JSON.stringify({ conversation_config: { agent: { prompt: { knowledge_base: nextRefs } } } }) });
              if (pr.ok) {
                fixed.push("Refreshed my bestly.tech site map knowledge.");
                for (const r of stale) await fetch(`https://api.elevenlabs.io/v1/convai/knowledge-base/${r.id}`, { method: "DELETE", headers: el }).catch(() => {});
              } else site.push(`I made the new site map but couldn't attach it (${pr.status}).`);
            }
          }
        }
      } catch (e) {
        site.push(`Site map check crashed: ${String(e).slice(0, 120)}`);
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
    // 5c. Website door: maya-session must mint a signed session (proves key + agent + ElevenLabs path).
    const ms = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/maya-session`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` }, body: JSON.stringify({ op: "health" }) });
    const mj = await ms.json().catch(() => ({}));
    if (!ms.ok || mj?.ok !== true) site.push(`My website door (maya-session) can't start chats (${ms.status}${mj?.mint_status ? `, ElevenLabs ${mj.mint_status}` : ""}).`);
    else if ((mj.refused_last_hour ?? 0) > 40) site.push(`My website door refused ${mj.refused_last_hour} chat starts in the last hour; someone may be hammering it (the limits held).`);
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
    p_title: fixed.length ? "Maya: I fixed my line and tools on my own" : "Maya: line OK", p_body: fixed.join(" ") || null, p_area: "maya", p_healed: fixed.length > 0 });
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

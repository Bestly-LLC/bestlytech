/**
 * "Tailor this agent": the last card on every AgentDesk. For anything the template can't do (a custom page, a new tool, a workflow),
 * type what you want and either copy a complete build prompt for Claude Code, or ask Scout to build it (paid AI, only when you tap).
 * Prompt-only changes (tone, script, knowledge) don't need code: the Prompt and Knowledge sections above do that for free.
 */
import { useState } from "react";
import { Binoculars, Check, Copy, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { askScout } from "@/components/admin/scoutBus";
import { openSection } from "@/components/admin/roofguard/CollapsibleSection";
import { PROMPT_NOTE, btnPrimary, btnQuiet, copyText, fieldCls, pendingPromptNote, type AgentInfo } from "./agentApi";

export function buildPrompt(a: AgentInfo, request: string): string {
  const slug = a.slug;
  return [
    `Work in the repo Bestly-LLC/bestlytech. Read CLAUDE.md, docs/agents.md and docs/agent-template-opusplan.md first.`,
    ``,
    `Agent to tailor: ${a.name} (${a.purpose})`,
    `- slug: ${slug}`,
    `- registry row: public.voice_agents where slug = '${slug}' (kind ${a.kind}, status ${a.status})`,
    `- ElevenLabs agent id: ${a.elevenlabs_agent_id ?? "none yet"}`,
    `- phone number id: ${a.phone_number_id ?? "none"}  line: ${a.line_e164 ?? "web only"}`,
    `- modules: ${(a.modules ?? []).join(", ") || "none"}`,
    `- page: ${a.page_url ?? `/admin/agents/${slug}`}`,
    ``,
    `What I want it to do that the template can't:`,
    request.trim() || "(describe it here)",
    ``,
    `How to work:`,
    `- Plan with Opus in docs/${slug}-opusplan.md first, then build with Sonnet.`,
    `- Keep it on the template (voice_agents, agent-hub, AgentDesk) unless a custom page is truly needed. If one is, add src/pages/admin/agents/${slug[0].toUpperCase()}${slug.slice(1)}.tsx and point voice_agents.page_url at it, the way RoofGuard does.`,
    `- Follow the plan's Global rules: additive SQL only, one or two statements per MCP call, never edit a committed migration, admin RPCs are SECURITY DEFINER with team_is_admin() on the first line, new tables with emails or phones get privacy_data_map rows, every scheduled job gets a team card via team_onboard, free AI first.`,
    `- UI work: load .claude/skills/apple-design first, then do a ui-ux-pro-max pass. Admin runs dark. 12-hour times, no truncation with "...", numbers never split from units, no emoji, 44px touch targets.`,
    `- Do not change Ava's or Reese's pages, functions or tables. Commit, git pull --rebase origin main, push to main.`,
  ].join("\n");
}

export function AgentTailor({ agent }: { agent: AgentInfo }) {
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const prompt = buildPrompt(agent, text);
  const copy = async () => {
    if (await copyText(prompt)) { setDone(true); setTimeout(() => setDone(false), 1500); }
  };
  // Prompt-only requests (tone, script, what it knows) need no code: hand the request to the Prompt section's free-AI "Suggest a change".
  const tryFree = () => {
    const note = text.trim().replace(/\s+/g, " ").slice(0, 240);
    pendingPromptNote.set(agent.slug, note);
    openSection(`${agent.slug}-prompt`);
    setTimeout(() => window.dispatchEvent(new CustomEvent(PROMPT_NOTE, { detail: { slug: agent.slug, note } })), 400);
  };
  const id = `${agent.slug}-tailor`;
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
      <h3 id={`${id}-h`} className="flex items-center gap-2 text-[15px] font-semibold text-white"><Wand2 className="h-4 w-4 text-white/70" aria-hidden />Tailor this agent</h3>
      <p className="mt-1 text-[13px] leading-snug text-white/60">
        The template covers calls, the Coach, voice, knowledge and the script. For anything it can't do, say what you want and hand it to Claude.
        Changing tone, script or what {agent.name} knows needs no code: "Try with free AI" drafts the change in Prompt for you to review, and Knowledge holds the facts.
      </p>
      <label htmlFor={id} className="mt-4 block text-[13px] font-medium text-white">What should {agent.name} do that the template can't?</label>
      <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000}
        placeholder="Example: look up a customer's order status from our database and read it out."
        className={cn(fieldCls, "mt-1 min-h-[112px] resize-y py-3 leading-snug")} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className={btnPrimary}>
          {done ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{done ? "Copied" : "Copy build prompt for Claude"}</button>
        <button type="button" disabled={text.trim().length < 5} onClick={tryFree} className={btnQuiet}>
          <Sparkles className="h-4 w-4" aria-hidden />Try with free AI</button>
        <button type="button" disabled={text.trim().length < 5} onClick={() => askScout(prompt, { about: `agent:${agent.slug}` })} className={btnQuiet}>
          <Binoculars className="h-4 w-4" aria-hidden />Ask Scout to build it (paid AI)</button>
      </div>
    </section>
  );
}

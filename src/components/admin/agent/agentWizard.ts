/**
 * Logic for "+ New agent" (AgentNew page): the quick bits, the free-AI autofill, the deterministic no-AI template, name ideas,
 * and the spec text handed to Claude or Scout. Plan: docs/agent-template-opusplan.md, Phase 4.
 * Everything here is free: the autofill calls the free-llm function with paid: "never" and throws away any answer that cost money.
 */
import { supabase } from "@/integrations/supabase/client";

export const PURPOSES = ["Personal", "Bestly", "RoofGuard", "A client business", "Something else"] as const;
export type Purpose = (typeof PURPOSES)[number];

export type Bit = { id: string; label: string; hint: string; modules?: string[]; line: string };
/** Each quick bit adds one block to the script. `line` is plain instructions the agent follows. */
export const BITS: Bit[] = [
  { id: "answers", label: "Answers questions", hint: "From its knowledge, never guesses",
    line: "Answer questions from the knowledge base. If the knowledge base has no answer, say you are not sure and offer to have the team follow up. Never guess." },
  { id: "messages", label: "Takes messages", hint: "Name, number, what it is about",
    line: "Take a message when the caller needs a person: full name, best phone number, and what it is about. Read the details back and get a yes before you finish." },
  { id: "booking", label: "Books appointments", hint: "Collects day, time, contact",
    line: "Book appointments: ask what the visit is for, the day and time they prefer, their full name and phone number. Read it back and say the team will confirm. You cannot see a calendar, so never promise a time is open." },
  { id: "leads", label: "Qualifies leads", hint: "Asks the right few questions",
    line: "Qualify new leads: find out what they need, how soon, and who decides. Ask one question at a time. Collect name, phone and email, then say someone will follow up." },
  { id: "sells", label: "Sells a product", hint: "Explains it, asks for the next step",
    line: "Explain what we sell in two short sentences, answer questions from the knowledge base, and ask for the next step. Never invent prices, discounts or promises." },
  { id: "tickets", label: "Support tickets", hint: "Logs problems for the team", modules: ["tickets"],
    line: "When a problem cannot be solved on the call, collect name, email, phone and what happened, read it back, and open a ticket. Say when they will hear back." },
  { id: "privacy", label: "Privacy requests", hint: "Delete, export, correct data", modules: ["privacy"],
    line: "If a caller asks to delete, export or correct their data, or opt out, treat it as a privacy request. Do not argue or ask why. Collect their details and tell them the team will confirm by email." },
  { id: "outbound", label: "Calls people (outbound)", hint: "Script only, dialing is not switched on",
    line: "If you are the one placing the call, say who you are and why you are calling in the first sentence, and end the call politely if they say stop or not interested." },
  { id: "web", label: "Website chat", hint: "Short, written-style replies",
    line: "On website chat keep replies to one or two short sentences. Offer to take their details if you cannot answer." },
];

export const STYLE_RULES = [
  "Keep every reply to one or two short sentences. Ask only one question at a time.",
  "No markdown, lists, bullet points or bracketed audio tags. Speak naturally, like a friendly person on the phone.",
  "No filler such as \"great question\" or \"absolutely\". Get to the point.",
  "Use US units and 12-hour times, for example \"3 PM\".",
  "Say web addresses out loud, for example \"bestly dot tech\". Never read out personal emails.",
  "Never invent facts, prices, dates or policies. Only state what the knowledge base or this script confirms.",
  "If anyone asks whether you are a real person, say plainly that you are a voice AI.",
];

export type DataField = { name: string; description: string };
export type Fill = { greeting: string; prompt: string; knowledge_starter: string; data_fields: DataField[]; team_card: { role: string; what_it_does: string }; orb_hue: number };

export type Brief = { name: string; purpose: string; job: string; bits: string[] };

const bitLines = (ids: string[]) => BITS.filter((b) => ids.includes(b.id)).map((b) => `- ${b.line}`).join("\n");

/** No AI at all: build a sensible first script from the quick bits. Always works, always free. */
export function templateFill(b: Brief): Fill {
  const job = b.job.trim() || `Help callers for ${b.purpose}.`;
  const prompt = [
    `# Identity`,
    `You are ${b.name}, the voice AI for ${b.purpose}. ${job}`,
    ``,
    `# Speaking style`,
    ...STYLE_RULES.map((r) => `- ${r}`),
    ``,
    `# What you do`,
    bitLines(b.bits) || "- Answer questions from the knowledge base and take a message when someone needs a person.",
    ``,
    `# Wrapping up`,
    `- Before ending, ask if there is anything else. When the caller is done, say a short goodbye and end the call.`,
    `- If the caller asks for a person, say the team will call them back and take their name and number.`,
  ].join("\n");
  return {
    greeting: `Hey, this is ${b.name} with ${b.purpose}. What can I help you with?`,
    prompt,
    knowledge_starter: `About ${b.purpose}\n\n${job}\n\nNot confirmed yet: hours, prices and policies. Add them here so ${b.name} can answer from them.`,
    data_fields: [
      { name: "caller_name", description: "The caller's full name, if they gave it." },
      { name: "caller_email", description: "The caller's email address, if they gave it." },
      { name: "reason", description: "In one sentence, why they called." },
    ],
    team_card: { role: `${b.purpose} phone agent`, what_it_does: `Answers calls for ${b.purpose}. ${job}`.slice(0, 480) },
    orb_hue: hueFor(b.name),
  };
}

export function hueFor(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export const slugFrom = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 32).replace(/-+$/, "");

const FILL_SYSTEM = `You write the setup for a new phone voice agent. Reply with ONE JSON object and nothing else, with exactly these keys:
{"greeting": string, "prompt": string, "knowledge_starter": string, "data_fields": [{"name": string, "description": string}], "team_card": {"role": string, "what_it_does": string}, "orb_hue": integer}
Rules:
- greeting: what the agent says first. One short sentence, under 160 characters. Say its name and who it works for.
- prompt: the full script, plain text with short "# Heading" lines (Identity, Speaking style, What you do, Wrapping up). Speak to the agent as "you". Work every requested ability in, using plain steps. Keep it under 2500 characters. The agent speaks on the phone: replies are one or two short sentences, one question at a time, no lists or markdown read aloud, US units, 12-hour times, never invent facts, say plainly it is a voice AI if asked. Do not mention tools.
- knowledge_starter: a short starter document (under 1500 characters) of facts the agent can state. Use only facts from the brief. Where a fact is unknown write "Not confirmed yet:" followed by what to add. Never invent prices, hours or policies.
- data_fields: 3 to 5 things to capture from each call. name is snake_case and one field must be caller_name. description is one sentence.
- team_card.role: a job title under 50 characters. team_card.what_it_does: one or two plain sentences under 300 characters, written for the owner.
- orb_hue: 0 to 359, a color that suits the purpose.
Plain words. No emoji. No em dashes.`;

const clamp = (v: unknown, n: number) => String(v ?? "").replace(/[ \t]+\n/g, "\n").trim().slice(0, n);

function coerceFill(j: unknown, fallback: Fill): Fill | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const prompt = clamp(o.prompt, 20000);
  if (prompt.length < 80) return null;
  const fields = (Array.isArray(o.data_fields) ? o.data_fields : []).slice(0, 8)
    .map((f) => ({ name: clamp((f as DataField)?.name, 40).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""), description: clamp((f as DataField)?.description, 200) }))
    .filter((f) => f.name && f.description);
  const tc = (o.team_card ?? {}) as Record<string, unknown>;
  const hue = Number(o.orb_hue);
  return {
    greeting: clamp(o.greeting, 300) || fallback.greeting,
    prompt,
    knowledge_starter: clamp(o.knowledge_starter, 6000) || fallback.knowledge_starter,
    data_fields: fields.length ? fields : fallback.data_fields,
    team_card: { role: clamp(tc.role, 60) || fallback.team_card.role, what_it_does: clamp(tc.what_it_does, 500) || fallback.team_card.what_it_does },
    orb_hue: Number.isFinite(hue) ? Math.max(0, Math.min(359, Math.round(hue))) : fallback.orb_hue,
  };
}

/** One shape for both outcomes (the project compiles without strict null checks, which cannot narrow a true/false union). */
export type FillResult = { ok: boolean; fill: Fill | null; model: string; provider: string; reason: string };

/** One free-AI try. Paid answers are refused here too, whatever the server did. */
export async function freeAutofill(b: Brief): Promise<FillResult> {
  const picked = BITS.filter((x) => b.bits.includes(x.id)).map((x) => `- ${x.label}: ${x.line}`).join("\n") || "- (none picked)";
  const user = `Agent name: ${b.name}\nWorks for: ${b.purpose}\nThe job in one line: ${b.job.trim() || "(not given, infer from the abilities)"}\nAbilities to include:\n${picked}`;
  const { data, error } = await supabase.functions.invoke("free-llm", { body: { op: "run", task: "write", system: FILL_SYSTEM, user, json: true, paid: "never", privacy: "private", maxTokens: 3500 } });
  const d = data as { ok?: boolean; json?: unknown; text?: string; provider?: string; model?: string; cost_usd?: number } | null;
  if (error || !d?.ok) return { ok: false, fill: null, model: "", provider: "", reason: "The free AI is busy or resting right now." };
  if (d.provider === "anthropic" || Number(d.cost_usd ?? 0) > 0) return { ok: false, fill: null, model: "", provider: "", reason: "That answer came from a paid model, so it was thrown away." };
  let j: unknown = d.json;
  if (!j && d.text) { try { j = JSON.parse(String(d.text).replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "")); } catch { j = null; } }
  const fill = coerceFill(j, templateFill(b));
  if (!fill) return { ok: false, fill: null, model: "", provider: "", reason: "The free AI's answer wasn't usable." };
  return { ok: true, fill, model: String(d.model ?? "free model"), provider: String(d.provider ?? "free"), reason: "" };
}

/** Three name ideas from the free AI. Empty list when it is resting; the person can always type a name. */
export async function suggestNames(purpose: string, job: string): Promise<string[]> {
  const system = `Suggest 3 first names for a friendly phone voice agent. Reply with ONE JSON object only: {"names":["A","B","C"]}. Each name is one short, easy-to-say first name (4 to 8 letters), not a famous person, not a brand.`;
  const { data } = await supabase.functions.invoke("free-llm", { body: { op: "run", task: "write", system, user: `It works for: ${purpose}. The job: ${job || "answers calls"}`, json: true, paid: "never", privacy: "private", maxTokens: 200 } });
  const d = data as { ok?: boolean; json?: { names?: unknown }; provider?: string; cost_usd?: number } | null;
  if (!d?.ok || d.provider === "anthropic" || Number(d.cost_usd ?? 0) > 0) return [];
  const names = Array.isArray(d.json?.names) ? (d.json!.names as unknown[]).map((n) => String(n).replace(/[^A-Za-z]/g, "").slice(0, 12)).filter((n) => n.length >= 2) : [];
  return [...new Set(names)].slice(0, 3);
}

export type Spec = Brief & { slug: string; fill: Fill; voice_name: string; line: string; use_ticket_desk: boolean };

/** The whole request as plain text, for Scout (paid autofill) and for "Copy for Claude". */
export function specText(s: Spec): string {
  const picked = BITS.filter((b) => s.bits.includes(b.id)).map((b) => `- ${b.label}`).join("\n") || "- (none)";
  return [
    `New phone agent for Bestly's agent template (voice_agents, agent-hub, AgentDesk).`,
    `Name: ${s.name}   Short name (slug): ${s.slug}   Works for: ${s.purpose}`,
    `The job in one line: ${s.job.trim() || "(not given)"}`,
    `Abilities:\n${picked}`,
    `Line: ${s.line}`,
    `Voice: ${s.voice_name}`,
    ``,
    `Write the greeting, the full script (plain text, short "# Heading" lines, replies of one or two short sentences, US units, 12-hour times, never invent facts), a starter knowledge document, 3 to 5 call data fields (one is caller_name), a Team card role and one-line description, and an orb hue from 0 to 359.`,
    `Reply with ONE JSON object only, no explanation, with exactly these keys: {"greeting": string, "prompt": string, "knowledge_starter": string, "data_fields": [{"name": string, "description": string}], "team_card": {"role": string, "what_it_does": string}, "orb_hue": integer}. Jared pastes it into the New agent form. Do not buy a phone number or spend money.`,
  ].join("\n");
}

/** Read a pasted JSON answer (Scout's, or Claude's) into the form fields. Returns null when it isn't usable. */
export function parseFillText(text: string, b: Brief): Fill | null {
  const m = text.replace(/```[a-z]*\n?/gi, "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return coerceFill(JSON.parse(m[0]), templateFill(b)); } catch { return null; }
}

/** A complete Claude Code prompt that creates this agent through agent-hub, for the "Copy for Claude" button. */
export function claudePrompt(s: Spec, numberId: string | null): string {
  const spec = {
    slug: s.slug, name: s.name, purpose: s.purpose, orb_hue: s.fill.orb_hue, greeting: s.fill.greeting, prompt: s.fill.prompt, knowledge_starter: s.fill.knowledge_starter,
    data_fields: s.fill.data_fields, team_card: s.fill.team_card, modules: BITS.filter((b) => s.bits.includes(b.id)).flatMap((b) => b.modules ?? []), use_ticket_desk: s.use_ticket_desk,
    phone_number_id: numberId, voice_id: "(the voice id picked in the form, or Maya's)",
  };
  return [
    `Work in the repo Bestly-LLC/bestlytech. Read CLAUDE.md and docs/agents.md first.`,
    `Create a new template phone agent with the agent-hub edge function, action "create", idempotent per slug. It spends nothing and never buys a number.`,
    `Job: ${s.job.trim() || "(not given)"}`,
    `Fill in anything below that is empty or weak, then call create with this spec:`,
    JSON.stringify(spec, null, 2),
    `Then open /admin/agents/${s.slug}, confirm the page renders, the Team card exists, and report the ElevenLabs agent id. Follow the Global rules in docs/agent-template-opusplan.md. Commit, git pull --rebase origin main, push to main.`,
  ].join("\n");
}

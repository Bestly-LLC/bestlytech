/**
 * AgentNew: "+ New agent" (route /admin/agents/new). One screen, phone first. Plan: docs/agent-template-opusplan.md, Phase 4.
 *
 *   1 Who is it for        purpose chips, name (3 free-AI ideas), short name
 *   2 Quick bits           tap what it should do; each adds a block to the script and, for tickets and privacy, a page module
 *   3 The job + Autofill   one line, then free AI fills the greeting, script, knowledge starter, call fields and Team card.
 *                          Every field is an editable box. If free AI fails twice: Scout (paid, only when tapped) or Copy for Claude.
 *   4 Voice                the account's voices with a preview; Maya's voice is the default
 *   5 Line                 Web only (free), a spare number, or ask Scout. Nothing is ever bought here.
 *   6 Create               agent-hub create (idempotent per slug) with a checklist and a retry per step.
 * Making the agent costs nothing. Calls cost about the per-minute rate shown at the bottom.
 */
import { Lines } from "@/components/Lines";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Binoculars, Check, ClipboardPaste, Copy, Loader2, Plus, RotateCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AvaOrb, orbGlow } from "@/components/admin/roofguard/AvaOrb";
import { invokeError } from "@/components/admin/roofguard/AvaActions";
import { askScout } from "@/components/admin/scoutBus";
import { LinePick, VoicePick, type LineChoice, type PickVoice } from "@/components/admin/agent/WizardPickers";
import { BITS, PURPOSES, claudePrompt, freeAutofill, hueFor, parseFillText, slugFrom, specText, suggestNames, templateFill, type Brief, type Fill, type Purpose, type Spec } from "@/components/admin/agent/agentWizard";
import { boxCls, btnPrimary, btnQuiet, copyText, fieldCls, ring, rpcArgs } from "@/components/admin/agent/agentApi";

const RESERVED = new Set(["new", "admin", "ava", "reese", "roofguard", "maya", "scout"]);
const SLUG_OK = /^[a-z][a-z0-9-]{1,31}$/;
const COST_PER_MIN = 0.12;
const HUES = [21, 45, 140, 190, 215, 265, 320, 350];
const STEPS = [
  { key: "agent", label: "Agent made" }, { key: "voice", label: "Voice set" }, { key: "knowledge", label: "Knowledge added" },
  { key: "number", label: "Number assigned" }, { key: "hook", label: "Calls hooked up" }, { key: "team", label: "On the Team page" },
] as const;
type StepRes = { key: string; label: string; ok: boolean; detail?: string };

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`new-s${n}`} className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
      <h2 id={`new-s${n}`} className="flex items-center gap-2.5 text-[17px] font-semibold text-white">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[13px] font-semibold tabular-nums text-white/80" aria-hidden>{n}</span>{title}</h2>
      {hint && <p className="mt-1 text-[13px] leading-snug text-white/60"><Lines>{hint}</Lines></p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const chip = (on: boolean) => cn("inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[15px] font-medium ring-1 transition", ring, "motion-safe:active:scale-[0.97]",
  on ? "bg-white text-black ring-white" : "bg-white/[0.05] text-white/85 ring-white/10 hover:bg-white/[0.1]");

function Label({ id, children, hint }: { id: string; children: ReactNode; hint?: string }) {
  return <div className="mb-1"><label htmlFor={id} className="block text-[13px] font-medium text-white">{children}</label>{hint && <p className="text-xs text-white/50"><Lines>{hint}</Lines></p>}</div>;
}

export default function AgentNew() {
  const [purpose, setPurpose] = useState<Purpose>("Bestly");
  const [other, setOther] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [bits, setBits] = useState<string[]>(["answers", "messages"]);
  const [useDesk, setUseDesk] = useState(false);
  const [job, setJob] = useState("");
  const [fill, setFill] = useState<Fill | null>(null);
  const [fieldsText, setFieldsText] = useState("");
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [fails, setFails] = useState(0);
  const [pasted, setPasted] = useState("");
  const [voice, setVoice] = useState<PickVoice | null>(null);
  const [line, setLine] = useState<LineChoice>({ kind: "web" });
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<StepRes[] | null>(null);
  const [failMsg, setFailMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<{ page_url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const purposeText = purpose === "Something else" || purpose === "A client business" ? (other.trim() || purpose) : purpose;
  const purposeValid = purpose !== "Something else" || other.trim().length > 0;
  const brief: Brief = { name: name.trim(), purpose: purposeText.slice(0, 40), job, bits };
  const modules = BITS.filter((b) => bits.includes(b.id)).flatMap((b) => b.modules ?? []);
  const deskAsked = modules.includes("tickets") || modules.includes("privacy");

  useEffect(() => { void (async () => {
    const r = await rpcArgs<{ slug: string }[]>("admin_agents", {});
    if (!r.error && Array.isArray(r.data)) setTaken(new Set(r.data.map((a) => a.slug)));
  })(); }, []);
  useEffect(() => { if (!slugTouched) setSlug(slugFrom(name)); }, [name, slugTouched]);
  useEffect(() => { if (!deskAsked) setUseDesk(false); }, [deskAsked]);

  const slugErr = !slug ? null : !SLUG_OK.test(slug) ? "Use 2 to 32 lowercase letters, numbers or dashes, starting with a letter."
    : RESERVED.has(slug) || (taken.has(slug) && !results) ? `"${slug}" is taken. Pick another short name.` : null;

  const toggleBit = (id: string) => setBits((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));

  const applyFill = (f: Fill) => { setFill(f); setFieldsText(f.data_fields.map((d) => `${d.name}: ${d.description}`).join("\n")); };
  const parseFields = () => fieldsText.split("\n").map((l) => { const i = l.indexOf(":"); return i > 0 ? { name: l.slice(0, i).trim(), description: l.slice(i + 1).trim() } : null; })
    .filter((x): x is { name: string; description: string } => !!x && !!x.name && !!x.description);

  const suggest = async () => {
    setIdeasBusy(true);
    const n = await suggestNames(purposeText, job);
    setIdeasBusy(false);
    if (!n.length) toast("The free AI is resting. Type a name instead.");
    setIdeas(n);
  };

  const autofill = async () => {
    if (!brief.name) { toast.error("Give it a name first."); return; }
    setFilling(true); setFillNote(null);
    const r = await freeAutofill(brief);
    setFilling(false);
    if (r.ok) { applyFill(r.fill); setFails(0); setFillNote(`Free AI · $0 · ${r.model}`); return; }
    setFails((n) => n + 1);
    setFillNote(r.reason);
  };
  const fromTemplate = () => {
    if (!brief.name) { toast.error("Give it a name first."); return; }
    applyFill(templateFill(brief)); setFillNote("Filled from the template. No AI used · $0");
  };

  const filled = !!fill && fill.prompt.trim().length >= 40;
  const canCreate = !!brief.name && SLUG_OK.test(slug) && !slugErr && purposeValid && filled && !!voice && !(line.kind === "spare" && !line.num) && !running && !created;

  const spec: Spec | null = fill ? { ...brief, slug, fill: { ...fill, data_fields: parseFields() }, voice_name: voice?.name ?? "Maya's voice", line: line.kind === "web" ? "Web only, no phone number" : line.kind === "spare" ? `Spare number ${line.num?.phone_number ?? ""}` : "Web only for now (a number is being arranged with Scout)", use_ticket_desk: useDesk } : null;
  const numberId = line.kind === "spare" && line.num ? line.num.phone_number_id : null;

  const create = async () => {
    if (!fill || !voice) return;
    setRunning(true); setFailMsg(null);
    if (!results) setResults([]);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }), 60);
    const body = { action: "create", spec: {
      slug, name: brief.name, purpose: brief.purpose, dept: purpose === "Personal" || purpose === "Something else" ? "desk" : "sales", orb_hue: fill.orb_hue, greeting: fill.greeting, prompt: fill.prompt,
      knowledge_starter: fill.knowledge_starter, data_fields: parseFields(), team_card: fill.team_card, modules, use_ticket_desk: useDesk, voice_id: voice.voice_id, phone_number_id: numberId } };
    const { data, error } = await supabase.functions.invoke("agent-hub", { body });
    setRunning(false);
    const d = data as { ok?: boolean; steps?: StepRes[]; error?: string; page_url?: string } | null;
    if (Array.isArray(d?.steps)) {
      setResults(d!.steps!);
      if (d!.ok) {
        setCreated({ page_url: d!.page_url ?? `/admin/agents/${slug}` });
        try { window.dispatchEvent(new Event("bestly:agents-changed")); } catch { /* no window */ }
        toast.success(`${brief.name} is ready.`);
      } else setFailMsg(d?.error ?? "Some steps didn't finish. Tap Retry.");
      return;
    }
    setFailMsg(await invokeError(error, d, "Couldn't create the agent. Try again in a minute."));
  };

  const claudeText = useMemo(() => (spec ? claudePrompt(spec, numberId) : ""), [spec, numberId]);
  const scoutText = spec ? specText(spec) : specText({ ...brief, slug, fill: templateFill(brief), voice_name: voice?.name ?? "Maya's voice", line: "Web only", use_ticket_desk: useDesk });

  const doCopy = async () => {
    const text = claudeText || claudePrompt({ ...brief, slug, fill: templateFill(brief), voice_name: voice?.name ?? "", line: "Web only", use_ticket_desk: useDesk }, numberId);
    if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } else toast.error("Couldn't copy. Select the text and copy it by hand.");
  };

  const stepState = (key: string): "ok" | "bad" | "run" | "wait" => {
    const r = results?.find((s) => s.key === key);
    if (r) return r.ok ? "ok" : "bad";
    return running ? "run" : "wait";
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-28">
      <header className="flex items-center gap-4">
        <AvaOrb size={64} hue={fill?.orb_hue ?? hueFor(name || "new")} label="New agent" />
        <div className="min-w-0">
          <Link to="/admin" className="-ml-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-[13px] text-white/60 hover:text-white"><ArrowLeft className="h-4 w-4" aria-hidden />Command Center</Link>
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-[-0.015em] text-white sm:text-3xl">New agent</h1>
        </div>
      </header>
      <p className="text-[15px] leading-snug text-white/65">Tap a few things, let free AI write the script, check it, and create. Making an agent is free and never buys a phone number.</p>

      <Section n={1} title="Who is it for?">
        <div role="radiogroup" aria-label="Who is it for" className="flex flex-wrap gap-2">
          {PURPOSES.map((p) => <button key={p} type="button" role="radio" aria-checked={purpose === p} onClick={() => setPurpose(p)} className={chip(purpose === p)}>{p}</button>)}
        </div>
        {(purpose === "A client business" || purpose === "Something else") && (
          <div className="mt-3">
            <Label id="new-other" hint={purpose === "A client business" ? "Optional. Shows next to the name." : "Shows next to the name."}>{purpose === "A client business" ? "Business name" : "Who or what is it for?"}</Label>
            <input id="new-other" value={other} maxLength={40} onChange={(e) => setOther(e.target.value)} className={cn(fieldCls, "h-11")} placeholder={purpose === "A client business" ? "Sunset Dental" : "Open house line"} />
          </div>
        )}
        <div className="mt-4">
          <Label id="new-name">Name</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="new-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={cn(fieldCls, "h-11 shrink-0 sm:flex-1")} placeholder="Piper" autoComplete="off" />
            <button type="button" onClick={() => void suggest()} disabled={ideasBusy} className={btnQuiet}>
              {ideasBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}Suggest names</button>
          </div>
          {ideas.length > 0 && <div className="mt-2 flex flex-wrap gap-2" aria-label="Name ideas">{ideas.map((n) => <button key={n} type="button" onClick={() => setName(n)} className={chip(name === n)}>{n}</button>)}</div>}
        </div>
        <div className="mt-4">
          <Label id="new-slug" hint={`Its page address: /admin/agents/${slug || "short-name"}`}>Short name</Label>
          <input id="new-slug" value={slug} maxLength={32} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); }}
            aria-invalid={!!slugErr} aria-describedby={slugErr ? "new-slug-err" : undefined} className={cn(fieldCls, "h-11 font-mono text-[14px]")} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          {slugErr && <p id="new-slug-err" role="alert" className="mt-1 text-[13px] text-amber-200">{slugErr}</p>}
        </div>
      </Section>

      <Section n={2} title="Quick bits" hint="Tap everything it should do. Each one adds a block to the script.">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick bits">
          {BITS.map((b) => (
            <button key={b.id} type="button" aria-pressed={bits.includes(b.id)} onClick={() => toggleBit(b.id)} className={chip(bits.includes(b.id))} title={b.hint}>
              {bits.includes(b.id) ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4 opacity-60" aria-hidden />}{b.label}</button>
          ))}
        </div>
        {bits.includes("outbound") && <p className="mt-3 text-[13px] leading-snug text-white/60">Calls people adds the script only. Placing calls is not switched on for template agents yet.</p>}
        {deskAsked && (
          <label className="mt-4 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
            <input type="checkbox" checked={useDesk} onChange={(e) => setUseDesk(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-white" />
            <span className="text-[14px] leading-snug text-white/80"><span className="block font-medium text-white">Use Maya's ticket desk</span>
              Tickets this agent opens land on Maya's desk and her ticket tool is attached. Leave it off and the agent has no ticket tool.</span>
          </label>
        )}
      </Section>

      <Section n={3} title="The job, then autofill" hint="One line is enough. Free AI writes the rest and you can edit every box.">
        <Label id="new-job">What is the job in one line?</Label>
        <textarea id="new-job" value={job} maxLength={240} rows={2} onChange={(e) => setJob(e.target.value)} className={cn(fieldCls, "resize-y py-2.5 leading-snug")} placeholder="Answer calls for our dental office and book cleanings" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void autofill()} disabled={filling || !brief.name} className={btnPrimary}>
            {filling ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}{filling ? "Writing" : fill ? "Autofill again with free AI" : "Autofill with free AI"}</button>
          <button type="button" onClick={fromTemplate} disabled={!brief.name} className={btnQuiet}>Use the template (no AI)</button>
        </div>
        <p className="mt-2 text-xs text-white/55" aria-live="polite">{fillNote ?? "Free AI · $0"}</p>

        {fails >= 2 && (
          <div role="group" aria-label="Free AI is not answering" className="mt-3 space-y-3 rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-500/30">
            <p className="text-[14px] leading-snug text-amber-100">The free AI didn't answer twice. Use the template above, or hand it to a paid helper. Scout costs money only when you tap.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => askScout(scoutText, { about: `new-agent:${slug || "draft"}` })} className={btnQuiet}><Binoculars className="h-4 w-4" aria-hidden />Autofill with Scout (paid)</button>
              <button type="button" onClick={() => void doCopy()} className={btnQuiet}>{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copied" : "Copy for Claude"}</button>
            </div>
            <div>
              <Label id="new-paste" hint="Paste the JSON answer Scout or Claude gives you.">Paste an answer</Label>
              <textarea id="new-paste" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} className={cn(fieldCls, "py-2 font-mono text-[13px]")} />
              <button type="button" disabled={pasted.trim().length < 20} onClick={() => { const f = parseFillText(pasted, brief); if (f) { applyFill(f); setPasted(""); setFails(0); setFillNote("Filled from the pasted answer."); } else toast.error("That didn't read as the JSON answer."); }}
                className={cn(btnQuiet, "mt-2")}><ClipboardPaste className="h-4 w-4" aria-hidden />Fill the boxes</button>
            </div>
          </div>
        )}

        {fill && (
          <div className="mt-5 space-y-4">
            <div>
              <Label id="new-greet">Greeting</Label>
              <textarea id="new-greet" value={fill.greeting} maxLength={500} rows={2} onChange={(e) => setFill({ ...fill, greeting: e.target.value })} className={cn(fieldCls, "resize-y py-2.5 leading-snug")} />
            </div>
            <div>
              <Label id="new-script" hint="What it follows on every call.">Script</Label>
              <textarea id="new-script" value={fill.prompt} onChange={(e) => setFill({ ...fill, prompt: e.target.value })} rows={14} spellCheck={false} className={cn(fieldCls, "min-h-[280px] resize-y py-3 font-mono text-[13px] leading-snug")} />
              <p className="mt-1 text-xs tabular-nums text-white/50">{fill.prompt.length.toLocaleString("en-US")} characters</p>
            </div>
            <div>
              <Label id="new-kb" hint="Facts it can state. Add hours, prices and policies here.">Knowledge starter</Label>
              <textarea id="new-kb" value={fill.knowledge_starter} onChange={(e) => setFill({ ...fill, knowledge_starter: e.target.value })} rows={6} className={cn(fieldCls, "min-h-[140px] resize-y py-3 text-[14px] leading-snug")} />
            </div>
            <div>
              <Label id="new-fields" hint="One per line, as name: what to capture. Shows on every call.">Call details to capture</Label>
              <textarea id="new-fields" value={fieldsText} onChange={(e) => setFieldsText(e.target.value)} rows={4} spellCheck={false} className={cn(fieldCls, "resize-y py-3 font-mono text-[13px] leading-snug")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label id="new-role">Team card: job title</Label>
                <input id="new-role" value={fill.team_card.role} maxLength={60} onChange={(e) => setFill({ ...fill, team_card: { ...fill.team_card, role: e.target.value } })} className={cn(fieldCls, "h-11")} /></div>
              <div><Label id="new-what">Team card: what it does</Label>
                <textarea id="new-what" value={fill.team_card.what_it_does} maxLength={500} rows={3} onChange={(e) => setFill({ ...fill, team_card: { ...fill.team_card, what_it_does: e.target.value } })} className={cn(fieldCls, "resize-y py-2.5 leading-snug")} /></div>
            </div>
            <div>
              <p className="mb-1 text-[13px] font-medium text-white">Orb color</p>
              <div role="radiogroup" aria-label="Orb color" className="flex flex-wrap gap-2">
                {HUES.map((h) => (
                  <button key={h} type="button" role="radio" aria-checked={fill.orb_hue === h} aria-label={`Color ${h}`} onClick={() => setFill({ ...fill, orb_hue: h })}
                    className={cn("grid h-11 w-11 place-items-center rounded-full ring-2", ring, fill.orb_hue === h ? "ring-white" : "ring-white/10")}>
                    <span className="h-6 w-6 rounded-full" style={{ background: orbGlow(h) }} aria-hidden /></button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section n={4} title="Voice" hint="Maya's voice is the default. Preview others before you pick.">
        <VoicePick agentName={brief.name} purpose={brief.purpose} value={voice} onPick={setVoice} />
      </Section>

      <Section n={5} title="Line" hint="How people reach it.">
        <LinePick slug={slug} name={brief.name} value={line} onChange={setLine} />
      </Section>

      <Section n={6} title="Create">
        <p className="text-[15px] leading-snug text-white/75">Making the agent: free. Calls: about <span className="whitespace-nowrap font-semibold text-white">${COST_PER_MIN.toFixed(2)} a minute</span>. You can set a daily cap on its page.</p>
        {!canCreate && !running && !created && (
          <p className="mt-2 text-[13px] leading-snug text-white/55">
            {!brief.name ? "Add a name." : slugErr ? slugErr : !purposeValid ? "Say who it is for." : !filled ? "Run the autofill (or use the template) so there is a script." : !voice ? "Pick a voice." : line.kind === "spare" && !line.num ? "Pick the spare number, or switch to Web only." : ""}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void create()} disabled={!canCreate} className={btnPrimary}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}{running ? "Creating" : "Create agent"}</button>
          <button type="button" onClick={() => void doCopy()} className={btnQuiet}>{copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copied" : "Copy for Claude to build"}</button>
        </div>

        {(results || running || failMsg) && (
          <div ref={resultsRef} className="mt-5" aria-live="polite">
            <ul className="space-y-2">
              {STEPS.map((s) => {
                const st = stepState(s.key); const r = results?.find((x) => x.key === s.key);
                return (
                  <li key={s.key} className={cn("flex items-start gap-3 rounded-2xl p-3 ring-1", st === "bad" ? "bg-amber-500/10 ring-amber-500/30" : "bg-white/[0.04] ring-white/10")}>
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full" aria-hidden>
                      {st === "ok" ? <Check className="h-5 w-5 text-emerald-300" /> : st === "bad" ? <X className="h-5 w-5 text-amber-300" /> : st === "run" ? <Loader2 className="h-4 w-4 animate-spin text-white/70" /> : <span className="h-2.5 w-2.5 rounded-full bg-white/20" />}</span>
                    <span className="min-w-0 flex-1 text-[15px] text-white"><span className="sr-only">{st === "ok" ? "Done: " : st === "bad" ? "Failed: " : st === "run" ? "Working: " : "Waiting: "}</span>{s.label}
                      {r?.detail && <span className={cn("block text-[13px] leading-snug [overflow-wrap:anywhere]", st === "bad" ? "text-amber-100" : "text-white/55")}>{r.detail}</span>}</span>
                    {st === "bad" && <button type="button" onClick={() => void create()} disabled={running} className={cn(btnQuiet, "shrink-0")}><RotateCw className="h-4 w-4" aria-hidden />Retry</button>}
                  </li>
                );
              })}
            </ul>
            {failMsg && !running && (
              <div role="alert" className="mt-3 rounded-2xl bg-amber-500/10 p-4 text-[14px] leading-snug text-amber-100 ring-1 ring-amber-500/30">
                <p>{failMsg}</p>
                {!results?.length && <button type="button" onClick={() => void create()} className={cn(btnQuiet, "mt-2")}><RotateCw className="h-4 w-4" aria-hidden />Retry</button>}
              </div>
            )}
            {created && (
              <div className="mt-3 rounded-2xl bg-emerald-500/[0.08] p-4 ring-1 ring-emerald-400/30">
                <p className="text-[15px] font-medium text-white">{brief.name} is ready.</p>
                <p className="mt-0.5 text-[13px] leading-snug text-white/65">{line.kind === "spare" ? "Its number is connected." : "It is Web only. Test it from its page, then add a number when you want one."}</p>
                <Link to={created.page_url} className={cn(btnPrimary, "mt-3")}>Open {brief.name}</Link>
              </div>
            )}
          </div>
        )}
      </Section>

      <p className={cn(boxCls, "text-[13px]")}>Rather have Claude build it? Tap "Copy for Claude to build" and paste it into Claude Code. Want it tailored later? Every agent page has a Tailor card at the bottom.</p>
    </div>
  );
}

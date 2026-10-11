/**
 * Prompt: the greeting and the script a template agent follows. Collapsed by default. Nothing is saved until you press Save
 * (agent-hub prompt_set). "Improve with free AI" takes a one-line note, asks the free-llm function (paid: never) for a revised prompt,
 * and shows what changed line by line; you can use that version in the editor, but it still needs Save. The learned-playbook block
 * between <!-- playbook --> markers belongs to the Coach and is kept exactly as it is.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, ScrollText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/admin/roofguard/CollapsibleSection";
import { PROMPT_NOTE, announceAgentChanged, boxCls, btnPrimary, btnQuiet, fieldCls, hub, pendingPromptNote, type AgentInfo } from "./agentApi";

const PB_OPEN = "<!-- playbook -->";
const MAX_PROMPT = 60000;

type Part = { kind: "same" | "add" | "del"; text: string };
/** Line-level diff (longest common subsequence). Prompts are a few hundred lines at most. */
export function lineDiff(a: string, b: string): Part[] {
  const x = a.split("\n"), y = b.split("\n");
  const n = x.length, m = y.length;
  const t: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out: Part[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ kind: "same", text: x[i] }); i++; j++; }
    else if (t[i + 1][j] >= t[i][j + 1]) out.push({ kind: "del", text: x[i++] });
    else out.push({ kind: "add", text: y[j++] });
  }
  while (i < n) out.push({ kind: "del", text: x[i++] });
  while (j < m) out.push({ kind: "add", text: y[j++] });
  return out;
}

function Diff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => lineDiff(before, after), [before, after]);
  const rows: ({ kind: "same-run"; n: number } | { kind: "add" | "del"; text: string })[] = [];
  let run = 0;
  for (const p of parts) {
    if (p.kind === "same") { run++; continue; }
    if (run) { rows.push({ kind: "same-run", n: run }); run = 0; }
    rows.push({ kind: p.kind as "add" | "del", text: p.text });
  }
  if (run) rows.push({ kind: "same-run", n: run });
  const changed = parts.filter((p) => p.kind !== "same").length;
  if (!changed) return <p className={boxCls}>The free AI changed nothing.</p>;
  return (
    <div className="max-h-[360px] overflow-y-auto rounded-2xl bg-black/30 p-3 font-mono text-[13px] leading-snug ring-1 ring-white/10" role="region" aria-label="What changed, line by line">
      {rows.map((r, i) => r.kind === "same-run"
        ? <p key={i} className="py-1 text-white/45">{r.n} unchanged {r.n === 1 ? "line" : "lines"}</p>
        : <p key={i} className={cn("whitespace-pre-wrap px-2 py-0.5 [overflow-wrap:anywhere]", r.kind === "add" ? "bg-emerald-500/15 text-emerald-100" : "bg-rose-500/15 text-rose-100 line-through decoration-rose-300/50")}>
            <span className="sr-only">{r.kind === "add" ? "Added: " : "Removed: "}</span>{r.text || " "}</p>)}
    </div>
  );
}

function Body({ agent }: { agent: AgentInfo }) {
  const [orig, setOrig] = useState<{ prompt: string; first: string } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [first, setFirst] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState(() => pendingPromptNote.get(agent.slug) ?? "");
  const [improving, setImproving] = useState(false);
  const [sugg, setSugg] = useState<string | null>(null);
  const [suggErr, setSuggErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const r = await hub<{ prompt: string; first_message: string }>({ action: "prompt_get", slug: agent.slug }, "Couldn't read the prompt. Try again.");
    if (!r.ok) { setErr(r.error); return; }
    setOrig({ prompt: r.data.prompt, first: r.data.first_message }); setPrompt(r.data.prompt); setFirst(r.data.first_message);
  }, [agent.slug]);
  useEffect(() => { void load(); }, [load]);
  // "Try with free AI" on the Tailor card hands its request over as the note.
  useEffect(() => { pendingPromptNote.delete(agent.slug); }, [agent.slug]);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<{ slug: string; note: string }>).detail; if (d?.slug === agent.slug) { setNote(d.note); pendingPromptNote.delete(agent.slug); } };
    window.addEventListener(PROMPT_NOTE, h);
    return () => window.removeEventListener(PROMPT_NOTE, h);
  }, [agent.slug]);

  const dirty = !!orig && (prompt !== orig.prompt || first !== orig.first);
  const valid = prompt.trim().length >= 20 && prompt.length <= MAX_PROMPT && first.length <= 500;

  const save = async () => {
    setSaving(true);
    const r = await hub({ action: "prompt_set", slug: agent.slug, prompt, first_message: first }, "Couldn't save. Try again.");
    setSaving(false);
    if (!r.ok) { toast.error(r.error); return; }
    setOrig({ prompt, first });
    toast.success(`Saved. ${agent.name} uses it from the next call.`);
    announceAgentChanged(agent.slug);
  };

  const improve = async () => {
    setImproving(true); setSugg(null); setSuggErr(null);
    const system = `You edit the system prompt of a phone agent named ${agent.name}. Apply ONLY the requested change. Keep every rule, tool name, variable like {{name}}, heading and the order of sections exactly as they are unless the change needs otherwise. Keep any block between ${PB_OPEN} and <!-- /playbook --> unchanged. Reply with the complete revised prompt and nothing else: no explanation, no code fences.`;
    const { data, error } = await supabase.functions.invoke("free-llm", { body: { op: "run", task: "pick", system, user: `Requested change: ${note.trim()}\n\nCurrent prompt:\n${prompt}`, paid: "never", privacy: "private", maxTokens: 8000 } });
    setImproving(false);
    const d = data as { ok?: boolean; text?: string; provider?: string; cost_usd?: number } | null;
    if (error || !d?.ok) { setSuggErr("The free AI is busy or resting right now. Nothing was changed. Try again in a minute."); return; }
    if (d.provider === "anthropic" || Number(d.cost_usd ?? 0) > 0) { setSuggErr("That answer came from a paid model, so it was thrown away. Nothing was changed."); return; }
    const text = String(d.text ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "").trim();
    if (!text) { setSuggErr("The free AI sent back an empty answer. Nothing was changed."); return; }
    if (prompt.includes(PB_OPEN) && !text.includes(PB_OPEN)) { setSuggErr(`The suggestion dropped the Coach's playbook block, so it was thrown away. Try a smaller note.`); return; }
    if (text.length < prompt.length * 0.5) { setSuggErr("The suggestion came back much shorter than the prompt, which usually means it was cut off. It was thrown away."); return; }
    if (text.length > MAX_PROMPT) { setSuggErr("The suggestion is too long to save, so it was thrown away."); return; }
    setSugg(text);
  };

  if (err) return (
    <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
      <p>{err}</p><button type="button" onClick={() => void load()} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button>
    </div>
  );
  if (!orig) return <div className="h-40 rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />;

  return (
    <div className="space-y-4">
      {agent.line_e164 && (
        <p className="flex items-start gap-2 rounded-2xl bg-amber-500/10 p-3 text-[14px] leading-snug text-amber-100 ring-1 ring-amber-500/25">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Customer-facing: changes go live on the next call.</p>
      )}
      <div>
        <label htmlFor={`${agent.slug}-greeting`} className="mb-1 block text-[13px] font-medium text-white">Greeting</label>
        <input id={`${agent.slug}-greeting`} value={first} maxLength={500} onChange={(e) => setFirst(e.target.value)} className={cn(fieldCls, "h-11")} />
        <p className="mt-1 text-xs text-white/50">The first thing {agent.name} says when someone calls.</p>
      </div>
      <div>
        <label htmlFor={`${agent.slug}-prompt`} className="mb-1 block text-[13px] font-medium text-white">Script</label>
        <textarea id={`${agent.slug}-prompt`} value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={18} spellCheck={false}
          className={cn(fieldCls, "min-h-[320px] resize-y py-3 font-mono text-[13px] leading-snug")} />
        <p className={cn("mt-1 text-xs tabular-nums", prompt.length > MAX_PROMPT ? "text-amber-200" : "text-white/50")}>{prompt.length.toLocaleString("en-US")} of {MAX_PROMPT.toLocaleString("en-US")} characters</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={!dirty || !valid || saving} className={btnPrimary}>{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save</button>
        {dirty && <button type="button" onClick={() => { setPrompt(orig.prompt); setFirst(orig.first); }} className={btnQuiet}>Undo edits</button>}
        {!dirty && <span className="text-xs text-white/50">Nothing changed.</span>}
      </div>

      <div className="space-y-3 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
        <h4 className="flex items-center gap-2 text-[15px] font-semibold text-white"><Sparkles className="h-4 w-4 text-[#FFA270]" aria-hidden />Improve with free AI</h4>
        <p className="text-[13px] leading-snug text-white/60">Say what to change in one line. You see exactly what would change, and nothing is saved until you press Save.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor={`${agent.slug}-note`} className="sr-only">What to change</label>
          <input id={`${agent.slug}-note`} value={note} maxLength={240} onChange={(e) => setNote(e.target.value)} placeholder="Make it shorter and ask for an email address first" className={cn(fieldCls, "h-11 flex-1")} />
          <button type="button" onClick={() => void improve()} disabled={improving || note.trim().length < 5} className={btnQuiet}>
            {improving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}{improving ? "Working" : "Suggest a change"}</button>
        </div>
        {suggErr && <p role="alert" className="rounded-xl bg-amber-500/10 p-3 text-[14px] text-amber-100">{suggErr}</p>}
        {sugg && (
          <div className="space-y-3">
            <Diff before={prompt} after={sugg} />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { setPrompt(sugg); setSugg(null); setNote(""); toast("Put it in the editor. Press Save to make it live."); }} className={btnPrimary}>Use this version</button>
              <button type="button" onClick={() => setSugg(null)} className={btnQuiet}>Discard</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentPrompt({ agent }: { agent: AgentInfo }) {
  return (
    <CollapsibleSection id={`${agent.slug}-prompt`} anchorId={`${agent.slug}-prompt`} bodyClassName="p-4"
      title="Prompt" summary={`Greeting and script for ${agent.name}`} icon={<span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 text-white/80"><ScrollText className="h-4 w-4" aria-hidden /></span>}>
      <Body agent={agent} />
    </CollapsibleSection>
  );
}

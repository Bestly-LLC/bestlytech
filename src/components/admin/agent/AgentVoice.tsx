/**
 * Voice: how a template agent sounds. Shows the agent's live voice (read from the voice platform, never a stale copy), the account's library with
 * a preview that says "Hey, this is {name} with {purpose}. What can I help you with?", and "Use this voice" (agent-hub voice_use).
 * The library is only fetched when the section is opened. Cloned voices are left out on purpose.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, Loader2, Play, Search, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/admin/roofguard/CollapsibleSection";
import { announceAgentChanged, boxCls, btnQuiet, fieldCls, hub, hubBlob, ring, type AgentInfo } from "./agentApi";

type V = { voice_id: string; name: string; accent: string; age: string; gender: string; description: string; preview_url: string | null };
const PAGE = 24;
const meta = (v: V) => [v.gender, v.accent, v.age].filter(Boolean).join(" · ");

function VoiceBody({ agent }: { agent: AgentInfo }) {
  const [cur, setCur] = useState<V | null>(null);
  const [lib, setLib] = useState<V[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const r = await hub<{ current: V | null; library: V[] }>({ action: "voices", slug: agent.slug }, "Couldn't load voices right now. Try again.");
    if (!r.ok) { setErr(r.error); return; }
    setCur(r.data.current); setLib(r.data.library);
  }, [agent.slug]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { audio.current?.pause(); }, []);

  const stop = () => { audio.current?.pause(); audio.current = null; setPlaying(null); };
  const preview = async (v: V) => {
    if (playing === v.voice_id) { stop(); return; }
    stop();
    setBusy(v.voice_id);
    const blob = await hubBlob({ action: "voice_say", voice_id: v.voice_id, text: `Hey, this is ${agent.name} with ${agent.purpose}. What can I help you with?` });
    setBusy(null);
    if (!blob) { toast.error("Couldn't make that sample. Try again."); return; }
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    audio.current = a;
    a.onended = () => { setPlaying(null); URL.revokeObjectURL(url); };
    setPlaying(v.voice_id);
    void a.play().catch(() => { setPlaying(null); toast.error("Your browser blocked the sound. Tap Preview again."); });
  };

  const use = async (v: V) => {
    setBusy(v.voice_id);
    const r = await hub({ action: "voice_use", slug: agent.slug, voice_id: v.voice_id }, "Couldn't switch the voice. Try again.");
    setBusy(null);
    if (!r.ok) { toast.error(r.error); return; }
    setCur(v);
    toast.success(`${agent.name} now sounds like ${v.name}. It applies from the next call.`);
    announceAgentChanged(agent.slug);
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = (lib ?? []).filter((v) => v.voice_id !== cur?.voice_id);
    return needle ? all.filter((v) => `${v.name} ${v.accent} ${v.gender} ${v.age} ${v.description}`.toLowerCase().includes(needle)) : all;
  }, [lib, q, cur]);

  if (err) return (
    <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
      <p>{err}</p><button type="button" onClick={() => void load()} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button>
    </div>
  );
  if (!lib) return <div className="h-32 rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />;

  const row = (v: V, current?: boolean) => (
    <li key={v.voice_id} className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-white">{v.name}
            {current && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300"><Check className="h-3 w-3" aria-hidden />In use</span>}</p>
          {meta(v) && <p className="text-[13px] text-white/60">{meta(v)}</p>}
          {v.description && <p className="mt-0.5 text-[13px] leading-snug text-white/70">{v.description}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => void preview(v)} disabled={busy === v.voice_id} aria-label={`${playing === v.voice_id ? "Stop" : "Preview"} ${v.name}`} className={btnQuiet}>
            {busy === v.voice_id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : playing === v.voice_id ? <Square className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            {playing === v.voice_id ? "Stop" : "Preview"}</button>
          {!current && <button type="button" onClick={() => void use(v)} disabled={busy === v.voice_id} aria-label={`Use ${v.name}`} className={btnQuiet}>Use this voice</button>}
        </div>
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-snug text-white/60">Preview says: "Hey, this is {agent.name} with {agent.purpose}. What can I help you with?" A new voice applies from the next call.</p>
      {cur ? <ul>{row(cur, true)}</ul> : <p className={boxCls}>The current voice isn't in your library.</p>}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" aria-hidden />
        <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search voices by name, accent or feel" aria-label="Search voices" className={cn(fieldCls, "h-11 pl-9")} />
      </div>
      {list.length === 0 && <p className={boxCls}>No voices match.</p>}
      <ul className="space-y-2">{list.slice(0, shown).map((v) => row(v))}</ul>
      {list.length > shown && <button type="button" onClick={() => setShown((n) => n + PAGE)} className={cn(btnQuiet, "w-full")}>Show more voices · {list.length - shown} left</button>}
    </div>
  );
}

export function AgentVoice({ agent }: { agent: AgentInfo }) {
  return (
    <CollapsibleSection id={`${agent.slug}-voice`} anchorId={`${agent.slug}-voice`} bodyClassName="p-4"
      title="Voice" summary={`Choose how ${agent.name} sounds`} icon={<span className={cn("grid h-8 w-8 place-items-center rounded-xl bg-sky-400/15 text-sky-300", ring)}><AudioLines className="h-4 w-4" aria-hidden /></span>}>
      <VoiceBody agent={agent} />
    </CollapsibleSection>
  );
}

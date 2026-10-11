/**
 * The two pickers on the "+ New agent" page that talk to the voice platform:
 *   VoicePick  the account's voice library with a preview; the list is read through Maya's row (the library is the same for every agent).
 *   LinePick   Web only (free), a spare number that no agent uses yet (agent-hub numbers_free), or "Buy a number", which never buys anything:
 *              it only asks Scout, who asks Jared first.
 * Neither one changes anything on the voice platform. The Create button does, and only with what is picked here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Binoculars, Check, Globe, Loader2, Phone, Play, Search, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtPhone } from "@/components/admin/roofguard/AvaShared";
import { askScout } from "@/components/admin/scoutBus";
import { boxCls, btnQuiet, fieldCls, hub, hubBlob, ring } from "./agentApi";

export type PickVoice = { voice_id: string; name: string; accent: string; age: string; gender: string; description: string };
const meta = (v: PickVoice) => [v.gender, v.accent, v.age].filter(Boolean).join(" · ");
const PAGE = 8;

export function VoicePick({ agentName, purpose, value, onPick }: { agentName: string; purpose: string; value: PickVoice | null; onPick: (v: PickVoice) => void }) {
  const [cur, setCur] = useState<PickVoice | null>(null);
  const [lib, setLib] = useState<PickVoice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const r = await hub<{ current: PickVoice | null; library: PickVoice[] }>({ action: "voices", slug: "maya" }, "Couldn't load voices right now. Try again.");
    if (!r.ok) { setErr(r.error); return; }
    setCur(r.data.current); setLib(r.data.library);
    if (r.data.current) onPick(r.data.current);       // default: Maya's voice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { audio.current?.pause(); }, []);

  const preview = async (v: PickVoice) => {
    if (playing === v.voice_id) { audio.current?.pause(); setPlaying(null); return; }
    audio.current?.pause(); setPlaying(null);
    setBusy(v.voice_id);
    const blob = await hubBlob({ action: "voice_say", voice_id: v.voice_id, text: `Hey, this is ${agentName || "your agent"} with ${purpose || "Bestly"}. What can I help you with?` });
    setBusy(null);
    if (!blob) { toast.error("Couldn't make that sample. Try again."); return; }
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    audio.current = a;
    a.onended = () => { setPlaying(null); URL.revokeObjectURL(url); };
    setPlaying(v.voice_id);
    void a.play().catch(() => { setPlaying(null); toast.error("Your browser blocked the sound. Tap Preview again."); });
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
  if (!lib) return <div className="h-24 rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />;

  const row = (v: PickVoice, isDefault?: boolean) => {
    const chosen = value?.voice_id === v.voice_id;
    return (
      <li key={v.voice_id} className={cn("rounded-2xl p-4 ring-1", chosen ? "bg-emerald-500/[0.07] ring-emerald-400/35" : "bg-white/[0.04] ring-white/10")}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-white">{v.name}
              {isDefault && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/70">Maya's voice</span>}
              {chosen && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300"><Check className="h-3 w-3" aria-hidden />Picked</span>}</p>
            {meta(v) && <p className="text-[13px] text-white/60">{meta(v)}</p>}
            {v.description && <p className="mt-0.5 text-[13px] leading-snug text-white/70">{v.description}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => void preview(v)} disabled={busy === v.voice_id} aria-label={`${playing === v.voice_id ? "Stop" : "Preview"} ${v.name}`} className={btnQuiet}>
              {busy === v.voice_id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : playing === v.voice_id ? <Square className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {playing === v.voice_id ? "Stop" : "Preview"}</button>
            {!chosen && <button type="button" onClick={() => onPick(v)} aria-label={`Use ${v.name}`} className={btnQuiet}>Use</button>}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      {cur ? <ul>{row(cur, true)}</ul> : <p className={boxCls}>Maya's voice isn't in your library. Pick one below.</p>}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" aria-hidden />
        <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search voices by name, accent or feel" aria-label="Search voices" className={cn(fieldCls, "h-11 pl-9")} />
      </div>
      {q.trim() && list.length === 0 && <p className={boxCls}>No voices match.</p>}
      {q.trim() || shown > PAGE ? <ul className="space-y-2">{list.slice(0, shown).map((v) => row(v))}</ul> : null}
      {!q.trim() && shown === PAGE && list.length > 0 && <button type="button" onClick={() => setShown(PAGE + 1)} className={cn(btnQuiet, "w-full")}>Browse {list.length} more voices</button>}
      {list.length > shown && (q.trim() || shown > PAGE) && <button type="button" onClick={() => setShown((n) => n + PAGE)} className={cn(btnQuiet, "w-full")}>Show more voices · {list.length - shown} left</button>}
    </div>
  );
}

export type Num = { phone_number_id: string; phone_number: string; label: string; provider: string };
export type LineChoice = { kind: "web" } | { kind: "spare"; num: Num | null } | { kind: "buy" };

export function LinePick({ slug, name, value, onChange }: { slug: string; name: string; value: LineChoice; onChange: (v: LineChoice) => void }) {
  const [nums, setNums] = useState<Num[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loadNums = useCallback(async () => {
    setErr(null);
    const r = await hub<{ numbers: Num[] }>({ action: "numbers_free" }, "Couldn't read your phone numbers. Try again.");
    if (!r.ok) { setErr(r.error); return; }
    setNums(r.data.numbers);
  }, []);
  useEffect(() => { if (value.kind === "spare" && nums === null && !err) void loadNums(); }, [value.kind, nums, err, loadNums]);

  const card = (active: boolean) => cn("w-full rounded-2xl p-4 text-left ring-1 transition", active ? "bg-emerald-500/[0.07] ring-emerald-400/40" : "bg-white/[0.04] ring-white/10 hover:bg-white/[0.07]", ring);
  return (
    <div role="radiogroup" aria-label="Phone line" className="space-y-2">
      <button type="button" role="radio" aria-checked={value.kind === "web"} onClick={() => onChange({ kind: "web" })} className={card(value.kind === "web")}>
        <span className="flex items-center gap-2 text-[15px] font-semibold text-white"><Globe className="h-4 w-4 text-white/70" aria-hidden />Web only
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Free</span></span>
        <span className="mt-1 block text-[13px] leading-snug text-white/60">No phone number. You can add a number later.</span>
      </button>

      <button type="button" role="radio" aria-checked={value.kind === "spare"} onClick={() => onChange(value.kind === "spare" ? value : { kind: "spare", num: null })} className={card(value.kind === "spare")}>
        <span className="flex items-center gap-2 text-[15px] font-semibold text-white"><Phone className="h-4 w-4 text-white/70" aria-hidden />Use a spare number</span>
        <span className="mt-1 block text-[13px] leading-snug text-white/60">A number you already own that no agent is using.</span>
      </button>
      {value.kind === "spare" && (
        <div className="ml-2 space-y-2 border-l border-white/10 pl-3">
          {err && <div role="alert" className="rounded-2xl bg-amber-500/10 p-3 text-[14px] text-amber-100 ring-1 ring-amber-500/30"><p>{err}</p>
            <button type="button" onClick={() => void loadNums()} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button></div>}
          {!err && nums === null && <div className="h-14 rounded-2xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden />}
          {nums && nums.length === 0 && <p className={boxCls}>Every number you own is already in use. Pick Web only, or ask Scout about a new number below.</p>}
          {nums && nums.map((n) => {
            const on = value.kind === "spare" && value.num?.phone_number_id === n.phone_number_id;
            return (
              <button key={n.phone_number_id} type="button" role="radio" aria-checked={on} onClick={() => onChange({ kind: "spare", num: n })}
                className={cn("flex w-full min-h-[44px] items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left ring-1", on ? "bg-emerald-500/[0.07] ring-emerald-400/40" : "bg-white/[0.04] ring-white/10 hover:bg-white/[0.07]", ring)}>
                <span><span className="block whitespace-nowrap text-[15px] font-semibold tabular-nums text-white">{fmtPhone(n.phone_number)}</span>
                  {n.label && <span className="block text-[13px] text-white/60">{n.label}</span>}</span>
                {on && <Check className="h-4 w-4 text-emerald-300" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}

      <button type="button" role="radio" aria-checked={value.kind === "buy"} onClick={() => onChange({ kind: "buy" })} className={card(value.kind === "buy")}>
        <span className="flex items-center gap-2 text-[15px] font-semibold text-white"><Binoculars className="h-4 w-4 text-white/70" aria-hidden />Buy a number</span>
        <span className="mt-1 block text-[13px] leading-snug text-white/60">Not automated. Buying a number costs money.</span>
      </button>
      {value.kind === "buy" && (
        <div className="ml-2 space-y-2 border-l border-white/10 pl-3">
          <p className="text-[14px] leading-snug text-white/70">Nothing is bought here. Create {name || "the agent"} as Web only now, then ask Scout. Scout checks with you before spending anything.</p>
          <button type="button" onClick={() => askScout(`Buy a phone number for agent ${slug || "(new agent)"} (${name || "new agent"}). Ask me before you spend anything, then connect the number to the agent in ElevenLabs and record it on its row in voice_agents (phone_number_id and line_e164).`, { about: `agent:${slug}` })}
            className={btnQuiet}><Binoculars className="h-4 w-4" aria-hidden />Ask Scout</button>
        </div>
      )}
    </div>
  );
}

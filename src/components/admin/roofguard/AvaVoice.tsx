/**
 * Ava's voice, for both Avas (one component, `source` picks which). See docs/ava-voice-clone-opusplan.md.
 *
 *   VoicePicker source="ava"        /admin/ava      pick her voice, hear a line of your own in it, ring your cell with it,
 *                                                   plus the "Your voice" card: record or upload yourself, clone, preview, delete
 *   VoicePicker source="roofguard"  Setup tab       the same picker (no cloning: RoofGuard never speaks as Jared)
 *
 * Edge actions (ava-assistant / roofguard-caller, admin only): voices, voice_say, voice_test_call, voice_use, and for personal
 * Ava voice_clone, voice_preview, voice_delete, voice_resume. The ElevenLabs key never reaches the browser.
 * "In your library" = voices already in the account. "Discover" = ElevenLabs' shared library; Use adds the voice first.
 * A cloned voice never becomes her default voice (it has no disclosure opener): it is only used by the dialer's switch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, Loader2, Mic, Pause, PhoneCall, Play, RotateCcw, Square, Trash2, Upload, Volume2 } from "lucide-react";
import { AvaOrb, AVA_GLOW } from "./AvaOrb";
import { InCallSheet, type ActiveCall } from "./AvaDialer";
import type { Source } from "./AvaShared";

// ---------- types and config ----------
type Voice = { voice_id: string; public_owner_id?: string; name: string; accent: string; age: string; description: string;
  preview_url: string | null; in_library?: boolean; missing?: boolean };
type CloneInfo = { can_clone: boolean | null; voice_id: string | null; paused_at: string | null; paused_why: string | null };
type VoicesRes = { ok: boolean; error?: string; current: Voice; library: Voice[] | null; discover: Voice[] | null; has_more: boolean;
  says_left: number; say_cap: number; clone: CloneInfo | null };

const CFG = {
  ava: { fn: "ava-assistant" as const, use: "Use for Ava", name: "Ava", line: "Hey, it's Ava, Jared's assistant. He's tied up right now, can I take a message?" },
  roofguard: { fn: "roofguard-caller" as const, use: "Use for RoofGuard", name: "RoofGuard Ava",
    line: "Hey, it's Ava from RoofGuard. I'm looking for whoever's in charge of keeping your roof maintained." },
};
const ACCENTS = [["any", "Any accent"], ["american", "American"], ["british", "British"], ["australian", "Australian"]] as const;
const GENDERS = [["female", "Female"], ["male", "Male"], ["any", "Any"]] as const;
const CELL = "(816)\u00A0500-7236";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
const btn = cn("inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-medium transition motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45", ring);
const btnQuiet = cn(btn, "bg-white/[0.07] text-white ring-1 ring-white/10 hover:bg-white/[0.11]");
const btnPrimary = cn(btn, "font-semibold text-[#1c1c1e] hover:brightness-110");   // apricot fill, dark text (set by style)
const primaryStyle = { background: AVA_GLOW } as const;
const inputCls = "w-full rounded-xl bg-white/[0.05] px-3 py-2 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/50 focus:ring-white/25";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, "-") : "");
const ageText = (a: string) => (a === "middle_aged" ? "Middle-aged" : cap(a));
const traits = (v: Voice) => [cap(v.accent), ageText(v.age)].filter(Boolean).join(" · ");
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s)) % 60).padStart(2, "0")}`;

// ---------- calling the edge functions ----------
type Fn = "ava-assistant" | "roofguard-caller";
async function invoke<T extends { ok?: boolean; error?: string }>(fn: Fn, body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = (data as { error?: string } | null)?.error;
    if (!msg && "context" in error) msg = await (error as { context: Response }).context.json().then((j) => j.error as string).catch(() => undefined);
    return { data: null, error: msg ?? "That didn't work. Try again in a moment." };
  }
  const d = data as T | null;
  if (!d || d.ok === false) return { data: null, error: d?.error ?? "That didn't work. Try again in a moment." };
  return { data: d, error: null };
}

/** Audio comes back as an mp3 body, which supabase.functions.invoke would read as text, so this one uses fetch. */
async function fetchAudio(fn: Fn, body: Record<string, unknown>): Promise<{ url: string | null; left: number | null; error: string | null }> {
  const { data: { session } } = await supabase.auth.getSession();
  const base = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
  const res = await fetch(`${base}/functions/v1/${fn}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token ?? ""}`, apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "") as string },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { url: null, left: null, error: "No connection. Try again." };
  if (!res.ok) {
    const j = await res.json().catch(() => null) as { error?: string } | null;
    return { url: null, left: null, error: j?.error ?? "Couldn't make that sample. Try again." };
  }
  const left = Number(res.headers.get("x-says-left"));
  return { url: URL.createObjectURL(await res.blob()), left: res.headers.has("x-says-left") && Number.isFinite(left) ? left : null, error: null };
}

/** One sound at a time across the whole picker. `key` says which button is playing so it can show Pause. */
function useOnePlayer() {
  const el = useRef<HTMLAudioElement | null>(null);
  const blobUrl = useRef<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = useCallback(() => {
    el.current?.pause(); el.current = null;
    if (blobUrl.current) { URL.revokeObjectURL(blobUrl.current); blobUrl.current = null; }
    setPlaying(null);
  }, []);
  const play = useCallback((key: string, src: string, isBlob = false) => {
    stop();
    const a = new Audio(src);
    el.current = a; if (isBlob) blobUrl.current = src;
    a.onended = () => { if (el.current === a) stop(); };
    a.onerror = () => { if (el.current === a) { stop(); toast.error("That sample won't play."); } };
    setPlaying(key);
    void a.play().catch(() => { if (el.current === a) { stop(); toast.error("Your browser blocked the sound. Tap Play again."); } });
  }, [stop]);
  useEffect(() => stop, [stop]);
  return { playing, play, stop };
}

// ---------- the picker ----------
export function VoicePicker({ source, defaultOpen, openSignal }: { source: Source; defaultOpen?: boolean; openSignal?: number }) {
  const cfg = CFG[source];
  const [open, setOpen] = useState(defaultOpen ?? source === "roofguard");
  useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);   // the quick switcher's "More voices" link
  const [tab, setTab] = useState<"library" | "discover">("library");
  const [accent, setAccent] = useState<(typeof ACCENTS)[number][0]>("any");
  const [gender, setGender] = useState<(typeof GENDERS)[number][0]>("female");
  const [current, setCurrent] = useState<Voice | null>(null);
  const [library, setLibrary] = useState<Voice[]>([]);
  const [discover, setDiscover] = useState<Voice[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState(cfg.line);
  const [saysLeft, setSaysLeft] = useState<number | null>(null);
  const [sayErr, setSayErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "use" | "call"; id: string } | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);
  const [clone, setClone] = useState<CloneInfo | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const player = useOnePlayer();
  const req = useRef(0);

  const fetchList = useCallback(async (which: "library" | "discover", pageNo: number, append: boolean) => {
    const id = ++req.current;
    if (append) setMore(true); else { setLoading(true); setErr(null); }
    const { data, error } = await invoke<VoicesRes>(cfg.fn, { action: "voices", scope: which, gender, accent, age: "any", page: pageNo });
    if (id !== req.current) return;
    setLoading(false); setMore(false);
    if (error || !data) { setErr(error ?? "Couldn't load voices."); return; }
    setCurrent(data.current); setSaysLeft(data.says_left);
    if (which === "library") setLibrary(data.library ?? []);
    else {
      setDiscover((prev) => {
        const next = data.discover ?? [];
        if (!append) return next;
        const seen = new Set(prev.map((v) => v.voice_id));
        return [...prev, ...next.filter((v) => !seen.has(v.voice_id))];
      });
      setHasMore(data.has_more); setPage(pageNo);
    }
  }, [cfg.fn, gender, accent]);
  useEffect(() => { if (open) void fetchList(tab, 0, false); }, [open, tab, fetchList]);

  const loadClone = useCallback(async () => {
    if (source !== "ava") return;
    const { data } = await invoke<VoicesRes>("ava-assistant", { action: "voices", scope: "clone" });
    if (data?.clone) setClone(data.clone);
  }, [source]);
  useEffect(() => { if (open) void loadClone(); }, [open, loadClone]);

  // ---- row actions ----
  const sample = (v: Voice) => {
    if (player.playing === `s:${v.voice_id}`) { player.stop(); return; }
    if (v.preview_url) player.play(`s:${v.voice_id}`, v.preview_url);
  };
  const sayLine = async (v: Voice) => {
    if (player.playing === `l:${v.voice_id}`) { player.stop(); return; }
    setSayErr(null); setBusy(`say:${v.voice_id}`);
    const r = await fetchAudio(cfg.fn, { action: "voice_say", voice_id: v.voice_id, text });
    setBusy(null);
    if (r.error || !r.url) { setSayErr(r.error); if (r.error && /all \d+ samples/.test(r.error)) setSaysLeft(0); return; }
    if (r.left != null) setSaysLeft(r.left);
    player.play(`l:${v.voice_id}`, r.url, true);
  };
  const callMe = async (v: Voice) => {
    setRowErr(null); setBusy(`call:${v.voice_id}`);
    const { data, error } = await invoke<{ ok: boolean; call_id?: string | null }>(cfg.fn, { action: "voice_test_call", voice_id: v.voice_id });
    setBusy(null);
    if (error || !data) { setRowErr({ id: v.voice_id, text: error ?? "The call didn't go out." }); return; }
    setConfirm(null);
    toast.success("Calling your cell…");
    if (data.call_id) setActive({ id: data.call_id, fn: cfg.fn, who: "Your cell", kind: `${v.name} test` });
  };
  const switchTo = async (v: Voice, fromLibrary: boolean) => {
    setRowErr(null); setBusy(`use:${v.voice_id}`);
    const { data, error } = await invoke<{ ok: boolean; voice_id: string; setup_ok: boolean }>(cfg.fn, {
      action: "voice_use", voice_id: v.voice_id, public_owner_id: v.public_owner_id, in_library: fromLibrary || v.in_library === true, name: v.name });
    setBusy(null);
    if (error || !data) { setRowErr({ id: v.voice_id, text: error ?? "Couldn't switch her voice." }); return; }
    setConfirm(null);
    toast.success(`${cfg.name} now sounds like ${v.name}.`);
    if (!data.setup_ok) toast.message("Saved. The line check will finish the setup in a few minutes.");
    void fetchList(tab, 0, false);
  };

  const filtersChanged = tab === "discover" ? "Discover" : "your library";
  return (
    <section id={`voice-studio-${source}`} aria-label={`${cfg.name}'s voice`} className="rounded-3xl bg-white/[0.03] ring-1 ring-white/10">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={cn("flex min-h-[56px] w-full items-center gap-3 rounded-3xl px-4 py-3 text-left", ring)}>
        <AvaOrb size={32} />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-white">Ava's voice</span>
          <span className="block text-xs text-white/60">{source === "ava" ? "Pick how she sounds, hear your own line, or record your voice." : "Pick how RoofGuard Ava sounds on calls."}</span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-white/55 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="space-y-4 border-t border-white/5 px-4 pb-4 pt-4">
          {/* the voice she has now */}
          {current && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-white/55">Her voice now</div>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[17px] font-semibold text-white">{current.name}</span>
                  <span className="text-xs text-white/60">{traits(current)}</span>
                </div>
                {current.missing && (
                  <p role="alert" className="mt-1 inline-flex items-start gap-1.5 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    That voice is gone from your account. The line check switches her back to Lily within ten minutes, or pick one below.</p>
                )}
              </div>
              {current.preview_url && (
                <button type="button" onClick={() => sample(current)} className={btnQuiet} aria-label={`${player.playing === `s:${current.voice_id}` ? "Pause" : "Play"} sample of ${current.name}`}>
                  {player.playing === `s:${current.voice_id}` ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}Sample</button>
              )}
            </div>
          )}

          {/* hear her say... */}
          <div>
            <label htmlFor={`say-${source}`} className="mb-1 flex items-baseline justify-between gap-2 text-[13px] font-medium text-white">
              <span>Hear her say…</span>
              <span className="text-xs font-normal tabular-nums text-white/60">{saysLeft == null ? "" : `${saysLeft}\u00A0of\u00A040 plays left today`}</span>
            </label>
            <textarea id={`say-${source}`} value={text} onChange={(e) => { setText(e.target.value.slice(0, 200)); setSayErr(null); }} rows={2} maxLength={200} className={inputCls} />
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
              <span className="tabular-nums">{text.length}/200</span>
              {text !== cfg.line && <button type="button" onClick={() => setText(cfg.line)} className={cn("inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-sky-300 hover:bg-white/5", ring)}><RotateCcw className="h-3.5 w-3.5" aria-hidden />Reset line</button>}
            </div>
            {sayErr && <p role="alert" className="text-sm text-amber-200">{sayErr}</p>}
          </div>

          {/* filters */}
          <div className="space-y-2">
            <div role="tablist" aria-label="Where to look" className="grid grid-cols-2 rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10">
              {([["library", "In your library"], ["discover", "Discover"]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setConfirm(null); }}
                  className={cn("min-h-[44px] rounded-lg text-sm font-medium transition-colors", ring, tab === id ? "bg-white text-black shadow-sm" : "text-white/70 hover:text-white")}>{label}</button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Accent" className="flex flex-wrap gap-2">
              {ACCENTS.map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={accent === id} onClick={() => setAccent(id)}
                  className={cn("min-h-[44px] rounded-full px-3.5 text-sm transition-colors", ring, accent === id ? "font-semibold text-[#1c1c1e]" : "bg-white/[0.07] text-white/80 ring-1 ring-white/10 hover:bg-white/[0.11]")}
                  style={accent === id ? primaryStyle : undefined}>{label}</button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Gender" className="flex flex-wrap gap-2">
              {GENDERS.map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={gender === id} onClick={() => setGender(id)}
                  className={cn("min-h-[44px] rounded-full px-3.5 text-sm transition-colors", ring, gender === id ? "bg-white font-semibold text-black" : "bg-white/[0.07] text-white/80 ring-1 ring-white/10 hover:bg-white/[0.11]")}>{label}</button>
              ))}
            </div>
            {tab === "discover" && <p className="text-xs text-white/60">Discover voices play their own sample. Use one to add it to your library, then you can hear your line in it and ring your cell with it.</p>}
          </div>

          {/* the list */}
          <div role="tabpanel" aria-label={tab === "library" ? "In your library" : "Discover"}>
            {loading && <p role="status" className="flex min-h-[44px] items-center gap-2 text-sm text-white/65"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading voices…</p>}
            {err && !loading && (
              <div role="alert" className="rounded-2xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30">
                {err} <button type="button" onClick={() => void fetchList(tab, 0, false)} className={cn("ml-1 inline-flex min-h-[44px] items-center rounded-lg px-2 font-medium underline", ring)}>Try again</button>
              </div>
            )}
            {!loading && !err && (tab === "library" ? library : discover).length === 0 && (
              <p className="py-6 text-center text-sm text-white/60">No voices match {accent === "any" ? "those filters" : `${cap(accent)} ${gender === "any" ? "" : gender}`} in {filtersChanged}. Try another accent.</p>
            )}
            {!loading && !err && (
              <ul className="divide-y divide-white/5 rounded-2xl bg-white/[0.02] ring-1 ring-white/10">
                {(tab === "library" ? library : discover).map((v) => (
                  <VoiceRow key={v.voice_id} v={v} isCurrent={current?.voice_id === v.voice_id} inLibrary={tab === "library" || v.in_library === true}
                    playing={player.playing} busy={busy} saysLeft={saysLeft} hasText={text.trim().length > 0} useLabel={cfg.use} who={cfg.name}
                    confirm={confirm?.id === v.voice_id ? confirm.kind : null} rowErr={rowErr?.id === v.voice_id ? rowErr.text : null}
                    onSample={() => sample(v)} onLine={() => void sayLine(v)}
                    onAsk={(k) => { setRowErr(null); setConfirm(k ? { kind: k, id: v.voice_id } : null); }}
                    onCall={() => void callMe(v)} onUse={() => void switchTo(v, tab === "library")} />
                ))}
              </ul>
            )}
            {tab === "discover" && hasMore && !loading && !err && (
              <button type="button" onClick={() => void fetchList("discover", page + 1, true)} disabled={more} className={cn(btnQuiet, "mt-3 w-full")}>
                {more && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Show more voices</button>
            )}
          </div>

          {source === "ava" && <YourVoiceCard info={clone} onChanged={() => void loadClone()} player={player} />}
        </div>
      )}
      <InCallSheet call={active} onClose={() => setActive(null)} />
    </section>
  );
}

function VoiceRow({ v, isCurrent, inLibrary, playing, busy, saysLeft, hasText, useLabel, who, confirm, rowErr, onSample, onLine, onAsk, onCall, onUse }: {
  v: Voice; isCurrent: boolean; inLibrary: boolean; playing: string | null; busy: string | null; saysLeft: number | null; hasText: boolean; useLabel: string; who: string;
  confirm: "use" | "call" | null; rowErr: string | null; onSample: () => void; onLine: () => void; onAsk: (k: "use" | "call" | null) => void; onCall: () => void; onUse: () => void;
}) {
  const sampling = playing === `s:${v.voice_id}`, lining = playing === `l:${v.voice_id}`;
  const saying = busy === `say:${v.voice_id}`, calling = busy === `call:${v.voice_id}`, using = busy === `use:${v.voice_id}`;
  return (
    <li className="px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[15px] font-semibold text-white">{v.name}</span>
        {isCurrent && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "rgba(255,162,112,0.16)", color: AVA_GLOW }}>
            <Check className="h-3 w-3" aria-hidden />Current</span>
        )}
        <span className="text-xs text-white/60">{traits(v)}</span>
      </div>
      {v.description && <p className="mt-0.5 truncate text-sm text-white/65" title={v.description}>{v.description}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSample} disabled={!v.preview_url} className={btnQuiet} aria-label={`${sampling ? "Pause" : "Play"} sample of ${v.name}`}>
          {sampling ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}Sample</button>
        {inLibrary && (
          <button type="button" onClick={onLine} disabled={saying || !hasText || saysLeft === 0} className={btnQuiet} aria-label={`${lining ? "Pause" : "Hear"} ${v.name} say your line`}
            title={saysLeft === 0 ? "That's all today's plays. They reset at midnight Pacific." : undefined}>
            {saying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : lining ? <Pause className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}Her line</button>
        )}
        {inLibrary && (
          <button type="button" onClick={() => onAsk(confirm === "call" ? null : "call")} className={btnQuiet} aria-expanded={confirm === "call"} aria-label={`Call me with ${v.name}'s voice`}>
            <PhoneCall className="h-4 w-4" aria-hidden />Call me</button>
        )}
        {!isCurrent && (
          <button type="button" onClick={() => onAsk(confirm === "use" ? null : "use")} className={cn(btnPrimary, "ml-auto")} style={primaryStyle} aria-expanded={confirm === "use"} aria-label={`${useLabel} with the voice ${v.name}`}>
            {useLabel}</button>
        )}
      </div>

      {confirm === "call" && (
        <div role="alertdialog" aria-label={`Ring your cell in ${v.name}'s voice?`} className="mt-2 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
          <p className="text-[15px] font-semibold text-white">Ring your cell in this voice?</p>
          <p className="mt-0.5 text-sm text-white/65">{who} calls {CELL} once as {v.name}, says she's testing a voice, and hangs up in about a minute. It counts toward today's spend cap.</p>
          {rowErr && <p role="alert" className="mt-2 text-sm text-red-300">{rowErr}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onAsk(null)} disabled={calling} className={btnQuiet}>Not now</button>
            <button type="button" onClick={onCall} disabled={calling} autoFocus className={btnPrimary} style={primaryStyle}>
              {calling && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Call me</button>
          </div>
        </div>
      )}
      {confirm === "use" && (
        <div role="alertdialog" aria-label={`${useLabel}: switch to ${v.name}?`} className="mt-2 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
          <p className="text-[15px] font-semibold text-white">Switch {who} to {v.name}?</p>
          <p className="mt-0.5 text-sm text-white/65">Every call from now on uses this voice. {inLibrary ? "" : `${v.name} is added to your voice library first. `}Her setup re-runs, which takes about half a minute.</p>
          {rowErr && <p role="alert" className="mt-2 text-sm text-red-300">{rowErr}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onAsk(null)} disabled={using} className={btnQuiet}>Cancel</button>
            <button type="button" onClick={onUse} disabled={using} autoFocus className={btnPrimary} style={primaryStyle}>
              {using && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Use {v.name}</button>
          </div>
        </div>
      )}
      {confirm === null && rowErr && <p role="alert" className="mt-2 text-sm text-red-300">{rowErr}</p>}
    </li>
  );
}

// ---------- "Your voice": record or upload, clone, preview, delete (personal Ava only) ----------
const SCRIPT = [
  "Read this in your normal talking voice, like you're explaining something to a friend. Don't rush, and take a breath between paragraphs.",
  "Hey, it's good to talk. I've been looking forward to getting this set up, so let me walk you through how my week usually goes.",
  "Mornings are the quiet part of the day. I make coffee, check what came in overnight, and decide what actually needs my attention. Most things don't. A few do, and those get done before lunch.",
  "By the afternoon the calls start. Some are quick, a yes or a no, and some turn into a longer conversation about timing, budgets, and who's doing what. I try to keep those simple. If I don't know the answer, I say so, and I get back to people the same day.",
  "I like plain language. If something costs two hundred and fifty dollars, I say two hundred and fifty dollars. If it's due on the twelfth, I say the twelfth. No jargon, no fluff, just what you need to know and when you need to know it.",
  "Here are a few numbers for variety: nine, fourteen, thirty-one, one hundred and six, and the year twenty twenty-six. And a few names: Kansas City, Portland, Thursday, September, Mississippi, and Wednesday.",
  "Sometimes I get asked whether I ever slow down. Honestly, not much. But I do try to be home for dinner, and I try to leave the phone on the counter. That's the rule. The phone stays in the other room, and the work will still be there tomorrow.",
  "If you're ever not sure what I meant, just ask. I'd rather explain something twice than have you guess. Questions are good. Questions mean you're paying attention.",
  "Let's try a few quick ones. Are you free on Friday? What time works best for you? Can you send that over by noon? Did you get my message? Great, thank you. That sounds good to me.",
  "Now a longer thought, slowly. When I started this business, I didn't have much of a plan. I had a laptop, a phone, and a habit of saying yes to anything that sounded interesting. Some of it worked, and a lot of it didn't, but every time I learned something I could use the next day. That's still how I work. Try it, see what happens, fix what broke, and keep going.",
  "Thanks for listening. That's about it. Talk soon.",
];
const MAX_REC_SECS = 300;
const MIN_REC_SECS = 30;
const MAX_UPLOAD = 25 * 1024 * 1024;

type Take = { blob: Blob; ext: string; url: string; secs: number | null; label: string };

function encodeWav(pcm: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.length * 2, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++, o += 2) { const x = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}

/** Whatever the browser recorded (webm, mp4) to a plain mono 24 kHz WAV, which the voice platform always accepts. */
async function toWav(blob: Blob): Promise<Blob> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const rate = 24000, off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
    return encodeWav((await off.startRendering()).getChannelData(0), rate);
  } finally { void ctx.close(); }
}

function YourVoiceCard({ info, onChanged, player }: { info: CloneInfo | null; onChanged: () => void; player: ReturnType<typeof useOnePlayer> }) {
  const [phase, setPhase] = useState<"idle" | "recording" | "processing">("idle");
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [take, setTakeState] = useState<Take | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"clone" | "preview" | "delete" | "resume" | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number; timer: ReturnType<typeof setInterval>; started: number; chunks: Blob[]; peak: number } | null>(null);
  const takeRef = useRef<Take | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const setTake = useCallback((t: Take | null) => {
    if (takeRef.current) URL.revokeObjectURL(takeRef.current.url);
    takeRef.current = t; setTakeState(t);
  }, []);
  const teardown = useCallback(() => {
    const r = rec.current; if (!r) return;
    cancelAnimationFrame(r.raf); clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop()); void r.ctx.close();
    rec.current = null;
  }, []);
  useEffect(() => () => { teardown(); if (takeRef.current) URL.revokeObjectURL(takeRef.current.url); }, [teardown]);

  const start = async () => {
    setErr(null); setTake(null); player.stop();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setErr("This browser can't record. Upload a Voice Memo instead."); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true } }); }
    catch { setErr("The microphone is blocked. Allow it for this site in your browser, or upload a Voice Memo instead."); return; }
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx(), an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const r = { mr, stream, ctx, raf: 0, timer: 0 as unknown as ReturnType<typeof setInterval>, started: performance.now(), chunks: [] as Blob[], peak: 0 };
    rec.current = r;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const b of buf) { const x = (b - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / buf.length); r.peak = Math.max(r.peak, rms);
      setLevel(Math.min(1, rms * 4));
      r.raf = requestAnimationFrame(tick);
    };
    r.raf = requestAnimationFrame(tick);
    r.timer = setInterval(() => {
      const s = (performance.now() - r.started) / 1000;
      setSecs(s); setHeard(r.peak > 0.02);
      if (s >= MAX_REC_SECS) stop();
    }, 250);
    mr.ondataavailable = (e) => { if (e.data.size) r.chunks.push(e.data); };
    mr.onstop = () => { void finish(r, mime ?? mr.mimeType); };
    setSecs(0); setLevel(0); setHeard(false); setPhase("recording");
    mr.start(1000);
  };
  const stop = () => { const r = rec.current; if (r && r.mr.state !== "inactive") r.mr.stop(); };
  const finish = async (r: NonNullable<typeof rec.current>, mime: string) => {
    const length = (performance.now() - r.started) / 1000;
    teardown(); setLevel(0); setPhase("processing");
    const raw = new Blob(r.chunks, { type: mime || "audio/webm" });
    try {
      const wav = await toWav(raw);
      setTake({ blob: wav, ext: "wav", url: URL.createObjectURL(wav), secs: length, label: "Your recording" });
    } catch {
      // the browser couldn't convert it: send what it recorded (the clone accepts webm, mp4 and ogg too)
      const ext = /mp4/.test(raw.type) ? "mp4" : /ogg/.test(raw.type) ? "ogg" : "webm";
      setTake({ blob: raw, ext, url: URL.createObjectURL(raw), secs: length, label: "Your recording" });
    }
    setPhase("idle");
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["m4a", "mp3", "wav"].includes(ext)) { setErr("Use an m4a, mp3 or wav file. iPhone Voice Memos are m4a."); return; }
    if (f.size > MAX_UPLOAD) { setErr("That file is over 25\u00A0MB. Trim it to a few minutes."); return; }
    setTake({ blob: f, ext, url: URL.createObjectURL(f), secs: null, label: f.name });
  };

  const makeVoice = async () => {
    if (!take) return;
    setBusy("clone"); setErr(null);
    const path = `clone/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${take.ext}`;
    const up = await supabase.storage.from("ava-voice").upload(path, take.blob, { contentType: take.blob.type || "audio/wav", upsert: false });
    if (up.error) { setBusy(null); setErr("Couldn't upload the recording. Try again."); return; }
    const { data, error } = await invoke<{ ok: boolean }>("ava-assistant", { action: "voice_clone", path });
    setBusy(null);
    if (error || !data) {
      void supabase.storage.from("ava-voice").remove([path]);   // nothing is kept when it didn't work
      setErr(error ?? "Couldn't make a clone from that recording."); return;
    }
    setTake(null);
    toast.success("Your voice is ready. Turn on Use my voice in the dialer to try it.");
    onChanged();
  };
  const preview = async () => {
    if (player.playing === "c") { player.stop(); return; }
    setBusy("preview"); setErr(null);
    const r = await fetchAudio("ava-assistant", { action: "voice_preview" });
    setBusy(null);
    if (r.error || !r.url) { setErr(r.error); return; }
    player.play("c", r.url, true);
  };
  const remove = async () => {
    setBusy("delete"); setErr(null);
    const { error } = await invoke("ava-assistant", { action: "voice_delete" });
    setBusy(null);
    if (error) { setErr(error); return; }
    setAskDelete(false); setTake(null); player.stop();
    toast.success("Your voice is deleted.");
    onChanged();
  };
  const resume = async () => {
    setBusy("resume"); setErr(null);
    const { error } = await invoke("ava-assistant", { action: "voice_resume" });
    setBusy(null);
    if (error) { setErr(error); return; }
    toast.success("Voice mode is back on.");
    onChanged();
  };

  const noPlan = info?.can_clone === false;
  const has = !!info?.voice_id;
  const recording = phase === "recording";
  const bars = 16, lit = Math.round(level * bars);
  const tooShort = take?.secs != null && take.secs < MIN_REC_SECS;

  return (
    <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
      <div className="flex items-center gap-2">
        <Mic className="h-4 w-4" style={{ color: AVA_GLOW }} aria-hidden />
        <h4 className="text-[15px] font-semibold text-white">Your voice</h4>
        {has && !info?.paused_at && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/80"><Check className="h-3 w-3" aria-hidden />Ready</span>}
      </div>
      <p className="mt-1 text-sm text-white/65">Record about 3 minutes once. Then the dialer's Use my voice switch has Ava call in your voice. She always opens by saying she's your AI assistant, and never says she is you.</p>

      {noPlan && (
        <p role="status" className="mt-3 inline-flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/25">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Your voice plan doesn't include cloning yet.</p>
      )}
      {info?.paused_at && (
        <div role="alert" className="mt-3 rounded-xl bg-amber-500/10 p-3 ring-1 ring-amber-500/30">
          <p className="inline-flex items-start gap-2 text-sm text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Voice mode is off. {info.paused_why ?? "A call in your voice broke the rules."} Review it under Reply guard, then turn it back on.</p>
          <button type="button" onClick={() => void resume()} disabled={busy === "resume"} className={cn(btnQuiet, "mt-2")}>
            {busy === "resume" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Turn voice mode back on</button>
        </div>
      )}

      {has && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void preview()} disabled={busy === "preview"} className={btnQuiet} aria-label={player.playing === "c" ? "Pause preview of your voice" : "Preview your voice"}>
            {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : player.playing === "c" ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}Preview</button>
          {!askDelete && <button type="button" onClick={() => setAskDelete(true)} className={cn(btn, "text-[#FF453A] ring-1 ring-white/10 hover:bg-[#FF453A]/10")}><Trash2 className="h-4 w-4" aria-hidden />Delete my voice</button>}
        </div>
      )}
      {askDelete && (
        <div role="alertdialog" aria-label="Delete your voice?" className="mt-3 rounded-2xl bg-[#FF453A]/[0.08] p-3 ring-1 ring-[#FF453A]/30">
          <p className="text-[15px] font-semibold text-white">Delete your voice?</p>
          <p className="mt-0.5 text-sm text-white/65">It's removed from the voice platform and Use my voice turns off. You can record it again any time.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setAskDelete(false)} disabled={busy === "delete"} className={btnQuiet}>Keep it</button>
            <button type="button" onClick={() => void remove()} disabled={busy === "delete"} autoFocus className={cn(btn, "bg-[#FF453A] font-semibold text-white hover:bg-[#ff5a50]")}>
              {busy === "delete" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Delete</button>
          </div>
        </div>
      )}

      {/* recorder */}
      <div className="mt-4 rounded-2xl bg-black/20 p-3 ring-1 ring-white/10">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/55">{has ? "Record it again" : "Record your voice"}</div>
        <div className="mt-2 flex items-center gap-4">
          <button type="button" onClick={() => (recording ? stop() : void start())} disabled={phase === "processing" || busy === "clone"}
            aria-label={recording ? "Stop recording" : "Start recording"}
            className={cn("relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full transition motion-safe:active:scale-95 disabled:opacity-45", ring)}
            style={{ background: recording ? "#FF453A" : AVA_GLOW, color: recording ? "#fff" : "#1c1c1e" }}>
            {recording && <span className="absolute inset-0 rounded-full ring-4 ring-[#FF453A]/40 motion-safe:animate-pulse" aria-hidden />}
            {phase === "processing" ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden /> : recording ? <Square className="h-6 w-6 fill-current" aria-hidden /> : <Mic className="h-7 w-7" aria-hidden />}
          </button>
          <div className="min-w-0 flex-1">
            <div role="timer" aria-label="Recording length" className="font-mono text-[26px] font-medium leading-none tabular-nums text-white">{mmss(recording ? secs : take?.secs ?? 0)}</div>
            <div className="mt-2 flex h-5 items-end gap-[3px]" aria-hidden>
              {Array.from({ length: bars }, (_, i) => (
                <span key={i} className="w-full max-w-[10px] rounded-sm transition-colors" style={{ height: `${30 + (i / bars) * 70}%`, background: recording && i < lit ? AVA_GLOW : "rgba(255,255,255,0.14)" }} />
              ))}
            </div>
            <p className="mt-1.5 text-xs text-white/60" role={recording && secs >= 2 && !heard ? "alert" : undefined}>
              {phase === "processing" ? "Getting the recording ready…"
                : recording ? (secs >= 2 && !heard ? "Can't hear you. Check your microphone." : secs < MIN_REC_SECS ? "Keep going. Aim for about 3 minutes." : "Good. Stop any time, or finish the script.")
                : "Quiet room, normal voice. 3 minutes is plenty."}
            </p>
          </div>
        </div>

        <div className="mt-3 max-h-48 overflow-y-auto overscroll-contain rounded-xl bg-white/[0.04] p-3 text-[15px] leading-relaxed text-white/85 ring-1 ring-white/10" role="region" tabIndex={0} aria-label="Script to read aloud">
          {SCRIPT.map((p, i) => <p key={i} className={cn(i > 0 && "mt-2.5", i === 0 && "text-xs text-white/55")}>{p}</p>)}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".m4a,.mp3,.wav,audio/mp4,audio/x-m4a,audio/mpeg,audio/wav,audio/x-wav" className="sr-only" tabIndex={-1} aria-label="Upload a recording"
            onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={recording || phase === "processing" || busy === "clone"} className={btnQuiet}>
            <Upload className="h-4 w-4" aria-hidden />Upload a Voice Memo</button>
          <span className="text-xs text-white/55">m4a, mp3 or wav, up to 25{"\u00A0"}MB</span>
        </div>
      </div>

      {take && (
        <div className="mt-3 space-y-2">
          <div className="text-sm text-white/75"><span className="font-medium text-white">{take.label}</span>{take.secs != null && <span className="tabular-nums"> · {mmss(take.secs)}</span>}</div>
          <audio controls src={take.url} className="h-11 w-full" aria-label="Your recording, to check before cloning" />
          {tooShort && <p className="text-sm text-amber-200">That's under {MIN_REC_SECS}{"\u00A0"}seconds. Record a little more so the clone sounds like you.</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setTake(null)} disabled={busy === "clone"} className={btnQuiet}><RotateCcw className="h-4 w-4" aria-hidden />Start over</button>
            <button type="button" onClick={() => void makeVoice()} disabled={busy === "clone" || noPlan || tooShort} className={btnPrimary} style={primaryStyle}>
              {busy === "clone" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{busy === "clone" ? "Cloning…" : has ? "Replace my voice" : "Make my voice"}</button>
          </div>
          <p className="text-xs text-white/55">The recording is deleted from storage as soon as your voice is made.</p>
        </div>
      )}
      {err && <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-500/25">{err}</p>}
    </div>
  );
}

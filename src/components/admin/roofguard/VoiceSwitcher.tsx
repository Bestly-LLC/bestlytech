/**
 * Voice switcher for either Ava (personal: source="ava", RoofGuard: source="rg").
 * Chip shows her current voice; the sheet lists favorites + her last two voices, each with Play sample and Use.
 * Backend: edge fn ava-voices (admin only). Samples are capped per day server-side.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Check, Loader2, Mic, Play, Plus, Search, Square, Trash2 } from "lucide-react";

type Voice = { voice_id: string; name: string; accent?: string | null; gender?: string | null; description?: string | null; public_owner_id?: string | null; preview_url?: string | null };
type Listing = {
  favorites: Voice[]; says_left: number; say_cap: number; needs_seed: boolean;
  ava: { current: { voice_id: string; name: string | null }; recent: Voice[] };
  rg: { current: { voice_id: string; name: string | null }; recent: Voice[] };
};
type Source = "ava" | "rg";

const SAMPLE = "Hey, it's Ava. Quick one: is now a bad time?";

async function call(body: Record<string, unknown>): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const base = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
  return fetch(`${base}/functions/v1/ava-voices`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token ?? ""}`,
      apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "") as string },
    body: JSON.stringify(body),
  });
}
async function json<T>(body: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const res = await call(body).catch(() => null);
  if (!res) return { ok: false, error: "Couldn't reach the server. Try again." } as T & { ok: boolean; error?: string };
  return (await res.json().catch(() => ({ ok: false, error: "Unexpected reply. Try again." }))) as T & { ok: boolean; error?: string };
}

export function VoiceSwitcher({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Listing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);   // voice_id being switched
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingPlay, setLoadingPlay] = useState<string | null>(null);
  const [both, setBoth] = useState(false);
  const [text, setText] = useState(SAMPLE);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Voice[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sugg, setSugg] = useState<Voice[] | null>(null);
  const [basedOn, setBasedOn] = useState<string[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const r = await json<Listing>({ action: "list" });
    if (!r.ok) { toast.error(r.error ?? "Couldn't load voices."); return; }
    setData(r);
    if (r.needs_seed) {
      const s = await json<{ found: string[]; missing: string[] }>({ action: "seed" });
      if (s.ok) {
        if (s.missing.length) toast.message(`Couldn't find: ${s.missing.join(", ")}. Use search below.`);
        const again = await json<Listing>({ action: "list" });
        if (again.ok) setData(again);
      }
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!open || !data || sugg !== null) return;
    void json<{ voices: Voice[]; based_on: string[] }>({ action: "suggest" }).then((r) => { if (r.ok) { setSugg(r.voices); setBasedOn(r.based_on); } else setSugg([]); });
  }, [open, data, sugg]);
  useEffect(() => () => { audio.current?.pause(); if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const stop = () => { audio.current?.pause(); setPlaying(null); };
  const play = async (v: Voice) => {
    if (playing === v.voice_id) { stop(); return; }
    stop();
    setLoadingPlay(v.voice_id);
    const res = await call({ action: "say", voice_id: v.voice_id, text }).catch(() => null);
    setLoadingPlay(null);
    if (!res) { toast.error("Couldn't reach the server. Try again."); return; }
    if (!res.ok) { const e = await res.json().catch(() => null); toast.error(e?.error ?? "Couldn't make that sample."); return; }
    const left = res.headers.get("x-says-left");
    if (left !== null) setData((d) => (d ? { ...d, says_left: Number(left) } : d));
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(await res.blob());
    const a = audio.current ?? new Audio();
    audio.current = a;
    a.src = urlRef.current;
    a.onended = () => setPlaying(null);
    setPlaying(v.voice_id);
    a.play().catch(() => setPlaying(null));
  };

  const use = async (v: Voice) => {
    setBusy(v.voice_id);
    const r = await json<{ name: string; problems: string[] }>({ action: "use", source: both ? "both" : source, voice_id: v.voice_id,
      public_owner_id: v.public_owner_id ?? undefined, name: v.name });
    setBusy(null);
    if (!r.ok) { toast.error(r.error ?? "Couldn't switch the voice."); return; }
    toast.success(`${both ? "Both Avas" : "Ava"} now sound like ${v.name}.`);
    if (r.problems?.length) toast.error(r.problems.join(" "));
    await load();
  };

  const search = async () => {
    setSearching(true);
    const r = await json<{ voices: Voice[] }>({ action: "find", query: q });
    setSearching(false);
    if (!r.ok) { toast.error(r.error ?? "Search failed."); return; }
    setFound(r.voices);
  };
  const addFav = async (v: Voice) => {
    const r = await json({ action: "add_favorite", voice: v });
    if (!r.ok) { toast.error(r.error ?? "Couldn't save."); return; }
    toast.success(`${v.name} saved.`);
    await load();
  };
  const removeFav = async (v: Voice) => {
    const r = await json({ action: "remove_favorite", voice_id: v.voice_id });
    if (!r.ok) { toast.error(r.error ?? "Couldn't remove."); return; }
    await load();
  };

  const mine = data?.[source];
  const curId = mine?.current.voice_id;
  const curName = mine?.current.name ?? "Voice";
  const recents = (mine?.recent ?? []).map((r) => ({ ...r }) as Voice);
  const favIds = new Set((data?.favorites ?? []).map((f) => f.voice_id));

  const row = (v: Voice, opts: { removable?: boolean; saveable?: boolean } = {}) => {
    const isCur = v.voice_id === curId;
    return (
      <li key={v.voice_id} className="flex items-center gap-2 rounded-2xl bg-white/[0.04] p-2.5 ring-1 ring-white/10">
        <button type="button" onClick={() => void play(v)} disabled={loadingPlay === v.voice_id || (data?.says_left ?? 1) <= 0}
          aria-label={playing === v.voice_id ? `Stop ${v.name} sample` : `Play ${v.name} sample`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/15 transition hover:bg-white/15 active:scale-95 disabled:opacity-40">
          {loadingPlay === v.voice_id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            : playing === v.voice_id ? <Square className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </button>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[15px] font-semibold text-white">{v.name}</div>
          <div className="truncate text-xs text-white/50">{[v.gender, v.accent, v.description].filter(Boolean).join(" · ") || " "}</div>
        </div>
        {opts.saveable && !favIds.has(v.voice_id) && (
          <button type="button" onClick={() => void addFav(v)} aria-label={`Save ${v.name} to favorites`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/70 ring-1 ring-white/15 hover:bg-white/5"><Plus className="h-4 w-4" aria-hidden /></button>
        )}
        {opts.removable && !isCur && (
          <button type="button" onClick={() => void removeFav(v)} aria-label={`Remove ${v.name} from favorites`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/40 hover:text-red-300"><Trash2 className="h-4 w-4" aria-hidden /></button>
        )}
        {isCur ? (
          <span className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm font-medium text-emerald-300"><Check className="h-4 w-4" aria-hidden />In use</span>
        ) : (
          <button type="button" onClick={() => void use(v)} disabled={busy !== null}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-[#052E1F] transition hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-40">
            {busy === v.voice_id && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Use</button>
        )}
      </li>
    );
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Ava's voice: ${curName}. Change voice`}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 ring-1 ring-white/10 transition hover:bg-white/[0.07]">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-violet-500/15 text-violet-300"><Mic className="h-3.5 w-3.5" aria-hidden /></span>
        <span className="text-left leading-tight"><span className="block text-[11px] text-white/50">Ava's voice</span>
          <span className="block whitespace-nowrap text-[15px] font-semibold text-white">{data ? curName : "…"}</span></span>
      </button>

      <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) stop(); }}>
        <SheetContent className="w-full overflow-y-auto border-white/10 bg-[#0B0F14] text-white sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-white">Ava's voice</SheetTitle>
            <SheetDescription className="text-white/50">Play a sample, then tap Use. It switches her on the next call.</SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <label className="block text-xs text-white/50">Sample line
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={240}
                className="mt-1 min-h-[44px] w-full rounded-xl bg-white/[0.06] px-3 text-[15px] text-white ring-1 ring-white/10 focus:outline-none focus:ring-white/30" />
            </label>
            <div className="flex items-center justify-between gap-3 text-xs text-white/50">
              <label className="inline-flex min-h-[44px] items-center gap-2">
                <input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} className="h-4 w-4" />Switch both Avas</label>
              <span className="whitespace-nowrap tabular-nums">{data ? `${data.says_left} samples left today` : ""}</span>
            </div>

            {!data && <div className="py-8 text-center text-white/50"><Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden /></div>}

            {data && (
              <>
                <section aria-label="Favorites">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Favorites</h3>
                  <ul className="space-y-2">{data.favorites.map((v) => row(v, { removable: true }))}</ul>
                </section>
                {recents.length > 0 && (
                  <section aria-label="Recently used">
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Last used</h3>
                    <ul className="space-y-2">{recents.map((v) => row(v))}</ul>
                  </section>
                )}
                <section aria-label="Find a voice">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">Find a voice</h3>
                  <form onSubmit={(e) => { e.preventDefault(); if (q.trim().length > 1) void search(); }} className="flex gap-2">
                    <input value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value.trim()) setFound(null); }} placeholder="Name, e.g. Matilda" aria-label="Search voices"
                      className="min-h-[44px] min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3 text-[15px] text-white ring-1 ring-white/10 placeholder:text-white/30 focus:outline-none focus:ring-white/30" />
                    <button type="submit" disabled={searching || q.trim().length < 2} aria-label="Search"
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-40">
                      {searching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}</button>
                  </form>
                  {!found && sugg === null && <div className="py-3 text-sm text-white/50"><Loader2 className="inline h-4 w-4 animate-spin" aria-hidden /> Finding voices like your favorites…</div>}
                  {!found && sugg && sugg.length > 0 && <>
                    <p className="mb-2 text-xs text-white/40">Suggested from your favorites{basedOn.length ? `: ${basedOn.join(", ")}` : ""}</p>
                    <ul className="space-y-2">{sugg.map((v) => row(v, { saveable: true }))}</ul></>}
                  {found && <ul className={cn("mt-2 space-y-2")}>{found.length ? found.map((v) => row(v, { saveable: true })) :
                    <li className="py-3 text-sm text-white/50">No matches.</li>}</ul>}
                </section>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

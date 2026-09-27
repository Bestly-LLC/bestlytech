/**
 * Radio for the Bestly Wall (admin /admin/wall).
 *
 * Stations come from the free Radio Browser directory (radio-browser.info), fetched straight from the browser:
 * no key, no backend. Picking one writes wall state key `radio` = {on, name, url, favicon, ts} through the
 * page's normal save path (wall_admin_set). The Pi plays it on the Desk HomePod over AirPlay and the wall shows
 * what's playing (server.py, see the wall-feedback opusplan).
 *
 * HIG: one list style for favorites and results, 56 pt rows, the whole row is the tap target, the playing
 * station is marked with a speaker icon and text (not color alone), and the list keeps its height while
 * loading so nothing jumps.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Radio as RadioIcon, Search, Square, Volume2, X } from "lucide-react";

export type WallRadio = { on: boolean; name: string; url: string; favicon?: string | null; ts: number } | null;

type Station = { id: string; name: string; url: string; favicon: string; place: string; bitrate: number; codec: string };

/** Radio Browser asks clients to spread load across mirrors; try the next one if a mirror is down. */
const MIRRORS = ["de1", "de2", "fi1"];
const HOME = { lat: 34.086, lng: -118.37 }; // West Hollywood

async function rb(path: string, signal?: AbortSignal): Promise<unknown> {
  let last: unknown = null;
  for (const m of MIRRORS) {
    try {
      const res = await fetch(`https://${m}.api.radio-browser.info${path}`, { signal, headers: { Accept: "application/json" } });
      if (res.ok) return await res.json();
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      last = e;
    }
  }
  throw last ?? new Error("Radio directory unreachable");
}

type Raw = { stationuuid: string; name: string; url_resolved: string; url: string; favicon: string; state: string; country: string; countrycode: string; bitrate: number; codec: string };

function clean(list: unknown): Station[] {
  const seen = new Set<string>();
  const out: Station[] = [];
  for (const r of (Array.isArray(list) ? list : []) as Raw[]) {
    const url = (r.url_resolved || r.url || "").trim();
    const name = (r.name || "").replace(/\s+/g, " ").trim();
    if (!url || !name) continue;
    const key = `${name.toLowerCase()}|${url}`;
    if (seen.has(key) || seen.has(url)) continue;
    seen.add(key); seen.add(url);
    out.push({
      id: r.stationuuid, name, url, favicon: (r.favicon || "").trim(),
      place: [r.state, r.countrycode === "US" ? "" : r.country].filter(Boolean).join(", "),
      bitrate: r.bitrate || 0, codec: (r.codec || "").toUpperCase(),
    });
  }
  return out;
}

/** "Mega 96.3 (Los Angeles) - 96.3 FM - KXOL-FM - …" -> title "Mega 96.3 (Los Angeles)", rest as detail. */
function split(name: string) {
  const parts = name.split(/\s+[-|–]\s+/);
  return { title: parts[0], rest: parts.slice(1).join(" · ") };
}

function Logo({ src, className }: { src?: string | null; className?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  // Many station logos are plain http; the admin is https, so only load secure ones.
  const ok = !!src && src.startsWith("https://") && !bad;
  return (
    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.08] ring-1 ring-white/10", className)}>
      {ok
        ? <img src={src!} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setBad(true)} />
        : <RadioIcon className="h-5 w-5 text-white/50" aria-hidden />}
    </span>
  );
}

function StationRow({ st, playing, onPick }: { st: Station; playing: boolean; onPick: (s: Station) => void }) {
  const { title, rest } = split(st.name);
  const detail = [rest || st.place, st.bitrate ? `${st.bitrate} kbps` : st.codec].filter(Boolean).join(" · ");
  return (
    <button type="button" onClick={() => onPick(st)} aria-pressed={playing}
      aria-label={playing ? `${title}, playing now` : `Play ${title}`}
      className="flex min-h-[56px] w-full items-center gap-3 border-b border-white/[0.07] px-4 py-2 text-left last:border-b-0 transition-colors duration-150 hover:bg-white/[0.04] active:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400">
      <Logo src={st.favicon} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[16px]", playing ? "font-semibold text-sky-300" : "text-white")}>{title}</span>
        {detail && <span className="block truncate text-[13px] text-white/50">{detail}</span>}
      </span>
      {playing
        ? <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-sky-300"><Volume2 className="h-4 w-4" aria-hidden />Playing</span>
        : <span className="shrink-0 text-[13px] text-white/40">Play</span>}
    </button>
  );
}

const ROWS = 6;

export function WallRadioSection({ radio, onPlay, onStop }: {
  radio: WallRadio | undefined;
  onPlay: (r: NonNullable<WallRadio>) => void;
  onStop: () => void;
}) {
  const [favs, setFavs] = useState<Station[] | null>(null);
  const [favErr, setFavErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Station[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Favorites: the most-liked stations within about 25 miles of home.
  useEffect(() => {
    const ac = new AbortController();
    rb(`/json/stations/search?geo_lat=${HOME.lat}&geo_long=${HOME.lng}&geo_distance=40000&order=votes&reverse=true&limit=24&hidebroken=true`, ac.signal)
      .then((d) => setFavs(clean(d).slice(0, 12)))
      .catch((e) => { if ((e as Error).name !== "AbortError") setFavErr("Couldn't reach the radio directory. Search still works when it's back."); });
    return () => ac.abort();
  }, []);

  // Search as you type (after a short pause).
  useEffect(() => {
    const term = q.trim();
    abort.current?.abort();
    if (term.length < 2) { setResults(null); setSearching(false); setSearchErr(null); return; }
    const ac = new AbortController();
    abort.current = ac;
    setSearching(true);
    const t = window.setTimeout(() => {
      rb(`/json/stations/search?name=${encodeURIComponent(term)}&limit=20&hidebroken=true&order=votes&reverse=true`, ac.signal)
        .then((d) => { setResults(clean(d)); setSearchErr(null); })
        .catch((e) => { if ((e as Error).name !== "AbortError") setSearchErr("Search didn't go through. Try again in a moment."); })
        .finally(() => { if (!ac.signal.aborted) setSearching(false); });
    }, 350);
    return () => { window.clearTimeout(t); ac.abort(); };
  }, [q]);

  const pick = useCallback((st: Station) => {
    onPlay({ on: true, name: st.name, url: st.url, favicon: st.favicon || null, ts: Date.now() });
    // Radio Browser's click counter keeps its popularity ranking honest. Fire and forget.
    void rb(`/json/url/${encodeURIComponent(st.id)}`).catch(() => {});
  }, [onPlay]);

  const on = !!radio?.on;
  const nowTitle = radio?.name ? split(radio.name).title : null;
  const list = results ?? favs;
  const listing = q.trim().length >= 2;
  const cap = listing ? 8 : ROWS;
  const shown = useMemo(() => (list ? (showAll ? list : list.slice(0, cap)) : null), [list, showAll, cap]);
  useEffect(() => setShowAll(false), [listing]);

  return (
    <section id="radio" className="scroll-mt-20 space-y-2">
      <h2 className="px-4 text-[13px] font-medium uppercase tracking-[0.06em] text-white/50">Radio</h2>
      <div className="overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
        {/* Now playing: same height whether on or off, so the list below never moves. */}
        <div className="flex min-h-[72px] items-center gap-3 border-b border-white/[0.07] px-4 py-3" aria-live="polite">
          <Logo src={radio?.favicon} className="h-12 w-12 rounded-xl" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-white">{on && nowTitle ? nowTitle : nowTitle ?? "Nothing playing"}</div>
            <div className="truncate text-[13px] text-white/55">
              {on ? "On the Desk HomePod" : nowTitle ? "Stopped. Tap Play to pick it back up." : "Pick a station below. It plays on the Desk HomePod."}
            </div>
          </div>
          {on ? (
            <button type="button" onClick={onStop}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-[15px] font-semibold text-black transition-colors duration-150 hover:bg-white/90 active:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
              <Square className="h-4 w-4 fill-current" aria-hidden /> Stop
            </button>
          ) : radio?.url ? (
            <button type="button" onClick={() => onPlay({ ...radio, on: true, ts: Date.now() })}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-[15px] font-semibold text-black transition-colors duration-150 hover:bg-white/90 active:bg-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
              <Volume2 className="h-4 w-4" aria-hidden /> Play
            </button>
          ) : null}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-4">
          <Search className="h-4 w-4 shrink-0 text-white/45" aria-hidden />
          <label htmlFor="wall-radio-q" className="sr-only">Search stations</label>
          <input id="wall-radio-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" enterKeyHint="search"
            placeholder="Search stations, like KCRW or jazz"
            className="min-h-[48px] min-w-0 flex-1 bg-transparent text-[16px] text-white placeholder:text-white/35 focus:outline-none [&::-webkit-search-cancel-button]:hidden" />
          {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/50" aria-label="Searching" />}
          {q && !searching && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search"
              className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-white/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        <div className="px-4 pb-1 pt-3 text-[13px] font-medium uppercase tracking-[0.06em] text-white/45">
          {listing ? "Results" : "Popular near you"}
        </div>

        {/* List keeps a stable minimum height while loading (6 rows x 56 pt). */}
        <div className="min-h-[336px]">
          {listing && searchErr ? (
            <p className="px-4 py-4 text-[15px] text-amber-300" role="status">{searchErr}</p>
          ) : !listing && favErr ? (
            <p className="px-4 py-4 text-[15px] text-amber-300" role="status">{favErr}</p>
          ) : shown == null || (listing && searching && results == null) ? (
            <div aria-busy="true">
              {Array.from({ length: ROWS }).map((_, i) => (
                <div key={i} className="flex min-h-[56px] items-center gap-3 border-b border-white/[0.07] px-4 py-2 last:border-b-0">
                  <span className="h-10 w-10 animate-pulse rounded-lg bg-white/[0.07]" />
                  <span className="h-4 flex-1 animate-pulse rounded bg-white/[0.07]" style={{ maxWidth: `${60 - i * 5}%` }} />
                </div>
              ))}
            </div>
          ) : shown.length === 0 ? (
            <p className="px-4 py-4 text-[15px] text-white/60" role="status">No stations match “{q.trim()}”.</p>
          ) : (
            shown.map((st) => <StationRow key={st.id} st={st} playing={on && radio?.url === st.url} onPick={pick} />)
          )}
        </div>
        {list && list.length > cap && (
          <div className="border-t border-white/[0.07] px-4">
            <button type="button" className="min-h-[44px] text-[15px] font-medium text-sky-400" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${list.length}`}
            </button>
          </div>
        )}
      </div>
      <p className="px-4 text-[13px] leading-snug text-white/50">
        Stations come from the free Radio Browser directory. The wall shows what's playing.
      </p>
    </section>
  );
}

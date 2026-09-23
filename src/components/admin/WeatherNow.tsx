/**
 * Current conditions for home (West Hollywood), from Apple WeatherKit.
 *
 * Sits to the right of the greeting in the Command Center hero, so it is sized to be
 * read at a glance rather than squinted at: a drawn scene (WeatherGlyph) plus the
 * temperature at display size, with the day's range underneath.
 *
 * The signing key lives in the Supabase vault and never reaches the browser - this
 * only ever talks to the weatherkit-proxy edge function, which mints the ES256 token
 * server-side and caches each coordinate for ten minutes.
 *
 * Apple's terms require the  Weather mark and a link to their attribution page
 * wherever this data is shown, so the link below is not optional decoration.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { WeatherGlyph } from "@/components/admin/WeatherGlyph";
import { WeatherBoard, type WxData, type WxDay, type WxHour } from "@/components/admin/WeatherBoard";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Home. Everything else on this dashboard is Jared's day, so this is too. */
const HOME: Place = { lat: 34.09, lon: -118.3617, label: "West Hollywood" };
export type Place = { lat: number; lon: number; label: string };

/*
 * Where the viewer is, for the partner portal (Eli does not live where Jared does).
 * The browser asks once; the answer is kept on this device so it does not ask on every
 * visit, and refreshed quietly after a day. Coordinates are rounded to ~1 km before they
 * leave the page - plenty for weather, and no one needs the house.
 */
const LOC_KEY = "bestly-wx-place";
const DAY_MS = 24 * 3600 * 1000;
const round = (n: number) => Math.round(n * 100) / 100;
function cachedPlace(): (Place & { at: number }) | null {
  try { return JSON.parse(localStorage.getItem(LOC_KEY) ?? "null"); } catch { return null; }
}
async function placeName(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const j = await r.json();
    return j.city || j.locality || j.principalSubdivision || "Your area";
  } catch { return "Your area"; }
}
function locate(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("no geolocation"));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = round(pos.coords.latitude), lon = round(pos.coords.longitude);
        const place = { lat, lon, label: await placeName(lat, lon) };
        try { localStorage.setItem(LOC_KEY, JSON.stringify({ ...place, at: Date.now() })); } catch { /* ok */ }
        resolve(place);
      },
      reject,
      { maximumAge: 60 * 60 * 1000, timeout: 15000, enableHighAccuracy: false },
    );
  });
}
const REFRESH_MS = 15 * 60 * 1000;
const ATTRIBUTION = "https://developer.apple.com/weatherkit/data-source-attribution/";

type Current = {
  conditionCode?: string;
  daylight?: boolean;
  temperature?: number;
  temperatureApparent?: number;
  humidity?: number;
  windSpeed?: number;
  metadata?: { attributionURL?: string };
};
type Day = { temperatureMax?: number; temperatureMin?: number };

const f = (c: number | undefined) => (c == null ? null : Math.round((c * 9) / 5 + 32));
/** WeatherKit's conditionCode is CamelCase; people read words. */
const words = (code: string) => {
  const s = code.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function WeatherNow({ className, useDeviceLocation = false }: {
  className?: string;
  /** Partner portal: weather where the viewer is (browser location), not Jared's home. */
  useDeviceLocation?: boolean;
}) {
  const [place, setPlace] = useState<Place | null>(() => {
    if (!useDeviceLocation) return HOME;
    const c = cachedPlace();
    return c ? { lat: c.lat, lon: c.lon, label: c.label } : null;
  });
  const [needsTap, setNeedsTap] = useState(false);
  useEffect(() => {
    if (!useDeviceLocation) return;
    const c = cachedPlace();
    if (c && Date.now() - c.at < DAY_MS) return;
    locate().then(setPlace).catch(() => { if (!c) setNeedsTap(true); });
  }, [useDeviceLocation]);
  const [now, setNow] = useState<Current | null>(null);
  const [today, setToday] = useState<Day | null>(null);
  const [failed, setFailed] = useState(false);
  const [board, setBoard] = useState<WxData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!place) return;
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.functions.invoke("weatherkit-proxy", {
        body: { lat: place.lat, lon: place.lon, dataSets: "currentWeather,forecastHourly,forecastDaily" },
      });
      if (!alive) return;
      const cw = (data as { currentWeather?: Current })?.currentWeather;
      if (error || !cw) {
        // A weather panel is never worth an error state in the hero - it just goes away.
        setFailed(true);
        return;
      }
      const d = data as { forecastDaily?: { days?: WxDay[] }; forecastHourly?: { hours?: WxHour[] } };
      setNow(cw);
      setToday(d.forecastDaily?.days?.[0] ?? null);
      setBoard({
        current: cw,
        hours: d.forecastHourly?.hours ?? [],
        days: d.forecastDaily?.days ?? [],
        attribution: cw.metadata?.attributionURL ?? ATTRIBUTION,
      });
      setFailed(false);
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [place]);

  if (needsTap && !place) {
    // Location was blocked or timed out: one tap asks again (Safari only asks from a click).
    return (
      <button
        type="button"
        onClick={() => { setNeedsTap(false); locate().then(setPlace).catch(() => setNeedsTap(true)); }}
        className={cn(
          "inline-flex items-center gap-2 rounded-[1.25rem] bg-white/[0.05] px-3.5 py-2.5 text-sm font-medium text-white/75 ring-1 ring-inset ring-white/[0.07] transition hover:bg-white/[0.08] bento:bg-[#F3F2EE] bento:text-[#33313a] bento:ring-[#e6e4de]",
          className,
        )}
      >
        <WeatherGlyph code="PartlyCloudy" day className="h-8 w-8 shrink-0" />
        Show my weather
      </button>
    );
  }
  if (failed || !now || !place) return null;

  const temp = f(now.temperature);
  const feels = f(now.temperatureApparent);
  const hi = f(today?.temperatureMax);
  const lo = f(today?.temperatureMin);
  const code = now.conditionCode ?? "Clear";
  const day = now.daylight !== false;
  const drift = feels != null && temp != null && Math.abs(feels - temp) >= 3;

  return (
    <>
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) setOpen(true); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
      aria-label={`Weather: ${temp} degrees, ${words(code)}. Open the forecast`}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-[1.25rem] px-3.5 py-2.5 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
        "bg-white/[0.05] ring-1 ring-inset ring-white/[0.07]",
        "bento:bg-[#F3F2EE] bento:ring-[#e6e4de]",
        className,
      )}
    >
      <WeatherGlyph code={code} day={day} className="h-16 w-16 shrink-0 drop-shadow-sm" />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[2.25rem] font-bold leading-none tracking-tight tabular-nums text-white bento:text-[#17151c]">
            {temp}&deg;
          </span>
          <span className="truncate text-sm font-medium text-white/75 bento:text-[#33313a]">{words(code)}</span>
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-white/50 bento:text-[#55525c]">
          {hi != null && lo != null && (
            <span className="tabular-nums">
              H {hi}&deg; &nbsp;L {lo}&deg;
            </span>
          )}
          {drift && <span className="tabular-nums">Feels {feels}&deg;</span>}
          <span className="hidden xl:inline">{place.label}</span>
          <a
            href={now.metadata?.attributionURL ?? ATTRIBUTION}
            target="_blank"
            rel="noreferrer"
            className="text-white/35 underline-offset-2 transition hover:text-white/75 hover:underline bento:text-[#8a8792]"
          >
            &#63743;&nbsp;Weather
          </a>
        </p>
      </div>
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-6xl overflow-y-auto border-white/10 bg-[#07090d] p-3 text-white sm:p-4 bento:bg-[#F3F2EE] bento:text-[#17151c]">
        <DialogTitle className="sr-only">Weather in {place.label}</DialogTitle>
        <DialogDescription className="sr-only">Now, the next hours, and the next ten days.</DialogDescription>
        {board && <WeatherBoard data={board} place={place.label} />}
      </DialogContent>
    </Dialog>
    </>
  );
}

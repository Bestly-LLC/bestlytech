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
import { cn } from "@/lib/utils";

/** Home. Everything else on this dashboard is Jared's day, so this is too. */
const HOME = { lat: 34.09, lon: -118.3617, label: "West Hollywood" };
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

export function WeatherNow({ className }: { className?: string }) {
  const [now, setNow] = useState<Current | null>(null);
  const [today, setToday] = useState<Day | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.functions.invoke("weatherkit-proxy", {
        body: { lat: HOME.lat, lon: HOME.lon, dataSets: "currentWeather,forecastDaily" },
      });
      if (!alive) return;
      const cw = (data as { currentWeather?: Current })?.currentWeather;
      if (error || !cw) {
        // A weather panel is never worth an error state in the hero - it just goes away.
        setFailed(true);
        return;
      }
      setNow(cw);
      setToday((data as { forecastDaily?: { days?: Day[] } })?.forecastDaily?.days?.[0] ?? null);
      setFailed(false);
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (failed || !now) return null;

  const temp = f(now.temperature);
  const feels = f(now.temperatureApparent);
  const hi = f(today?.temperatureMax);
  const lo = f(today?.temperatureMin);
  const code = now.conditionCode ?? "Clear";
  const day = now.daylight !== false;
  const drift = feels != null && temp != null && Math.abs(feels - temp) >= 3;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[1.25rem] px-3.5 py-2.5",
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
          <span className="hidden xl:inline">{HOME.label}</span>
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
  );
}

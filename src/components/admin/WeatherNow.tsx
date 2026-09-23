/**
 * Current conditions for home (West Hollywood), from Apple WeatherKit.
 *
 * The signing key lives in the Supabase vault and never reaches the browser - this
 * only ever talks to the weatherkit-proxy edge function, which mints the ES256 token
 * server-side and caches each coordinate for ten minutes.
 *
 * Apple's terms require the  Weather mark and a link to their attribution page
 * wherever this data is shown, so the link below is not optional decoration.
 */
import { useEffect, useState } from "react";
import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow,
  CloudSun, Moon, Sun, Wind, type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
const words = (code: string) => code.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

function icon(code: string, day: boolean): LucideIcon {
  const c = code.toLowerCase();
  if (c.includes("thunder") || c.includes("tornado") || c.includes("hurricane")) return CloudLightning;
  if (c.includes("snow") || c.includes("sleet") || c.includes("flurr") || c.includes("blizzard") || c.includes("hail")) return CloudSnow;
  if (c.includes("drizzle")) return CloudDrizzle;
  if (c.includes("rain") || c.includes("shower")) return CloudRain;
  if (c.includes("fog") || c.includes("haze") || c.includes("smoke") || c.includes("dust")) return CloudFog;
  if (c.includes("wind") || c.includes("breezy")) return Wind;
  if (c.includes("partly") || c.includes("mostly cloudy")) return day ? CloudSun : CloudMoon;
  if (c.includes("cloud")) return Cloud;
  return day ? Sun : Moon;
}

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
        // A weather strip is never worth an error state in the hero - it just goes away.
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
  const Icon = icon(code, now.daylight !== false);

  return (
    <div className={cn("flex items-center gap-2 text-sm text-white/55 bento:text-[#55525c]", className)}>
      <Icon className="h-4 w-4 shrink-0 text-white/70 bento:text-[#33313a]" aria-hidden />
      <span className="text-white/80 bento:text-[#17151c]">
        <span className="font-semibold tabular-nums">{temp}&deg;</span> {words(code)}
      </span>
      {hi != null && lo != null && (
        <span className="hidden tabular-nums sm:inline">
          H {hi}&deg; L {lo}&deg;
        </span>
      )}
      {feels != null && temp != null && Math.abs(feels - temp) >= 3 && (
        <span className="hidden tabular-nums md:inline">feels {feels}&deg;</span>
      )}
      <span className="hidden lg:inline">{HOME.label}</span>
      <a
        href={now.metadata?.attributionURL ?? ATTRIBUTION}
        target="_blank"
        rel="noreferrer"
        className="rounded text-xs text-white/35 underline-offset-2 transition hover:text-white/70 hover:underline bento:text-[#8a8792]"
      >
        &#63743;&nbsp;Weather
      </a>
    </div>
  );
}

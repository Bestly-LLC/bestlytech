/**
 * The full weather board, opened from the weather chip in the Command Center hero.
 * (Jared, 2026-09-22: "I want my weather on admin to look like this" + a reference.)
 *
 *   ┌ Now ───────────┐ ┌ Hourly: next 10 hours as a line, sunrise/sunset slotted in ┐
 *   └────────────────┘ └──────────────────────────────────────────────────────────────┘
 *   ┌ 10 days: highs (amber) over lows, tap a day ─┬ that day: summary, sun, UV, wind ┐
 *   └───────────────────────────────────────────────┴──────────────────────────────────┘
 *
 * Both charts are HTML columns with the line drawn in an SVG overlay that shares the
 * same x centres, so labels and glyphs never distort when the dialog is resized.
 * Everything is in West Hollywood time and US units (°F, mph, inches), 12-hour clock.
 */
import { useMemo, useState } from "react";
import { Droplets, Sunrise, Sunset, Sun, Wind, Droplet, Clock, CalendarDays } from "lucide-react";
import { WeatherGlyph } from "@/components/admin/WeatherGlyph";
import { cn } from "@/lib/utils";

export const LA = "America/Los_Angeles";

export type WxCurrent = {
  conditionCode?: string; daylight?: boolean; temperature?: number; temperatureApparent?: number;
  humidity?: number; windSpeed?: number; windDirection?: number; uvIndex?: number;
  metadata?: { attributionURL?: string };
};
export type WxHour = {
  forecastStart: string; temperature: number; conditionCode: string; daylight?: boolean;
  precipitationChance?: number;
};
type Part = { humidity?: number; precipitationChance?: number; conditionCode?: string };
export type WxDay = {
  forecastStart: string; temperatureMax: number; temperatureMin: number; conditionCode: string;
  sunrise?: string; sunset?: string; maxUvIndex?: number; windSpeedAvg?: number; windSpeedMax?: number;
  precipitationAmount?: number; precipitationChance?: number;
  daytimeForecast?: Part & { windDirection?: number }; overnightForecast?: Part;
};
export type WxData = { current: WxCurrent; hours: WxHour[]; days: WxDay[]; attribution: string };

export const toF = (c: number | undefined | null) => (c == null ? null : Math.round((c * 9) / 5 + 32));
const mph = (kmh: number | undefined) => (kmh == null ? null : Math.round(kmh * 0.621371));
const inches = (mm: number | undefined) => (mm == null ? null : Math.round((mm / 25.4) * 100) / 100);
export const words = (code: string) => {
  const s = code.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const compass = (deg: number | undefined) =>
  deg == null ? "" : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
/** "6 PM" -> hour + small suffix, the way the reference sets it. */
const hourParts = (iso: string, withMinutes = false) => {
  const s = new Date(iso).toLocaleTimeString("en-US", {
    timeZone: LA, hour: "numeric", ...(withMinutes ? { minute: "2-digit" } : {}), hour12: true,
  });
  const [t, ap] = s.split(" ");
  return { t, ap: ap ?? "" };
};
const clock = (iso?: string) => {
  if (!iso) return "—";
  const { t, ap } = hourParts(iso, true);
  return `${t} ${ap}`;
};
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: LA });

/* ── shared chart scaffolding ─────────────────────────────────────────────── */

/** y in % from the top, inside [top, bottom] of the plot box. */
const scaleY = (min: number, max: number, top: number, bottom: number) => (v: number) =>
  max === min ? (top + bottom) / 2 : bottom - ((v - min) / (max - min)) * (bottom - top);

function LinePath({ pts, className, dashed }: { pts: { x: number; y: number }[]; className: string; dashed?: boolean }) {
  if (pts.length < 2) return null;
  return (
    <polyline
      points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
      fill="none"
      className={className}
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
      strokeDasharray={dashed ? "5 5" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
}

const Card = ({ className, children, label }: { className?: string; children: React.ReactNode; label?: React.ReactNode }) => (
  <section
    className={cn(
      "rounded-[1.25rem] border border-white/[0.08] bg-[#0b0e14] p-4 sm:p-5",
      // NOT bento:bg-white. Under .admin-bento the theme redefines Tailwind's white as
      // ink (--tw-white: 17 17 20) so that text-white/60 becomes ink at 60% with no
      // per-page work - which means bento:bg-white paints a near-BLACK card. That is
      // what left these panels dark while their bento:text-[#17151c] labels turned
      // dark too: dark text on a dark card. The surface token is the safe way to say
      // "the light theme's card".
      "bento:border-[#e6e4de] bento:bg-[var(--bento-card)]",
      className,
    )}
  >
    {label && (
      <h3 className="mb-3 flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-white/45 bento:text-[#8a8792]">
        {label}
      </h3>
    )}
    {children}
  </section>
);

/* ── now ─────────────────────────────────────────────────────────────────── */

function NowCard({ data, place }: { data: WxData; place: string }) {
  const c = data.current;
  const code = c.conditionCode ?? "Clear";
  const feels = toF(c.temperatureApparent), temp = toF(c.temperature);
  return (
    <section
      className={cn(
        "flex flex-col justify-between rounded-[1.25rem] border border-white/15 p-5 text-center",
        "bg-[linear-gradient(135deg,#5b6b8c_0%,#2c3a57_55%,#1d2740_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
        "bento:border-[#d9dde6] bento:bg-[linear-gradient(135deg,#eef2f9_0%,#dfe6f2_100%)]",
      )}
    >
      <p className="text-lg font-semibold text-white/80 bento:text-[#33313a]">{place}</p>
      <div className="my-2 flex items-center justify-center gap-3">
        <WeatherGlyph code={code} day={c.daylight !== false} className="h-20 w-20 shrink-0 drop-shadow" />
        <div className="text-left">
          <p className="text-[4rem] font-bold leading-none tracking-tight tabular-nums text-white bento:text-[#17151c]">
            {temp}
            <span className="align-top text-2xl font-medium">&deg;</span>
          </p>
          <p className="mt-1 text-sm font-medium text-white/75 bento:text-[#55525c]">{words(code)}</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 border-t border-white/15 pt-3 text-white bento:border-[#cfd5e0] bento:text-[#17151c]">
        <Stat icon={<Droplet className="h-3.5 w-3.5" />} label="Humidity" value={c.humidity != null ? `${Math.round(c.humidity * 100)}%` : "—"} />
        <Stat icon={<Wind className="h-3.5 w-3.5" />} label="Wind" value={mph(c.windSpeed) != null ? `${mph(c.windSpeed)} mph ${compass(c.windDirection)}` : "—"} />
        <Stat icon={<Sun className="h-3.5 w-3.5" />} label="Feels" value={feels != null ? `${feels}°` : "—"} />
      </div>
    </section>
  );
}
const Stat = ({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) => (
  <div>
    <p className="flex items-center justify-center gap-1 text-[0.7rem] text-white/55 bento:text-[#6b6874]">{icon}{label}</p>
    <p className="mt-0.5 whitespace-nowrap text-base font-semibold tabular-nums">{value}</p>
  </div>
);

/* ── hourly ──────────────────────────────────────────────────────────────── */

type HourPt = { at: string; temp: number; code: string; day: boolean; sun?: "rise" | "set" };

function hourlyPoints(data: WxData, count = 10): HourPt[] {
  const start = Date.now() - 30 * 60 * 1000;
  const hrs = data.hours.filter((h) => new Date(h.forecastStart).getTime() >= start).slice(0, count);
  if (!hrs.length) return [];
  const pts: HourPt[] = hrs.map((h) => ({ at: h.forecastStart, temp: h.temperature, code: h.conditionCode, day: h.daylight !== false }));
  // Slot the sunrise / sunset that falls inside the window between its two hours.
  const t0 = new Date(pts[0].at).getTime(), t1 = new Date(pts[pts.length - 1].at).getTime();
  const events = data.days.flatMap((d) => [
    d.sunrise ? { at: d.sunrise, kind: "rise" as const } : null,
    d.sunset ? { at: d.sunset, kind: "set" as const } : null,
  ]).filter((e): e is { at: string; kind: "rise" | "set" } => !!e)
    .filter((e) => { const t = new Date(e.at).getTime(); return t > t0 && t < t1; });
  for (const e of events) {
    const t = new Date(e.at).getTime();
    const i = pts.findIndex((p) => new Date(p.at).getTime() > t);
    if (i <= 0) continue;
    const a = pts[i - 1], b = pts[i];
    const f = (t - new Date(a.at).getTime()) / (new Date(b.at).getTime() - new Date(a.at).getTime());
    pts.splice(i, 0, { at: e.at, temp: a.temp + (b.temp - a.temp) * f, code: "Clear", day: e.kind === "rise", sun: e.kind });
  }
  return pts;
}

function SunEventIcon({ kind }: { kind: "rise" | "set" }) {
  const I = kind === "rise" ? Sunrise : Sunset;
  return <I className="h-8 w-8 text-amber-300" aria-label={kind === "rise" ? "Sunrise" : "Sunset"} />;
}

function HourlyCard({ data }: { data: WxData }) {
  const pts = useMemo(() => hourlyPoints(data), [data]);
  if (!pts.length) return null;
  const temps = pts.map((p) => toF(p.temp)!);
  const y = scaleY(Math.min(...temps), Math.max(...temps), 30, 62);
  const n = pts.length;
  const xy = pts.map((p, i) => ({ x: ((i + 0.5) / n) * 100, y: y(toF(p.temp)!) }));
  return (
    <Card label={<><Clock className="h-3 w-3" /> Hourly forecast</>} className="flex min-w-0 flex-col">
      <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      <div className="relative h-44 min-w-[560px]">
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <LinePath pts={xy} className="stroke-white/25 bento:stroke-[#c9c6cf]" dashed />
        </svg>
        {pts.map((p, i) => {
          const { t, ap } = hourParts(p.at, !!p.sun);
          const accent = !!p.sun;
          return (
            <div key={p.at + i} className="absolute inset-y-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${xy[i].x}%`, width: `${100 / n}%` }}>
              <div className="absolute flex -translate-y-[calc(100%+18px)] flex-col items-center" style={{ top: `${xy[i].y}%` }}>
                <span className={cn("mb-0.5 text-[0.95rem] font-semibold tabular-nums", accent ? "text-amber-300" : "text-white bento:text-[#17151c]")}>
                  {temps[i]}&deg;
                </span>
              </div>
              <div className="absolute -translate-y-1/2" style={{ top: `${xy[i].y}%` }}>
                {p.sun ? <SunEventIcon kind={p.sun} /> : <WeatherGlyph code={p.code} day={p.day} className="h-11 w-11" />}
              </div>
              <span className={cn("absolute bottom-0 whitespace-nowrap text-[0.8rem] font-semibold tabular-nums",
                i === 0 ? "text-white bento:text-[#17151c]" : "text-white/55 bento:text-[#6b6874]", accent && "text-amber-300")}>
                {i === 0 && !p.sun ? "Now" : <>{t}<span className="text-[0.6rem]">{p.sun ? "" : ap}</span></>}
              </span>
            </div>
          );
        })}
      </div>
      </div>
    </Card>
  );
}

/* ── ten days + the selected day ─────────────────────────────────────────── */

function DailyChart({ days, sel, onSel }: { days: WxDay[]; sel: number; onSel: (i: number) => void }) {
  const hi = days.map((d) => toF(d.temperatureMax)!), lo = days.map((d) => toF(d.temperatureMin)!);
  const y = scaleY(Math.min(...lo), Math.max(...hi), 18, 72);
  const n = days.length;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const hiPts = hi.map((v, i) => ({ x: x(i), y: y(v) })), loPts = lo.map((v, i) => ({ x: x(i), y: y(v) }));
  const rain = days.map((d) => d.precipitationChance ?? 0);
  const today = dayKey(new Date().toISOString());
  // precipitation chance as a soft area along the floor, 0-100% -> 0-9% of the height
  const area = `0,100 ${rain.map((r, i) => `${x(i)},${100 - r * 9}`).join(" ")} 100,100`;
  return (
    <div className="relative h-72 min-w-0 select-none">
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {rain.some((r) => r > 0) && <polygon points={area} className="fill-sky-400/60" />}
        <LinePath pts={hiPts} className="stroke-amber-300" dashed />
        <LinePath pts={loPts} className="stroke-white/40 bento:stroke-[#9a97a2]" dashed />
      </svg>
      {days.map((d, i) => {
        const on = i === sel;
        const wd = dayKey(d.forecastStart) === today ? "Today"
          : new Date(d.forecastStart).toLocaleDateString("en-US", { timeZone: LA, weekday: "short" });
        return (
          <button
            key={d.forecastStart}
            type="button"
            onClick={() => onSel(i)}
            aria-pressed={on}
            aria-label={`${wd}: high ${hi[i]}°, low ${lo[i]}°, ${words(d.conditionCode)}`}
            className={cn(
              "absolute inset-y-0 rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-amber-300/70",
              on ? "bg-white/[0.07] bento:bg-[#f1efe9]" : "hover:bg-white/[0.03] bento:hover:bg-[#f7f6f2]",
            )}
            style={{ left: `${(i / n) * 100}%`, width: `${100 / n}%` }}
          >
            <span className="absolute left-1/2 -translate-x-1/2 -translate-y-[calc(100%+18px)] text-[0.95rem] font-semibold tabular-nums text-amber-300" style={{ top: `${y(hi[i])}%` }}>
              {hi[i]}&deg;
            </span>
            <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top: `${y(hi[i])}%` }}>
              <WeatherGlyph code={d.daytimeForecast?.conditionCode ?? d.conditionCode} day className="h-11 w-11" />
            </span>
            <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ top: `${y(lo[i])}%` }}>
              <WeatherGlyph code={d.overnightForecast?.conditionCode ?? d.conditionCode} day={false} className="h-10 w-10" />
            </span>
            <span className="absolute left-1/2 -translate-x-1/2 translate-y-[18px] text-[0.95rem] font-semibold tabular-nums text-white bento:text-[#17151c]" style={{ top: `${y(lo[i])}%` }}>
              {lo[i]}&deg;
            </span>
            <span className={cn("absolute bottom-2 left-1/2 -translate-x-1/2 text-[0.8rem] font-semibold",
              on ? "text-white bento:text-[#17151c]" : "text-white/55 bento:text-[#6b6874]")}>
              {wd}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DayDetail({ d }: { d: WxDay }) {
  const hi = toF(d.temperatureMax), lo = toF(d.temperatureMin);
  const chance = Math.round((d.precipitationChance ?? 0) * 100);
  const rain = inches(d.precipitationAmount);
  const date = new Date(d.forecastStart).toLocaleDateString("en-US", { timeZone: LA, weekday: "short", month: "short", day: "numeric" });
  const summary = `${words(d.daytimeForecast?.conditionCode ?? d.conditionCode)} with temperatures between ${lo}° and ${hi}°.` +
    (chance >= 10 ? ` ${chance}% chance of rain.` : "");
  const rows: [React.ReactNode, string, string][] = [
    [<Sunrise className="h-5 w-5 text-amber-300" />, "Sunrise", clock(d.sunrise)],
    [<Sunset className="h-5 w-5 text-orange-300" />, "Sunset", clock(d.sunset)],
    [<Sun className="h-5 w-5 text-amber-300" />, "Max UV", d.maxUvIndex != null ? String(d.maxUvIndex) : "—"],
    [<Wind className="h-5 w-5 text-white/60 bento:text-[#6b6874]" />, "Wind",
      mph(d.windSpeedAvg) != null ? `${mph(d.windSpeedAvg)} mph ${compass(d.daytimeForecast?.windDirection)}`.trim() : "—"],
    [<Droplets className="h-5 w-5 text-sky-400" />, "Rainfall", rain ? `${rain} in` : "None"],
    [<Droplet className="h-5 w-5 text-sky-300" />, "Humidity",
      d.daytimeForecast?.humidity != null ? `${Math.round(d.daytimeForecast.humidity * 100)}%` : "—"],
  ];
  return (
    <div className="min-w-0">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-white/45 bento:text-[#8a8792]">{date}</p>
      <p className="mt-2 text-[1.05rem] font-semibold leading-snug text-white bento:text-[#17151c]">{summary}</p>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
        {rows.map(([icon, label, value]) => (
          <div key={label} className="flex items-center gap-3">
            <span className="shrink-0">{icon}</span>
            <div>
              <dt className="text-xs text-white/50 bento:text-[#6b6874]">{label}</dt>
              <dd className="text-[0.95rem] font-semibold tabular-nums text-white bento:text-[#17151c]">{value}</dd>
            </div>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function WeatherBoard({ data, place }: { data: WxData; place: string }) {
  const [sel, setSel] = useState(0);
  const days = data.days.slice(0, 10);
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <NowCard data={data} place={place} />
        <HourlyCard data={data} />
      </div>
      {days.length > 0 && (
        <Card className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <h3 className="mb-3 flex items-center justify-between text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-white/45 bento:text-[#8a8792]">
              <span className="flex items-center gap-1.5"><CalendarDays className="h-3 w-3" /> 10-day forecast</span>
              <span className="flex items-center gap-3 normal-case tracking-normal">
                <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 rounded bg-amber-300" /> High</span>
                <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-3 rounded bg-white/50 bento:bg-[#9a97a2]" /> Low</span>
                {days.some((d) => (d.precipitationChance ?? 0) > 0) && (
                  <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm bg-sky-400/60" /> Rain chance</span>
                )}
              </span>
            </h3>
            <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]"><div className="min-w-[540px]"><DailyChart days={days} sel={Math.min(sel, days.length - 1)} onSel={setSel} /></div></div>
          </div>
          <DayDetail d={days[Math.min(sel, days.length - 1)]} />
        </Card>
      )}
      <p className="text-right text-xs text-white/40 bento:text-[#8a8792]">
        <a href={data.attribution} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">&#63743;&nbsp;Weather</a>
      </p>
    </div>
  );
}

/**
 * Weather on the Command Center (rebuilt 2026-10-20, chart redone 2026-10-21 to match the approved v2 preview).
 * Apple WeatherKit through weatherkit-proxy, with your calendars and Turo pickups/returns drawn on it the way the projection
 * wall draws them.
 *
 *   Headline + alerts (worst first) + chips that only appear when they matter (UV, air quality, rain). The rain headline, the
 *   rain chip and the chart's "% rain" label all read ONE peak (rainPeak in lib/commandCenter), so they cannot disagree.
 *   Now row: the current temperature once (no repeat in the headline area), with Feels / Rain / Wind / UV that follow the scrub.
 *   Hourly: next 24 hours you can scrub by finger, mouse or arrow keys. Smooth temperature curve with a feathered fill, night
 *   shading, the day's high and low called out, a temperature every few hours, and rain as a soft blue hill whose height AND
 *   opacity grow with the chance (hidden when every hour is under 10%).
 *   Calendar items: each event is an indigo capsule with end dots across its hours and its name under the bar; overlapping events
 *   share ONE capsule with names joined by " · ". Turo Pickup (hour before) and Return (hour after) come from the wall; home
 *   pickups are redrawn as the hour starting at pickup, and every Turo label reads the real reservation time (evAt), never the
 *   bar's edge (2026-10-27: a 9:00 AM home pickup read "8:00 AM").
 *   Night shading is labelled: a sunset / sunrise tick with its time where the shade starts and ends.
 *   Next 5 days with each day's events as a compact agenda.
 *
 * No ellipsis, no hard-coded dark (white/black utilities + bento variants), unique SVG ids (useId), Lucide icons only.
 * US units, 12-hour times. Reduced motion jumps instead of gliding.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, MapPin, Moon, Sun, Sunrise, Sunset, TriangleAlert, Wind } from "lucide-react";
import { cn } from "@/lib/utils";
import { Disclosure, LoadError, Pill, cardCls, focusRing, hairline, inset, text } from "@/components/admin/ui";
import {
  HOME, TZ, agendaByDay, chips, clusterEvents, dayShort, evAt, eventsAt, headline, hour12, loadWxEvents, normalizeWxEvents, ptDateKey, rainPeak, stamp, time12, useLive,
  type Cluster, type Live, type Wx, type WxAlert, type WxEvent, type WxHour,
} from "@/lib/commandCenter";

/* ───────── icons ───────── */

export function CondIcon({ code, daylight = true, className }: { code: string; daylight?: boolean; className?: string }) {
  const c = code.toLowerCase();
  const cls = cn("shrink-0", className);
  if (/thunder|lightning/.test(c)) return <CloudLightning className={cls} aria-hidden />;
  if (/snow|flurr|sleet|blizzard|hail|freezing/.test(c)) return <CloudSnow className={cls} aria-hidden />;
  if (/drizzle/.test(c)) return <CloudDrizzle className={cls} aria-hidden />;
  if (/rain|shower/.test(c)) return <CloudRain className={cls} aria-hidden />;
  if (/fog|haze|smok|dust/.test(c)) return <CloudFog className={cls} aria-hidden />;
  if (/wind|breez/.test(c)) return <Wind className={cls} aria-hidden />;
  if (/partly|mostlyclear/.test(c)) return daylight ? <CloudSun className={cls} aria-hidden /> : <CloudMoon className={cls} aria-hidden />;
  if (/cloud|overcast/.test(c)) return <Cloud className={cls} aria-hidden />;
  return daylight ? <Sun className={cls} aria-hidden /> : <Moon className={cls} aria-hidden />;
}

const F = (n: number) => Math.round(n);

/** "69 °F" that never wraps apart. */
export const Deg = ({ v, className }: { v: number; className?: string }) => (
  <span className={cn("whitespace-nowrap tabular-nums", className)}>{F(v)}&nbsp;°F</span>
);

/* ───────── colours (both themes) ───────── */

/** Chart tokens: set once on the chart wrapper, light theme swaps them. Gradients read them with var(). */
const WX_VARS = cn(
  "[--wx-ind:#7A8BE0] [--wx-blue:#0A84FF] [--wx-rain:#5AC8FA] [--wx-night:#2C3B8F] [--wx-nop:1] [--wx-wash:20%]",
  "bento:[--wx-ind:#3A4A9C] bento:[--wx-blue:#0A6CF0] bento:[--wx-rain:#0A84FF] bento:[--wx-night:#3A4A9C] bento:[--wx-nop:0.3] bento:[--wx-wash:11%]",
);
const CAL_BAR = "bg-[#7A8BE0] bento:bg-[#4C5DB8]";
const TURO_BAR = "bg-[#30D158] bento:bg-[#248A3D]";
const CAL_TEXT = "text-[#AAB6F5] bento:text-[#3A4A9C]";
const TURO_TEXT = "text-[#30D158] bento:text-[#248A3D]";
const RING = "ring-2 ring-[#1c1c1e] bento:ring-[#ffffff]";

const SEV_TONE: Record<WxAlert["severity"], "red" | "orange" | "blue" | "neutral"> = { extreme: "red", severe: "red", moderate: "orange", minor: "blue", unknown: "neutral" };
const SEV_WORD: Record<WxAlert["severity"], string> = { extreme: "Extreme", severe: "Severe", moderate: "Moderate", minor: "Minor", unknown: "Advisory" };

function untilText(ms: number | null): string {
  if (!ms) return "";
  const same = ptDateKey(ms) === ptDateKey(Date.now());
  return `Until ${same ? "" : dayShort(ms) + " "}${time12(ms)}`;
}

/* ───────── helpers ───────── */

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const PAD = 16;   // px of breathing room at each end of the timeline
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ptHour = (t: number) => Number(new Date(t).toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: TZ }));

/** Smooth path through points (Catmull-Rom to cubic Bezier), the same curve as the approved preview. */
function smooth(pts: readonly (readonly [number, number])[]): string {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[k - 1] ?? pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(360);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || 360);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 360));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const evKind = (c: Cluster): "turo" | "cal" => (c.events.every((e) => e.source === "turo") ? "turo" : "cal");

/* chart geometry: the SVG viewBox height equals the chart's pixel height, so y values are pixels */
const CH = 184;          // chart height
const VB = 1000;         // viewBox width (stretched to the card)
const T_TOP = 34;        // temperature band: top
const T_H = 70;          // temperature band: height
const R_H = 56;          // rain hill height at 100%
const R_BASE = CH - 2;   // rain baseline

/* ───────── the scrubbable hour timeline ───────── */

function HourScrub({ hours, events, suns }: { hours: WxHour[]; events: WxEvent[]; suns: Wx["suns"] }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const n = hours.length;
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  const raf = useRef<number | null>(null);
  const drag = useRef<{ id: number; x0: number; y0: number; on: boolean } | null>(null);
  const [wrapRef, W] = useWidth<HTMLDivElement>();

  const set = useCallback((p: number) => { posRef.current = p; setPos(p); }, []);
  const stop = () => { if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };
  /** Critically damped glide to a target (interruptible: any new input cancels it). Reduced motion jumps. */
  const goal = useRef(0);   // where the current glide is heading, so fast key repeats stack instead of restarting
  const glide = useCallback((target: number) => {
    stop();
    goal.current = target;
    if (reduced()) { set(target); return; }
    const step = () => {
      const d = target - posRef.current;
      if (Math.abs(d) < 0.004) { set(target); raf.current = null; return; }
      set(posRef.current + d * 0.28);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [set]);
  useEffect(() => () => stop(), []);

  const t0 = hours[0].t;
  const tN = hours[n - 1].t;
  const span = Math.max(1, tN - t0);
  const fx = (t: number) => Math.min(1, Math.max(0, (t - t0) / span));
  const px = (f: number) => PAD + (W - PAD * 2) * f;
  const xp = (i: number) => (i / (n - 1)) * 100;   // percent across the chart

  /* temperature curve */
  const temps = hours.map((h) => h.tempF);
  const tmax = Math.max(...temps);
  const tmin = Math.min(...temps);
  const mid = (tmax + tmin) / 2;
  const range = Math.max(8, tmax - tmin);
  const yOf = (t: number) => T_TOP + T_H / 2 - ((t - mid) / range) * T_H;
  const pts = hours.map((h, i) => [(i / (n - 1)) * VB, yOf(h.tempF)] as const);
  const line = smooth(pts);
  const area = `${line}L${VB} ${CH}L0 ${CH}Z`;
  const hiI = temps.indexOf(tmax);
  const loI = temps.indexOf(tmin);

  /* rain: slim rounded columns, one per hour; height AND opacity follow the chance. Hidden when every hour is under 10%. */
  const maxRain = Math.max(...hours.map((h) => h.rain));
  const showRain = maxRain >= 10;
  const peak = rainPeak(hours);
  const colW = clamp(((W - PAD * 2) / (n - 1)) * 0.42, 4, 12);              // slim: well under half the gap between hours
  const colH = (pct: number) => Math.max(4, (pct / 100) * R_H);
  // where it first crosses 50% (only labelled when it is not next to the peak, so labels never collide)
  const crossI = hours.findIndex((h, i) => h.rain >= 50 && (i === 0 || hours[i - 1].rain < 50));
  const showCross = showRain && crossI >= 0 && peak != null && Math.abs(crossI - peak.i) >= 3;

  /* hour axis: clock-aligned ticks (every 3 hours when there is room, else 6); "Now" first; midnight reads as the day */
  const stepPx = ((W - PAD * 2) / (n - 1)) * 3;
  const every = stepPx >= 44 ? 3 : stepPx >= 36 ? 4 : 6;
  const minGap = Math.ceil(48 / (stepPx / 3));   // keep clock labels clear of the "Now" label
  const ticks = hours
    .map((h, i) => ({ h, i, hr: ptHour(h.t) }))
    .filter(({ i, hr }) => i >= minGap && hr % every === 0);

  /* what is under the finger */
  const i0 = Math.min(n - 2, Math.max(0, Math.floor(pos)));
  const fr = Math.min(1, Math.max(0, pos - i0));
  const a = hours[i0];
  const b = hours[i0 + 1];
  const tempAt = lerp(a.tempF, b.tempF, fr);
  const feelsAt = lerp(a.feelsF, b.feelsF, fr);
  const rainAt = Math.round(lerp(a.rain, b.rain, fr));
  const windAt = lerp(a.windMph, b.windMph, fr);
  const uvAt = Math.round(lerp(a.uv, b.uv, fr));
  const near = hours[Math.round(pos)] ?? a;
  const hereEvents = eventsAt(events, near.t);
  const label = Math.round(pos) === 0 && Date.now() - near.t < 36e5 ? "Now" : `${dayShort(near.t)} ${time12(near.t)}`;
  const mostAtOnce = useMemo(() => hours.reduce((m, h) => Math.max(m, eventsAt(events, h.t).length), 0), [hours, events]);

  // capsules, then name labels placed on rows so none overlap (no cut-off stacks)
  const clusters = useMemo(() => clusterEvents(events, t0, tN + 36e5), [events, t0, tN]);
  const laid = useMemo(() => {
    const rowEnd: number[] = [];
    return clusters.map((c) => {
      const f1 = fx(c.start);
      const f2 = Math.max(f1, fx(c.end));
      const title = c.titles.join(" · ");
      const wLab = Math.min(Math.max(96, title.length * 6.4 + 6), Math.min(240, W - PAD * 2));
      let left = px(f1) - 4;
      left = Math.max(PAD / 2, Math.min(left, W - wLab - PAD / 2));
      let row = rowEnd.findIndex((e) => e + 8 <= left);
      if (row < 0) row = rowEnd.length;
      rowEnd[row] = left + wLab;
      return { c, f1, f2, title, wLab, left, row };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, W, t0, tN]);
  const rows = laid.reduce((m, l) => Math.max(m, l.row + 1), 0);
  /* sunset / sunrise ticks: say what the night shade is, at the edge where it starts or ends */
  const sunMarks = (suns ?? []).filter((s) => s.t > t0 && s.t < tN);
  const laneH = laid.length ? 22 + rows * 36 : 0;

  const fromEvent = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left - PAD) / Math.max(1, r.width - PAD * 2)));
    return f * (n - 1);
  };
  const onDown = (e: React.PointerEvent) => {
    stop();
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, on: e.pointerType === "mouse" };
    if (e.pointerType === "mouse") { wrapRef.current?.setPointerCapture(e.pointerId); set(fromEvent(e)); }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.on) {
      // touch/pen: commit to scrubbing only after ~10px sideways, so vertical scrolling still works
      if (Math.abs(e.clientX - d.x0) < 10 || Math.abs(e.clientY - d.y0) > Math.abs(e.clientX - d.x0)) return;
      d.on = true;
      wrapRef.current?.setPointerCapture(e.pointerId);
    }
    set(fromEvent(e));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.on) { glide(Math.round(fromEvent(e))); return; }   // a tap: go to that hour
    glide(Math.round(posRef.current));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const cur = raf.current != null ? goal.current : Math.round(posRef.current);
    const to = e.key === "ArrowRight" || e.key === "ArrowUp" ? cur + 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? cur - 1
      : e.key === "PageUp" ? cur + 6 : e.key === "PageDown" ? cur - 6 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to == null) return;
    e.preventDefault();
    glide(Math.min(n - 1, Math.max(0, to)));
  };

  const readout = `${label}, ${F(tempAt)} degrees, ${rainAt} percent chance of rain, ${near.cond}${hereEvents.length ? ", " + hereEvents.map((x) => x.title).join(", ") : ""}`;
  const tagCls = "pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold leading-none tabular-nums";
  const facts: [string, string][] = [
    ["Feels", `${F(feelsAt)}\u00a0°F`],
    ["Rain", `${rainAt}%`],
    ["Wind", `${F(windAt)}\u00a0mph`],
    ["UV", String(uvAt)],
  ];
  // room for the events a scrub can land on, so moving across the chart never shifts the page
  const evRoom = Math.min(2, mostAtOnce) * (W < 480 ? 40 : 22);

  return (
    <div className={WX_VARS}>
      {/* readout: reserved height so scrubbing never shifts the page */}
      <div className="px-1 pb-3" style={{ minHeight: 76 + evRoom }} aria-hidden data-testid="scrub-readout">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <CondIcon code={near.code} daylight={near.daylight} className="h-11 w-11 stroke-[1.5] text-white/90" />
          <div>
            <p className="whitespace-nowrap text-[13px] font-semibold uppercase tracking-wide text-white/60">{label}</p>
            <p className="flex items-baseline gap-2.5 text-white">
              <Deg v={tempAt} className="text-[34px] font-bold leading-[1.1] tracking-tight" />
              <span className="text-[16px] font-medium text-white/65">{near.cond}</span>
            </p>
          </div>
          <dl className="grid w-full grid-cols-4 gap-x-3 sm:ml-auto sm:flex sm:w-auto sm:gap-x-6">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0 sm:min-w-[3rem]">
                <dt className="text-[12px] leading-tight text-white/60">{k}</dt>
                <dd className="whitespace-nowrap text-[16px] font-semibold tabular-nums leading-tight text-white">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        {hereEvents.length > 0 && (
          <ul className="mt-2 space-y-0.5" data-testid="scrub-events">
            {hereEvents.map((e, i) => (
              <li key={i} className={cn("text-[14px] font-medium leading-snug", e.source === "turo" ? TURO_TEXT : CAL_TEXT)}>
                {e.title}
                <span className="font-normal text-white/60"> · <span className="whitespace-nowrap">
                  {e.source === "turo" ? time12(evAt(e)) : `${time12(e.start)} to ${time12(e.end)}`}
                </span></span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        ref={wrapRef}
        role="slider"
        tabIndex={0}
        aria-label="Hourly forecast. Use the left and right arrow keys to move through the next 24 hours."
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={readout}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { drag.current = null; glide(Math.round(posRef.current)); }}
        onKeyDown={onKey}
        className={cn("relative select-none rounded-xl [touch-action:pan-y]", focusRing)}
        style={{ cursor: "ew-resize" }}
        data-testid="hour-scrub"
      >
        {/* event lane: capsule bar with end dots, name under the bar */}
        {laid.length > 0 && (
          <div className="relative" style={{ height: laneH }} data-testid="event-lane">
            {laid.map((l, i) => {
              const kind = evKind(l.c);
              const bar = kind === "turo" ? TURO_BAR : CAL_BAR;
              const left = px(l.f1);
              const width = Math.max(10, px(l.f2) - px(l.f1));
              return (
                <div key={i}>
                  <div className={cn("absolute top-[6px] h-2 rounded-full opacity-90", bar)} style={{ left, width }} data-testid="event-capsule" data-names={l.title}>
                    <span className={cn("absolute -left-[3px] -top-[2px] h-3 w-3 rounded-full", RING, bar)} />
                    {width > 14 && <span className={cn("absolute -right-[3px] -top-[2px] h-3 w-3 rounded-full", RING, bar)} />}
                  </div>
                  <p className={cn("absolute text-[12px] font-medium leading-tight", kind === "turo" ? TURO_TEXT : CAL_TEXT)}
                    style={{ left: l.left, width: l.wLab, top: 22 + l.row * 36 }}>
                    {l.title}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* temperature curve, night shading, rain hill, callouts */}
        <div className="relative" style={{ height: CH, marginLeft: PAD, marginRight: PAD }} data-testid="wx-chart">
          {/* faint column behind each event's hours, feathered on every side (the wall's wash) */}
          {laid.map((l, i) => (
            <span key={i} aria-hidden className="pointer-events-none absolute inset-y-0 min-w-[10px]"
              style={{
                left: `${l.f1 * 100}%`, width: `${(l.f2 - l.f1) * 100}%`,
                background: "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--wx-ind) var(--wx-wash), transparent) 30%, color-mix(in srgb, var(--wx-ind) var(--wx-wash), transparent) 70%, transparent)",
                WebkitMaskImage: "linear-gradient(to right, transparent, #000 22%, #000 78%, transparent)",
                maskImage: "linear-gradient(to right, transparent, #000 22%, #000 78%, transparent)",
              }} />
          ))}
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VB} ${CH}`} preserveAspectRatio="none" aria-hidden data-testid="wx-svg">
            <defs>
              <linearGradient id={`night${uid}`} gradientUnits="userSpaceOnUse" x1="0" x2={VB} y1="0" y2="0">
                {hours.map((h, i) => <stop key={i} offset={i / (n - 1)} style={{ stopColor: "var(--wx-night)", stopOpacity: h.daylight ? 0 : 0.34 }} />)}
              </linearGradient>
              <linearGradient id={`line${uid}`} gradientUnits="userSpaceOnUse" x1="0" x2={VB} y1="0" y2="0">
                <stop offset="0" style={{ stopColor: "var(--wx-ind)" }} />
                <stop offset="0.5" style={{ stopColor: "var(--wx-blue)" }} />
                <stop offset="1" style={{ stopColor: "var(--wx-ind)" }} />
              </linearGradient>
              <linearGradient id={`area${uid}`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={T_TOP} y2={CH}>
                <stop offset="0" style={{ stopColor: "var(--wx-ind)", stopOpacity: 0.28 }} />
                <stop offset="0.6" style={{ stopColor: "var(--wx-ind)", stopOpacity: 0.05 }} />
                <stop offset="1" style={{ stopColor: "var(--wx-ind)", stopOpacity: 0 }} />
              </linearGradient>
              {/* soft left and right ends for every fill */}
              <linearGradient id={`fade${uid}`} gradientUnits="userSpaceOnUse" x1="0" x2={VB} y1="0" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.05" stopColor="#fff" stopOpacity="1" />
                <stop offset="0.95" stopColor="#fff" stopOpacity="1" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <mask id={`mask${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width={VB} height={CH}>
                <rect width={VB} height={CH} fill={`url(#fade${uid})`} />
              </mask>
            </defs>
            <g mask={`url(#mask${uid})`}>
              <rect width={VB} height={CH} fill={`url(#night${uid})`} style={{ opacity: "var(--wx-nop)" } as React.CSSProperties} />
              <path d={area} fill={`url(#area${uid})`} />
            </g>
            <path d={line} fill="none" stroke={`url(#line${uid})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>

          {/* rain columns: soft blue, richer with the chance, top edge feathered away, never blobs */}
          {showRain && hours.map((h, i) => h.rain >= 10 && (
            <span key={i} aria-hidden data-testid="rain-col" className="pointer-events-none absolute -translate-x-1/2 rounded-full"
              style={{
                left: `${xp(i)}%`, width: colW, height: colH(h.rain), bottom: CH - R_BASE,
                opacity: 0.4 + 0.6 * (h.rain / 100),
                background: "linear-gradient(to top, color-mix(in srgb, var(--wx-rain) 90%, transparent), color-mix(in srgb, var(--wx-rain) 6%, transparent))",
              }} />
          ))}

          {/* callouts: the high, the low, a temperature every few hours, and the rain peak */}
          <span className={cn(tagCls, "text-white")} style={{ left: `${clamp(xp(hiI), 5, 95)}%`, top: yOf(tmax) - 24 }} aria-hidden data-testid="wx-hi">{F(tmax)}°</span>
          {loI !== hiI && (
            <span className={cn(tagCls, "text-white/75")} style={{ left: `${clamp(xp(loI), 5, 95)}%`, top: yOf(tmin) + 12 }} aria-hidden data-testid="wx-lo">{F(tmin)}°</span>
          )}
          {ticks.filter(({ i }) => Math.abs(i - hiI) > 2 && i < n - 1).map(({ h, i }) => (
            <span key={i} className={cn(tagCls, "font-medium text-white/60")} style={{ left: `${xp(i)}%`, top: yOf(h.tempF) - 22 }} aria-hidden>{F(h.tempF)}°</span>
          ))}
          {showRain && peak && peak.pct >= 10 && (
            <span className={cn(tagCls, "text-[#64D2FF] bento:text-[#0A6CF0]")} style={{ left: `${clamp(xp(peak.i), 8, 92)}%`, top: R_BASE - colH(peak.pct) - 20 }} aria-hidden data-testid="wx-rain-peak">
              {peak.pct}%&nbsp;rain
            </span>
          )}
          {showCross && (
            <span className={cn(tagCls, "font-medium text-[#64D2FF]/80 bento:text-[#0A6CF0]")} style={{ left: `${xp(crossI)}%`, top: R_BASE - colH(hours[crossI].rain) - 20 }} aria-hidden data-testid="wx-rain-cross">
              {hours[crossI].rain}%
            </span>
          )}

          {/* sunset / sunrise: a feathered hairline at the edge of the night shade and its time along the bottom */}
          {sunMarks.map((s) => {
            const f = fx(s.t);
            const Icon = s.kind === "sunset" ? Sunset : Sunrise;
            return (
              <span key={s.t} aria-hidden data-testid="wx-sun">
                <span className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2" style={{
                  left: `${f * 100}%`,
                  background: "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--wx-ind) 55%, transparent) 35%, color-mix(in srgb, var(--wx-ind) 55%, transparent) 85%, transparent)",
                }} />
                <span className={cn(tagCls, "bottom-1 flex items-center gap-1 font-medium text-white/60")} style={{ left: `${clamp(f * 100, 9, 91)}%` }}>
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {s.kind === "sunset" ? "Sunset" : "Sunrise"}&nbsp;{time12(s.t)}
                </span>
              </span>
            );
          })}

          {/* scrub hairline: feathered at both ends, plus a soft dot on the curve */}
          <span className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2" style={{
            left: `${(pos / (n - 1)) * 100}%`,
            background: "linear-gradient(to bottom, transparent, rgba(128,128,128,0.7) 22%, rgba(128,128,128,0.7) 78%, transparent)",
          }} />
          <span className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
            style={{
              left: `${(pos / (n - 1)) * 100}%`, top: yOf(tempAt),
              boxShadow: "0 0 0 5px color-mix(in srgb, var(--wx-ind) 28%, transparent), 0 0 20px color-mix(in srgb, var(--wx-ind) 65%, transparent)",
            }} />
        </div>

        {/* hour axis: "Now" first, then the clock hours, midnight as the day */}
        <div className="relative h-6" aria-hidden data-testid="wx-axis">
          <span className="absolute top-1 -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold text-white" style={{ left: px(0) }}>Now</span>
          {ticks.map(({ h, i, hr }) => (
            <span key={i} className={cn("absolute top-1 -translate-x-1/2 whitespace-nowrap text-[12px] tabular-nums", hr === 0 ? "font-semibold text-white" : "text-white/60")} style={{ left: px(i / (n - 1)) }}>
              {hr === 0 ? dayShort(h.t) : hour12(h.t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────── the card ───────── */

export function WeatherCard({ wxs }: { wxs: Live<Wx> }) {
  const evs = useLive(loadWxEvents, 5 * 60_000);
  const [allAlerts, setAllAlerts] = useState(false);
  const wx = wxs.data;

  // the first hour is "right now": use the live reading so the curve starts on the temperature people just saw
  const hours = useMemo<WxHour[]>(() => {
    if (!wx) return [];
    return wx.hours.map((h, i) => i === 0
      ? { ...h, tempF: wx.now.tempF, feelsF: wx.now.feelsF, windMph: wx.now.windMph, uv: wx.now.uv, cond: wx.now.cond, code: wx.now.code }
      : h);
  }, [wx]);

  if (!wx) {
    return (
      <section aria-label="Weather" className={cn(cardCls, "p-4 sm:p-6")} aria-busy={wxs.loading}>
        {wxs.loading ? (
          <div className="space-y-3" aria-hidden>
            <div className="h-6 w-2/3 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-40 animate-pulse rounded-xl bg-white/[0.04]" />
          </div>
        ) : (
          <LoadError label="the weather" onRetry={() => wxs.reload()} busy={wxs.busy} detail={wxs.error} />
        )}
      </section>
    );
  }

  const events = normalizeWxEvents((evs.data?.events ?? []) as WxEvent[]);
  const st = stamp(wx.readAt, 45);
  const evSt = evs.data ? stamp(evs.data.calendar_at ?? evs.data.updated_at, 30) : null;
  const chipList = chips(wx);
  const alerts = allAlerts ? wx.alerts : wx.alerts.slice(0, 3);
  const agenda = agendaByDay(events);

  return (
    <section aria-label="Weather" className={cn(cardCls, "overflow-hidden")}>
      <div className={cn("space-y-4 py-4 sm:py-6", inset)}>
        {/* headline */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-white/60">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />{HOME.name}
            </p>
            <h2 className="mt-1.5 text-[22px] font-semibold leading-snug tracking-tight text-white" data-testid="wx-headline">{headline(wx)}</h2>
          </div>
          <p className={cn("whitespace-nowrap text-[12px] tabular-nums", st.stale ? "text-[#FF9F0A] bento:text-[#C93400]" : "text-white/50")} data-testid="wx-updated">
            {st.text}
          </p>
        </div>

        {/* alerts, worst first */}
        {alerts.length > 0 && (
          <ul className="space-y-2" aria-label="Weather alerts" data-testid="wx-alerts">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 rounded-xl bg-[#FF9F0A1f] px-3 py-2.5 bento:bg-[#FF95001a]">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#FF9F0A] bento:text-[#C93400]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium leading-snug text-white">
                    <Pill tone={SEV_TONE[a.severity]}>{SEV_WORD[a.severity]}</Pill>
                    <span>{a.title}</span>
                  </p>
                  <p className="mt-0.5 text-[13px] text-white/60">{[untilText(a.until), a.area].filter(Boolean).join(" · ")}</p>
                </div>
              </li>
            ))}
            {wx.alerts.length > 3 && (
              <li><Disclosure variant="inline" open={allAlerts} onToggle={() => setAllAlerts((v) => !v)}>{allAlerts ? "Show fewer alerts" : `Show all ${wx.alerts.length} alerts`}</Disclosure></li>
            )}
          </ul>
        )}

        {/* chips: only when they matter */}
        {chipList.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Heads up" data-testid="wx-chips">
            {chipList.map((c) => <li key={c.id}><Pill tone={c.tone} className="px-2.5 py-1 text-[13px]">{c.label}</Pill></li>)}
          </ul>
        )}

        {/* hourly */}
        {hours.length >= 2 ? <HourScrub hours={hours} events={events} suns={wx.suns} /> : <p className={text.detail}>The hourly forecast is not available right now.</p>}

        {evs.error && !evs.data && <p className="text-[13px] text-white/60">Calendar items are not loading right now. The forecast above is unaffected.</p>}
        {evSt?.stale && <p className="text-[12px] text-[#FF9F0A] bento:text-[#C93400]">Calendar items: {evSt.text.toLowerCase()}</p>}
      </div>

      {/* 5 days, each with its agenda */}
      {wx.days.length > 0 && (
        <div className={cn("border-t", hairline)}>
          <h3 className={cn("pt-4 text-[13px] font-semibold uppercase tracking-[0.02em] text-white/60", inset)}>Next 5 days</h3>
          <ul className="mt-1 grid grid-cols-1 divide-y divide-white/[0.06] md:grid-cols-5 md:divide-x md:divide-y-0" data-testid="five-days">
            {wx.days.map((d, i) => {
              const key = ptDateKey(d.t + 6 * 36e5);
              const list = (agenda.get(key) ?? []).filter((e) => !e.all_day);
              return (
                <li key={d.t} className="flex gap-3 px-4 py-3 sm:px-6 md:flex-col md:gap-1.5 md:px-4 md:py-4">
                  <div className="flex w-24 shrink-0 items-center gap-2 md:w-auto md:justify-between">
                    <span className="text-[15px] font-semibold text-white">{i === 0 ? "Today" : dayShort(d.t + 6 * 36e5)}</span>
                    <CondIcon code={d.code} className="h-5 w-5 text-white/80" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] tabular-nums text-white">
                      <Deg v={d.hiF} className="font-semibold" />
                      <Deg v={d.loF} className="text-white/55" />
                      {d.rain >= 20 && <span className="whitespace-nowrap text-[13px] text-[#64D2FF] bento:text-[#007AFF]">Rain&nbsp;{d.rain}%</span>}
                    </p>
                    {list.length > 0 && (
                      <ul className="mt-1.5 space-y-1" aria-label="Events that day">
                        {list.map((e, j) => (
                          <li key={j} className={cn("text-[12px] leading-snug", e.source === "turo" ? TURO_TEXT : CAL_TEXT)}>
                            <span className="whitespace-nowrap tabular-nums text-white/60">{time12(evAt(e))}</span> {e.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

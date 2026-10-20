/**
 * Weather on the Command Center (rebuilt 2026-10-20). Apple WeatherKit through weatherkit-proxy, with your calendars and
 * Turo pickups/returns drawn on it the way the projection wall draws them.
 *
 *   Headline + alerts (worst first) + chips that only appear when they matter (UV, air quality, rain)
 *   Hourly: next 24 hours you can scrub by finger, mouse or arrow keys. Each event is a capsule with end dots across its
 *   hours and its name under the bar; overlapping events share ONE capsule with names joined by " · ".
 *   Scrubbing onto an hour with an event shows it with the temperature and rain chance at that time.
 *   Next 5 days with each day's events as a compact agenda.
 *
 * Fixes the old WeatherNow bugs: no ellipsis, light theme colours (white/black utilities + bento variants, no hard-coded dark),
 * mounted once, unique SVG ids (useId), no private-use Apple glyph (Lucide icons only). US units, 12-hour times.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Sun, TriangleAlert, Wind } from "lucide-react";
import { cn } from "@/lib/utils";
import { Disclosure, LoadError, Pill, cardCls, focusRing, hairline, inset, text } from "@/components/admin/ui";
import {
  agendaByDay, chips, clusterEvents, dayShort, eventsAt, headline, hour12, loadWxEvents, ptDateKey, stamp, time12, useLive,
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

const LINE = "text-[#409CFF] bento:text-[#007AFF]";
const CAL_BAR = "bg-[#BF5AF2] bento:bg-[#AF52DE]";
const TURO_BAR = "bg-[#30D158] bento:bg-[#248A3D]";
const CAL_TEXT = "text-[#DA8FFF] bento:text-[#8944AB]";
const TURO_TEXT = "text-[#30D158] bento:text-[#248A3D]";
const RING = "ring-2 ring-[#1c1c1e] bento:ring-white";

const SEV_TONE: Record<WxAlert["severity"], "red" | "orange" | "blue" | "neutral"> = { extreme: "red", severe: "red", moderate: "orange", minor: "blue", unknown: "neutral" };
const SEV_WORD: Record<WxAlert["severity"], string> = { extreme: "Extreme", severe: "Severe", moderate: "Moderate", minor: "Minor", unknown: "Advisory" };

function untilText(ms: number | null): string {
  if (!ms) return "";
  const same = ptDateKey(ms) === ptDateKey(Date.now());
  return `Until ${same ? "" : dayShort(ms) + " "}${time12(ms)}`;
}

/* ───────── helpers ───────── */

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const PAD = 16;   // px of breathing room at each end of the timeline
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

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

/* ───────── the scrubbable hour timeline ───────── */

function HourScrub({ hours, events }: { hours: WxHour[]; events: WxEvent[] }) {
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
  const glide = useCallback((target: number) => {
    stop();
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

  // temperature curve, in a 0..100 box
  const temps = hours.map((h) => h.tempF);
  const lo = Math.min(...temps) - 3;
  const hi = Math.max(...temps) + 3;
  const yOf = (t: number) => 88 - ((t - lo) / Math.max(1, hi - lo)) * 66;
  const pts = hours.map((h, i) => [(i / (n - 1)) * 100, yOf(h.tempF)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L100 100 L0 100 Z`;

  // what is under the finger
  const i0 = Math.min(n - 2, Math.max(0, Math.floor(pos)));
  const fr = Math.min(1, Math.max(0, pos - i0));
  const a = hours[i0];
  const b = hours[i0 + 1];
  const tempAt = lerp(a.tempF, b.tempF, fr);
  const rainAt = Math.round(lerp(a.rain, b.rain, fr));
  const near = hours[Math.round(pos)] ?? a;
  const hereEvents = eventsAt(events, near.t);
  const label = Math.round(pos) === 0 && Date.now() - near.t < 36e5 ? "Now" : `${dayShort(near.t)} ${time12(near.t)}`;

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
    const cur = Math.round(posRef.current);
    const to = e.key === "ArrowRight" || e.key === "ArrowUp" ? cur + 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? cur - 1
      : e.key === "PageUp" ? cur + 6 : e.key === "PageDown" ? cur - 6 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to == null) return;
    e.preventDefault();
    glide(Math.min(n - 1, Math.max(0, to)));
  };

  const readout = `${label}, ${F(tempAt)} degrees, ${rainAt} percent chance of rain, ${near.cond}${hereEvents.length ? ", " + hereEvents.map((x) => x.title).join(", ") : ""}`;
  const ticks = hours.map((h, i) => ({ h, i })).filter(({ i }) => i % 3 === 0);

  return (
    <div>
      {/* readout: reserved height so scrubbing never shifts the page */}
      <div className="min-h-[3.5rem] px-1 pb-2" aria-hidden data-testid="scrub-readout">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-white">
          <span className="whitespace-nowrap text-[13px] font-semibold uppercase tracking-wide text-white/60">{label}</span>
          <Deg v={tempAt} className="text-[22px] font-semibold leading-tight" />
          <span className="whitespace-nowrap text-[15px] tabular-nums text-white/70">Rain&nbsp;{rainAt}%</span>
          <span className="inline-flex items-center gap-1 text-[15px] text-white/70"><CondIcon code={near.code} daylight={near.daylight} className="h-4 w-4" />{near.cond}</span>
        </p>
        {hereEvents.length > 0 && (
          <ul className="mt-1 space-y-0.5" data-testid="scrub-events">
            {hereEvents.map((e, i) => (
              <li key={i} className={cn("text-[14px] font-medium leading-snug", e.source === "turo" ? TURO_TEXT : CAL_TEXT)}>
                {e.title}
                <span className="font-normal text-white/60"> · {time12(e.start)} to {time12(e.end)}</span>
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

        {/* temperature curve + rain bars */}
        <div className="relative h-[132px]" style={{ marginLeft: PAD, marginRight: PAD }}>
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id={`fill${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.30" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g className={LINE}>
              <path d={area} fill={`url(#fill${uid})`} />
              <path d={line} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </g>
          </svg>
          {hours.map((h, i) => h.rain >= 10 && (
            <span key={i} className="absolute bottom-0 w-[3.5%] -translate-x-1/2 rounded-full bg-[#64D2FF]/40 bento:bg-[#007AFF]/25"
              style={{ left: `${(i / (n - 1)) * 100}%`, height: `${Math.max(4, h.rain * 0.34)}%` }} />
          ))}
          {/* scrub hairline: feathered at both ends, plus a soft dot on the curve */}
          <span className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2" style={{
            left: `${(pos / (n - 1)) * 100}%`,
            background: "linear-gradient(to bottom, transparent, rgba(128,128,128,0.7) 22%, rgba(128,128,128,0.7) 78%, transparent)",
          }} />
          <span className={cn("pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current", RING, LINE)}
            style={{ left: `${(pos / (n - 1)) * 100}%`, top: `${yOf(tempAt)}%`, boxShadow: "0 0 14px 3px color-mix(in srgb, currentColor 35%, transparent)" }} />
        </div>

        {/* hour axis */}
        <div className="relative h-6" aria-hidden>
          {ticks.map(({ h, i }) => (
            <span key={i} className="absolute top-1 -translate-x-1/2 whitespace-nowrap text-[12px] tabular-nums text-white/55" style={{ left: px(i / (n - 1)) }}>{hour12(h.t)}</span>
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

  const events = (evs.data?.events ?? []) as WxEvent[];
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
            <h2 className="text-[22px] font-semibold leading-snug tracking-tight text-white">{headline(wx)}</h2>
            <p className={cn(text.detail, "mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5")}>
              <span className="inline-flex items-center gap-1.5 text-white/80"><CondIcon code={wx.now.code} daylight={!!wx.hours[0]?.daylight} className="h-4 w-4" /><Deg v={wx.now.tempF} className="font-semibold text-white" /> {wx.now.cond}</span>
              <span className="whitespace-nowrap">Feels {F(wx.now.feelsF)}&nbsp;°F</span>
              <span className="whitespace-nowrap">Wind {F(wx.now.windMph)}&nbsp;mph</span>
              <span className="whitespace-nowrap">Humidity {wx.now.humidity}%</span>
            </p>
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
        {wx.hours.length >= 2 ? <HourScrub hours={wx.hours} events={events} /> : <p className={text.detail}>The hourly forecast is not available right now.</p>}

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
              const list = agenda.get(key) ?? [];
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
                            <span className="whitespace-nowrap tabular-nums text-white/60">{time12(e.start)}</span> {e.title}
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

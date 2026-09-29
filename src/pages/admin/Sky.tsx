/**
 * /admin/sky - the wall's sky, full screen on a computer or iPhone.
 *
 * Same planes as the ceiling: the Pi pushes its aircraft list (server.py sky_share_loop -> wall_pi_air_put
 * -> wall_air_live) every 3 s while this page is open; wall_admin_air() returns it and tells the Pi someone
 * is watching. If the Pi hasn't shared for 45 s, the page asks the wall-sky edge function (adsb.lol / adsb.fi
 * around home) so it never goes blank. SQL wall_r4admin_watchdog tells Scout when the Pi stops sharing.
 *
 * Looks like the wall: dark sky, planes colored by kind (bigger = flying lower), name tags, and rings plus a
 * red dot on the one plane in the name tag (the wall's airFocus, else the closest). North is up.
 * Motion is dead-reckoned from speed and heading between snapshots and eased, so planes glide instead of jumping.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Maximize2, Minimize2, Plane, RotateCw } from "lucide-react";

type Air = {
  hex: string; cs?: string | null; reg?: string | null; t?: string | null; cat?: string | null;
  lat: number; lon: number; alt?: number | null; gs?: number | null; track?: number | null; vr?: number | null;
  dst?: number | null; dir?: number | null; airline?: string | null; iata?: string | null; owner?: string | null;
  model?: string | null; maker?: string | null; area?: string | null; close?: boolean;
  from?: string | { iata?: string; city?: string } | null; to?: string | { iata?: string; city?: string } | null;
  news?: { station?: string; call?: string } | null; police?: string | null;
};
type Feed = { list: Air[]; at: number; home: [number, number]; radius: number; source: "wall" | "feed"; focus: string | null; error: string | null; fetchedAt: number };

const HOME: [number, number] = [34.0835, -118.3698];
const NB = " ";
const KINDS: Record<string, [string, string]> = {
  airline: ["Airline", "#FFFFFF"], cargo: ["Cargo", "#FFD60A"], bizjet: ["Private jet", "#BF5AF2"], small: ["Small plane", "#64D2FF"],
  heli: ["Helicopter", "#FF9F0A"], rescue: ["Police / rescue", "#FF453A"], military: ["Military", "#30D158"], unknown: ["Unknown", "#98989D"],
};
const CALLSIGN: Record<string, string> = {
  UAL: "United", AAL: "American", DAL: "Delta", SWA: "Southwest", ASA: "Alaska", JBU: "JetBlue", SKW: "SkyWest", FFT: "Frontier",
  NKS: "Spirit", HAL: "Hawaiian", AAY: "Allegiant", QXE: "Horizon", ENY: "Envoy", RPA: "Republic", CPZ: "Compass", WJA: "WestJet",
  ACA: "Air Canada", AMX: "Aeromexico", VOI: "Volaris", VIV: "Viva", BAW: "British Airways", AFR: "Air France", DLH: "Lufthansa",
  KLM: "KLM", JAL: "Japan Airlines", ANA: "ANA", KAL: "Korean Air", AAR: "Asiana", CPA: "Cathay Pacific", QFA: "Qantas", UAE: "Emirates",
  QTR: "Qatar", VIR: "Virgin Atlantic", EVA: "EVA Air", CAL: "China Airlines", SIA: "Singapore", THY: "Turkish", ANZ: "Air New Zealand",
  FDX: "FedEx", UPS: "UPS", GTI: "Atlas", ABX: "ABX", ATN: "ATI", CKS: "Kalitta", MXY: "Breeze", SCX: "Sun Country",
};
const CARGO = /fedex|ups|atlas|abx|kalitta|\bati\b|cargo|amazon|dhl|polar/i;
const HELI = /^(R22|R44|R66|EC\d|H1\d\d|AS\d|B06|B04|B407|B412|B429|B505|A109|A119|A139|S76|MD5|MD6|EC45|UH|H60|BK17)/i;
const BIZJET = /^(C25|C5\d|C68|C7\d|CL\d|GLF|GL\d|GLEX|E50|E55|E545|LJ|FA\d|F2TH|F900|H25|PC24|HDJT|G150|G280|BE40|PRM1)/i;

/** Wall-style kind + name, simplified from wall.html planeInfo(). */
function info(a: Air) {
  const t = (a.t ?? "").toUpperCase(), own = a.owner ?? "", reg = a.reg ?? "";
  const pre = (a.cs ?? "").slice(0, 3).toUpperCase();
  const al = a.airline || (/^[A-Z]{3}\d/.test(a.cs ?? "") ? CALLSIGN[pre] : "") || "";
  const short = (s: string) => s.replace(/\s+(Airlines|Air Lines|Airways|Air Line)\b.*$/i, "").trim();
  if (a.police || /^N\d{2,4}(LA|PD)$/.test(reg)) return { kind: "rescue", who: a.police ? `${a.police} helicopter` : "Police helicopter" };
  if (HELI.test(t) || a.cat === "A7") {
    if (a.news?.station) return { kind: "heli", who: `${a.news.station}${a.news.call ? " " + a.news.call : ""}`, news: true };
    if (/sheriff|police/i.test(own)) return { kind: "rescue", who: "Police helicopter" };
    if (/fire/i.test(own)) return { kind: "rescue", who: "Fire helicopter" };
    if (/medical|mercy|reach|air methods|hospital|ambulance/i.test(own)) return { kind: "rescue", who: "Medical helicopter" };
    if (/broadcast|television|news|\btv\b|media|ktla|nbc|abc|cbs|fox/i.test(own)) return { kind: "heli", who: "TV news helicopter", news: true };
    return { kind: "heli", who: "Helicopter" };
  }
  if (/air force|navy|army|marine|coast guard|military/i.test(own)) return { kind: "military", who: "Military aircraft" };
  if (al && CARGO.test(al)) return { kind: "cargo", who: `${short(al)} cargo` };
  if (al) return { kind: "airline", who: short(al) };
  if (BIZJET.test(t)) return { kind: "bizjet", who: "Private jet" };
  if (a.cat === "A1" || a.cat === "A2" || /^(C1\d\d|C2\d\d|SR2|PA\d|P28|BE3|BE2|DA4|M20|PC12|C208)/.test(t)) return { kind: "small", who: "Small plane" };
  return { kind: "unknown", who: "Aircraft" };
}
const flightNo = (a: Air) => a.iata || (a.cs && /^[A-Z]{3}\d/.test(a.cs) ? a.cs : null);
const place = (p: Air["from"]) => (!p ? "" : typeof p === "string" ? p : p.city || p.iata || "");
const fmtAlt = (ft?: number | null) => (ft == null ? "" : `${(Math.round(ft / 25) * 25).toLocaleString("en-US")}${NB}ft`);
const mph = (kt?: number | null) => (kt == null ? "" : `${Math.round(kt * 1.15078)}${NB}mph`);
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const time12 = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });

/** Miles east / north of home. */
function toMi(lat: number, lon: number, home: [number, number]) {
  return { x: (lon - home[1]) * 69.172 * Math.cos((home[0] * Math.PI) / 180), y: (lat - home[0]) * 68.97 };
}

/** Airplane silhouette pointing up, ~24 units long. */
const PLANE = "M0-12 1.6-8.6 1.7-3.2 10-0.4 10 1.8 1.7 0.6 1.1 7.2 4.2 9.4 4.2 11 0 10 -4.2 11 -4.2 9.4 -1.1 7.2 -1.7 0.6 -10 1.8 -10 -0.4 -1.7 -3.2 -1.6 -8.6Z";

/** Fixed star field (seeded so it doesn't reshuffle). */
const STARS = (() => {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 140 }, () => ({ x: r(), y: r(), o: 0.15 + r() * 0.55, s: r() < 0.08 ? 1.6 : r() < 0.4 ? 1 : 0.6 }));
})();

type Disp = { x: number; y: number; hdg: number };

export default function Sky() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [, setFrame] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const disp = useRef<Map<string, Disp>>(new Map());
  const lastT = useRef(performance.now());
  const busy = useRef(false);
  /** On-screen size of the sky box: text and planes keep the same on-screen size on a phone and a big screen. */
  const [box, setBox] = useState({ w: 1000, h: 1000 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);

  const pull = useCallback(async () => {
    if (busy.current || document.hidden) return;
    busy.current = true;
    try {
      const { data, error } = await (supabase.rpc as unknown as (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>)("wall_admin_air");
      const d = data as { data?: { list?: Air[]; at?: number; home?: [number, number]; radius_mi?: number; focus?: { hex?: string; until?: number } | null } | null; age_s?: number | null; radius_mi?: number; focus?: { hex?: string; until?: number } | null } | null;
      const fresh = !error && d?.data && Array.isArray(d.data.list) && d.age_s != null && d.age_s < 45;
      if (fresh && d?.data) {
        const f = d.focus ?? d.data.focus ?? null;
        setFeed({
          list: d.data.list ?? [], at: (d.data.at ?? Date.now() / 1000) * 1000, home: d.data.home ?? HOME,
          radius: d.radius_mi ?? d.data.radius_mi ?? 15, source: "wall", error: null, fetchedAt: Date.now(),
          focus: f?.hex && (!f.until || f.until > Date.now()) ? f.hex : null,
        });
        setErr(null);
        return;
      }
      // The Pi isn't sharing: read the public feed through the edge function (browsers can't call it directly).
      const radius = d?.radius_mi ?? 15;
      const { data: b, error: e2 } = await supabase.functions.invoke("wall-sky", { body: { radius_mi: radius } });
      const bb = b as { list?: Air[]; at?: number; error?: string } | null;
      if (e2 || !bb || bb.error) { setErr(error?.message ?? bb?.error ?? e2?.message ?? "No planes feed right now."); return; }
      setFeed({ list: bb.list ?? [], at: (bb.at ?? Date.now() / 1000) * 1000, home: HOME, radius, source: "feed", focus: null, error: null, fetchedAt: Date.now() });
      setErr(null);
    } finally { busy.current = false; }
  }, []);

  useEffect(() => {
    void pull();
    const t = window.setInterval(() => void pull(), 3000);
    const vis = () => { if (!document.hidden) void pull(); };
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [pull]);

  // ~30 fps while visible: dead-reckon each plane from its last report, ease the drawn position toward it.
  useEffect(() => {
    let raf = 0, last = 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < (reduce ? 1000 : 33)) return;
      last = t;
      setFrame((n) => (n + 1) % 1e6);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Full screen: the real Fullscreen API where it exists (Mac, iPad), a fixed cover on iPhone.
  useEffect(() => {
    const on = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  useEffect(() => {
    if (!full) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [full]);
  const toggleFull = async () => {
    const el = boxRef.current;
    if (!full) {
      setFull(true);
      try { if (el?.requestFullscreen && !/iPhone|iPod/.test(navigator.userAgent)) await el.requestFullscreen(); } catch { /* the fixed cover still works */ }
    } else {
      setFull(false);
      try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore */ }
    }
  };

  const radius = Math.min(25, Math.max(2, feed?.radius ?? 15));
  const home = feed?.home ?? HOME;
  const now = Date.now();
  const dtFrame = Math.min(0.25, (performance.now() - lastT.current) / 1000);
  lastT.current = performance.now();

  const planes = useMemo(() => (feed?.list ?? []).filter((a) => typeof a.lat === "number" && typeof a.lon === "number"), [feed]);
  const seen = new Set<string>();
  const drawn = planes.map((a) => {
    const age = Math.min(20, Math.max(0, (now - (feed?.at ?? now)) / 1000));
    const p = toMi(a.lat, a.lon, home);
    const hdg = a.track ?? 0;
    const miPerS = ((a.gs ?? 0) * 1.15078) / 3600;
    const tx = p.x + Math.sin((hdg * Math.PI) / 180) * miPerS * age;
    const ty = p.y + Math.cos((hdg * Math.PI) / 180) * miPerS * age;
    let d = disp.current.get(a.hex);
    if (!d || Math.hypot(d.x - tx, d.y - ty) > 3) d = { x: tx, y: ty, hdg };
    const k = Math.min(1, dtFrame * 5);
    d = { x: d.x + (tx - d.x) * k, y: d.y + (ty - d.y) * k, hdg };
    disp.current.set(a.hex, d);
    seen.add(a.hex);
    return { a, d, i: info(a) };
  });
  for (const k of disp.current.keys()) if (!seen.has(k)) disp.current.delete(k);
  const inView = drawn.filter(({ d }) => Math.hypot(d.x, d.y) <= radius * 1.08);
  const closest = [...inView].sort((p, q) => Math.hypot(p.d.x, p.d.y) - Math.hypot(q.d.x, q.d.y))[0];
  const focusHex = (pick && inView.some((p) => p.a.hex === pick) ? pick : null) ?? (feed?.focus && inView.some((p) => p.a.hex === feed.focus) ? feed.focus : null) ?? closest?.a.hex ?? null;
  const focus = inView.find((p) => p.a.hex === focusHex) ?? null;

  // SVG space: 1000 x 1000, home in the middle, radius = 440.
  const S = 440 / radius;
  const X = (mi: number) => 500 + mi * S;
  const Y = (mi: number) => 500 - mi * S;
  const ringStep = radius <= 6 ? 1 : radius <= 12 ? 3 : 5;
  const rings: number[] = [];
  for (let r = ringStep; r < radius * 0.82; r += ringStep) rings.push(r);   // keep inner labels clear of the edge ring
  rings.push(radius);
  /** SVG units per screen pixel (the 1000-unit square fits the box's short side). */
  const u = Math.min(2.8, Math.max(1, 1000 / Math.max(1, Math.min(box.w, box.h))));
  const fs = 13 * u;

  // Name tags: the focus plane first, then nearest first; each tries four spots and skips if all collide.
  type Tag = { hex: string; x: number; y: number; w: number; h: number; text: string; sub: string | null; col: string; isF: boolean };
  const tags: Tag[] = [];
  {
    const order = [...inView].sort((p, q) => (p.a.hex === focusHex ? -1 : q.a.hex === focusHex ? 1 : Math.hypot(p.d.x, p.d.y) - Math.hypot(q.d.x, q.d.y)));
    const hit = (r: { x: number; y: number; w: number; h: number }) =>
      tags.some((t) => r.x < t.x + t.w + 4 && r.x + r.w + 4 > t.x && r.y < t.y + t.h + 4 && r.y + r.h + 4 > t.y) ||
      Math.hypot(r.x + r.w / 2 - 500, r.y + r.h / 2 - 505) < 30 * u;
    for (const { a, d, i } of order) {
      const isF = a.hex === focusHex;
      const text = `${i.who}${flightNo(a) && i.kind === "airline" ? " " + (flightNo(a) ?? "").replace(/^[A-Z0-9]{2}/, "") : ""}`;
      const sub = isF ? [fmtAlt(a.alt), mph(a.gs)].filter(Boolean).join(" · ") : null;
      const w = Math.max(text.length * fs * 0.6, (sub?.length ?? 0) * fs * 0.52) + fs * 1.3;
      const h = fs * (isF ? 2.9 : 1.65);
      const x = X(d.x), y = Y(d.y), gap = 16 * u;
      const spots = [[x + gap, y - h / 2], [x - gap - w, y - h / 2], [x - w / 2, y + gap], [x - w / 2, y - gap - h]];
      const spot = spots.find(([sx, sy]) => sx > 4 && sx + w < 996 && sy > 4 && sy + h < 996 && !hit({ x: sx, y: sy, w, h })) ?? (isF ? spots[0] : null);
      if (spot) tags.push({ hex: a.hex, x: spot[0], y: spot[1], w, h, text, sub, col: KINDS[i.kind]?.[1] ?? "#fff", isF });
    }
  }

  const ageS = feed ? Math.max(0, Math.round((now - feed.fetchedAt) / 1000)) : null;
  const srcText = !feed ? "Connecting…" : feed.source === "wall" ? "Live from the wall" : "Wall not sharing · public feed";

  const fa = focus?.a;
  const fi = focus?.i;
  const route = fa && (place(fa.from) || place(fa.to)) ? `${place(fa.from) || "?"} → ${place(fa.to) || "?"}` : "";
  const fDir = fa?.dir != null ? COMPASS[Math.round(fa.dir / 45) % 8] : "";
  const fDist = focus ? Math.hypot(focus.d.x, focus.d.y) : null;

  return (
    <div className={cn(full ? "fixed inset-0 z-[70] bg-black" : "-m-4 md:-m-6 lg:-m-8")}>
      <div ref={boxRef}
        className={cn("relative w-full overflow-hidden bg-[#02030a] text-white",
          full ? "h-[100dvh]" : "h-[calc(100dvh-7.5rem)] min-h-[480px] md:h-[calc(100dvh-4rem)]")}
        style={{ backgroundImage: "radial-gradient(120% 90% at 50% 45%, #101a3a 0%, #070b1f 45%, #02030a 100%)" }}>
        {/* the sky */}
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" role="img"
          aria-label={`Sky over home, ${inView.length} ${inView.length === 1 ? "aircraft" : "aircraft"} within ${radius} miles`}>
          <defs>
            <radialGradient id="sky-home" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#64D2FF" stopOpacity=".35" /><stop offset="100%" stopColor="#64D2FF" stopOpacity="0" /></radialGradient>
          </defs>
          {STARS.map((s, n) => <circle key={n} cx={s.x * 1000} cy={s.y * 1000} r={s.s} fill="#fff" opacity={s.o} />)}
          {rings.map((r) => (
            <g key={r}>
              <circle cx={500} cy={500} r={r * S} fill="none" stroke="#fff" strokeOpacity={r === radius ? 0.28 : 0.12} strokeWidth={r === radius ? 1.6 : 1} strokeDasharray={r === radius ? undefined : "4 8"} />
              <text x={500 + r * S * 0.707 + 6} y={500 - r * S * 0.707 - 6} fill="#fff" fillOpacity={0.45} fontSize={11 * u} fontWeight={600}>{r}{NB}mi</text>
            </g>
          ))}
          {["N", "E", "S", "W"].map((c, n) => {
            const a = (n * Math.PI) / 2, rr = radius * S + 14 * u;
            return <text key={c} x={500 + Math.sin(a) * rr} y={500 - Math.cos(a) * rr + 5 * u} textAnchor="middle" fill="#fff" fillOpacity={c === "N" ? 0.85 : 0.45} fontSize={13 * u} fontWeight={700} letterSpacing={2}>{c}</text>;
          })}
          {/* home */}
          <circle cx={500} cy={500} r={26 * u} fill="url(#sky-home)" />
          <path d="M0 -12 L11 -3 L11 10 L-11 10 L-11 -3 Z" transform={`translate(500 500) scale(${Math.max(1, u * 0.75)})`} fill="#64D2FF" stroke="#02030a" strokeWidth={2} strokeLinejoin="round" />
          <text x={500} y={500 + 22 * u} textAnchor="middle" fill="#64D2FF" fontSize={11 * u} fontWeight={700} letterSpacing={1.5}>HOME</text>

          {/* planes */}
          {inView.map(({ a, d, i }) => {
            const x = X(d.x), y = Y(d.y);
            const col = KINDS[i.kind]?.[1] ?? "#fff";
            const low = a.alt == null ? 0.5 : Math.min(1, Math.max(0, 1 - a.alt / 14000));
            const sc = (0.9 + low * 0.9) * Math.max(1, u * 0.7);
            const isF = a.hex === focusHex;
            return (
              <g key={a.hex} onClick={() => setPick(a.hex)} style={{ cursor: "pointer" }}>
                {isF && (
                  <g>
                    <circle cx={x} cy={y} r={24 * sc} fill="none" stroke={col} strokeOpacity={0.5} strokeWidth={2}>
                      <animate attributeName="r" values={`${18 * sc};${36 * sc};${18 * sc}`} dur="2.4s" repeatCount="indefinite" />
                      <animate attributeName="stroke-opacity" values=".7;0;.7" dur="2.4s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={x} cy={y} r={16 * sc} fill="none" stroke={col} strokeOpacity={0.6} strokeWidth={1.5} />
                  </g>
                )}
                <circle cx={x} cy={y} r={22 * u} fill="transparent" />
                {i.kind === "heli" || i.kind === "rescue" ? (
                  <g transform={`translate(${x} ${y}) scale(${sc})`}>
                    <ellipse cx={0} cy={1} rx={4.5} ry={7} fill={col} />
                    <path d="M0 7 L0 15" stroke={col} strokeWidth={2} />
                    <g transform={`rotate(${(now / 6) % 360})`}><path d="M-13 0 H13 M0 -13 V13" stroke={col} strokeOpacity={0.8} strokeWidth={1.6} /></g>
                  </g>
                ) : (
                  <path d={PLANE} transform={`translate(${x} ${y}) rotate(${d.hdg}) scale(${sc})`} fill={col} stroke="#02030a" strokeWidth={0.8} />
                )}
                {isF && <circle cx={x} cy={y} r={3.5 * sc} fill="#FF453A" stroke="#fff" strokeWidth={1.5} />}
              </g>
            );
          })}
          {/* name tags on top of every plane */}
          <defs>
            <filter id="tag-shadow" x="-10%" y="-20%" width="120%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#000" floodOpacity="0.9" />
            </filter>
          </defs>
          {tags.map((t) => (
            <g key={`tag-${t.hex}`} onClick={() => setPick(t.hex)} style={{ cursor: "pointer" }}>
              <rect x={t.x} y={t.y} rx={t.h / (t.isF ? 3.2 : 2)} height={t.h} width={t.w} fill="#0b1530" fillOpacity={0.96} stroke={t.col} strokeOpacity={t.isF ? 0.9 : 0.45} strokeWidth={t.isF ? 1.8 : 1.2} />
              <text x={t.x + fs * 0.65} y={t.y + fs * 1.15} fontSize={fs} fontWeight={700} filter="url(#tag-shadow)" style={{ fill: '#ffffff', fontSize: fs, fontWeight: 700 }}>{t.text}</text>
              {t.sub && <text x={t.x + fs * 0.65} y={t.y + fs * 2.4} fontSize={fs * 0.88} fontWeight={500} filter="url(#tag-shadow)" style={{ fill: '#c8deff', fontSize: fs * 0.88, fontWeight: 500 }}>{t.sub}</text>}
            </g>
          ))}
        </svg>

        {/* top bar */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:p-4" style={{ paddingTop: full ? "max(0.75rem, env(safe-area-inset-top))" : undefined }}>
          <div className="pointer-events-auto rounded-2xl bg-black/45 px-3.5 py-2 ring-1 ring-white/10">
            <div className="text-[17px] font-semibold leading-tight">Sky over home</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-white/60" aria-live="polite">
              <span className={cn("h-2 w-2 rounded-full", !feed ? "bg-white/40" : feed.source === "wall" ? "bg-emerald-400" : "bg-amber-400")} aria-hidden />
              {srcText}{ageS != null && ageS > 8 ? ` · ${ageS}${NB}sec ago` : ""} · <span className="whitespace-nowrap">{inView.length} in {radius}{NB}mi</span>
            </div>
            {err && <div className="mt-0.5 text-[13px] text-amber-300">{err}</div>}
          </div>
          <div className="pointer-events-auto flex gap-2">
            <button type="button" onClick={() => { setPick(null); void pull(); }} aria-label="Refresh"
              className="grid h-11 w-11 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/10 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
              <RotateCw className="h-5 w-5" aria-hidden />
            </button>
            <button type="button" onClick={() => void toggleFull()} aria-label={full ? "Exit full screen" : "Full screen"} aria-pressed={full}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-4 text-[15px] font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
              {full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
              <span className="hidden sm:inline">{full ? "Exit full screen" : "Full screen"}</span>
            </button>
          </div>
        </div>

        {/* name tag card (the wall's flight card) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 sm:p-4" style={{ paddingBottom: full ? "max(0.75rem, env(safe-area-inset-bottom))" : undefined }}>
          {fa && fi ? (
            <div className="pointer-events-auto w-full max-w-[420px] rounded-3xl bg-[#0b0f1e]/85 p-4 ring-1 ring-white/12" aria-live="polite">
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-white/55">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: KINDS[fi.kind]?.[1] }} aria-hidden />
                {KINDS[fi.kind]?.[0]}{flightNo(fa) ? ` · Flight ${flightNo(fa)}` : fa.reg ? ` · ${fa.reg}` : ""}
                {feed?.focus === fa.hex && <span className="ml-auto rounded-full bg-[#FF453A]/20 px-2 py-0.5 text-[11px] text-[#FF8A80]">On the wall</span>}
              </div>
              <div className="mt-1 text-[22px] font-bold leading-tight text-white">{fi.who}</div>
              {route && <div className="mt-0.5 text-[15px] text-white/80">{route}</div>}
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                {[["Altitude", fmtAlt(fa.alt) || "—"], ["Speed", mph(fa.gs) || "—"], ["Away", fDist != null ? `${fDist.toFixed(1)}${NB}mi ${fDir}` : "—"]].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-white/[0.06] px-2 py-1.5">
                    <div className="text-[11px] uppercase tracking-[0.06em] text-white/50">{k}</div>
                    <div className="whitespace-nowrap text-[15px] font-semibold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              {(fa.model || fa.t || fa.area) && <div className="mt-2 truncate text-[13px] text-white/55">{[fa.maker && fa.model ? `${fa.maker} ${fa.model}` : fa.model || fa.t, fa.area ? `over ${fa.area}` : ""].filter(Boolean).join(" · ")}</div>}
            </div>
          ) : (
            <div className="pointer-events-auto rounded-2xl bg-black/45 px-4 py-3 text-[15px] text-white/75 ring-1 ring-white/10">
              <Plane className="mr-2 inline h-4 w-4 text-white/60" aria-hidden />
              {feed ? <>Quiet skies. No planes within {radius}{NB}mi right now.</> : "Finding planes…"}
            </div>
          )}
          {/* key, desktop only */}
          <div className="pointer-events-auto hidden rounded-2xl bg-black/45 px-3.5 py-2.5 text-[12px] text-white/70 ring-1 ring-white/10 lg:block">
            <div className="mb-1 font-semibold text-white/85">Key · bigger = flying lower</div>
            {Object.entries(KINDS).filter(([k]) => k !== "unknown").map(([k, [name, col]]) => (
              <div key={k} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: col }} aria-hidden />{name}</div>
            ))}
            <div className="mt-1 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#FF453A] ring-2 ring-white/70" aria-hidden />The plane in the name tag</div>
            {feed && <div className="mt-1 text-white/45">Updated {time12(feed.fetchedAt)}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

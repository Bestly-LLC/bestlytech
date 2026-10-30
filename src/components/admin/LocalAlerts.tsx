/**
 * Local alerts v2 (Sky Sync, 2026-10-28): the ONE category registry + snapshot both the projector wall and the /admin Sky map render.
 *
 * Jared 2026-10-28 3:08 PM: "Make sure that the sky and wall are in parity, both admin and projector." So nothing about a category
 * (id, label, color, icon, order, default switch) lives in this file or in wall.html: it all comes from the SQL snapshot
 * (citizen_snapshot_json via wall_admin_citizen here, wall_citizen_snapshot on the wall) and both sides only draw what it says.
 * The per-category switches live in the wall's saved state (alertCats + skyAlerts), so a switch flipped here changes the projector
 * and the other way around. Sky Sync (skysync.py) compares the two snapshots every 5 min and alerts Scout on drift.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { swHit } from "@/components/admin/wallUi";

export type CitCat = { id: string; label: string; color: string; icon: string; ord: number; default_on: boolean; n: number; state: "ok" | "paused" | "setup" };
export type CitInc = {
  key: string; cat: string; title: string; short: string | null; sub: string | null; lat: number; lng: number; address: string | null;
  level: "low" | "moderate" | "high" | "critical"; severity: number; source: string; dist_ft: number; place: "point" | "ring" | "note";
  first_seen: number; updated_at: number; fade0: number | null; fade1: number | null; ping_id: number | null; pinged_at: number | null;
  n_updates: number; last_update: string | null;
};
export type CitSnap = {
  at: number; rev: number; hash: string; dot_ft?: number; notes_max?: number; paused: boolean; ping_max: number;
  cats: CitCat[]; incidents: CitInc[]; sources: Record<string, { status: string; ok_s: number | null }>;
};

const rpcAny = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (fn: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

/** Icons are Lucide path markup from the registry; only plain shapes are drawn (same check as the wall page). */
const ICON_OK = /^(?:<(?:path|circle|rect|line|polyline|polygon|ellipse)[^<>]*\/>)+$/;
export const iconMarkup = (c?: Pick<CitCat, "icon"> | null) => (c && ICON_OK.test(c.icon) ? c.icon : '<circle cx="12" cy="12" r="4"/>');
export const catRGB = (hex?: string | null) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "100,210,255";
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(",");
};
/** Fade near the end of an incident's life (fade0 to fade1); persistent items (area alerts, outages) have none. */
export const citOpacity = (i: Pick<CitInc, "fade0" | "fade1">, now: number) =>
  i.fade1 == null || i.fade0 == null || now <= i.fade0 ? 1 : Math.max(0, (i.fade1 - now) / Math.max(1, i.fade1 - i.fade0));
/** Halo/dot size by severity, same numbers as the wall (--sc). */
export const LEVEL_SCALE: Record<CitInc["level"], number> = { low: 0.82, moderate: 1, high: 1.12, critical: 1.26 };

/** Icon color on top of a solid category-colored fill: white, or dark gray when the fill is very light (relative luminance > 0.8, e.g. white traffic). */
export const iconInk = (color?: string | null) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(color ?? "");
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const lin = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.8 ? "#3A3A3C" : "#FFFFFF";
};
/** New = pinged in the last 5 minutes (same rule on the map, the wall and the Near home list). */
export const isNewInc = (c: Pick<CitInc, "pinged_at">, now: number) => c.pinged_at != null && now - c.pinged_at < 5 * 60_000;

/** Registry icon as a small inline SVG (stroke in the category color). */
export function CatIcon({ cat, className }: { cat?: Pick<CitCat, "icon" | "color"> | null; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={cat?.color ?? "#64D2FF"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden dangerouslySetInnerHTML={{ __html: iconMarkup(cat) }} />
  );
}

/** The shared snapshot, refreshed every 30 s. `fresh` goes false after 3 min without an answer (the wall hides the layer then too). */
export function useCitizen() {
  const [snap, setSnap] = useState<CitSnap | null>(null);
  const at = useRef(0);
  const [, tick] = useState(0);
  useEffect(() => {
    let dead = false;
    const get = async () => {
      try {
        const { data } = await rpcAny("wall_admin_citizen");
        const d = data as CitSnap | null;
        if (!dead && d && Array.isArray(d.incidents) && Array.isArray(d.cats)) { at.current = Date.now(); setSnap(d); }
      } catch { /* keep the last copy; it hides itself after 3 min */ }
    };
    void get();
    const t = window.setInterval(() => void get(), 30_000);
    const k = window.setInterval(() => tick((n) => n + 1), 15_000);
    return () => { dead = true; window.clearInterval(t); window.clearInterval(k); };
  }, []);
  return { snap, fresh: snap != null && Date.now() - at.current < 180_000 };
}

export type AlertSw = { master: boolean; cats: Record<string, boolean> };
/** A category is on when the master is on and its own switch is on (missing switch = the registry default). */
export const catIsOn = (sw: AlertSw, c: Pick<CitCat, "id" | "default_on">) => sw.master && (sw.cats[c.id] === undefined ? c.default_on !== false : sw.cats[c.id]);

/** Switch state kept in the wall's saved state (wall_admin_get / wall_admin_set), shared with the projector. */
export function useAlertSwitches() {
  const [sw, setSw] = useState<AlertSw>({ master: true, cats: {} });
  const ref = useRef(sw);
  const wrote = useRef(0);
  ref.current = sw;
  useEffect(() => {
    let dead = false;
    const get = async () => {
      if (Date.now() - wrote.current < 8000) return;      // let our own write land before reading back
      try {
        const { data } = await rpcAny("wall_admin_get");
        const st = (data as { state?: { skyAlerts?: boolean; alertCats?: Record<string, boolean> } } | null)?.state;
        if (!dead && st) setSw({ master: st.skyAlerts !== false, cats: st.alertCats && typeof st.alertCats === "object" ? st.alertCats : {} });
      } catch { /* keep the last switches */ }
    };
    void get();
    const t = window.setInterval(() => void get(), 15_000);
    return () => { dead = true; window.clearInterval(t); };
  }, []);
  // supabase.rpc() is lazy: the request only goes out once something calls .then, so the write must end in one.
  const write = useCallback((patch: Record<string, unknown>) => {
    wrote.current = Date.now();
    void rpcAny("wall_admin_set", { p_patch: patch }).then(({ error }) => { if (error) wrote.current = 0; }, () => { wrote.current = 0; });
  }, []);
  const setMaster = useCallback((v: boolean) => { setSw((s) => ({ ...s, master: v })); write({ skyAlerts: v }); }, [write]);
  const setCat = useCallback((id: string, v: boolean) => {
    const cats = { ...ref.current.cats, [id]: v };
    setSw((s) => ({ ...s, cats }));
    write({ alertCats: cats });
  }, [write]);
  return { sw, setMaster, setCat };
}

const statusText = (c: CitCat, on: boolean) =>
  c.state === "setup" ? "Needs a one-time setup"
    : c.state === "paused" ? "Paused, its feed isn't answering"
    : !on ? "Off"
    : c.n === 0 ? "Nothing right now" : null;

/** One switch per category, in registry order. Same rows in the Sky map panel and in Wall > Sky details. */
export function AlertCategoryRows({ snap, sw, onCat, idPrefix = "alert-cat" }: { snap: CitSnap | null; sw: AlertSw; onCat: (id: string, v: boolean) => void; idPrefix?: string }) {
  if (!snap) return <div className="px-4 py-3 text-[13px] text-white/50">Loading categories…</div>;
  return (
    <>
      {[...snap.cats].sort((a, b) => a.ord - b.ord).map((c) => {
        const on = sw.cats[c.id] === undefined ? c.default_on !== false : sw.cats[c.id];
        const quiet = c.state !== "ok";
        const st = statusText(c, on && sw.master);
        return (
          <div key={c.id} className={cn("flex min-h-[48px] items-center gap-3 border-b border-white/[0.07] px-4 py-1.5 last:border-b-0", (!sw.master || quiet) && "opacity-70")}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full ring-1 ring-white/10" style={{ background: `rgba(${catRGB(c.color)},.16)` }}>
              <CatIcon cat={c} className="h-[18px] w-[18px]" />
            </span>
            <label htmlFor={`${idPrefix}-${c.id}`} className="min-w-0 flex-1 cursor-pointer">
              <span className="block text-[16px] leading-tight text-white">{c.label}</span>
              <span className="block text-[13px] leading-snug text-white/50" aria-live="polite">
                {st ?? <><span className="whitespace-nowrap">{c.n}{" "}showing</span></>}
              </span>
            </label>
            <Switch className={swHit} id={`${idPrefix}-${c.id}`} checked={on} disabled={!sw.master} onCheckedChange={(v) => onCat(c.id, v)} />
          </div>
        );
      })}
    </>
  );
}

/** How many incidents are drawn right now (category on, not faded out). */
export const countShowing = (snap: CitSnap, sw: AlertSw, now: number) => {
  const reg = new Map(snap.cats.map((c) => [c.id, c] as const));
  return snap.incidents.filter((i) => { const c = reg.get(i.cat); return !!c && catIsOn(sw, c) && citOpacity(i, now) > 0; }).length;
};
/** Categories that are switched on but whose feed isn't answering (they sit quiet on their switch). */
export const pausedOn = (snap: CitSnap, sw: AlertSw) => snap.cats.filter((c) => c.state === "paused" && catIsOn(sw, c)).length;

/** Log row from citizen_admin_log (every incident in the last N days, open or ended). Times are epoch ms. */
export type CitLogRow = {
  key: string; cat: string; source: string; title: string; short: string | null; sub: string | null; address: string | null;
  level: CitInc["level"]; dist_ft: number | null; place: CitInc["place"]; first_seen: number; closed_at: number | null; pinged_at: number | null; n_updates: number;
  lat: number | null; lng: number | null; updates: { t?: number | string; text?: string }[] | null;
};

const t12 = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayLabel = (ms: number, now: number) => {
  const d = new Date(ms), t = new Date(now), y = new Date(now - 86_400_000);
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
};
const miText = (ft: number | null) => (ft == null || ft <= 0 ? null : ft < 528 ? `${Math.max(50, Math.round(ft / 50) * 50)} ft` : `${(ft / 5280).toFixed(1)} mi`);

/** Every alert from the last week (admin only), refreshed every minute. */
export function useAlertLog(days = 7) {
  const [rows, setRows] = useState<CitLogRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    const get = async () => {
      try {
        const { data, error } = await rpcAny("citizen_admin_log", { p_days: days });
        if (dead) return;
        if (error) { setErr(error.message); return; }
        setErr(null); setRows(Array.isArray(data) ? (data as CitLogRow[]) : []);
      } catch (e) { if (!dead) setErr(String(e)); }
    };
    void get();
    const t = window.setInterval(() => void get(), 60_000);
    return () => { dead = true; window.clearInterval(t); };
  }, [days]);
  return { rows, err };
}

/** "Log": what happened, newest first, grouped by day. Ended alerts are dimmed; open ones say "Showing now". */
export function AlertLogList({ snap, rows, err, now, activeKey, onPick }: { snap: CitSnap | null; rows: CitLogRow[] | null; err: string | null; now: number; activeKey?: string | null; onPick?: (r: CitLogRow) => void }) {
  if (err) return <div className="px-4 py-3 text-[14px] leading-snug text-white/60">The log didn't load (citizen_admin_log: {err}).</div>;
  if (!rows) return <div className="px-4 py-3 text-[13px] text-white/50">Loading the log…</div>;
  if (rows.length === 0) return <div className="px-4 py-3 text-[14px] leading-snug text-white/50">No alerts in the last 7 days.</div>;
  const reg = new Map((snap?.cats ?? []).map((c) => [c.id, c] as const));
  let lastDay = "";
  return (
    <>
      {rows.map((r) => {
        const cat = reg.get(r.cat);
        const color = cat?.color ?? "#64D2FF";
        const day = dayLabel(r.first_seen, now);
        const head = day !== lastDay ? (lastDay = day) : null;
        const open = r.closed_at == null;
        const dist = miText(r.dist_ft);
        return (
          <div key={r.key}>
            {head && <div className="px-4 pb-1 pt-3 text-[12px] font-semibold text-white/45">{head}</div>}
            <button type="button" onClick={() => onPick?.(r)} aria-pressed={activeKey === r.key}
              className={cn("flex min-h-[48px] w-full items-center gap-3 border-b border-white/[0.07] px-4 py-2 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400",
                !open && activeKey !== r.key && "opacity-75", activeKey === r.key && "bg-white/[0.08]")}>
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]" style={{ background: open ? color : `rgba(${catRGB(color)},.22)` }}>
                <svg viewBox="0 0 24 24" fill="none" stroke={open ? iconInk(color) : color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden
                  dangerouslySetInnerHTML={{ __html: iconMarkup(cat) }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-tight text-white">{r.short || r.title}</span>
                <span className="block text-[13px] leading-snug text-white/50">
                  <span className="whitespace-nowrap">{t12(r.first_seen)}</span>
                  {dist && <>{" · "}<span className="whitespace-nowrap">{dist}</span></>}
                  {" · "}
                  {open ? <span style={{ color }}>Showing now</span> : <span className="whitespace-nowrap">ended {t12(r.closed_at!)}</span>}
                  {r.pinged_at != null && <>{" · "}<span className="whitespace-nowrap">pinged you</span></>}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </>
  );
}

const updT = (t: number | string | undefined) => {
  if (t == null) return "";
  const ms = typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
  return Number.isFinite(ms) ? t12(ms) : String(t);
};

/** The tapped log entry, Citizen-style: what, where, when, how far, and its timeline of updates. */
export function AlertDetail({ snap, row, now, onClose }: { snap: CitSnap | null; row: CitLogRow; now: number; onClose: () => void }) {
  const cat = (snap?.cats ?? []).find((c) => c.id === row.cat);
  const color = cat?.color ?? "#64D2FF";
  const open = row.closed_at == null;
  const dist = miText(row.dist_ft);
  const ups = (row.updates ?? []).filter((u) => u && u.text);
  return (
    <div className="border-b border-white/10 px-4 py-3" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[11px]" style={{ background: color }}>
          <svg viewBox="0 0 24 24" fill="none" stroke={iconInk(color)} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden
            dangerouslySetInnerHTML={{ __html: iconMarkup(cat) }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold leading-tight text-white">{row.title}</div>
          {(row.address || row.sub) && <div className="mt-0.5 text-[13px] leading-snug text-white/60">{row.address || row.sub}</div>}
          <div className="mt-1 text-[13px] leading-snug text-white/50">
            <span className="whitespace-nowrap">{dayLabel(row.first_seen, now)}, {t12(row.first_seen)}</span>
            {dist && <>{" · "}<span className="whitespace-nowrap">{dist} from home</span></>}
            {" · "}
            {open ? <span style={{ color }}>Showing now</span> : <span className="whitespace-nowrap">ended {t12(row.closed_at!)}</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close this alert" className="-mr-2 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      {ups.length > 0 && (
        <ol className="mt-3 space-y-2 border-l border-white/15 pl-3">
          {ups.slice().reverse().map((u, k) => (
            <li key={k} className="text-[13px] leading-snug text-white/75">
              {u.t != null && <span className="mr-1.5 whitespace-nowrap text-white/45">{updT(u.t)}</span>}{u.text}
            </li>
          ))}
        </ol>
      )}
      {row.lat == null && <div className="mt-2 text-[13px] text-white/45">This alert has no map location.</div>}
    </div>
  );
}

/** "Near home": the incidents the map is drawing right now (category on, not faded out), new first, then nearest. Tap a row to flash its dot. */
export function NearHomeList({ snap, sw, now, activeKey, onPick }: { snap: CitSnap | null; sw: AlertSw; now: number; activeKey: string | null; onPick: (key: string) => void }) {
  if (!snap) return <div className="px-4 py-3 text-[13px] text-white/50">Loading alerts…</div>;
  const reg = new Map(snap.cats.map((c) => [c.id, c] as const));
  const rows = snap.incidents
    .filter((i) => { const c = reg.get(i.cat); return !!c && catIsOn(sw, c) && citOpacity(i, now) > 0; })
    .sort((a, b) => Number(isNewInc(b, now)) - Number(isNewInc(a, now)) || a.dist_ft - b.dist_ft);
  if (rows.length === 0) return <div className="px-4 py-3 text-[14px] leading-snug text-white/50">Nothing near home right now.</div>;
  return (
    <>
      {rows.map((i) => {
        const cat = reg.get(i.cat)!;
        const fresh = isNewInc(i, now);
        return (
          <button key={i.key} type="button" onClick={() => onPick(i.key)} aria-pressed={activeKey === i.key}
            className={cn("flex min-h-[48px] w-full items-center gap-3 border-b border-white/[0.07] px-4 py-2 text-left transition-colors last:border-b-0 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400", activeKey === i.key && "bg-white/[0.08]")}>
            <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]" style={{ background: cat.color }}>
              <svg viewBox="0 0 24 24" fill="none" stroke={iconInk(cat.color)} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden
                dangerouslySetInnerHTML={{ __html: iconMarkup(cat) }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] leading-tight text-white">
                {i.short || i.title}
                {fresh && <span className="ml-2 align-middle text-[11px] font-extrabold tracking-[0.09em]" style={{ color: cat.color }}>NEW</span>}
              </span>
              {i.sub && <span className="block text-[13px] leading-snug text-white/50">{i.sub}</span>}
            </span>
          </button>
        );
      })}
    </>
  );
}

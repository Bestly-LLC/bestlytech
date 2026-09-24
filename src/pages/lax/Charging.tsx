/**
 * "Supercharging on your trip": every Supercharger stop inside the trip window, what it cost, and the running total.
 * Live during the trip from TezLab (estimate), replaced by Tesla's billed amounts after the trip (final).
 * Data: lax_guest_public(token).charging ← trip_charges_for(reservation) ← trip_charges (synced by trip_charges_tick).
 */
import { useEffect, useState, type ReactNode } from "react";
import { BatteryCharging, CheckCircle2, ChevronRight, Clock, FileDown, Receipt, Zap } from "lucide-react";
import { track } from "./track";

export type ChargeSession = { at: string; end?: string | null; place?: string | null; address?: string | null; kwh?: number | null; from?: number | null; to?: number | null; cost?: number | null; idle?: number | null; final?: boolean; invoices?: { id: string; name?: string }[] | null };
export type Charging = { sessions: ChargeSession[]; total: number; idle: number; kwh: number; count: number; final: boolean; updated_at?: string | null };

const ACCENT = "var(--trip-accent)";
const RECEIPT = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/trip-receipt";
const money = (n: number | null | undefined) => `$${(n ?? 0).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`;
};
const shortPlace = (p?: string | null) => (p ?? "Supercharger").replace(/, CA\b/, "").replace(/^Los Angeles - /, "");

export type BatteryHealth = { score: "excellent" | "good" | "average" | "poor"; pct: number; range_full: number } | null;
const HEALTH_WORD: Record<string, string> = { excellent: "Excellent", good: "Good", average: "Normal", poor: "Worn" };

/** Sub text under the battery bar: "Battery health: Good · 192 mi when full". */
export function BatteryHealthRow({ h, className = "" }: { h: BatteryHealth | undefined; className?: string }) {
  if (!h) return null;
  return (
    <p className={`text-[12px] leading-snug text-white/55 ${className}`}>
      Battery health: <span className="font-semibold" style={{ color: ACCENT }}>{HEALTH_WORD[h.score]}</span> · <span className="whitespace-nowrap">{Math.round(h.range_full)} mi when full</span>
    </p>
  );
}

export function ChargingCard({ charging, battery, pickupBattery, health, charging_now, ended, embedded, titleFont, token, children }: {
  charging: Charging; battery?: number | null; pickupBattery?: number | null; health?: BatteryHealth; charging_now?: boolean; ended?: boolean; embedded?: boolean; titleFont?: string; token?: string; children?: ReactNode;
}) {
  const c = charging;
  const [all, setAll] = useState(false);
  const short = battery != null && pickupBattery != null ? pickupBattery - battery : null;
  const ok = short != null && short <= 0;
  const stops = all ? c.sessions : c.sessions.slice(-2).reverse();
  const receipts = !!token && c.final; // Receipts only once Tesla's final bill is in (after the trip).
  const empty = c.sessions.length === 0; // No stops: no "$0.00" hero, just what happens when they charge.
  return (
    <section id="charging" aria-label="Supercharging on your trip" className={embedded ? "" : "mt-6 scroll-mt-4 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10"}>
      {/* 1. The one number: what charging has cost so far. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>Supercharging</p>
          {empty ? (
            <>
              <p className="mt-1 text-[24px] font-bold leading-tight text-white" style={{ fontFamily: titleFont }}>{ended ? "No Supercharging" : "No Supercharging yet"}</p>
              <p className="mt-1.5 text-[13px] leading-snug text-white/65">{ended ? "Nothing to pay for charging on this trip." : "When you charge, the stop and its cost show up here in about 30 min."}</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-[34px] font-bold leading-none tabular-nums text-white" style={{ fontFamily: titleFont }}>{money(c.total)}</p>
              <p className="mt-1.5 text-[13px] text-white/65">{`${c.count} stop${c.count === 1 ? "" : "s"} so far`}{c.idle > 0 ? ` · incl. ${money(c.idle)} idle fees` : ""}</p>
            </>
          )}
        </div>
        {!empty && <span className={`mt-1 inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${c.final ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/30" : "bg-white/10 text-white/75 ring-1 ring-white/15"}`}>
          {c.final ? <><CheckCircle2 className="h-3.5 w-3.5" /> Final</> : <><Clock className="h-3.5 w-3.5" /> Estimate</>}
        </span>}
      </div>

      {/* 2. Battery: now vs the return line, health as sub text. (Bar hidden while charging: the live charging box shows it.) */}
      {!ended && (battery != null || health) && (
        <div className="mt-4 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
          {battery != null && !charging_now && (
            <>
              <div className="flex items-baseline justify-between text-[14px]">
                <span className="text-white/80">Battery <b className="text-[17px] tabular-nums text-white">{battery}%</b></span>
                {pickupBattery != null && <span className="text-white/65">Return at <b className="tabular-nums text-white">{pickupBattery}%+</b></span>}
              </div>
              <div className="relative mt-2 h-2 rounded-full bg-white/10" aria-hidden>
                <div className="h-2 rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, Math.max(2, battery))}%`, background: ok || pickupBattery == null ? ACCENT : "#FCD34D" }} />
                {pickupBattery != null && <span className="absolute -top-1 h-4 w-[2px] rounded bg-white" style={{ left: `${Math.min(100, pickupBattery)}%` }} />}
              </div>
              {short != null && short > 0 && <p className="mt-1.5 text-[13px] text-white/65">Add about {short}% before you return.</p>}
            </>
          )}
          <BatteryHealthRow h={health} className={battery != null && !charging_now ? "mt-1.5" : ""} />
        </div>
      )}

      {!ended && children}

      {/* 3. Stops: the latest two, the rest on tap. */}
      {c.sessions.length > 0 ? (
        <>
          <ol className="mt-3 divide-y divide-white/10">
            {stops.map((s) => (
              <li key={s.at} className="flex items-center gap-3 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10"><Zap className="h-4 w-4" style={{ color: ACCENT }} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-white">{shortPlace(s.place)}</p>
                  <p className="text-[13px] text-white/60">{when(s.at)}{s.from != null && s.to != null ? ` · ${s.from}% → ${s.to}%` : ""}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[15px] font-semibold tabular-nums text-white">{money((s.cost ?? 0) + (s.idle ?? 0))}</p>
                  {receipts && s.invoices?.[0] && (
                    <a href={`${RECEIPT}?t=${encodeURIComponent(token!)}&inv=${encodeURIComponent(s.invoices[0].id)}`} target="_blank" rel="noreferrer" onClick={() => track(token, "tesla_receipt")}
                      className="inline-flex min-h-[28px] items-center gap-1 text-[12px] font-semibold underline decoration-white/30 underline-offset-2" style={{ color: ACCENT }}>
                      <Receipt className="h-3.5 w-3.5" /> Receipt
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {c.sessions.length > 2 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="min-h-[44px] text-[14px] font-semibold" style={{ color: ACCENT }}>
              {all ? "Show less" : `Show all ${c.sessions.length} stops`}
            </button>
          )}
        </>
      ) : null}

      {receipts && c.count > 0 && (
        <a href={`${RECEIPT}?t=${encodeURIComponent(token!)}`} target="_blank" rel="noreferrer" onClick={() => track(token, "charge_receipt")}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-white/10 text-[15px] font-semibold text-white ring-1 ring-white/15 active:scale-[0.98]">
          <FileDown className="h-4 w-4" style={{ color: ACCENT }} /> Download receipt (PDF)
        </a>
      )}
      <p className="mt-2 text-[12px] leading-snug text-white/50">
        {empty ? "Charging is billed to the car's Tesla account; your host requests it in Turo." : <>Billed to the car's Tesla account; your host requests it in Turo.{c.final ? "" : " Final after your trip."}{c.updated_at ? ` Updated ${ago(c.updated_at)}.` : ""}</>}
      </p>
    </section>
  );
}

/** Small bolt button on the right edge during the trip. Every so often it slides open with
 *  "See your true Supercharging cost" (or the running total). Tap: jumps to the charging card. Hidden while that card is on screen. */
/** Jump to the Supercharging card (it lives in the trip carousel). */
export function openCharging() {
  window.dispatchEvent(new CustomEvent("open-section", { detail: "charging" }));
  const el = document.getElementById("charging");
  const box = (el?.closest("[aria-roledescription=carousel]") as HTMLElement | null) ?? el;
  box?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ChargingFab({ charging }: { charging: Charging }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  // Stays out of the way until the guest scrolls past the trip card + Next step (it used to sit on top of their buttons).
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const f = () => setScrolled(window.scrollY > 650); f(); window.addEventListener("scroll", f, { passive: true }); return () => window.removeEventListener("scroll", f); }, []);
  useEffect(() => {
    // Hide while the charging card or the lobby-door QR code is on screen (never cover the QR).
    const els = ["charging", "qr"].map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!els.length || !("IntersectionObserver" in window)) return;
    const seen = new Map<Element, boolean>();
    const io = new IntersectionObserver((ens) => { ens.forEach((en) => seen.set(en.target, en.isIntersecting)); setHidden([...seen.values()].some(Boolean)); }, { threshold: 0.05 });
    els.forEach((el) => io.observe(el)); return () => io.disconnect();
  });
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let t2 = 0;
    const peek = () => { setOpen(true); t2 = window.setTimeout(() => setOpen(false), 5000); };
    const first = window.setTimeout(peek, 3500);
    const every = window.setInterval(peek, 28000);
    return () => { window.clearTimeout(first); window.clearTimeout(t2); window.clearInterval(every); };
  }, []);
  const label = charging.count > 0 ? `${money(charging.total)} so far · see details` : "See your true Supercharging cost";
  const go = () => { track(undefined, "charging_fab"); openCharging(); };
  return (
    <button type="button" onClick={go} aria-label={label}
      className={`fixed right-3 z-30 flex h-[52px] items-center overflow-hidden rounded-full text-left text-white shadow-xl shadow-black/40 ring-1 ring-white/25 backdrop-blur-xl transition-all duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${hidden || !scrolled ? "pointer-events-none translate-x-24 opacity-0" : "opacity-100"}`}
      style={{ top: "46%", background: "linear-gradient(160deg, rgba(255,255,255,.24), rgba(255,255,255,.08)), rgba(12,10,24,.62)", maxWidth: open ? 300 : 52 }}>
      <span className="grid h-[52px] w-[52px] shrink-0 place-items-center">
        <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: ACCENT, boxShadow: "0 0 14px -2px var(--trip-accent)" }}>
          <Zap className="h-5 w-5 fill-[#1A1140] text-[#1A1140]" aria-hidden />
        </span>
      </span>
      <span className={`flex items-center gap-1 whitespace-nowrap pr-4 text-[14px] font-semibold transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}>
        {label}<ChevronRight className="h-4 w-4 opacity-70" aria-hidden />
      </span>
    </button>
  );
}

/** "Return it at 80%+ · Now 62%": the pickup charge as the target, with the car's live battery against it. */
const at12 = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });

/** The return charge line = the battery level when the trip started (snapshotted at the reservation start time).
 *  Before the trip starts there's no line yet: it says when it gets set and shows today's level. */
export function BatteryReturn({ target, now, observedAt, startsAt, setAt, className = "" }: {
  target?: number | null; now?: number | null; observedAt?: string | null; startsAt?: string | null; setAt?: string | null; className?: string;
}) {
  const before = target == null && !!startsAt && Date.now() < +new Date(startsAt);
  if (target == null && now == null) return null;
  if (target == null) {
    return (
      <div className={`rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10 ${className}`}>
        <div className="flex items-center justify-between gap-2 text-[14px]">
          <span className="flex items-center gap-1.5 text-white/85"><BatteryCharging className="h-4 w-4 text-emerald-300" aria-hidden /> Return charge</span>
          {now != null && <span className="text-white/70">Now <b className="tabular-nums text-white">{now}%</b></span>}
        </div>
        {now != null && (
          <div className="relative mt-2 h-2.5 rounded-full bg-white/10" aria-hidden>
            <div className="h-2.5 rounded-full bg-white/40 transition-[width] duration-700" style={{ width: `${Math.min(100, Math.max(3, now))}%` }} />
          </div>
        )}
        <p className="mt-1.5 text-[12px] leading-snug text-white/65">
          {before ? <>It's set when your trip starts{startsAt ? <> (<b className="text-white/85">{at12(startsAt)}</b>)</> : null}: bring it back with at least the charge it has then.</>
            : "Bring it back with at least the charge it had when your trip started."}
          {observedAt ? ` Updated ${ago(observedAt)}.` : ""}
        </p>
      </div>
    );
  }
  const ok = now != null && now >= target;
  return (
    <div className={`rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10 ${className}`}>
      <div className="flex items-center justify-between gap-2 text-[14px]">
        <span className="flex items-center gap-1.5 text-white/85"><BatteryCharging className="h-4 w-4 text-emerald-300" aria-hidden /> Return it at <b className="tabular-nums text-white">{target}%+</b></span>
        {now != null && <span className="text-white/70">Now <b className={`tabular-nums ${ok ? "text-emerald-300" : "text-amber-200"}`}>{now}%</b></span>}
      </div>
      {now != null && (
        <div className="relative mt-2 h-2.5 rounded-full bg-white/10" aria-hidden>
          <div className={`h-2.5 rounded-full transition-[width] duration-700 ${ok ? "bg-emerald-400" : "bg-amber-300"}`} style={{ width: `${Math.min(100, Math.max(3, now))}%` }} />
          <span className="absolute -top-1 h-[18px] w-[3px] rounded bg-white shadow" style={{ left: `calc(${Math.min(100, target)}% - 1px)` }} />
        </div>
      )}
      <p className="mt-1.5 text-[12px] leading-snug text-white/60">
        The line is the charge it had when your trip started{setAt ? ` (${at12(setAt)})` : ""}. {now == null ? "" : ok ? "You're good on charge." : `Add about ${target - now}% before you return.`}
        {observedAt ? ` Updated ${ago(observedAt)}.` : ""}
      </p>
    </div>
  );
}

/**
 * Return charge: the guest owes Turo's recharge fee only if the car comes back below the pickup level.
 * returnCharge() estimates the battery on arrival at the return spot (now − the miles to get there),
 * and Supercharger suggestions only show when that estimate is under the pickup level.
 * The live charge gauge (an Apple-style arc) only shows in the last 24 hours before return, when it matters.
 */
import { useState, type ReactNode } from "react";
import { Info, Zap } from "lucide-react";
import { SendToCar, type NavRun } from "./KeyNext";
import { RangeCheck, type RangeCheckData } from "./LiveCharge";
import type { TripKind } from "./places";

export type ReturnChargeInfo = { known: boolean; needs: boolean; arrive: number | null; add: number; used: number; miles: number | null };

export function returnCharge(battery?: number | null, pickup?: number | null, rc?: RangeCheckData): ReturnChargeInfo {
  if (battery == null || pickup == null) return { known: false, needs: false, arrive: null, add: 0, used: 0, miles: rc?.miles ?? null };
  // Battery % used per mile ≈ battery % now / real-world miles left now.
  const used = rc && rc.range_mi > 0 ? Math.ceil((rc.miles * battery) / rc.range_mi) : 0;
  const arrive = Math.max(0, battery - used);
  const needs = rc?.status === "charge" || arrive < pickup;
  return { known: true, needs, arrive, add: needs ? Math.max(1, pickup - arrive) : 0, used, miles: rc?.miles ?? null };
}

/** Semicircle gauge: filled to the estimated % on arrival, the drive back shown faint, a tick at the pickup level. */
function ChargeArc({ now, arrive, pickup, ok }: { now: number; arrive: number; pickup: number; ok: boolean }) {
  const R = 84, CX = 100, CY = 96, SW = 14;
  const pt = (pct: number, r = R) => { const a = Math.PI * (1 - Math.min(100, Math.max(0, pct)) / 100); return [CX + r * Math.cos(a), CY - r * Math.sin(a)]; };
  const arc = (from: number, to: number) => { const [x1, y1] = pt(from), [x2, y2] = pt(to); return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
  const color = ok ? "#34C759" : "#FF9F0A"; // Apple system green / orange
  const [t1x, t1y] = pt(pickup, R - SW / 2 - 4), [t2x, t2y] = pt(pickup, R + SW / 2 + 4);
  return (
    <svg viewBox="0 0 200 108" className="mx-auto block w-full max-w-[260px]" role="img"
      aria-label={`About ${arrive}% when you get back. Charge at pick-up was ${pickup}%. Now ${now}%.`}>
      <path d={arc(0, 100)} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth={SW} strokeLinecap="round" />
      {now > arrive && <path d={arc(arrive, now)} fill="none" stroke={color} strokeOpacity=".35" strokeWidth={SW} strokeLinecap="round" />}
      {/* Short of the pick-up charge: the missing part is drawn as a dotted orange gap up to the tick. */}
      {!ok && pickup > arrive && <path d={arc(arrive, pickup)} fill="none" stroke={color} strokeOpacity=".95" strokeWidth={3} strokeDasharray="4 4" strokeLinecap="butt" />}
      {arrive > 0 && <path d={arc(0, arrive)} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" className="transition-all duration-700" />}
      <line x1={t1x} y1={t1y} x2={t2x} y2={t2y} stroke="white" strokeWidth="3" strokeLinecap="round" />
      <text x={CX} y={CY - 16} textAnchor="middle" fontSize="34" fontWeight="700" fill="white" style={{ fontVariantNumeric: "tabular-nums" }}>{arrive}%</text>
      <text x={CX} y={CY + 2} textAnchor="middle" fontSize="10" fontWeight="500" fill="rgba(255,255,255,.65)">when you get back</text>
    </svg>
  );
}

/** Show the return charge only when it matters: last 24 hours before return, or when they'd come back short. */
export function returnChargeLive(battery?: number | null, pickup?: number | null, rc?: RangeCheckData, endsAt?: string | null): boolean {
  const r = returnCharge(battery, pickup, rc);
  const hoursLeft = endsAt ? (+new Date(endsAt) - Date.now()) / 3600e3 : null;
  const near = hoursLeft != null && hoursLeft <= 24 && hoursLeft > -2;
  return r.known && r.arrive != null && (near || r.needs);
}

/** Step 1 of both Return sheets. Renders nothing until returnChargeLive() says it matters. */
export function ReturnChargeBlock({ kind, pickup, battery, rc, run, endsAt, observedAt, compact, check }: {
  kind: TripKind; pickup?: number | null; battery?: number | null; rc?: RangeCheckData; run?: NavRun; compact?: boolean; check?: ReactNode;
  setAt?: string | null; startsAt?: string | null; endsAt?: string | null; observedAt?: string | null; lead?: ReactNode;
}) {
  const [why, setWhy] = useState(false);
  const r = returnCharge(battery, pickup, rc);
  const level = pickup != null ? <b className="text-white">{pickup}%</b> : null;
  const spot = kind === "home" ? "N Kings Rd" : "the garage";
  if (!returnChargeLive(battery, pickup, rc, endsAt) || battery == null || pickup == null) return null;
  return (
    <div>
      {r.needs
        ? (
          <>
            <p className="flex items-start gap-2 text-[16px] font-semibold leading-snug text-white"><Zap className="mt-0.5 h-[18px] w-[18px] shrink-0 fill-[#FF9F0A] text-[#FF9F0A]" aria-hidden />Add about {r.add}% before you return</p>
            <p className="mt-1 text-[14px] leading-snug text-white/70">It would get back at about {r.arrive}%. Bring it back at {level}, the charge at pick-up, to avoid Turo's recharge fee.</p>
          </>
        )
        : (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-semibold text-white">You're good on charge</span>
            <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} aria-label="How we worked this out"
              className="-m-2.5 grid h-11 w-11 place-items-center rounded-full text-white/60 active:scale-95">
              <Info className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </span>
        )}
      {check}
      {why && !r.needs && (
        <p className="mt-2 rounded-xl bg-white/[0.06] px-3 py-2 text-[13px] leading-snug text-white/75 ring-1 ring-white/10">
          It's at {battery}% now. The drive back to {spot}{r.miles != null ? ` (about ${r.miles} mi)` : ""} uses about {r.used}%, so it should get back at about {r.arrive}%.
          Turo only charges a recharge fee if it comes back under {pickup}%, the charge at pick-up.
        </p>
      )}
      <div className="mt-3 rounded-2xl bg-white/[0.05] px-3 pb-3 pt-2 ring-1 ring-white/10">
        <ChargeArc now={battery} arrive={r.arrive!} pickup={pickup} ok={!r.needs} />
        <div className="mt-1 grid grid-cols-3 divide-x divide-white/10 text-center">
          <p className="px-1 text-[12px] text-white/60">Now<b className="mt-0.5 block text-[16px] font-semibold tabular-nums text-white">{battery}%</b></p>
          <p className="px-1 text-[12px] text-white/60">Drive back<b className="mt-0.5 block text-[16px] font-semibold tabular-nums text-white">{r.miles != null ? `${Math.round(r.miles)} mi` : "—"}</b></p>
          <p className="px-1 text-[12px] text-white/60">Charge at pick-up<b className="mt-0.5 block text-[16px] font-semibold tabular-nums text-white">{pickup}%</b></p>
        </div>
        {observedAt && <p className="mt-2 text-center text-[11px] text-white/45">Updated {new Date(observedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })}</p>}
      </div>
      {!compact && <RangeCheck rc={rc} kind={kind} className="mt-3" warnOnly />}
      {r.needs && (compact ? <SendToCar center run={run} kind={kind} label="Send nearest Supercharger to car" /> : <><span className="mt-3 block text-center text-[13px] text-white/65">Picks the Supercharger closest to where the car is now.</span><SendToCar center run={run} kind={kind} label="Send nearest Supercharger to car" /></>)}
    </div>
  );
}

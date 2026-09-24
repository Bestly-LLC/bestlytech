/**
 * Return charge: the guest owes Turo's recharge fee only if the car comes back below the pickup level.
 * returnCharge() estimates the battery on arrival at the return spot (now − the miles to get there),
 * and Supercharger suggestions only show when that estimate is under the pickup level.
 */
import type { ReactNode } from "react";
import { BatteryReturn } from "./Charging";
import { ChargerLine, SendToCar, type NavRun } from "./KeyNext";
import { RangeCheck, type RangeCheckData } from "./LiveCharge";
import type { TripKind } from "./places";

export type ReturnChargeInfo = { known: boolean; needs: boolean; arrive: number | null; add: number };

export function returnCharge(battery?: number | null, pickup?: number | null, rc?: RangeCheckData): ReturnChargeInfo {
  if (battery == null || pickup == null) return { known: false, needs: false, arrive: null, add: 0 };
  // Battery % used per mile ≈ battery % now / real-world miles left now.
  const used = rc && rc.range_mi > 0 ? Math.ceil((rc.miles * battery) / rc.range_mi) : 0;
  const arrive = Math.max(0, battery - used);
  const cantReach = rc?.status === "charge";
  const needs = cantReach || arrive < pickup;
  return { known: true, needs, arrive, add: Math.max(1, pickup - arrive) * (needs ? 1 : 0) };
}

/** Step 1 of both Return sheets. */
export function ReturnChargeBlock({ kind, pickup, battery, rc, run, setAt, startsAt, observedAt, lead }: {
  kind: TripKind; pickup?: number | null; battery?: number | null; rc?: RangeCheckData; run?: NavRun;
  setAt?: string | null; startsAt?: string | null; observedAt?: string | null; lead?: ReactNode;
}) {
  const r = returnCharge(battery, pickup, rc);
  const level = pickup != null ? <b className="text-white">{pickup}%</b> : null;
  return (
    <div>
      {lead}
      {r.needs ? (
        <>Charge before you return: bring it back at {level}, the same charge it had at pickup, to avoid Turo's recharge fee. <b className="text-white">Add about {r.add}%.</b></>
      ) : r.known ? (
        <>You're good on charge. It should get back at about <b className="text-white">{r.arrive}%</b>, and it had {level} at pickup.</>
      ) : (
        <>Bring it back with the same charge it had at pickup{level ? <> ({level})</> : ""}.</>
      )}
      <RangeCheck rc={rc} kind={kind} className="mt-3" warnOnly />
      <BatteryReturn className="mt-3" startsAt={startsAt} setAt={setAt} target={pickup} now={battery} arrive={r.arrive} observedAt={observedAt} />
      {r.needs && <><span className="mt-3 block"><ChargerLine kind={kind} /></span><SendToCar run={run} kind={kind} /></>}
    </div>
  );
}

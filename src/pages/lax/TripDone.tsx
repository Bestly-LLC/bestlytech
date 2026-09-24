/**
 * After the trip ends, both trip pages collapse to this: a thank-you, what's left to do in Turo,
 * and (once the charging summary ships) what was charged at Superchargers during the trip.
 * The car, climate, key, guide and videos are hidden: none of it applies any more.
 */
import { CheckCircle2, ExternalLink, KeyRound, Camera } from "lucide-react";
import { fmtWhen, type Trip } from "./GuestExtras";
import { TURO_TRIPS } from "./places";
import { track } from "./track";

const ACCENT = "var(--trip-accent)";

export function OpenTuro({ label = "Open the Turo app", className = "", primary = false }: { label?: string; className?: string; primary?: boolean }) {
  return (
    <a href={TURO_TRIPS} target="_blank" rel="noreferrer" onClick={() => track(undefined, "turo_app")}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-4 text-[15px] font-semibold active:scale-[0.98] ${primary ? "text-[#1A1140] shadow-lg shadow-black/25" : "bg-white/10 text-white ring-1 ring-white/15"} ${className}`}
      style={primary ? { background: ACCENT } : undefined}>
      <ExternalLink className="h-4 w-4" aria-hidden /> {label}
    </a>
  );
}

export function TripDone({ trip, titleFont }: { trip: Trip; titleFont?: string }) {
  const rows = [
    { icon: Camera, title: "Return photos", body: "If you haven't yet, add your return photos in the Turo app. They protect you." },
    { icon: KeyRound, title: "Your key is off", body: "Tesla access turned off by itself. Nothing to hand back." },
    { icon: CheckCircle2, title: "Charging and extras", body: "Any Supercharger costs from your trip come through Turo as a reimbursement request." },
  ];
  return (
    <section aria-label="Trip complete" className="mt-5 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>Trip complete · {fmtWhen(trip.ends_at)}</p>
      <h2 className="mt-1 text-[22px] font-bold leading-snug text-white" style={{ fontFamily: titleFont }}>Thanks for driving with us{trip.first ? `, ${trip.first}` : ""}.</h2>
      <ol className="mt-3 divide-y divide-white/10">
        {rows.map((r) => (
          <li key={r.title} className="flex items-start gap-3 py-3">
            <r.icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: ACCENT }} strokeWidth={1.75} aria-hidden />
            <div className="min-w-0"><p className="text-[15px] font-semibold text-white">{r.title}</p><p className="mt-0.5 text-[14px] leading-snug text-white/75">{r.body}</p></div>
          </li>
        ))}
      </ol>
      <OpenTuro primary className="mt-2 w-full" label="Open the Turo app" />
      <p className="mt-2 text-center text-[12px] text-white/60">A review in Turo helps a lot. Thank you.</p>
    </section>
  );
}

export const tripEnded = (trip?: Trip | null) => !!trip && Date.now() >= +new Date(trip.ends_at);

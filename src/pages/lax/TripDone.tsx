/**
 * After the trip ends, both trip pages collapse to this: a thank-you, what's left to do in Turo,
 * and (once the charging summary ships) what was charged at Superchargers during the trip.
 * The car, climate, key, guide and videos are hidden: none of it applies any more.
 */
import { CheckCircle2, ExternalLink, KeyRound, Camera, Star } from "lucide-react";
import { fmtWhen, type Trip } from "./GuestExtras";
import { TURO_TRIPS } from "./places";
import { track } from "./track";
import { ChargingCard, type Charging } from "./Charging";

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

export function TripDone({ trip, titleFont, charging, token }: { trip: Trip; titleFont?: string; charging?: Charging | null; token?: string }) {
  const rows = [
    { icon: Camera, title: "Return photos", body: "If you haven't yet, add your return photos in the Turo app. They protect you." },
    { icon: KeyRound, title: "Your key is off", body: "Tesla access turned off by itself. Nothing to hand back." },
    { icon: CheckCircle2, title: "Charging and extras", body: charging && charging.count > 0
      ? `Your Supercharging (${charging.final ? "" : "about "}$${charging.total.toFixed(2)}) comes through Turo as a reimbursement request.`
      : "Any Supercharger costs from your trip come through Turo as a reimbursement request." },
  ];
  return (
    <section aria-label="Trip complete" className="mt-5 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>Trip complete · {fmtWhen(trip.ends_at)}</p>
      <h2 className="mt-1 text-[22px] font-bold leading-snug text-white" style={{ fontFamily: titleFont }}>Thanks for driving with us{trip.first ? `, ${trip.first}` : ""}.</h2>
      {charging && <div className="mt-4 rounded-2xl bg-white/[0.05] p-3.5 ring-1 ring-white/10"><ChargingCard charging={charging} ended embedded titleFont={titleFont} token={token} /></div>}
      <ol className="mt-3 divide-y divide-white/10">
        {rows.map((r) => (
          <li key={r.title} className="flex items-start gap-3 py-3">
            <r.icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: ACCENT }} strokeWidth={1.75} aria-hidden />
            <div className="min-w-0"><p className="text-[15px] font-semibold text-white">{r.title}</p><p className="mt-0.5 text-[14px] leading-snug text-white/75">{r.body}</p></div>
          </li>
        ))}
      </ol>
      <OpenTuro primary className="mt-2 w-full" label="Open the Turo app" />
      <ReviewAsk titleFont={titleFont} />
    </section>
  );
}

/** Glass card asking for a Turo review: five gold stars, a light sweep across the glass, one button. */
function ReviewAsk({ titleFont }: { titleFont?: string }) {
  return (
    <a href={TURO_TRIPS} target="_blank" rel="noreferrer" onClick={() => track(undefined, "review_tap")}
      className="trip-glass mt-4 block overflow-hidden rounded-3xl p-5 text-center active:scale-[0.99]">
      <span className="flex justify-center gap-1.5" aria-label="5 stars">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className="trip-star h-9 w-9 fill-[#FFD60A] text-[#FFD60A]" style={{ animationDelay: `${i * 90}ms` }} strokeWidth={1.25} aria-hidden />
        ))}
      </span>
      <span className="mt-3 block text-[22px] font-bold leading-tight text-white" style={{ fontFamily: titleFont }}>Enjoyed the ride?</span>
      <span className="mt-1.5 block text-[15px] leading-snug text-white/80">A 5-star review in Turo helps a lot. It takes 30 seconds.</span>
      <span className="mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-white px-6 text-[16px] font-bold text-[#1A1140] shadow-lg shadow-black/30">
        <Star className="h-4 w-4 fill-[#FFB800] text-[#FFB800]" aria-hidden /> Leave a review in Turo
      </span>
    </a>
  );
}

/** The page keeps its return mode for 30 minutes after the official end (a guest still parking/locking), then shows "Trip ended". */
export const END_GRACE = 30 * 60e3;
export const tripEnded = (trip?: Trip | null) => !!trip && Date.now() >= +new Date(trip.ends_at) + END_GRACE;

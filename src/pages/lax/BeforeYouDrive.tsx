/**
 * "Before you drive" as a swipeable carousel with midcentury-style illustrations (original, inline SVG).
 * Order matters: trip changes first (it's the one that costs guests money when they get it wrong).
 * Scroll-snap on phones, arrows + dots for everyone else. Colors follow the page theme vars.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";

const MUSTARD = "#E8A93A", ORANGE = "#E36F3C", CREAM = "#F4EAD5", TEAL = "#2a6b66", DEEP = "#132726", OLIVE = "#6f7d3a";
const star = (cx: number, cy: number, r: number, fill = CREAM) => {
  const p: string[] = [];
  for (let i = 0; i < 16; i++) { const a = (Math.PI * i) / 8 - Math.PI / 2, rr = i % 2 ? r * 0.26 : r; p.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`); }
  return <polygon points={p.join(" ")} fill={fill} />;
};

/** Phone with a calendar and a swap arrow: change your trip in the Turo app. */
const ArtChanges = () => (
  <svg viewBox="0 0 200 120" aria-hidden className="h-full w-full">
    <circle cx="150" cy="60" r="44" fill={TEAL} />
    <rect x="70" y="14" width="60" height="100" rx="12" fill={CREAM} />
    <rect x="77" y="26" width="46" height="72" rx="4" fill={DEEP} />
    <rect x="84" y="36" width="32" height="28" rx="3" fill={CREAM} />
    <rect x="84" y="36" width="32" height="8" rx="2" fill={ORANGE} />
    {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={88 + c * 9} y={48 + r * 5} width="5" height="3" fill={r === 1 && c === 2 ? MUSTARD : "#b9ae98"} />))}
    <path d="M86 78 h22 l-5 -5 M114 86 h-22 l5 5" stroke={MUSTARD} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    {star(40, 34, 12, MUSTARD)}{star(172, 18, 7)}
  </svg>
);
/** Seat with a profile badge: pick the Turo Guest driver profile. */
const ArtProfile = () => (
  <svg viewBox="0 0 200 120" aria-hidden className="h-full w-full">
    <circle cx="60" cy="62" r="42" fill={OLIVE} />
    <path d="M92 104 q-6 -40 6 -78 q4 -10 14 -8 q10 3 8 14 l-8 52 h30 q12 0 12 12 v8z" fill={ORANGE} />
    <rect x="96" y="104" width="62" height="6" rx="3" fill={DEEP} />
    <circle cx="160" cy="34" r="20" fill={CREAM} />
    <circle cx="160" cy="29" r="6" fill={DEEP} /><path d="M148 45 q12 -14 24 0" fill={DEEP} />
    <rect x="130" y="62" width="58" height="16" rx="8" fill={MUSTARD} />
    <text x="159" y="74" textAnchor="middle" fontSize="10" fontWeight="700" fill={DEEP} fontFamily="Futura, Avenir Next, sans-serif">GUEST</text>
    {star(30, 22, 9)}
  </svg>
);
/** Center console with a registration card: paperwork stays in the car. */
const ArtPaperwork = () => (
  <svg viewBox="0 0 200 120" aria-hidden className="h-full w-full">
    <circle cx="140" cy="58" r="46" fill={MUSTARD} />
    <rect x="40" y="62" width="120" height="48" rx="10" fill={DEEP} />
    <rect x="48" y="54" width="104" height="14" rx="7" fill={TEAL} />
    <g transform="rotate(-8 100 42)">
      <rect x="66" y="14" width="68" height="46" rx="4" fill={CREAM} />
      <rect x="72" y="20" width="26" height="6" rx="2" fill={ORANGE} />
      <rect x="72" y="31" width="54" height="3" fill="#b9ae98" /><rect x="72" y="38" width="44" height="3" fill="#b9ae98" /><rect x="72" y="45" width="50" height="3" fill="#b9ae98" />
      <text x="126" y="27" textAnchor="end" fontSize="8" fontWeight="700" fill={DEEP} fontFamily="Futura, Avenir Next, sans-serif">CA</text>
    </g>
    {star(24, 30, 10, ORANGE)}{star(182, 16, 6)}
  </svg>
);
/** Sparkling clean car: avoid the cleaning fee. */
const ArtClean = () => (
  <svg viewBox="0 0 200 120" aria-hidden className="h-full w-full">
    <circle cx="100" cy="62" r="50" fill={TEAL} />
    <path d="M44 86 q2 -18 18 -22 l20 -16 q8 -6 20 -6 h14 q12 0 20 8 l14 14 q16 4 16 22 v6 h-122z" fill={CREAM} />
    <path d="M86 50 h28 q8 0 13 6 l7 8 h-56 l8 -9 q3 -5 0 -5z" fill="#9fd3cc" />
    <circle cx="70" cy="94" r="11" fill={DEEP} /><circle cx="70" cy="94" r="4" fill="#b9ae98" />
    <circle cx="136" cy="94" r="11" fill={DEEP} /><circle cx="136" cy="94" r="4" fill="#b9ae98" />
    {star(40, 30, 13, MUSTARD)}{star(160, 26, 10, MUSTARD)}{star(176, 58, 6)}{star(28, 64, 6)}
  </svg>
);
/** Phone as the key, no key card. */
const ArtPhoneKey = () => (
  <svg viewBox="0 0 200 120" aria-hidden className="h-full w-full">
    <circle cx="58" cy="60" r="44" fill={ORANGE} />
    <rect x="42" y="16" width="44" height="88" rx="10" fill={DEEP} />
    <rect x="47" y="26" width="34" height="64" rx="3" fill={CREAM} />
    <circle cx="64" cy="50" r="9" fill="none" stroke={MUSTARD} strokeWidth="4" /><path d="M64 59 v18 m0 -6 h6 m-6 -6 h5" stroke={MUSTARD} strokeWidth="4" strokeLinecap="round" />
    <g transform="translate(140 60) rotate(12)">
      <rect x="-28" y="-18" width="56" height="36" rx="5" fill={CREAM} />
      <path d="M-34 -24 L34 24" stroke={ORANGE} strokeWidth="7" strokeLinecap="round" />
    </g>
    {star(178, 18, 8, MUSTARD)}{star(108, 22, 6)}
  </svg>
);

type Slide = { art: () => JSX.Element; kicker: string; title: string; body: ReactNode; cta?: { label: string; href: string } };

const turoApp = () => /android/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent)
  ? "https://play.google.com/store/apps/details?id=com.relayrides.android.relayrides" : "https://apps.apple.com/us/app/turo-better-car-rental/id555063314";

const SLIDES: Slide[] = [
  { art: ArtChanges, kicker: "1 · Changes to your trip", title: "Change it in the Turo app",
    body: <>Extending, shortening or changing times? Do it only in the Turo app so you're covered. Questions go to your host there too.</>,
    cta: { label: "Open the Turo app", href: "" } },
  { art: ArtProfile, kicker: "2 · Driver profile", title: "Pick the Turo Guest profile",
    body: <>Tap <b className="text-white">Easy Entry</b> at the top of the screen and choose <b className="text-white">Turo Guest</b> to save your seat and mirrors. Please don't change the host's profile.</> },
  { art: ArtPaperwork, kicker: "3 · Paperwork", title: "Registration stays in the car",
    body: <>The California registration is in the center console glovebox. The Turo incident card is in the Accidents &amp; roadside section below.</> },
  { art: ArtClean, kicker: "4 · Keep it clean", title: "Bring it back tidy",
    body: <>A little sand or crumbs is fine. If it comes back overly dirty, Turo may add a cleaning fee.</> },
  { art: ArtPhoneKey, kicker: "5 · No key card", title: "Your phone is the key",
    body: <>This car doesn't come with a key card. Keep your phone charged and Bluetooth on. Valet steps are below.</> },
];

export function BeforeYouDrive() {
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const on = () => setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth * 0.86)));
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, []);
  const go = (n: number) => {
    const el = track.current;
    const card = el?.children[Math.max(0, Math.min(SLIDES.length - 1, n))] as HTMLElement | undefined;
    if (el && card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: "smooth" });
  };
  return (
    <div className="-mx-4 pb-4 pt-2" id="before">
      <div className="flex items-end justify-between px-4">
        <p className="text-[16px] font-semibold text-white">Before you drive</p>
        <div className="flex gap-1.5">
          <button type="button" aria-label="Previous" onClick={() => go(i - 1)} disabled={i === 0} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" aria-label="Next" onClick={() => go(i + 1)} disabled={i >= SLIDES.length - 1} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
        </div>
      </div>
      <div ref={track} className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="region" aria-roledescription="carousel" aria-label="Before you drive">
        {SLIDES.map((s, n) => (
          <article key={s.kicker} aria-roledescription="slide" aria-label={`${n + 1} of ${SLIDES.length}`}
            className="w-[86%] shrink-0 snap-start overflow-hidden rounded-3xl bg-[#1f4442] ring-1 ring-white/10">
            <div className="h-[132px] bg-[#183433] px-4 pt-3"><s.art /></div>
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--trip-accent)" }}>{s.kicker}</p>
              <h3 className="mt-1 text-[18px] font-bold leading-snug text-white" style={{ fontFamily: "'Josefin Sans', Futura, 'Avenir Next', sans-serif" }}>{s.title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-white/80">{s.body}</p>
              {s.cta && (
                <a href={s.cta.href || turoApp()} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[15px] font-semibold text-[#132726]" style={{ background: "var(--trip-accent)" }}>
                  <ExternalLink className="h-4 w-4" /> {s.cta.label}
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
        {SLIDES.map((s, n) => <span key={s.kicker} className={`h-1.5 rounded-full transition-all ${n === i ? "w-5" : "w-1.5 bg-white/25"}`} style={n === i ? { background: "var(--trip-accent)" } : undefined} />)}
      </div>
    </div>
  );
}

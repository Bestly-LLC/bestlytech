/**
 * Small Bestly ad at the very bottom of both trip pages. Collapsed by default so it never competes
 * with the trip; the open pane has a little illustration of what we build (phone key, live car, pass).
 */
import { ArrowRight } from "lucide-react";
import { Collapse } from "./Collapse";

function Art() {
  // Theme-aware: strokes and fills use the page accent.
  const A = "var(--trip-accent, #FFB878)";
  return (
    <svg viewBox="0 0 320 132" className="h-auto w-full" role="img" aria-label="A phone showing a car key, live car info and a pass">
      <defs>
        <linearGradient id="ba-glow" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity=".16" /><stop offset="1" stopColor="white" stopOpacity=".03" />
        </linearGradient>
      </defs>
      {/* phone */}
      <rect x="118" y="6" width="84" height="120" rx="16" fill="#0d0b1a" stroke="white" strokeOpacity=".25" strokeWidth="1.5" />
      <rect x="146" y="12" width="28" height="5" rx="2.5" fill="white" fillOpacity=".18" />
      <rect x="126" y="26" width="68" height="26" rx="8" fill="url(#ba-glow)" />
      <circle cx="140" cy="39" r="8" fill={A} />
      <path d="M137.5 39.5a2.5 2.5 0 1 1 5 0l4 0m-2 0v2.5" stroke="#1A1140" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <rect x="152" y="34" width="34" height="4" rx="2" fill="white" fillOpacity=".7" />
      <rect x="152" y="41" width="22" height="3" rx="1.5" fill="white" fillOpacity=".35" />
      <rect x="126" y="58" width="32" height="30" rx="8" fill="url(#ba-glow)" />
      <text x="142" y="78" textAnchor="middle" fontSize="11" fontWeight="700" fill="white">72°</text>
      <rect x="162" y="58" width="32" height="30" rx="8" fill="url(#ba-glow)" />
      <rect x="170" y="66" width="16" height="14" rx="2" fill="none" stroke={A} strokeWidth="1.5" />
      <path d="M173 70h3v3h-3zM180 74h3v3h-3z" fill={A} />
      <rect x="126" y="94" width="68" height="22" rx="11" fill={A} />
      <rect x="140" y="103" width="40" height="4" rx="2" fill="#1A1140" fillOpacity=".7" />
      {/* car, left */}
      <g transform="translate(8 70)" opacity=".9">
        <path d="M6 30c0-8 6-12 14-14l12-10c3-2 6-3 10-3h26c4 0 7 1 10 4l10 9c7 1 12 6 12 14v4H6z" fill="white" fillOpacity=".12" stroke="white" strokeOpacity=".35" strokeWidth="1.5" />
        <circle cx="28" cy="36" r="8" fill="#0d0b1a" stroke={A} strokeWidth="2" /><circle cx="78" cy="36" r="8" fill="#0d0b1a" stroke={A} strokeWidth="2" />
      </g>
      <path d="M104 88c6 0 8-10 12-14" stroke={A} strokeWidth="1.5" strokeDasharray="3 4" fill="none" strokeLinecap="round" />
      {/* sparkles + chart, right */}
      <g transform="translate(222 22)">
        <rect x="0" y="0" width="86" height="56" rx="12" fill="url(#ba-glow)" stroke="white" strokeOpacity=".15" />
        <path d="M10 44l16-12 14 6 16-16 18 8" stroke={A} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="74" cy="30" r="3" fill={A} />
      </g>
      <path d="M262 96l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={A} opacity=".85" />
      <path d="M292 88l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="white" opacity=".5" />
    </svg>
  );
}

export function BestlyAd({ campaign, blurb }: { campaign: string; blurb: string }) {
  return (
    <Collapse id="bestly" kicker="Who made this page?" title="Bestly built it" summary="We can build one for your business." defaultOpen={false} className="mt-8"
      style={{ background: "linear-gradient(135deg, rgba(122,46,158,0.28), rgba(43,26,115,0.5))" }}>
      <div className="px-4 pb-5">
        <div className="rounded-2xl bg-black/20 p-3 ring-1 ring-white/10"><Art /></div>
        <p className="mt-3 text-[15px] leading-relaxed text-white/75">{blurb}</p>
        <a href={`https://www.bestly.tech/hire?utm_source=turo&utm_medium=guest-page&utm_campaign=${campaign}`} target="_blank" rel="noopener"
          className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-full bg-white px-5 text-[15px] font-semibold text-[#1A1140] active:scale-[0.98]">
          Tell us what you need <ArrowRight className="h-4 w-4" aria-hidden />
        </a>
        <span className="mt-3 block text-[12px] text-white/45">bestly.tech · Los Angeles</span>
      </div>
    </Collapse>
  );
}

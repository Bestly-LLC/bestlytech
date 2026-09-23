/**
 * The weather picture. Hand-drawn SVG scenes rather than a line icon, because this
 * sits next to the greeting at the top of the dashboard and a 14px glyph there reads
 * as chrome instead of information.
 *
 * Each scene is built from the same parts (sun, moon, cloud, precipitation) so they
 * share a visual language, and each moves just enough to feel alive - rays turning,
 * cloud drifting, drops falling. Everything stops under prefers-reduced-motion.
 */
import { cn } from "@/lib/utils";

type Props = { code: string; day: boolean; className?: string };

/** One shared stylesheet; mounting several glyphs does not multiply it. */
const CSS = `
@keyframes wx-spin { to { transform: rotate(360deg) } }
@keyframes wx-drift { 0%,100% { transform: translateX(-1.5px) } 50% { transform: translateX(1.5px) } }
@keyframes wx-fall { 0% { transform: translateY(-3px); opacity: 0 } 25% { opacity: 1 } 100% { transform: translateY(9px); opacity: 0 } }
@keyframes wx-twinkle { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
@keyframes wx-flash { 0%,92%,100% { opacity: 1 } 95% { opacity: .25 } }
@keyframes wx-gust { 0% { stroke-dashoffset: 26 } 100% { stroke-dashoffset: 0 } }
.wx-rays { animation: wx-spin 42s linear infinite; transform-origin: 26px 24px }
.wx-cloud { animation: wx-drift 7s ease-in-out infinite }
.wx-drop { animation: wx-fall 1.5s linear infinite }
.wx-star { animation: wx-twinkle 3.2s ease-in-out infinite }
.wx-bolt { animation: wx-flash 4s linear infinite }
.wx-gust { stroke-dasharray: 26; animation: wx-gust 3s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) {
  .wx-rays, .wx-cloud, .wx-drop, .wx-star, .wx-bolt, .wx-gust { animation: none }
}

/* The scenes were drawn for the black admin shell: white clouds, a near-white moon,
   pale fog. On the light card those all but disappeared. Same drawing, two palettes -
   on the light theme the cloud picks up enough slate to read against a pale sky. */
.wx-glyph {
  --wx-cloud-a: #ffffff; --wx-cloud-b: #cbd5e1;
  --wx-dark-a:  #cbd5e1; --wx-dark-b:  #7c8ba1;
  --wx-moon-a:  #f1f5f9; --wx-moon-b:  #94a3b8;
  --wx-star:    #cfe3ff;
  --wx-line:    #cbd5e1;
  --wx-rain:    #38bdf8;
  --wx-drizzle: #7dd3fc;
  --wx-snow:    #e0f2fe;
}
.admin-bento .wx-glyph {
  --wx-cloud-a: #f8fafc; --wx-cloud-b: #94a3b8;
  --wx-dark-a:  #94a3b8; --wx-dark-b:  #475569;
  --wx-moon-a:  #cbd5e1; --wx-moon-b:  #64748b;
  --wx-star:    #7c93b8;
  --wx-line:    #94a3b8;
  --wx-rain:    #0284c7;
  --wx-drizzle: #38bdf8;
  --wx-snow:    #7dd3fc;
}
`;

const Sun = ({ cx = 26, cy = 24, r = 9 }: { cx?: number; cy?: number; r?: number }) => (
  <>
    <g className="wx-rays">
      {Array.from({ length: 8 }, (_, i) => (
        <line
          key={i}
          x1={cx} y1={cy - r - 3.5} x2={cx} y2={cy - r - 7.5}
          stroke="url(#wx-sun)" strokeWidth="2.6" strokeLinecap="round"
          transform={`rotate(${i * 45} ${cx} ${cy})`}
        />
      ))}
    </g>
    <circle cx={cx} cy={cy} r={r} fill="url(#wx-sun)" />
  </>
);

const Moon = () => (
  <>
    <path d="M32 18a11 11 0 1 1-11-6 9 9 0 0 0 11 6Z" fill="url(#wx-moon)" />
    {[[38, 13, 1.6], [42, 22, 1.1], [34, 29, 1.2]].map(([x, y, r], i) => (
      <circle key={i} className="wx-star" cx={x} cy={y} r={r} fill="var(--wx-star)" style={{ animationDelay: `${i * 0.9}s` }} />
    ))}
  </>
);

const Cloud = ({ x = 0, y = 0, s = 1, fill = "url(#wx-cloud)", opacity }: { x?: number; y?: number; s?: number; fill?: string; opacity?: number }) => (
  <g className="wx-cloud" transform={`translate(${x} ${y}) scale(${s})`}>
    <path
      d="M18 40a9 9 0 0 1 .6-17.9 13 13 0 0 1 24.6 3.4A8 8 0 0 1 42 40Z"
      fill={fill}
      opacity={opacity}
    />
  </g>
);

const Drops = ({ fill, round }: { fill: string; round?: boolean }) =>
  <>{[20, 29, 38].map((x, i) => (
    round
      ? <circle key={x} className="wx-drop" cx={x} cy={45} r="2.3" fill={fill} style={{ animationDelay: `${i * 0.45}s` }} />
      : <line key={x} className="wx-drop" x1={x} y1={43} x2={x - 1.5} y2={48} stroke={fill} strokeWidth="2.4" strokeLinecap="round" style={{ animationDelay: `${i * 0.35}s` }} />
  ))}</>;

function scene(code: string, day: boolean) {
  const c = code.toLowerCase();
  if (c.includes("thunder") || c.includes("tornado") || c.includes("hurricane"))
    return <><Cloud fill="url(#wx-dark)" /><path className="wx-bolt" d="M30 40l-6 9h5l-2 8 8-11h-5l3-6Z" fill="#fbbf24" /></>;
  if (c.includes("snow") || c.includes("flurr") || c.includes("blizzard") || c.includes("sleet") || c.includes("hail"))
    return <><Cloud /><Drops fill="var(--wx-snow)" round /></>;
  if (c.includes("drizzle")) return <><Cloud /><Drops fill="var(--wx-drizzle)" round /></>;
  if (c.includes("rain") || c.includes("shower")) return <><Cloud fill="url(#wx-dark)" /><Drops fill="var(--wx-rain)" /></>;
  if (c.includes("fog") || c.includes("haze") || c.includes("smoke") || c.includes("dust"))
    return <><Cloud /><>{[44, 49].map((y, i) => (
      <line key={y} className="wx-gust" x1="14" y1={y} x2="46" y2={y} stroke="var(--wx-line)" strokeWidth="2.4" strokeLinecap="round" style={{ animationDelay: `${i * 0.7}s` }} />
    ))}</></>;
  if (c.includes("wind") || c.includes("breezy"))
    return <><Cloud />{[44, 50].map((y, i) => (
      <path key={y} className="wx-gust" d={`M14 ${y}h22a4 4 0 1 0-4-4`} fill="none" stroke="var(--wx-line)" strokeWidth="2.4" strokeLinecap="round" style={{ animationDelay: `${i * 0.6}s` }} />
    ))}</>;
  // Partly / mostly cloudy: the light source peeks out from behind.
  if (c.includes("partly") || c.includes("mostly cloud") || c.includes("scattered"))
    return <><g transform="translate(6 -4) scale(0.8)">{day ? <Sun /> : <Moon />}</g><Cloud y={4} /></>;
  if (c.includes("cloud")) return <><Cloud fill="url(#wx-cloud)" /><Cloud x={-7} y={-6} s={0.55} fill="var(--wx-cloud-a)" opacity={0.22} /></>;
  return day ? <Sun /> : <Moon />;
}

export function WeatherGlyph({ code, day, className }: Props) {
  return (
    <svg viewBox="0 0 60 60" className={cn("wx-glyph", className)} role="img" aria-label={code} focusable="false">
      <style>{CSS}</style>
      <defs>
        <linearGradient id="wx-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" /><stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id="wx-moon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--wx-moon-a)" }} /><stop offset="100%" style={{ stopColor: "var(--wx-moon-b)" }} />
        </linearGradient>
        <linearGradient id="wx-cloud" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--wx-cloud-a)" }} /><stop offset="100%" style={{ stopColor: "var(--wx-cloud-b)" }} />
        </linearGradient>
        <linearGradient id="wx-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--wx-dark-a)" }} /><stop offset="100%" style={{ stopColor: "var(--wx-dark-b)" }} />
        </linearGradient>
      </defs>
      {scene(code, day)}
    </svg>
  );
}

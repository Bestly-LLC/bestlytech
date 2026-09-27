/** Full-screen "turn your phone sideways" prompt shown in portrait. */
export default function RotatePrompt() {
  return (
    <div
      role="alertdialog"
      aria-live="polite"
      aria-label="Turn your phone sideways"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black px-8 text-center text-white"
    >
      <svg viewBox="0 0 120 120" className="sw-rotate h-32 w-32" aria-hidden>
        <defs>
          <linearGradient id="swRotG" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#FFD166" />
            <stop offset="1" stopColor="#FF6B9A" />
          </linearGradient>
        </defs>
        <path className="sw-rotate-arrow" d="M96 30 A44 44 0 0 1 104 66" fill="none" stroke="url(#swRotG)" strokeWidth="5" strokeLinecap="round" />
        <path className="sw-rotate-arrow" d="M97 57 L104 67 L111 57" fill="none" stroke="#FF6B9A" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <g className="sw-rotate-phone">
          <rect x="38" y="20" width="44" height="80" rx="10" fill="none" stroke="#fff" strokeWidth="5" />
          <rect x="53" y="26" width="14" height="4" rx="2" fill="#fff" />
          <path d="M48 76 q6 -12 12 -2 t12 -4" fill="none" stroke="url(#swRotG)" strokeWidth="4" strokeLinecap="round" />
        </g>
      </svg>
      <h1 className="mt-8 text-[28px] font-bold leading-tight tracking-[-0.02em]">Turn your phone sideways</h1>
      <p className="mt-2 max-w-[18rem] text-[17px] leading-snug text-white/60">The wall is wide, so signing works best in landscape.</p>
      <p className="mt-6 text-[13px] text-white/35">Rotation lock on? Swipe down from the top right to turn it off.</p>
    </div>
  );
}

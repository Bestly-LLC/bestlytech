/**
 * Little illustrations for the partner portal's shortcut tiles. Flat, two-tone, drawn on a
 * 64x64 grid: white shapes on the tile's gradient, with the accent colour (currentColor) for
 * detail. Add a new shortcut = add an entry here and in SHORTCUTS (PartnerHome.tsx).
 */
import type { ReactNode } from "react";

const W = "#fff";
const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 64 64" className="h-14 w-14 drop-shadow-[0_6px_14px_rgba(0,0,0,0.18)]" aria-hidden fill="none" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const ART: Record<string, ReactNode> = {
  // Studio: the review queue, a stack of cards with an approval tick
  studio: (
    <Svg>
      <rect x="11" y="17" width="30" height="36" rx="6" transform="rotate(-9 26 35)" fill={W} fillOpacity=".35" />
      <rect x="18" y="11" width="30" height="36" rx="6" fill={W} />
      <path d="M24 20h18M24 26h13M24 32h16" stroke="currentColor" strokeWidth="3" />
      <circle cx="46" cy="45" r="10" fill={W} />
      <path d="M41.5 45.2l3.2 3.2 5.8-6.4" stroke="currentColor" strokeWidth="3.2" />
    </Svg>
  ),
  // Ops board: three kanban columns
  ops: (
    <Svg>
      <rect x="8" y="12" width="48" height="40" rx="7" fill={W} fillOpacity=".3" />
      <rect x="12" y="17" width="12" height="16" rx="3" fill={W} />
      <rect x="12" y="36" width="12" height="10" rx="3" fill={W} fillOpacity=".75" />
      <rect x="26" y="17" width="12" height="10" rx="3" fill={W} />
      <rect x="40" y="17" width="12" height="22" rx="3" fill={W} />
      <path d="M15.5 22h5M29.5 22h5M43.5 22h5M43.5 27h3" stroke="currentColor" strokeWidth="2.6" />
    </Svg>
  ),
  // Talk: two chat bubbles
  talk: (
    <Svg>
      <path d="M10 18a7 7 0 017-7h20a7 7 0 017 7v10a7 7 0 01-7 7H24l-8 6v-6.4A7 7 0 0110 28z" fill={W} />
      <path d="M54 32a6 6 0 00-6-6H30a6 6 0 00-6 6v9a6 6 0 006 6h12l7 5v-5.3a6 6 0 005-5.7z" fill={W} fillOpacity=".55" />
      <circle cx="20" cy="23" r="2.3" fill="currentColor" /><circle cx="27" cy="23" r="2.3" fill="currentColor" /><circle cx="34" cy="23" r="2.3" fill="currentColor" />
    </Svg>
  ),
  // Files: a folder with a page peeking out
  files: (
    <Svg>
      <rect x="18" y="12" width="26" height="30" rx="4" fill={W} fillOpacity=".6" transform="rotate(8 31 27)" />
      <path d="M8 22a5 5 0 015-5h12l5 5h21a5 5 0 015 5v18a6 6 0 01-6 6H14a6 6 0 01-6-6z" fill={W} />
      <path d="M8 30h48" stroke="currentColor" strokeWidth="2.6" strokeOpacity=".35" />
    </Svg>
  ),
  // Calendar
  calendar: (
    <Svg>
      <rect x="10" y="14" width="44" height="40" rx="8" fill={W} />
      <path d="M10 22a8 8 0 018-8h28a8 8 0 018 8v4H10z" fill="currentColor" fillOpacity=".85" />
      <path d="M22 9v9M42 9v9" stroke={W} strokeWidth="4" />
      <rect x="18" y="32" width="7" height="6" rx="2" fill="currentColor" fillOpacity=".3" />
      <rect x="29" y="32" width="7" height="6" rx="2" fill="currentColor" />
      <rect x="40" y="32" width="7" height="6" rx="2" fill="currentColor" fillOpacity=".3" />
      <rect x="18" y="42" width="7" height="6" rx="2" fill="currentColor" fillOpacity=".3" />
    </Svg>
  ),
  // Our call: a video camera with a live dot
  call: (
    <Svg>
      <rect x="7" y="19" width="36" height="28" rx="8" fill={W} />
      <path d="M43 29l13-8v24l-13-8z" fill={W} fillOpacity=".7" />
      <circle cx="17" cy="28" r="3.6" fill="currentColor" />
      <path d="M14 39h18" stroke="currentColor" strokeWidth="3" strokeOpacity=".35" />
    </Svg>
  ),
  // Connect my Claude: a plug meeting a socket, with a spark
  claude: (
    <Svg>
      <rect x="8" y="24" width="22" height="18" rx="6" fill={W} />
      <path d="M30 29h7M30 37h7" stroke={W} strokeWidth="4" />
      <rect x="37" y="22" width="19" height="22" rx="6" fill={W} fillOpacity=".6" />
      <path d="M14 42v8M24 42v8" stroke={W} strokeWidth="4" />
      <path d="M47 8l2.2 5.8L55 16l-5.8 2.2L47 24l-2.2-5.8L39 16l5.8-2.2z" fill={W} />
      <circle cx="19" cy="33" r="3" fill="currentColor" />
    </Svg>
  ),
  // Mail (used for empty states)
  mail: (
    <Svg>
      <rect x="8" y="15" width="48" height="34" rx="7" fill={W} />
      <path d="M11 19l21 16 21-16" stroke="currentColor" strokeWidth="3.2" />
    </Svg>
  ),
};

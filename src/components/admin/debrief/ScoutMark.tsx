/** The Scout binoculars from the approved mockups (the Bestly mark), drawn in the current text colour. */
export function ScoutMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="4.4" y="3.8" width="4" height="3.6" rx="1.2" />
      <rect x="15.6" y="3.8" width="4" height="3.6" rx="1.2" />
      <rect x="2.6" y="7.4" width="7.6" height="13" rx="3.8" />
      <rect x="13.8" y="7.4" width="7.6" height="13" rx="3.8" />
      <path d="M10.2 13h3.6" />
      <circle cx="6.4" cy="14.6" r="2.3" />
      <circle cx="17.6" cy="14.6" r="2.3" />
      <circle cx="5.7" cy="14.9" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.9" cy="14.9" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

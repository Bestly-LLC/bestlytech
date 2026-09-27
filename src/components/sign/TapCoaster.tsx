/** Shown when someone opens the sign page without tapping a coaster (or their 20 minutes ran out). */
export default function TapCoaster({ expired }: { expired?: boolean }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black px-8 text-white">
      <div className="flex max-w-[34rem] flex-col items-center gap-6 text-center landscape:flex-row landscape:text-left">
        <div className="relative flex h-36 w-36 shrink-0 items-center justify-center" aria-hidden>
          <span className="sw-ring absolute inset-0 rounded-full border-2 border-[#C3A6FF]/60" />
          <span className="sw-ring absolute inset-0 rounded-full border-2 border-[#C3A6FF]/60" style={{ animationDelay: "1s" }} />
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#3a2466] to-[#1b0f33] shadow-[0_0_40px_rgba(195,166,255,.35)] ring-1 ring-white/15">
            <svg viewBox="0 0 24 24" className="h-11 w-11" fill="none" stroke="#C3A6FF" strokeWidth="1.8" strokeLinecap="round">
              <path d="M8.5 8.6a4.6 4.6 0 0 1 0 6.8M11.9 6a8.3 8.3 0 0 1 0 12M15.3 3.4a12 12 0 0 1 0 17.2" />
            </svg>
          </div>
        </div>
        <div>
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">{expired ? "Tap a coaster again" : "Tap a coaster to sign"}</h1>
          <p className="mt-2 text-[17px] leading-snug text-white/65">
            {expired
              ? "Your signing time ran out. Hold your phone to a coaster and you're back in."
              : "Hold your phone to one of the coasters. The sign page opens right up."}
          </p>
          <p className="mt-3 text-[15px] text-white/40">On iPhone, use the top edge.</p>
        </div>
      </div>
    </div>
  );
}

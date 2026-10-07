import { Fragment, useEffect, useState } from "react";
import { nextLoaderCard, type LoaderCardData, type LoaderCardsMode } from "./loaderDeck";

/** Fast loads stay a clean mark: the card only shows once the loader has been up this long. */
const REVEAL_MS = 400;
/** Still loading? A new card every 6 seconds. */
const ROTATE_MS = 6000;
/** Crossfade: 100 ms out, 100 ms in. */
const FADE_MS = 100;

/** A number never wraps away from its unit: "$66 today", "2 pieces" stay on one line. */
function NoBreak({ text }: { text: string }) {
  const parts = text.split(/(\$?\d+(?:[.,]\d+)*(?:\s[A-Za-z%°]+)?)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <span key={i} className="whitespace-nowrap">{p}</span> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}

/**
 * One short card under the binoculars: something useful from the admin's own data, a tip, or a quote.
 * Positioned absolutely below the mark, so the mark never moves whether a card is showing or not.
 * Ambient, not status: hidden from screen readers (the loader itself keeps role="status").
 */
export function LoaderCard({ mode }: { mode: LoaderCardsMode }) {
  const [card, setCard] = useState<LoaderCardData | null>(null);
  const [shown, setShown] = useState(false);
  const [fadeMs, setFadeMs] = useState(200);

  useEffect(() => {
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(fn, ms)); };

    const showNext = () => {
      const c = nextLoaderCard(mode);
      if (!c) return;
      setCard(c);
      setShown(true);
      later(rotate, ROTATE_MS);
    };
    const rotate = () => {
      if (reduce) { showNext(); return; }
      setFadeMs(FADE_MS);
      setShown(false);
      later(showNext, FADE_MS);
    };

    if (reduce) setFadeMs(0);
    later(showNext, REVEAL_MS);
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [mode]);

  const useful = card && (card.kind === "fact" || card.kind === "tip");
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-full mt-4 w-[22rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 text-center"
      style={{ minHeight: "7.5rem", opacity: shown ? 1 : 0, transition: fadeMs ? `opacity ${fadeMs}ms ease-out` : "none" }}
    >
      {card && (
        <>
          <p className="text-[15px] leading-snug text-white/80 text-balance">
            {useful ? <NoBreak text={card.text} /> : card.text}
          </p>
          {card.sub && (
            <p className="mt-1 text-[13px] leading-snug text-white/55 text-balance">
              <NoBreak text={card.sub} />
            </p>
          )}
          {card.author && <p className="mt-2 text-[13px] leading-snug text-white/55">{"—"} {card.author}</p>}
        </>
      )}
    </div>
  );
}

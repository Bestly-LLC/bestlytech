import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Giant "Bestly" wordmark anchored at the bottom of the homepage.
 *
 * - Set inside its own ink-colored section.
 * - The word is sized to fill the viewport width and pushed down so the
 *   bottom ~18% of glyphs is submerged below the section edge — gives it
 *   a "rising up from below" feel.
 * - Indigo gradient: full opacity at top of glyph, fading to transparent
 *   at bottom — reinforces the submerged metaphor.
 * - Reveals on scroll-into-view via Framer Motion `whileInView`.
 * - Subtle cursor-X parallax: word shifts up to ±18px horizontally as
 *   the cursor sweeps left-right across the section. Disabled on touch
 *   and prefers-reduced-motion.
 *
 * Original Bestly work — common-property "big brand wordmark" pattern.
 */
export function BottomWordmark() {
  const ref = useRef<HTMLDivElement | null>(null);
  const wordRef = useRef<HTMLSpanElement | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const el = ref.current;
    const word = wordRef.current;
    if (!el || !word) return;
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (isTouch) return;

    let target = 0;
    let current = 0;
    let raf = 0;

    function onMove(e: PointerEvent) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Only react when section is visible
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const cx = (e.clientX - rect.left) / rect.width - 0.5;
      target = cx * 36; // up to ±18px
    }
    function tick() {
      current += (target - current) * 0.08;
      if (word) word.style.transform = `translate3d(${current}px, 0, 0)`;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [reduce]);

  return (
    <section
      ref={ref}
      aria-hidden="true"
      className="relative overflow-hidden wow-bg-ink select-none"
      style={{ height: "70vh" }}
    >
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-center">
        <motion.span
          ref={wordRef}
          className="font-display block whitespace-nowrap leading-[0.78] tracking-[-0.05em]"
          style={{
            fontSize: "clamp(8rem, 28vw, 30rem)",
            transform: "translateY(18%)",
            backgroundImage:
              "linear-gradient(to bottom, hsl(var(--wow-indigo-light)) 0%, hsl(var(--wow-indigo-light) / 0.55) 55%, hsl(var(--wow-indigo-light) / 0) 90%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            paddingBottom: "0.2em", // make the gradient have somewhere to fade into
            willChange: "transform, opacity",
          }}
          initial={reduce ? false : { opacity: 0, y: 60 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15% 0px" }}
          transition={{
            duration: reduce ? 0 : 1.1,
            ease: [0.32, 0.72, 0, 1],
          }}
        >
          Bestly
        </motion.span>
      </div>
    </section>
  );
}

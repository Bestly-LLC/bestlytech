import { useEffect, useRef, useState } from "react";

/**
 * Soft indigo dot that lerps toward the cursor across the whole site.
 * Expands into a ring when hovering an element marked `data-cursor="link"`.
 * Hidden on touch devices and under prefers-reduced-motion.
 *
 * IMPORTANT: the dot/ring are only rendered once the follower is actually
 * active. On touch devices and under prefers-reduced-motion the component
 * renders nothing — otherwise the un-animated dot would sit in the corner of
 * the viewport as a stray speck floating over the page.
 */
export function CursorFollower() {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);

  // Decide once, on mount, whether the follower should run at all.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!isTouch && !reduce) setActive(true);
  }, []);

  // Run the follow animation only when active (the nodes now exist).
  useEffect(() => {
    if (!active) return;

    const dot = dotRef.current!;
    const ring = ringRef.current!;
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let dotX = mouseX;
    let dotY = mouseY;
    let ringX = mouseX;
    let ringY = mouseY;
    let hovering = false;
    let raf = 0;

    function tick() {
      // Tight follow on dot, softer on ring
      dotX += (mouseX - dotX) * 0.35;
      dotY += (mouseY - dotY) * 0.35;
      ringX += (mouseX - ringX) * 0.12;
      ringY += (mouseY - ringY) * 0.12;
      dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%) scale(${hovering ? 1.6 : 1})`;
      ring.style.opacity = hovering ? "1" : "0.5";
      raf = requestAnimationFrame(tick);
    }

    function onMove(e: PointerEvent) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }
    function onOver(e: MouseEvent) {
      const t = e.target as HTMLElement;
      hovering = !!t.closest('a, button, [data-cursor="link"], [role="button"]');
    }
    function onOut() {
      hovering = false;
    }

    document.body.appendChild(dot);
    document.body.appendChild(ring);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      dot.remove();
      ring.remove();
    };
  }, [active]);

  // Nothing renders until the follower is active — no stray dot at rest.
  if (!active) return null;

  return (
    <>
      <div
        ref={dotRef}
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 z-[9999] hidden lg:block"
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: "hsl(var(--wow-indigo-light))",
          mixBlendMode: "difference",
          willChange: "transform",
        }}
      />
      <div
        ref={ringRef}
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 z-[9999] hidden lg:block"
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          border: "1px solid hsl(var(--wow-indigo-light))",
          mixBlendMode: "difference",
          transition: "opacity 200ms cubic-bezier(0.32, 0.72, 0, 1)",
          willChange: "transform, opacity",
        }}
      />
    </>
  );
}

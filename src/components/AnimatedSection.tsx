import { useEffect, useRef, useState, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AnimatedSectionProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  animation?: "fade-in" | "fade-in-up" | "scale-in";
  /**
   * Render visible immediately (for above-the-fold content). The entrance
   * animation still plays, but visibility never depends on the observer.
   */
  immediate?: boolean;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function AnimatedSection({
  children,
  className,
  delay = 0,
  animation = "fade-in-up",
  immediate = false,
}: AnimatedSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Reduced-motion users and above-the-fold ("immediate") content start
  // visible so the content NEVER depends on the animation or the
  // IntersectionObserver firing to become visible.
  const reduce = prefersReducedMotion();
  const [isVisible, setIsVisible] = useState(() => immediate || reduce);

  useEffect(() => {
    // Already shown (immediate / reduced-motion) — nothing to observe.
    if (isVisible) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      {
        threshold: 0.1,
        rootMargin: "0px 0px -50px 0px",
      }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [isVisible]);

  return (
    <div
      ref={ref}
      className={cn(
        // Only ever hide when we're still waiting to reveal AND motion is
        // allowed. Reduced motion is always fully visible with no animation.
        !isVisible && !reduce && "opacity-0",
        isVisible && !reduce && `animate-${animation}`,
        className
      )}
      style={{
        animationDelay: isVisible && !reduce ? `${delay}ms` : "0ms",
      }}
    >
      {children}
    </div>
  );
}

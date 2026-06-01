import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Route-change transition: a brief fade + upward rise so navigating the
 * public site feels like one continuous product rather than hard cuts.
 * Admin routes and prefers-reduced-motion get a plain passthrough.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const [entered, setEntered] = useState(true);
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if (isAdminRoute || reduce) return;
    if (prevPath.current === location.pathname) return;
    prevPath.current = location.pathname;

    setEntered(false);
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, isAdminRoute, reduce]);

  if (isAdminRoute || reduce) return <>{children}</>;

  return (
    <div
      style={{
        opacity: entered ? 1 : 0,
        transform: entered ? "translateY(0)" : "translateY(8px)",
        transition:
          "opacity 280ms cubic-bezier(0.16,1,0.3,1), transform 280ms cubic-bezier(0.16,1,0.3,1)",
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

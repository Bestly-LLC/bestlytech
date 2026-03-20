import { ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");
  const [opacity, setOpacity] = useState(1);
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if (isAdminRoute) return;
    if (prevPath.current === location.pathname) return;
    prevPath.current = location.pathname;

    // Brief fade-in on route change
    setOpacity(0);
    const frame = requestAnimationFrame(() => {
      setOpacity(1);
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, isAdminRoute]);

  if (isAdminRoute) return <>{children}</>;

  return (
    <div
      style={{
        opacity,
        transition: "opacity 150ms ease-out",
      }}
    >
      {children}
    </div>
  );
}

import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");

  return (
    <div
      key={isAdminRoute ? "/admin" : location.pathname}
      className={cn(!isAdminRoute && "animate-page-enter motion-reduce:animate-none")}
    >
      {children}
    </div>
  );
}

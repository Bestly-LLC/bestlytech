import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ADMIN_MARK_PERIOD_MS } from "@/components/AdminMark";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { BrandLoader } from "@/components/BrandLoader";
import { useAdminFavicon } from "@/hooks/useAdminFavicon";
import { AdminAccessDenied } from "./AdminAccessDenied";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin, roleError, recheck, signOut } = useAdminAuth();
  const location = useLocation();
  useAdminFavicon();

  // On a fresh page load, let the side-eye finish one full glance (3.2s from navigation start)
  // instead of cutting it off mid-look. In-app navigation is already past that, so no extra wait.
  const [holding, setHolding] = useState(() => performance.now() < ADMIN_MARK_PERIOD_MS);
  useEffect(() => {
    if (!holding) return;
    const t = window.setTimeout(() => setHolding(false), Math.max(0, ADMIN_MARK_PERIOD_MS - performance.now()));
    return () => window.clearTimeout(t);
  }, [holding]);

  if (loading || holding) {
    return <BrandLoader tone="dark" fullScreen label="Checking your admin session" />;
  }

  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={next && next !== "/admin" ? `/admin/login?next=${encodeURIComponent(next)}` : "/admin/login"} replace />;
  }

  if (!isAdmin) {
    return <AdminAccessDenied email={user.email} checkFailed={!!roleError} onRetry={recheck} onSignOut={signOut} />;
  }

  return <>{children}</>;
}

import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ADMIN_MARK_PERIOD_MS } from "@/components/AdminMark";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { BrandLoader } from "@/components/BrandLoader";
import { useAdminFavicon } from "@/hooks/useAdminFavicon";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin } = useAdminAuth();
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
    return <Navigate to="/admin/login" replace />;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold text-destructive">Access Denied</h1>
          <p className="text-muted-foreground">You do not have admin privileges.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

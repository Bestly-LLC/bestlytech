import { useState } from "react";
import { AlertTriangle, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminMark } from "@/components/AdminMark";

interface AdminAccessDeniedProps {
  email?: string | null;
  /** The role check failed (network / server), so we don't actually know. */
  checkFailed?: boolean;
  onRetry?: () => Promise<void> | void;
  onSignOut: () => Promise<void> | void;
}

/** Full-screen, dark: shown when a signed-in account isn't an admin, or the role check failed. */
export function AdminAccessDenied({ email, checkFailed = false, onRetry, onSignOut }: AdminAccessDeniedProps) {
  const [retrying, setRetrying] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const retry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="admin-shell min-h-screen flex items-center justify-center bg-black text-white p-4">
      <div role="alert" className="w-full max-w-sm text-center space-y-5">
        <div className="flex justify-center">
          <AdminMark className="h-16 w-16" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {checkFailed ? "Couldn't check admin access" : "This account isn't an admin"}
          </h1>
          <p className="text-sm text-white/70">
            {checkFailed
              ? "Something went wrong while checking your role. Check your connection and try again."
              : "You're signed in, but this account doesn't have access to Bestly Admin."}
          </p>
          {email && (
            <p className="text-sm text-white/55">
              Signed in as <span className="text-white/90 break-all">{email}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          {onRetry && (
            <Button onClick={retry} disabled={retrying} className="h-10 bg-white text-black hover:bg-white/90">
              <RefreshCw className={retrying ? "h-4 w-4 mr-2 animate-spin" : "h-4 w-4 mr-2"} aria-hidden />
              {retrying ? "Checking…" : "Retry"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={signOut}
            disabled={signingOut}
            className="h-10 border-white/15 bg-transparent text-white hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4 mr-2" aria-hidden />
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
        {checkFailed && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-white/55">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-hidden />
            Your session is still active.
          </p>
        )}
      </div>
    </div>
  );
}

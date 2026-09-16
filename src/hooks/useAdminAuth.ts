import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

/**
 * Detect whether the current page load is an OAuth callback redirect.
 * Supabase implicit flow uses hash fragments (#access_token=...),
 * while PKCE flow uses query params (?code=...).
 */
function isOAuthCallback(): boolean {
  const hash = window.location.hash;
  const search = window.location.search;
  // Implicit flow
  if (hash && (hash.includes("access_token") || hash.includes("error_description"))) {
    return true;
  }
  // PKCE flow
  const params = new URLSearchParams(search);
  if (params.has("code") || params.has("error_description")) {
    return true;
  }
  return false;
}

export function useAdminAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  // Set when the role check itself failed (network, RPC error) and we have no earlier answer.
  // It is not "you are not an admin"; the UI should offer Retry rather than Access Denied.
  const [roleError, setRoleError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Last known answer for a user id, so a failed re-check (e.g. on token refresh) never
  // flips a signed-in admin to Access Denied.
  const known = useRef<{ userId: string; isAdmin: boolean } | null>(null);

  const checkAdmin = useCallback(async (userId: string) => {
    if (known.current && known.current.userId !== userId) known.current = null;
    setChecking(true);
    try {
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (error) throw error;
      known.current = { userId, isAdmin: !!data };
      setIsAdmin(!!data);
      setRoleError(null);
    } catch (e) {
      console.error("Admin role check failed", e);
      if (known.current) {
        // Keep the previous answer.
        setIsAdmin(known.current.isAdmin);
      } else {
        setIsAdmin(false);
        setRoleError(e instanceof Error ? e.message : (e as { message?: string })?.message || "Couldn't check admin access");
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const oauthInProgress = isOAuthCallback();

    // 1. Restore session from storage (or parse OAuth tokens)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        checkAdmin(u.id).finally(() => {
          if (mounted) setLoading(false);
        });
      } else if (!oauthInProgress) {
        // Only mark as "done loading" if we're NOT mid-OAuth redirect.
        // If OAuth is in progress but getSession returned null, Supabase
        // is still exchanging the token — onAuthStateChange will fire next.
        setLoading(false);
      }
      // If oauthInProgress && u == null → keep loading=true, wait for onAuthStateChange
    });

    // 2. Listen for subsequent auth changes (including OAuth completion)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        // A token refresh doesn't change roles; don't re-check (and risk a transient failure).
        if (event === "TOKEN_REFRESHED" && known.current?.userId === u.id) return;
        checkAdmin(u.id).finally(() => {
          if (mounted) setLoading(false);
        });
      } else {
        known.current = null;
        setIsAdmin(false);
        setRoleError(null);
        // Now safe to mark loading done — OAuth either failed or user signed out
        setLoading(false);
      }
    });

    // Safety net: if OAuth redirect token parsing takes too long, stop the spinner
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    if (oauthInProgress) {
      safetyTimer = setTimeout(() => {
        if (mounted) setLoading(false);
      }, 8000); // 8 seconds max wait
    }

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (safetyTimer) clearTimeout(safetyTimer);
    };
  }, [checkAdmin]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const recheck = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) await checkAdmin(session.user.id);
  }, [checkAdmin]);

  return { user, loading, isAdmin, roleError, checking, recheck, signIn, signOut };
}

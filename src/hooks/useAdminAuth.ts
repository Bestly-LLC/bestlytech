import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export function useAdminAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const checkAdmin = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      setIsAdmin(!!data);
    } catch {
      setIsAdmin(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // 1. Restore session from storage first
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        // Fire-and-forget; do NOT block the callback
        checkAdmin(u.id).finally(() => {
          if (mounted) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    // 2. Listen for subsequent changes — NO await inside callback
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        const u = session?.user ?? null;
        setUser(u);
        if (u) {
          // Fire-and-forget to avoid deadlock
          checkAdmin(u.id);
        } else {
          setIsAdmin(false);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [checkAdmin]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { user, loading, isAdmin, signIn, signOut };
}

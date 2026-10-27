/**
 * /partner/callwin: the call in its own window (Pop out from the portal). Nothing but the call shows here;
 * BestlyDock fills the window and joins at once with the microphone and camera the portal window had.
 * Needs the same sign-in as /partner (the session is shared by both windows of this browser).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { openCallWindow } from "./useCallDock";

export default function PartnerCallWin() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { if (alive) setMsg("Sign in to the portal first, then use Pop out again."); return; }
      const uid = data.session.user.id;
      const as = new URLSearchParams(window.location.search).get("as")?.toLowerCase() || "eli";
      const [{ data: p }, { data: adm }] = await Promise.all([
        supabase.from("partners" as never).select("call_url").eq("user_id", uid).maybeSingle(),
        supabase.rpc("has_role" as never, { _user_id: uid, _role: "admin" } as never),
      ]);
      let callUrl = (p as { call_url?: string | null } | null)?.call_url ?? null;
      if (!callUrl && adm) {
        const { data: ap } = await supabase.from("partners" as never).select("call_url").eq("roster_name", as).maybeSingle();
        callUrl = (ap as { call_url?: string | null } | null)?.call_url ?? null;
      }
      const ok = await openCallWindow({ isJared: !!adm, callUrl }, new URLSearchParams(window.location.search));
      if (!ok && alive) setMsg("The call window did not load. Close this window and try again.");
    })();
    return () => { alive = false; };
  }, []);
  return <div style={{ minHeight: "100vh", background: "#1F1D1B", color: "#F4F1EC", display: "grid", placeItems: "center", padding: 24, textAlign: "center", font: "600 18px/1.4 system-ui, sans-serif" }}>{msg}</div>;
}

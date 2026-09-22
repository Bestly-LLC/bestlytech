import { supabase } from "@/integrations/supabase/client";

// HOKU's store admin lives on hoku-clean.com with its own passkey login.
// admin-sso-mint checks the admin role here and returns a single-use,
// two-minute link that the HOKU admin redeems for a session.
export const HOKU_ADMIN_URL = "https://hoku-clean.com/admin";

// Call from inside a click/keypress handler. The tab is opened synchronously so
// popup blockers allow it, then pointed at the signed link once it arrives. If
// minting fails the tab still lands on the HOKU admin, where the passkey login
// works as before.
export async function openHokuAdmin(): Promise<void> {
  const w = window.open("about:blank", "_blank");
  let target = HOKU_ADMIN_URL;
  try {
    const { data, error } = await supabase.functions.invoke("admin-sso-mint", { body: {} });
    if (!error && data?.url) target = data.url;
  } catch {
    // fall through to the plain admin URL
  }
  if (w) {
    w.opener = null;
    w.location.href = target;
  } else {
    window.location.href = target;
  }
}

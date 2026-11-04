/**
 * /scout/connect: the sign-in handoff for the Scout Recorder Chrome extension.
 *
 * Passkeys stay here on bestly.tech. This page never has a password field.
 *  1. The extension opens it with ?redirect_uri=https://<id>.chromiumapp.org/connect
 *     (chrome.identity.launchWebAuthFlow). On success we go to <redirect_uri>#key=<bpc_...>.
 *  2. Without redirect_uri (the extension opened the page in a normal tab), we send the key to
 *     each allowed extension id with chrome.runtime.sendMessage({ type: "scout-connect", key }).
 *
 * Standalone route (no site header), so it is not behind AdminRoute and keeps its query string.
 * Admin and partner use the same session and the same passkey sign-in as /admin and /partner.
 */
import { useCallback, useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useSearchParams } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { passkeysSupported, signInWithPasskey } from "@/lib/passkey";
import { allowedIdFromRedirect, allowedIds } from "@/lib/scoutRecorderIds";

const LABEL = "Scout Recorder";

type Phase = "loading" | "signedOut" | "ready" | "working" | "done" | "bad";

declare const chrome: {
  runtime?: { sendMessage?: (id: string, msg: unknown, cb?: (res: unknown) => void) => void; lastError?: unknown };
} | undefined;

function sendToExtension(id: string, key: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const rt = typeof chrome !== "undefined" ? chrome?.runtime : undefined;
      if (!rt?.sendMessage) return resolve(false);
      rt.sendMessage(id, { type: "scout-connect", key }, (res) => {
        void rt.lastError; // read it so Chrome does not log an unchecked error
        resolve(!!res && (res as { ok?: boolean }).ok !== false);
      });
      window.setTimeout(() => resolve(false), 4000);
    } catch {
      resolve(false);
    }
  });
}

export default function ScoutRecorderConnect() {
  const [params] = useSearchParams();
  const redirect = params.get("redirect_uri");
  const redirectOk = redirect ? allowedIdFromRedirect(redirect) : null;
  const badLink = !!redirect && !redirectOk;

  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [askEmail, setAskEmail] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      setSession(data.session);
      setPhase(data.session ? "ready" : "signedOut");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!live) return;
      setSession(s);
      setPhase((p) => (p === "working" || p === "done" ? p : s ? "ready" : "signedOut"));
    });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true); setMsg("");
    const problem = await signInWithPasskey(askEmail ? email.trim() || undefined : undefined);
    setBusy(false);
    if (!problem || problem === "cancelled") return;
    if (!askEmail) { setAskEmail(true); return; }
    setMsg(problem.startsWith("No passkey") ? "There is no passkey on that account yet. Ask Jared for a sign-in link." : problem);
  }, [askEmail, email]);

  const connect = useCallback(async () => {
    if (badLink) return;
    setPhase("working"); setMsg("");
    try {
      // Replace any older Scout Recorder keys of this person, so one install = one key.
      const list = await supabase.rpc("partner_connector_list" as never);
      if (list.error) throw new Error(list.error.message);
      const old = ((list.data ?? []) as unknown as { id: string; label: string }[]).filter((c) => c.label === LABEL);
      for (const c of old) await supabase.rpc("partner_connector_revoke" as never, { p_id: c.id } as never);

      const made = await supabase.rpc("partner_connector_create" as never, { p_label: LABEL } as never);
      if (made.error) throw new Error(made.error.message);
      const key = (made.data as { key?: string } | null)?.key;
      if (!key) throw new Error("No key came back.");

      if (redirect && redirectOk) {
        setPhase("done");
        window.location.replace(`${redirect}#key=${key}`);
        return;
      }
      // Opened as a normal tab by the extension: hand the key over directly.
      const ids = allowedIds();
      for (const id of ids) {
        if (await sendToExtension(id, key)) { setPhase("done"); return; }
      }
      // Nobody took it: do not leave an unused key lying around.
      const fresh = await supabase.rpc("partner_connector_list" as never);
      const mine = ((fresh.data ?? []) as unknown as { id: string; label: string }[]).filter((c) => c.label === LABEL);
      for (const c of mine) await supabase.rpc("partner_connector_revoke" as never, { p_id: c.id } as never);
      setPhase("ready");
      setMsg("Scout Recorder did not answer. Open this page from the Scout Recorder extension and try again.");
    } catch (e) {
      setPhase("ready");
      setMsg(`Could not connect: ${e instanceof Error ? e.message : "something went wrong"}. Try again.`);
    }
  }, [badLink, redirect, redirectOk]);

  const who = session?.user?.email ?? "your Bestly account";

  return (
    <>
      <Helmet>
        <title>Connect Scout Recorder | Bestly</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <style>{CSS}</style>
      <main className="sr-wrap">
        <div className="sr-card">
          <img src="/scout-mark.svg" alt="" width={64} height={64} className="sr-mark" />
          <h1>Connect Scout Recorder</h1>
          {badLink ? (
            <p role="alert" className="sr-err">This link did not come from the Scout Recorder extension, so it cannot connect. Open it from the extension.</p>
          ) : phase === "loading" ? (
            <p className="sr-sub">One moment.</p>
          ) : phase === "signedOut" ? (
            <>
              <p className="sr-sub">Sign in to your Bestly account first. It uses a passkey, so there is no password to type.</p>
              {!passkeysSupported() ? (
                <p role="alert" className="sr-err">This browser cannot use passkeys. Open this page in Chrome on a device with Face ID, Touch ID or a security key.</p>
              ) : (
                <>
                  {askEmail && (
                    <input className="sr-input" type="email" autoComplete="username webauthn" inputMode="email" placeholder="Your email"
                      aria-label="Your email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
                  )}
                  {msg && <p role="alert" className="sr-err">{msg}</p>}
                  <button type="button" className="sr-btn" onClick={signIn} disabled={busy || (askEmail && !email.trim())}>
                    {busy ? "Waiting for your passkey" : "Sign in with a passkey"}
                  </button>
                </>
              )}
            </>
          ) : phase === "done" ? (
            <p className="sr-sub" role="status">Connected. You can close this window.</p>
          ) : (
            <>
              <p className="sr-sub">This connects Scout Recorder to <strong className="sr-who">{who}</strong>. Notes from your calls will land in that account only.</p>
              {msg && <p role="alert" className="sr-err">{msg}</p>}
              <button type="button" className="sr-btn" onClick={connect} disabled={phase === "working"}>
                {phase === "working" ? "Connecting" : "Connect Scout Recorder"}
              </button>
              <button type="button" className="sr-link" onClick={async () => { await supabase.auth.signOut(); }}>Not you? Sign out</button>
            </>
          )}
          <p className="sr-fine">
            <a href="/scout-recorder/privacy">Privacy</a> &middot; <a href="/scout-recorder">About Scout Recorder</a>
          </p>
        </div>
      </main>
    </>
  );
}

const CSS = `
.sr-wrap{--bg:#f5f5f7;--card:#fff;--fg:#1d1d1f;--mut:#6e6e73;--acc:#0071e3;--accfg:#fff;--bd:rgba(0,0,0,.08);--err:#c62828;
  min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);
  font:17px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif}
@media (prefers-color-scheme:dark){.sr-wrap{--bg:#000;--card:#1c1c1e;--fg:#f5f5f7;--mut:#a1a1a6;--acc:#0a84ff;--bd:rgba(255,255,255,.12);--err:#ff6961}}
.sr-card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--bd);border-radius:24px;padding:32px 24px;text-align:center;
  box-shadow:0 12px 40px -12px rgba(0,0,0,.18);animation:sr-in .4s cubic-bezier(.2,.8,.2,1) both}
.sr-mark{display:block;margin:0 auto 12px;border-radius:16px}
.sr-card h1{font-size:1.5rem;line-height:1.2;font-weight:700;letter-spacing:-.02em;margin:0 0 8px}
.sr-sub{color:var(--mut);margin:0 0 24px;font-size:1rem}
.sr-who{color:var(--fg);overflow-wrap:anywhere}
.sr-err{color:var(--err);margin:0 0 16px;font-size:.95rem}
.sr-btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;border:0;border-radius:14px;background:var(--acc);color:var(--accfg);
  font:600 1.0625rem/1 inherit;cursor:pointer;transition:transform .12s ease-out,opacity .2s}
.sr-btn:active{transform:scale(.97)}
.sr-btn:disabled{opacity:.55;cursor:default}
.sr-btn:focus-visible,.sr-link:focus-visible,.sr-input:focus-visible{outline:3px solid var(--acc);outline-offset:2px}
.sr-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin-top:8px;background:none;border:0;color:var(--mut);font:inherit;font-size:.95rem;cursor:pointer}
.sr-input{width:100%;min-height:48px;border-radius:14px;border:1px solid var(--bd);background:transparent;color:var(--fg);padding:0 16px;font:inherit;margin:0 0 16px;box-sizing:border-box}
.sr-fine{margin:24px 0 0;font-size:.85rem;color:var(--mut)}
.sr-fine a{color:var(--mut);display:inline-block;min-height:44px;line-height:44px;padding:0 8px}
@keyframes sr-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sr-card{animation:none}.sr-btn{transition:none}}
`;

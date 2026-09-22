import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldX, Loader2, Monitor } from "lucide-react";

/**
 * /admin/approve — let another browser in. Jared must type the code shown on that
 * browser's screen (a push only opens this page, it never carries the code), so a
 * request he didn't start can't be approved by a stray tap.
 */
type Lookup = { code: string; status: string; created_at: string; expires_at: string; user_agent: string | null; ip: string | null; live: boolean };

function browserName(ua: string | null) {
  if (!ua) return "Unknown browser";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  const app = /Claude/i.test(ua) ? "Claude app" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return os ? `${app} on ${os}` : app;
}

export default function AdminApproveLogin() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [req, setReq] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);

  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");

  useEffect(() => {
    setReq(null);
    setMsg(null);
    if (clean.length !== 8) return;
    let gone = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke("admin-device-login", { body: { op: "lookup", code: clean } });
      if (gone) return;
      if (error || !data?.ok) setMsg(data?.error ?? "No sign-in request with that code.");
      else setReq(data.request as Lookup);
    })();
    return () => {
      gone = true;
    };
  }, [clean]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("admin-device-login", { body: { op: "decide", code: clean, approve } });
    setBusy(false);
    if (error || !data?.ok) setMsg(data?.error ?? error?.message ?? "That didn't work.");
    else setDone(approve ? "approved" : "denied");
  };

  const ago = req ? Math.max(0, Math.round((Date.now() - new Date(req.created_at).getTime()) / 1000)) : 0;

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-2xl font-semibold text-white">Approve a sign-in</h1>
      <p className="mt-1 text-sm text-white/60">Type the code shown on the browser you want to sign in on.</p>

      {done ? (
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          {done === "approved" ? <ShieldCheck className="h-6 w-6 text-emerald-400" /> : <ShieldX className="h-6 w-6 text-red-400" />}
          <div>
            <p className="font-medium text-white">{done === "approved" ? "Approved" : "Denied"}</p>
            <p className="mt-0.5 text-sm text-white/60">
              {done === "approved" ? "The other browser signs in within a couple of seconds." : "That browser stays signed out."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <input
            autoFocus
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 9))}
            placeholder="ABCD-EFGH"
            aria-label="Sign-in code"
            className="mt-8 w-full rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-center font-mono text-2xl tracking-[0.2em] text-white placeholder:text-white/25 focus:border-white/35 focus:outline-none"
          />
          {clean.length === 8 && !req && !msg && (
            <p className="mt-4 flex items-center gap-2 text-sm text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking it up…
            </p>
          )}
          {msg && <p className="mt-4 text-sm text-red-300">{msg}</p>}
          {req && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center gap-3">
                <Monitor className="h-5 w-5 text-white/70" />
                <div>
                  <p className="font-medium text-white">{browserName(req.user_agent)}</p>
                  <p className="text-xs text-white/55">
                    Asked {ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago{req.ip ? ` · ${req.ip}` : ""}
                  </p>
                </div>
              </div>
              {req.live ? (
                <div className="mt-5 flex gap-2">
                  <Button disabled={busy} onClick={() => decide(true)} className="h-11 flex-1 bg-white text-black hover:bg-white/90">
                    Approve
                  </Button>
                  <Button disabled={busy} variant="ghost" onClick={() => decide(false)} className="h-11 border border-white/15 text-white/70 hover:bg-white/5">
                    Deny
                  </Button>
                </div>
              ) : (
                <p className="mt-4 text-sm text-white/60">This request is {req.status === "pending" ? "expired" : req.status}. Get a new code on the other browser.</p>
              )}
              <p className="mt-4 text-xs text-white/45">Only approve a code you can see on your own screen right now.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

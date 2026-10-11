import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";

// /p/:token — the page behind the link in Vera's email. Public, light, no Maya widget, no tracking.
// It only ever learns {status, action, requested_on, code, download} from the privacy-verify function:
// never an email address or a phone number.

type View = {
  status: "confirm" | "confirmed" | "done" | "expired" | string;
  action: string | null;
  requested_on: string | null;
  code: string | null;
  download: boolean;
};
type State = "loading" | "ready" | "sending" | "confirmed" | "invalid" | "error";

const NB = " ";
const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/privacy-verify`;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const headers: Record<string, string> = KEY ? { apikey: KEY } : {};

const ASK: Record<string, string> = {
  delete: "delete your data",
  export: "send you a copy of your data",
  opt_out: "stop sending you marketing",
  correct: "correct your data",
};

function fmtDay(iso: string | null): string {
  if (!iso) return "a recent day";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "a recent day";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
}

export default function PrivacyConfirm() {
  const { token = "" } = useParams();
  const [state, setState] = useState<State>("loading");
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(`${BASE}?t=${encodeURIComponent(token)}`, { headers });
        if (r.status === 404) { if (live) setState("invalid"); return; }
        if (!r.ok) { if (live) setState("error"); return; }
        const v = (await r.json()) as View;
        if (!live) return;
        setView(v);
        setState(v.status === "confirm" ? "ready" : v.status === "expired" ? "invalid" : "confirmed");
      } catch {
        if (live) setState("error");
      }
    })();
    return () => { live = false; };
  }, [token]);

  async function confirm() {
    setState("sending");
    try {
      const r = await fetch(BASE, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      if (r.status === 404) { setState("invalid"); return; }
      if (!r.ok) { setState("ready"); return; }
      setState("confirmed");
      setView((v) => (v ? { ...v, status: "confirmed" } : v));
    } catch {
      setState("ready");
    }
  }

  const ask = (view?.action && ASK[view.action]) || "update your data";
  const finished = view?.status === "done";

  return (
    <main className="min-h-screen bg-white text-neutral-900 flex items-start sm:items-center justify-center px-4 py-10">
      <Helmet>
        <title>Your data request | Bestly</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <div className="w-full max-w-md">
        <p className="text-xs font-semibold tracking-[0.14em] uppercase text-neutral-500 mb-6">Bestly Privacy</p>

        <div className="rounded-2xl border border-neutral-200 p-6 sm:p-8 shadow-sm" aria-live="polite">
          {state === "loading" && (
            <p className="text-neutral-600" role="status">Checking your link.</p>
          )}

          {(state === "ready" || state === "sending") && view && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight mb-3">Confirm your request</h1>
              <p className="text-base leading-relaxed text-neutral-700 mb-1">
                You asked Bestly to {ask} on {fmtDay(view.requested_on)}.
              </p>
              {view.code && (
                <p className="text-sm text-neutral-500 mb-6">Reference: {view.code}</p>
              )}
              <button
                type="button"
                onClick={confirm}
                disabled={state === "sending"}
                className="w-full min-h-[52px] rounded-xl bg-[#c84d2b] text-white text-lg font-semibold transition active:scale-[0.98] hover:bg-[#b24326] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c84d2b] disabled:opacity-60 cursor-pointer disabled:cursor-wait"
              >
                {state === "sending" ? "Confirming" : "Yes, this was me"}
              </button>
              <p className="text-sm text-neutral-500 mt-5">
                Didn't ask for this? Close this page and nothing will change.
              </p>
            </>
          )}

          {state === "confirmed" && !finished && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight mb-3">Thanks.</h1>
              <p className="text-base leading-relaxed text-neutral-700">
                We'll email you when it's done, within 45{NB}days and usually much sooner.
              </p>
              {view?.code && <p className="text-sm text-neutral-500 mt-4">Reference: {view.code}</p>}
            </>
          )}

          {state === "confirmed" && finished && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight mb-3">
                {view?.action === "export" ? "Your data file is ready" : "This request is done"}
              </h1>
              {view?.action === "export" && view.download ? (
                <>
                  <p className="text-base leading-relaxed text-neutral-700 mb-5">
                    The file works for 7{NB}days after you first download it.
                  </p>
                  <a
                    href={`${BASE}?t=${encodeURIComponent(token)}&download=1`}
                    className="flex items-center justify-center w-full min-h-[52px] rounded-xl bg-[#c84d2b] text-white text-lg font-semibold no-underline transition active:scale-[0.98] hover:bg-[#b24326] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c84d2b]"
                  >
                    Download my data
                  </a>
                </>
              ) : (
                <p className="text-base leading-relaxed text-neutral-700">
                  Check your email for what we did. Questions? Call (213){NB}641-0074 or email{" "}
                  <a className="underline" href="mailto:privacy@bestly.tech">privacy@bestly.tech</a>.
                </p>
              )}
              {view?.code && <p className="text-sm text-neutral-500 mt-4">Reference: {view.code}</p>}
            </>
          )}

          {state === "invalid" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight mb-3">This link has expired.</h1>
              <p className="text-base leading-relaxed text-neutral-700">
                Call (213){NB}641-0074 or email{" "}
                <a className="underline" href="mailto:privacy@bestly.tech">privacy@bestly.tech</a>.
              </p>
            </>
          )}

          {state === "error" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight mb-3">We couldn't load this page.</h1>
              <p className="text-base leading-relaxed text-neutral-700 mb-4">Try again in a minute. If it keeps happening, call (213){NB}641-0074.</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[44px] px-5 rounded-xl border border-neutral-300 font-medium cursor-pointer hover:bg-neutral-50"
              >
                Try again
              </button>
            </>
          )}
        </div>

        <p className="text-xs text-neutral-500 mt-6">Bestly LLC, Los Angeles</p>
      </div>
    </main>
  );
}

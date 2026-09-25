/**
 * One-tap approval for an extra driver, from Jared's Scout push: bestly.tech/xa/<token>.
 * Shows who and which trip, then Approve (makes their key right away). The token is long and random, and
 * it only ever goes to Jared's phone.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type R = { ok: boolean; error?: string; name?: string; guest?: string; status?: string; suggest?: string | null; pickup?: string; return?: string; asked?: string };

export default function ApproveDriver() {
  const { token = "" } = useParams();
  const [r, setR] = useState<R | null>(null);
  const [busy, setBusy] = useState(false);
  const call = async (doIt: boolean) => {
    const { data } = await (supabase.rpc("extra_driver_approve_token" as never, { p_token: token, p_do: doIt } as never) as unknown as Promise<{ data: R | null }>);
    setR(data ?? { ok: false, error: "Link not found" });
  };
  useEffect(() => { document.getElementById("boot-splash")?.remove(); void call(false); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const approved = r?.ok && r.status && r.status !== "requested";
  return (
    <main className="grid min-h-dvh place-items-center bg-black px-5 text-white" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif" }}>
      <div className="w-full max-w-sm rounded-3xl bg-[#1c1c1e] p-6 text-center">
        {!r ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-white/60" aria-label="Loading" /> : !r.ok ? (
          <p className="text-[17px] text-white/80">{r.error}</p>
        ) : (<>
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl" style={{ background: approved ? "#30D158" : "#0A84FF" }}>
            {approved ? <CheckCircle2 className="h-9 w-9" aria-hidden /> : <UserCheck className="h-9 w-9" aria-hidden />}
          </div>
          <h1 className="mt-4 text-[24px] font-bold leading-tight">{approved ? `${r.name} is approved` : `Approve ${r.name}?`}</h1>
          <p className="mt-2 text-[15px] leading-snug text-white/65">
            Extra driver on {r.guest ?? "a guest"}'s trip · pickup {r.pickup}, return {r.return}. Asked {r.asked}.
            {r.suggest ? ` Turo approved a driver named "${r.suggest}".` : ""}
          </p>
          {approved ? <p className="mt-4 text-[15px] text-white/80">Their own key is being made now. It shows up on {r.guest ?? "the guest"}'s trip page to text them.</p> : (<>
            <p className="mt-4 text-[13px] text-white/50">Only approve after checking they're an approved driver in the Turo app.</p>
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); await call(true); setBusy(false); }}
              className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#0A84FF] text-[17px] font-semibold active:scale-[0.98] disabled:opacity-60">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : null}Approve and make their key
            </button>
          </>)}
        </>)}
      </div>
    </main>
  );
}

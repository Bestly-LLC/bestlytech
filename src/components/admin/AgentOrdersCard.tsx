/**
 * Agent orders: every Bestly Agent signup from bestly.tech/agent, newest first, with plan, status, paid date and whether the buyer has
 * finished the setup questions. Data: agent_order_admin() (admin only, migration 20261012190000). Plan: docs/maya-sales-opusplan.md.
 * Times are 12-hour, the price never splits from its unit, nothing is cut off with an ellipsis.
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const NB = " ";
type Row = {
  id: string; plan: string; monthly_cents: number; status: string; company: string | null; name: string | null; email: string | null;
  created_at: string; paid_at: string | null; setup_done_at: string | null; kickoff_at: string | null; stripe_customer_id: string | null; stuck: boolean;
};

const STATUS: Record<string, { label: string; tone: string }> = {
  checkout_started: { label: "Checkout started", tone: "bg-white/10 text-white/70" },
  paid: { label: "Paid, setup not done", tone: "bg-amber-500/15 text-amber-200" },
  setup_done: { label: "Setup answers in", tone: "bg-emerald-500/15 text-emerald-200" },
  refunded: { label: "Refunded", tone: "bg-red-500/15 text-red-200" },
  cancelled: { label: "Cancelled", tone: "bg-red-500/15 text-red-200" },
};
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s(AM|PM)$/, `${NB}$1`);
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}${NB}a${NB}month`;
const planName = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

export function AgentOrdersCard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const { data, error } = await (supabase.rpc("agent_order_admin" as never, { p_limit: 50 } as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>);
    setBusy(false);
    if (error) { setErr("Couldn't load the orders. Try again in a minute."); return; }
    setErr(null);
    setRows((data as Row[] | null) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const paid = rows?.filter((r) => r.status === "paid" || r.status === "setup_done") ?? [];
  const waiting = rows?.filter((r) => r.stuck).length ?? 0;

  return (
    <section aria-labelledby="agent-orders" className="rounded-3xl bg-white/[0.03] p-4 ring-1 ring-white/10 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300" aria-hidden><ShoppingBag className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h3 id="agent-orders" className="text-[15px] font-semibold text-white">Agent orders</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-white/60">Bestly Agent signups from bestly.tech/agent. Maya opens the checkout; the buyer pays.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} aria-label="Refresh agent orders"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white/70 ring-1 ring-white/15 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50 motion-reduce:transition-none">
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {err && <p role="alert" className="mt-3 rounded-2xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/40">{err}</p>}
      {!rows && !err && <p className="mt-4 text-sm text-white/60">Loading</p>}

      {rows && (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-3xl font-semibold tabular-nums text-white">{paid.length.toLocaleString("en-US")}</span>
            <span className="text-sm text-white/70">paid {paid.length === 1 ? "order" : "orders"}{waiting > 0 ? `, ${waiting.toLocaleString("en-US")}${NB}${waiting === 1 ? "has" : "have"} waited over 3${NB}days for setup answers` : ""}</span>
          </div>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-white/60">No orders yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.08]">
              {rows.map((r) => {
                const st = STATUS[r.status] ?? { label: r.status, tone: "bg-white/10 text-white/70" };
                return (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 text-sm font-medium text-white [overflow-wrap:anywhere]">{r.company || r.name || r.email || "No name yet"}</span>
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", st.tone)}>{st.label}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-white/60">
                      <span className="whitespace-nowrap">{planName(r.plan)}, {money(r.monthly_cents)}</span>
                      {" · "}
                      {r.paid_at ? `Paid ${when(r.paid_at)}` : `Started ${when(r.created_at)}`}
                      {r.setup_done_at ? <>{" · "}Setup done {when(r.setup_done_at)}</> : null}
                      {r.stuck ? <span className="text-amber-200">{" · "}Waiting on setup answers</span> : null}
                    </p>
                    {r.stripe_customer_id && (
                      <a href={`https://dashboard.stripe.com/customers/${encodeURIComponent(r.stripe_customer_id)}`} target="_blank" rel="noopener noreferrer"
                        className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-sky-300 underline underline-offset-4 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                        Open in Stripe <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** One open claim: Your call first, then where it stands, estimates, repair, and the heavy stuff behind disclosure rows. */
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Clock, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Lines } from "@/components/Lines";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { btnDestructivePlain, btnPlain, btnTinted, card, field, label, pill, secondary, separator, tint } from "../laxUi";
import { ActivityRow, BookIt, Estimates, EvidenceRow, QuestionItem, Repair, SentRow } from "./CasePieces";
import { DraftCard } from "./DraftCard";
import { STATUS, daysToEscalate, escalateText, fullName, needsList, rpc, usd, when, type Row, type Shop } from "./shared";
import { Dot, Disclosure, Fact, Nw, Panel } from "./ui";

export function CaseDetail({ row, reload, autonomy, shops }: { row: Row; reload: () => void; autonomy: string; shops: Shop[] }) {
  const c = row.case;
  const [est, setEst] = useState(c.estimate_amount?.toString() ?? "");
  const [ins, setIns] = useState({ name: c.insurer?.name ?? "", policy: c.insurer?.policy_no ?? c.insurer?.policy ?? "", claim_no: c.insurer?.claim_no ?? "" });
  const [busy, setBusy] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const outgoing = row.drafts.filter((d) => ["approved", "sending", "failed"].includes(d.status));
  const sent = row.drafts.filter((d) => d.status === "sent");
  const invoice = row.turo_actions.find((a) => a.kind === "create_invoice" && !a.payload?.dry_run);
  const save = async (what: string, args: object) => {
    setBusy(what);
    const { error } = await rpc("claims_case_update", { p_id: c.id, ...args });
    setBusy("");
    if (error) { toast.error(error.message); return; }
    toast.success(what === "redraft" ? "Asked for a new draft" : "Saved");
    reload();
  };
  const daysLeft = daysToEscalate(c);
  const n = needsList(row);
  const bookNeeded = n.book || n.bookFailed;
  const yourCall: ReactNode[] = [];
  // Only one filled button across the whole block. Multiple-choice answers stay tinted (neither choice is "the" default).
  let filled = false;
  const takeFilled = () => { const p = !filled; filled = true; return p; };
  n.questions.forEach((q) => yourCall.push(<QuestionItem key={q.id} q={q} reload={reload} primary={(q.options ?? []).length ? false : takeFilled()} />));
  n.drafts.forEach((d) => yourCall.push(<DraftCard key={d.id} d={d} onDone={reload} primary={takeFilled()} />));
  if (bookNeeded) yourCall.push(<BookIt key="book" row={row} reload={reload} primary={takeFilled()} />);
  const chosen = row.estimates.find((e) => e.chosen);
  const state = c.repair_booking?.state ?? "";
  const showRepair = (!!chosen || !!state) && !bookNeeded;
  const nothingWaiting = !yourCall.length && !outgoing.length && !["paid", "closed"].includes(c.status);
  const showStatus = !!c.turo_next_action || outgoing.length > 0 || nothingWaiting;
  const hasInsurer = !!(c.insurer?.name || c.insurer?.policy_no || c.insurer?.policy || c.insurer?.claim_no);

  return (
    <article className="space-y-4" aria-label={`Claim for ${fullName(c)}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className={cn("text-[22px] font-semibold leading-tight tracking-[-0.01em]", label)}>{fullName(c)}</h2>
          <p className={cn("mt-0.5 text-[13px]", secondary)}>{c.turo_claim_no ? <>Turo claim <Nw>{c.turo_claim_no}</Nw> · </> : null}Reservation {c.reservation_id} · <Nw>{STATUS[c.status] ?? c.status}</Nw></p>
        </div>
        {daysLeft !== null && (
          <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold",
            daysLeft <= 4 ? pill.orange : "bg-[#7676803d] text-[#EBEBF5cc] bento:bg-[#7676801f] bento:text-[#3C3C43cc]")}>
            <Clock aria-hidden className="h-3.5 w-3.5" />{escalateText(daysLeft)}
          </span>
        )}
      </header>

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
          {yourCall.length > 0 && (
            <Panel tone="orange" className="order-1" title={<span className="inline-flex items-center gap-2"><Dot />Your call</span>}
              aside={<span className={cn("text-[13px]", secondary)}><Nw>{yourCall.length} {yourCall.length === 1 ? "thing" : "things"}</Nw> waiting on you</span>}>
              <div className={cn("divide-y", separator, "[&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0")}>{yourCall}</div>
            </Panel>
          )}

          {showStatus && (
            <Panel className="order-2" title="Where it stands">
              <div className="space-y-3">
                {c.turo_next_action && (
                  <p className={cn("rounded-xl bg-[#7676801f] px-3.5 py-3 text-[13px] leading-snug bento:bg-[#76768014]", secondary)}>
                    Turo says: <span className={cn("font-medium", label)}>{c.turo_next_action}</span>{c.turo_deadline && <> · deadline <Nw>{when(c.turo_deadline)}</Nw></>}
                    {c.synced_at && <> · read <Nw>{when(c.synced_at)}</Nw></>}
                  </p>
                )}
                {outgoing.map((d) => (
                  <p key={d.id} className={cn("flex items-start gap-1.5 text-[13px]", d.status === "failed" ? tint.red : secondary)}>
                    {d.status === "failed" ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
                    <span>{d.status === "failed" ? `Send failed: ${d.last_error ?? "unknown"}. It retries on its own.` : "A message is going out to the guest."}</span>
                  </p>
                ))}
                {nothingWaiting && (
                  <p className={cn("flex items-start gap-1.5 text-[13px] leading-snug", secondary)}>
                    <CheckCircle2 aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", tint.green)} />
                    <span><Lines>{`${autonomy === "full" ? "Nothing waiting on you." : "Nothing to approve right now."} Claims Closer writes to ${c.guest_first ?? "the guest"} on its own when they reply or a follow-up is due.`}</Lines></span>
                  </p>
                )}
              </div>
            </Panel>
          )}

          <Panel className="order-4" title="Estimates"><Estimates row={row} shops={shops} reload={reload} /></Panel>
          {showRepair && <Panel className="order-5" title="Repair"><Repair row={row} reload={reload} /></Panel>}

          <section className={cn(card, "order-6 divide-y p-1.5", separator)} aria-label="More detail">
            <EvidenceRow c={c} items={row.evidence} />
            <SentRow sent={sent} />
            <ActivityRow events={row.events} />
          </section>
        </div>

        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <Panel className="order-3" title="Key facts">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 xl:grid-cols-1">
              <Fact name="Estimate due to guest"><Nw>{when(c.estimate_due_at)}</Nw></Fact>
              <Fact name="Escalate to Turo by"><Nw>{when(c.escalate_by)}</Nw></Fact>
              <Fact name="Chosen estimate"><Nw>{usd(c.estimate_amount)}</Nw></Fact>
              <Fact name="Turo invoice cap"><Nw>{usd(c.invoice_max ?? c.guest_max)}</Nw></Fact>
              {c.host_responsibility != null && <Fact name="Your damage responsibility if Turo takes over"><Nw>{usd(c.host_responsibility)}</Nw></Fact>}
              {invoice && <Fact name="Turo invoice"><Nw>{usd(invoice.payload?.amount)}</Nw> · {invoice.status === "done" ? "posted" : invoice.status === "failed" ? `failed: ${invoice.error ?? "unknown"}` : "going up on the Pi"}</Fact>}
              {c.invoices?.map((i, k) => (
                <Fact key={k} name="Turo invoice"><Nw>{usd(i.amount)}</Nw> · {i.paid ? "paid" : <>due <Nw>{i.due_text ?? "—"}</Nw></>}</Fact>
              ))}
              {hasInsurer && <Fact name="Guest's insurer">{c.insurer?.name || "—"}{(c.insurer?.policy_no || c.insurer?.policy) ? <><br /><span className={secondary}>Policy <Nw>{c.insurer?.policy_no || c.insurer?.policy}</Nw></span></> : null}{c.insurer?.claim_no ? <><br /><span className={secondary}>Claim <Nw>{c.insurer.claim_no}</Nw></span></> : null}</Fact>}
            </dl>
          </Panel>

          <Panel className="order-7" title="Case">
            <button type="button" className={btnTinted} disabled={busy === "redraft"} onClick={() => save("redraft", { p_redraft: true })}><RefreshCw className="h-4 w-4" /> New draft</button>
            <p className={cn("mt-2 text-[13px] leading-snug", secondary)}>New draft asks Claims Closer to rewrite its next message to the guest.</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-5">
              {c.status !== "paid" && <button type="button" className={btnPlain} onClick={() => save("paid", { p_status: "paid" })}>Mark paid</button>}
              {c.status !== "closed" && <button type="button" className={btnDestructivePlain} onClick={() => setConfirmClose(true)}>Close case</button>}
              <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Close {fullName(c)}&rsquo;s claim?</AlertDialogTitle>
                    <AlertDialogDescription>
                      <Lines>{`Claims Closer stops working it: no more messages to ${c.guest_first ?? "the guest"}, shops or Turo. It moves to History under Not followed through.`}</Lines>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it open</AlertDialogCancel>
                    <AlertDialogAction className="bg-[#FF453A] text-white hover:bg-[#FF453A]/90 bento:bg-[#FF3B30]" disabled={busy === "closed"} onClick={() => save("closed", { p_status: "closed" })}>Close claim</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <div className="mt-1">
              <Disclosure variant="inline" title="Edit estimate or insurer">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block"><span className={cn("text-[13px]", secondary)}>Estimate override ($)</span>
                      <input inputMode="decimal" value={est} onChange={(e) => setEst(e.target.value.replace(/[^0-9.]/g, ""))} className={cn(field, "mt-1 w-36")} /></label>
                    <button type="button" className={btnTinted} disabled={!est || busy === "est"} onClick={() => save("est", { p_estimate: Number(est) })}>{busy === "est" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save estimate"}</button>
                  </div>
                  <div className="grid gap-2">
                    {(["name", "policy", "claim_no"] as const).map((k) => (
                      <label key={k} className="block"><span className={cn("text-[13px]", secondary)}>{k === "name" ? "Guest's insurer" : k === "policy" ? "Policy number" : "Insurance claim number"}</span>
                        <input value={ins[k]} onChange={(e) => setIns({ ...ins, [k]: e.target.value })} className={cn(field, "mt-1 w-full")} /></label>
                    ))}
                  </div>
                  <button type="button" className={btnTinted} disabled={busy === "ins"} onClick={() => save("ins", { p_insurer: { name: ins.name, policy_no: ins.policy, claim_no: ins.claim_no }, p_status: ins.name ? "insurance" : null })}>Save insurer</button>
                </div>
              </Disclosure>
            </div>
          </Panel>
        </div>
      </div>
    </article>
  );
}

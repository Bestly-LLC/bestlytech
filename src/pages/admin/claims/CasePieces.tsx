/** Building blocks of the case detail: questions, Book it, repair, estimates, evidence, messages sent, activity log. Logic moved from the old ClaimsCloser.tsx unchanged. */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, CircleAlert, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { btnPrimary, btnTinted, field, label, pill, secondary, separator, tint } from "../laxUi";
import { BOOK, EST, KIND, rpc, usd, when, type Case, type Estimate, type Evidence, type Question, type Row, type Shop, type Ev, type Draft } from "./shared";
import { Disclosure, Nw } from "./ui";

/* ───────── Questions ───────── */
export function QuestionItem({ q, reload, primary }: { q: Question; reload: () => void; primary: boolean }) {
  const [busy, setBusy] = useState(false); const [text, setText] = useState("");
  const answer = async (a: string) => {
    setBusy(true); const { error } = await rpc("claims_answer", { p_id: q.id, p_answer: a }); setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Thanks. Claims Closer is on it."); reload();
  };
  const opts = q.options ?? [];
  return (
    <div>
      <p className={cn("text-[15px] font-semibold", label)}>{q.question}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {opts.map((o) => <button key={o.value} type="button" className={btnTinted} disabled={busy} onClick={() => answer(o.value)}>{o.label}</button>)}
        {!opts.length && (<>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" className={cn(field, "w-full sm:w-72")} aria-label="Your answer" />
          <button type="button" className={primary ? btnPrimary : btnTinted} disabled={busy || !text.trim()} onClick={() => answer(text)}>Send</button></>)}
      </div>
    </div>
  );
}

/* ───────── Book it (waits for Jared) and the "I booked it myself" form ───────── */
export function ByHand({ row, reload, defaultOpen }: { row: Row; reload: () => void; defaultOpen?: boolean }) {
  const [busy, setBusy] = useState(false); const [manual, setManual] = useState("");
  const byHand = async () => {
    setBusy(true); const { error } = await rpc("claims_book_manual", { p_case: row.case.id, p_dropoff: new Date(manual).toISOString() }); setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved. I will remind you."); reload();
  };
  return (
    <details className="group" open={defaultOpen}>
      <summary className={cn("flex min-h-[44px] cursor-pointer list-none items-center text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF] rounded-lg sm:min-h-[36px] [&::-webkit-details-marker]:hidden", tint.blue)}>I booked it myself</summary>
      <div className="flex flex-wrap items-end gap-2 pb-1 pt-1">
        <label className="block w-full sm:w-auto"><span className={cn("text-[13px]", secondary)}>Drop-off</span><input type="datetime-local" value={manual} onChange={(e) => setManual(e.target.value)} className={cn(field, "mt-1 sm:w-56")} /></label>
        <button type="button" className={btnTinted} disabled={busy || !manual} onClick={byHand}>Save</button>
      </div>
    </details>
  );
}

export function BookIt({ row, reload, primary }: { row: Row; reload: () => void; primary: boolean }) {
  const chosen = row.estimates.find((e) => e.chosen);
  const failed = row.case.repair_booking?.state === "failed";
  const [busy, setBusy] = useState(false);
  const book = async () => {
    setBusy(true); const { error } = await rpc("claims_book", { p_case: row.case.id }); setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Booking started. Ava is calling the shop."); reload();
  };
  return (
    <div>
      <p className={cn("text-[15px] font-semibold", label)}>{failed ? "The repair booking needs you" : "Book the repair"}</p>
      {failed ? (
        <p className={cn("mt-0.5 text-[13px]", secondary)}>{chosen ? <>Ava could not book {chosen.shop}. </> : null}If you booked it yourself, enter the drop-off time below.</p>
      ) : (
        <>
          {chosen && <p className={cn("mt-0.5 text-[13px]", secondary)}>{chosen.shop} · <Nw>{usd(chosen.amount)}</Nw>{chosen.distance_mi != null && <> · <Nw>{Number(chosen.distance_mi)} mi</Nw></>}</p>}
          <div className="mt-2.5">
            <button type="button" className={primary ? btnPrimary : btnTinted} disabled={busy} onClick={book}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />} Book it</button>
            <p className={cn("mt-2 text-[13px]", secondary)}>Ava calls {chosen?.shop ?? "the shop"}, picks a drop-off when the car is free, and puts it on your calendar. Nothing is paid.</p>
          </div>
        </>
      )}
      <div className="mt-1"><ByHand row={row} reload={reload} defaultOpen={failed} /></div>
    </div>
  );
}

/* ───────── Repair status ───────── */
export function Repair({ row, reload }: { row: Row; reload: () => void }) {
  const c = row.case; const rb = c.repair_booking; const state = rb?.state ?? "";
  const chosen = row.estimates.find((e) => e.chosen);
  if (!chosen && !state) return null;
  const showByHand = state === "by_hand" || (!state && !!chosen && !c.estimate_amount);
  return (
    <div>
      {chosen && <p className={cn("text-[15px]", label)}>{chosen.shop}</p>}
      {chosen && <p className={cn("text-[13px]", secondary)}><Nw>{usd(chosen.amount)}</Nw>{chosen.distance_mi != null && <> · <Nw>{Number(chosen.distance_mi)} mi</Nw></>}</p>}
      {state ? (
        <p className={cn("mt-2 flex items-start gap-1.5 text-[15px]", label)}>
          {["booked", "manual"].includes(state) ? <CalendarCheck className={cn("mt-0.5 h-4 w-4 shrink-0", tint.green)} /> : ["requested", "calling"].includes(state) ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <CircleAlert className={cn("mt-0.5 h-4 w-4 shrink-0", tint.orange)} />}
          <span>{BOOK[state] ?? state}{rb?.dropoff_at && <> · drop off <Nw>{when(rb.dropoff_at)}</Nw></>}{rb?.pickup_at && <>, ready about <Nw>{when(rb.pickup_at)}</Nw></>}</span>
        </p>
      ) : (
        <p className={cn("mt-2 text-[13px]", secondary)}>{c.estimate_amount ? "Not booked yet." : "Waiting on a price before booking."}</p>
      )}
      {showByHand && <div className="mt-1"><ByHand row={row} reload={reload} /></div>}
    </div>
  );
}

/* ───────── Estimates ───────── */
export function Estimates({ row, shops, reload }: { row: Row; shops: Shop[]; reload: () => void }) {
  const c = row.case;
  const [shop, setShop] = useState(""); const [amt, setAmt] = useState(""); const [oem, setOem] = useState(false); const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const { error } = await rpc("claims_estimate_add", { p_case: c.id, p_shop: shop, p_amount: Number(amt), p_oem: oem });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Estimate added. Claims Closer picks it up in a minute."); setAmt(""); reload();
  };
  const list = row.estimates;
  return (
    <div>
      {!list.length ? <p className={cn("text-[13px]", secondary)}>No shops asked yet. Claims Closer asks the best-ranked shops as soon as the damage photos are in.</p> : (
        <ul className={cn("divide-y", separator)}>
          {list.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
              <div className="min-w-0">
                <p className={cn("text-[15px] font-medium", label)}>{e.shop}{e.chosen && <span className={cn("ml-2 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold", pill.green)}>Chosen</span>}</p>
                <p className={cn("mt-0.5 text-[13px]", secondary)}>
                  {e.distance_mi != null && <><Nw>{Number(e.distance_mi)} mi</Nw> · </>}{e.channel === "call" ? "Ava called" : e.channel === "email" ? "Emailed" : "Walk-in"} <Nw>{when(e.requested_at)}</Nw> · <Nw>{EST[e.status] ?? e.status}</Nw>
                  {e.oem != null && <> · {e.oem ? "OEM parts" : "aftermarket parts"}</>}{e.repair_vs_replace && <> · {e.repair_vs_replace}</>}
                </p>
                {e.status === "needs_visit" && e.notes && <p className={cn("mt-0.5 text-[13px]", secondary)}>{e.notes}</p>}
                {e.chosen_reason && <p className={cn("mt-0.5 text-[13px]", secondary)}>{e.chosen_reason}</p>}
              </div>
              <span className={cn("shrink-0 whitespace-nowrap text-[17px] font-semibold", label)}>{usd(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1">
        <Disclosure variant="inline" title="Add a quote I got myself">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block w-full sm:w-auto"><span className={cn("text-[13px]", secondary)}>Shop</span>
              <select value={shop} onChange={(e) => setShop(e.target.value)} className={cn(field, "mt-1 sm:w-56")}><option value="">Choose</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label className="block"><span className={cn("text-[13px]", secondary)}>Total ($)</span>
              <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} className={cn(field, "mt-1 w-28")} /></label>
            <label className={cn("flex min-h-[44px] items-center gap-1.5 text-[13px] sm:min-h-0", secondary)}><input type="checkbox" checked={oem} onChange={(e) => setOem(e.target.checked)} /> OEM parts</label>
            <button type="button" className={btnTinted} disabled={busy || !shop || !amt} onClick={add}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}</button>
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

/* ───────── Heavy stuff behind disclosure rows ───────── */
function Answers({ title, sub, answers }: { title: string; sub?: string; answers: Record<string, string> }) {
  return (
    <div>
      <p className={cn("text-[13px] font-semibold", label)}>{title}{sub ? <span className={cn("font-normal", secondary)}> · {sub}</span> : null}</p>
      <dl className="mt-1 space-y-1.5">{Object.entries(answers).map(([q, a]) => <div key={q}><dt className={cn("text-[12px]", secondary)}>{q}</dt><dd className={cn("text-[13px]", secondary)}>{a}</dd></div>)}</dl>
    </div>
  );
}

export function EvidenceRow({ c, items }: { c: Case; items: Evidence[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !items.length || Object.keys(urls).length) return;
    void supabase.functions.invoke("claims-closer", { body: { op: "evidence_urls", case_id: c.id } }).then(({ data }) => { if (data?.urls) setUrls(data.urls); });
  }, [open, items.length, c.id, urls]);
  const guest = c.guest_response?.answers ?? {};
  const report = c.damage_report?.answers ?? {};
  const after = items.filter((i) => i.kind === "after"), before = items.filter((i) => i.kind === "before");
  return (
    <Disclosure onToggle={setOpen} title={<>Evidence <span className={cn("font-normal", secondary)}>· <Nw>{after.length} damage</Nw> · <Nw>{before.length} before</Nw></span></>}>
      <div className="space-y-4">
        {Object.keys(guest).length > 0 && <Answers title={`${c.guest_first ?? "Guest"}’s answers`} sub={c.guest_response?.submitted} answers={guest} />}
        {Object.keys(report).length > 0 && <Answers title="Your damage report" answers={report} />}
        {[["Damage found at check-in", after], ["Before the trip", before]].map(([title, list]) => (list as Evidence[]).length > 0 && (
          <div key={title as string}><p className={cn("text-[13px] font-semibold", label)}>{title as string}</p>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {(list as Evidence[]).map((i) => urls[i.id]
                ? <a key={i.id} href={urls[i.id]} target="_blank" rel="noreferrer" aria-label={`${title as string}, open photo`}><img src={urls[i.id]} alt={`${title as string}`} loading="lazy" className="aspect-square w-full rounded-lg object-cover" /></a>
                : <div key={i.id} className="aspect-square w-full animate-pulse rounded-lg bg-[#7676803d] bento:bg-[#7676801f]" />)}
            </div></div>
        ))}
        {!items.length && !Object.keys(guest).length && !Object.keys(report).length && <p className={cn("text-[13px]", secondary)}>Nothing collected yet.</p>}
      </div>
    </Disclosure>
  );
}

export function SentRow({ sent }: { sent: Draft[] }) {
  if (!sent.length) return null;
  return (
    <Disclosure title={<>Messages sent <span className={cn("font-normal", secondary)}>· <Nw>{sent.length}</Nw></span></>}>
      <ul className={cn("divide-y", separator)}>
        {sent.map((d) => (
          <li key={d.id} className="py-2.5 first:pt-0"><p className={cn("text-[12px]", secondary)}>{KIND[d.kind] ?? "Message"} · <Nw>{when(d.sent_at)}</Nw>{d.verified ? " · confirmed in Turo" : ""}</p>
            <p className={cn("mt-0.5 whitespace-pre-wrap text-[13px]", secondary)}>{d.body}</p></li>
        ))}
      </ul>
    </Disclosure>
  );
}

export function ActivityRow({ events }: { events: Ev[] }) {
  if (!events.length) return null;
  return (
    <Disclosure title="Activity log">
      <ul className={cn("divide-y", separator)}>
        {events.map((e) => (
          <li key={e.id} className="py-2.5 text-[13px] first:pt-0">
            <span className={label}>{e.title ?? e.kind}</span> <span className={cn("whitespace-nowrap", secondary)}>{when(e.at)}</span>
            {typeof e.detail?.body === "string" && <p className={cn("mt-0.5 whitespace-pre-wrap", secondary)}>{e.detail.body as string}</p>}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

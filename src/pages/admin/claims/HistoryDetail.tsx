/** A finished claim: won (paid) or not followed through (closed). Content moved from the old HistoryCard. */
import { cn } from "@/lib/utils";
import { label, secondary, tint } from "../laxUi";
import { day, fullName, usd, type Case } from "./shared";
import { Fact, Nw, Panel } from "./ui";

export function HistoryDetail({ c }: { c: Case }) {
  const won = c.status === "paid";
  return (
    <article className="space-y-4" aria-label={`Finished claim for ${fullName(c)}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className={cn("text-[22px] font-semibold leading-tight tracking-[-0.01em]", label)}>{fullName(c)}</h2>
          <p className={cn("mt-0.5 text-[13px]", secondary)}><Nw>{day(c.opened_at)}</Nw> · {c.car ?? "—"}{c.turo_claim_no ? <> · claim <Nw>{c.turo_claim_no}</Nw></> : null}</p>
        </div>
        <p className={cn("whitespace-nowrap text-[22px] font-semibold", won ? tint.green : secondary)}>
          {won ? (c.recovered_amount != null ? usd(c.recovered_amount) : "Settled") : "Not pursued"}
        </p>
      </header>
      <Panel title={won ? "How it ended" : "Why it stopped"}>
        <div className={cn("space-y-2 text-[15px] leading-snug", label)}>
          {c.outcome && <p>{c.outcome}</p>}
          {c.facts && <p className={cn("text-[13px]", secondary)}>{c.facts}</p>}
          {!c.outcome && !c.facts && <p className={cn("text-[13px]", secondary)}>{won ? "Paid." : "Closed without a recovery."}</p>}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3">
          <Fact name="Reservation">{c.reservation_id}</Fact>
          {c.host_responsibility != null && <Fact name="Your damage responsibility"><Nw>{usd(c.host_responsibility)}</Nw></Fact>}
          {c.closed_at && <Fact name={won ? "Closed" : "Stopped"}><Nw>{day(c.closed_at)}</Nw></Fact>}
        </dl>
      </Panel>
    </article>
  );
}

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { catLabel } from "@/components/admin/hunter/scoreUi";
import { NBSP, fit100, pct, usePipelineRpc } from "./lib";
import { Empty, Gate, Ring } from "./parts";
import type { LeadRow, LeadStatus, LeadsPage } from "./types";

export const STATUS_LABEL: Record<LeadStatus, string> = { qualified: "Qualified", queued: "Queued", called: "Called", booked: "Booked", archived: "Archived", dnc: "Do not call", new: "New" };
const STATUS_TONE: Record<LeadStatus, string> = {
  qualified: "bg-sky-400/15 text-sky-200", queued: "bg-violet-400/15 text-violet-200", called: "bg-amber-400/15 text-amber-200", booked: "bg-emerald-400/15 text-emerald-200",
  archived: "bg-white/10 text-white/70", dnc: "bg-rose-400/15 text-rose-200", new: "bg-white/10 text-white/70",
};
const SEGS = [["qualified", "Qualified"], ["queued", "Queued"], ["called", "Called"], ["all", "All"]] as const;
const PAGE = 25;
const sel = "h-11 rounded-xl bg-white/[0.06] px-3 text-[16px] text-white outline-none ring-1 ring-white/10 focus-visible:ring-2 focus-visible:ring-white/60";

export const ownerName = (o: string) => o ? o.charAt(0).toUpperCase() + o.slice(1) : "Nobody";

export function LeadsList({ owners, onOpen }: { owners: Array<{ slug: string; name: string }>; onOpen: (l: LeadRow) => void }) {
  const [seg, setSeg] = useState<(typeof SEGS)[number][0]>("qualified");
  const [owner, setOwner] = useState("all");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [pages, setPages] = useState(1);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPages(1), [seg, owner, dq]);

  const { data, loading, missing, error, reload } = usePipelineRpc<LeadsPage>("pipeline_leads", {
    p_status: seg, p_owner: owner === "all" ? null : owner, p_q: dq || null, p_limit: PAGE * pages, p_offset: 0,
  });
  const rows = data?.rows ?? [], total = data?.total ?? 0, more = total > rows.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10" role="group" aria-label="Show leads that are">
          {SEGS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setSeg(k)} aria-pressed={seg === k}
              className={cn("min-h-[44px] rounded-lg px-3.5 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50", seg === k ? "bg-white/15 text-white" : "text-white/65 hover:text-white")}>{label}</button>
          ))}
        </div>
        <select className={sel} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Whose leads">
          <option value="all">Everyone's leads</option>
          {owners.map((o) => <option key={o.slug} value={o.slug}>{o.name}'s leads</option>)}
        </select>
        <label className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" aria-hidden />
          <input className={cn(sel, "w-full pl-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by business or city" aria-label="Search leads" />
        </label>
      </div>

      <Gate loading={loading} missing={missing} error={error} hasData={data != null} h={200} onRetry={() => void reload()}>
        {rows.length > 0 && <p className="text-[13px] text-white/60"><span className="whitespace-nowrap tabular-nums">{rows.length}</span> of <span className="whitespace-nowrap tabular-nums">{total}</span> leads</p>}
        {rows.length === 0 ? <Empty>{dq ? "No leads match that search." : "No leads here yet."}</Empty> : (
          <ul className="mt-2 divide-y divide-white/10 overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
            {rows.map((l) => (
              <li key={`${l.lead_table}:${l.id}`}>
                <button type="button" onClick={() => onOpen(l)} className="flex min-h-[64px] w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50 sm:px-4">
                  <Ring value={Math.round((l.reach ?? 0) * 100)} of={100} size={48} stroke={5} tone="text-emerald-400" label={`Chance a call reaches a decision maker: ${pct(l.reach)}`}>
                    <span className="text-[13px] font-semibold tabular-nums text-white">{l.reach == null ? "–" : Math.round(l.reach * 100)}</span>
                  </Ring>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[16px] font-medium leading-snug text-white">{l.company}</span>
                    <span className="block break-words text-[13px] text-white/60">{catLabel(l.category)}{l.city ? ` · ${l.city}` : ""}{l.fit != null ? <> · Fit{NBSP}{fit100(l.fit)}</> : null}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium", STATUS_TONE[l.status] ?? STATUS_TONE.new)}>{STATUS_LABEL[l.status] ?? l.status}</span>
                    <span className="whitespace-nowrap rounded-full bg-white/10 px-2.5 py-0.5 text-[12px] text-white/80">{ownerName(l.owner)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {more && <button type="button" onClick={() => setPages((p) => p + 1)} className="mt-2 min-h-[44px] w-full rounded-xl bg-white/10 text-[15px] font-medium text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">Show <span className="whitespace-nowrap tabular-nums">{total - rows.length}</span> more</button>}
      </Gate>
    </div>
  );
}

/**
 * /admin/claims: Claims Closer (team slug claims-closer). Migrations 20261005040000_claims_closer.sql, 20261006230000_claims_v2_core.sql,
 * 20261007000000_claims_v2_turo_book.sql, 20261029230000_claims_cleaning.sql; edge fns claims-closer + claims-cleaning; docs/claims-closer-v2-opusplan.md.
 * v2 is hands-off: guest messages, shop estimate requests and the Turo invoice go out on their own (Settings: "Ask me first" brings
 * the old tap-to-send back). The only things that wait for Jared are marked "Your call". This page shows what Claims Closer sees and did:
 * Turo's status, the evidence photos, the shop quotes and which one it chose, the booking, questions it needs answered, cleaning reports,
 * and a read-only log of messages sent.
 *
 * Layout (redesign 2026-10-29): desktop (lg+) is a split view, a sticky list on the left and the detail on the right. Below lg it is
 * iOS-style push navigation: list, then detail with a "Claims" back button. The selection lives in the URL (?item=<case id>,
 * clean:<reservation id>, hist:<case id>) so the phone's back button returns to the list. Pieces live in ./claims/.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, Inbox, Loader2, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { btnTinted, label, secondary, tint } from "./laxUi";
import { CaseDetail } from "./claims/CaseDetail";
import { CleaningDetail } from "./claims/CleaningDetail";
import { ClaimsList, buildItems } from "./claims/ClaimsList";
import { HistoryDetail } from "./claims/HistoryDetail";
import { SettingsSheet } from "./claims/SettingsSheet";
import { SummaryStrip } from "./claims/SummaryStrip";
import { Dot, Nw, Panel, useIsDesktop } from "./claims/ui";
import { caseNeedsCount, clock, cleanNeedsYou, cleanOpen, isHistory, rpc, tabOfId, wonTotal, type CleanData, type CleanRow, type Data, type Row, type Tab } from "./claims/shared";

type Sel = { kind: "open"; id: string; row: Row } | { kind: "history"; id: string; row: Row } | { kind: "clean"; id: string; clean: CleanRow };

/** Looks an item id up in fresh data, so the selection survives the 30-second reload (and follows a case that moved to History). */
function resolve(id: string | null, data: Data | null, clean: CleanData | null): Sel | null {
  if (!id || !data) return null;
  if (id.startsWith("clean:")) {
    const r = clean?.rows.find((x) => `clean:${x.reservation_id}` === id);
    return r ? { kind: "clean", id, clean: r } : null;
  }
  const cid = id.startsWith("hist:") ? id.slice(5) : id;
  const row = data.cases.find((r) => r.case.id === cid);
  if (!row) return null;
  return isHistory(row.case) ? { kind: "history", id: `hist:${cid}`, row } : { kind: "open", id: cid, row };
}

export default function ClaimsCloser() {
  const [data, setData] = useState<Data | null>(null);
  const [clean, setClean] = useState<CleanData | null>(null);
  const load = useCallback(async () => {
    const [{ data: d, error }, c] = await Promise.all([rpc<Data>("claims_admin"), rpc<CleanData>("claims_cleaning_admin")]);
    if (error) { toast.error(error.message); return; }
    setData(d);
    if (!c.error) setClean(c.data);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 30000); return () => clearInterval(t); }, [load]);

  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const itemParam = sp.get("item");
  const [tabState, setTabState] = useState<Tab>("open");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pushed = useRef(false);
  const listScroll = useRef(0);

  const items = useMemo(() => data ? buildItems(data, clean) : { open: [], clean: [], history: [] }, [data, clean]);
  const won = useMemo(() => wonTotal(data?.cases ?? []), [data]);
  const urlSel = resolve(itemParam, data, clean);
  const sel = urlSel ?? (desktop && items[tabState][0] ? resolve(items[tabState][0].id, data, clean) : null);
  const tab: Tab = sel?.kind ?? tabState;

  // First load: open on the tab that has something waiting on Jared.
  const started = useRef(false);
  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    if (itemParam) return;
    if (items.open.some((i) => i.needs)) setTabState("open");
    else if (items.clean.some((i) => i.needs)) setTabState("clean");
  }, [data, items, itemParam]);

  useEffect(() => { if (!itemParam) pushed.current = false; }, [itemParam]);

  // Phone: a new screen starts at the top, and coming back to the list restores where you were.
  const scroller = () => rootRef.current?.closest("main") ?? null;
  useLayoutEffect(() => {
    if (desktop) return;
    const m = scroller();
    if (m) m.scrollTop = sel ? 0 : listScroll.current;
  }, [sel?.id, desktop]);

  // Keep any other query params (the admin shell reads some, e.g. ?direct=1) and only touch ?item.
  const setItem = (id: string | null, replace: boolean) => setSp((prev) => { const n = new URLSearchParams(prev); if (id) n.set("item", id); else n.delete("item"); return n; }, { replace });
  const select = (id: string) => {
    setTabState(tabOfId(id));
    if (desktop) { setItem(id, true); return; }
    listScroll.current = scroller()?.scrollTop ?? 0;
    pushed.current = true;
    setItem(id, false);
  };
  const onTab = (t: Tab) => {
    setTabState(t);
    if (itemParam) setItem(null, true);
  };
  const back = () => {
    if (pushed.current) { pushed.current = false; navigate(-1); } else setItem(null, true);
  };

  const header = (
    <PageHeader title="Claims" description="Claims Closer works each Turo damage claim and cleaning report for you. You only step in when something here says Your call."
      actions={data ? <Health data={data} onOpen={() => setSettingsOpen(true)} /> : undefined} />
  );
  if (!data) return <div ref={rootRef} className="space-y-4 pb-8">{header}<Loader2 className="h-5 w-5 animate-spin text-[#8E8E93]" /></div>;

  const yourCall = data.cases.filter((r) => !isHistory(r.case)).reduce((n, r) => n + caseNeedsCount(r), 0) + (clean?.rows.filter(cleanNeedsYou).length ?? 0);
  const cleaning = clean?.rows.filter(cleanOpen).length ?? 0;
  const go = (k: "yourCall" | "open" | "clean" | "history") => {
    if (k === "yourCall") {
      const first = items.open.find((i) => i.needs) ?? items.clean.find((i) => i.needs);
      if (first) { select(first.id); return; }
      onTab("open"); return;
    }
    onTab(k);
  };

  const detail = !sel ? null
    : sel.kind === "open" ? <CaseDetail key={sel.id} row={sel.row} reload={load} autonomy={data.settings?.autonomy ?? "full"} shops={data.shops ?? []} />
    : sel.kind === "history" ? <HistoryDetail key={sel.id} c={sel.row.case} />
    : <CleaningDetail key={sel.id} r={sel.clean} reload={load} />;

  if (!desktop && sel) {
    return (
      <div ref={rootRef} className="space-y-3 pb-8">
        <h1 className="sr-only">Claims</h1>
        <button type="button" onClick={back} aria-label="Back to all claims"
          className={cn("-ml-2 inline-flex min-h-[44px] items-center gap-0.5 rounded-lg pl-1 pr-3 text-[17px] font-medium active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]", tint.blue)}>
          <ChevronLeft aria-hidden className="h-6 w-6" />Claims
        </button>
        {detail}
        <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} data={data} clean={clean} reload={load} />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="space-y-4 pb-8">
      {header}
      <SummaryStrip yourCall={yourCall} open={items.open.length} cleaning={cleaning} recovered={won.total} wonCount={won.won.length} go={go} />
      <div className="lg:flex lg:items-start lg:gap-5">
        <aside className="lg:sticky lg:top-3 lg:w-[320px] lg:shrink-0 xl:w-[380px]" aria-label="Claims list">
          <ClaimsList tab={tab} onTab={onTab} items={items} counts={{ open: items.open.length, clean: cleaning }}
            selectedId={sel?.id ?? null} onSelect={select} recovered={{ total: won.total, settlement: won.settlement }} />
        </aside>
        {desktop && (
          <section className="min-w-0 flex-1" aria-label="Details">
            {detail ?? (
              <Panel className="flex min-h-[240px] flex-col items-center justify-center text-center">
                <Inbox aria-hidden className={cn("h-8 w-8", secondary)} />
                <p className={cn("mt-3 text-[17px] font-semibold", label)}>Nothing to open here</p>
                <p className={cn("mt-1 max-w-sm text-[13px]", secondary)}>When a claim or cleaning report shows up in the list, pick it to see everything about it.</p>
              </Panel>
            )}
          </section>
        )}
      </div>
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} data={data} clean={clean} reload={load} />
    </div>
  );
}

/** Small health line: a dot plus when the last check ran. Orange when anything needs fixing; tap opens Settings. */
function Health({ data, onOpen }: { data: Data; onOpen: () => void }) {
  const beat = data.beat;
  const problem = beat && !beat.ok ? "Problem found" : data.sender?.last_error ? "Sender has an error" : data.reader && !data.reader.signed_in ? "Turo reader signed out" : null;
  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      <button type="button" onClick={onOpen} aria-label={problem ? `${problem}. Open settings.` : "Last check. Open settings."}
        className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-full pr-2 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF] sm:min-h-[36px]", problem ? tint.orange : secondary)}>
        <Dot tone={problem ? "orange" : beat ? "green" : "gray"} />
        <span>{problem ?? (beat ? "Checked" : "No check yet")}{beat ? <>{problem ? " · checked " : " "}<Nw>{clock(beat.at)}</Nw></> : null}</span>
      </button>
      <button type="button" className={btnTinted} onClick={onOpen}><Settings2 aria-hidden className="h-4 w-4" /> Settings</button>
    </div>
  );
}

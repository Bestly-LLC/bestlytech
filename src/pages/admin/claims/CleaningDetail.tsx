/** One cleaning report (a finished trip checked for a $150 cleaning fee). Logic moved from the old CleaningRow. */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { btnPlain, btnPrimary, card, label, secondary } from "../laxUi";
import { CLEAN_TONE, cleanLabel, cleanLive, cleanNeedsYou, rpc, when, type CleanRow } from "./shared";
import { Disclosure, Dot, Fact, Nw, Panel } from "./ui";

export function CleaningDetail({ r, reload }: { r: CleanRow; reload: () => void }) {
  const [busy, setBusy] = useState("");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !r.photos.length || Object.keys(urls).length) return;
    void supabase.functions.invoke("claims-cleaning", { body: { op: "urls", reservation_id: r.reservation_id } }).then(({ data }) => { if (data?.urls) setUrls(data.urls); });
  }, [open, r.photos.length, r.reservation_id, urls]);
  const live = cleanLive(r);
  const act = async (action: "file" | "skip" | "recheck") => {
    setBusy(action);
    const { error } = await rpc("claims_cleaning_decide", { p_res: r.reservation_id, p_action: action });
    setBusy("");
    if (error) { toast.error(error.message); return; }
    toast.success(action === "file" ? "Filing with Turo now. Claims Closer confirms Turo saved it." : action === "skip" ? "Skipped" : "Checking the photos again");
    reload();
  };
  const after = r.photos.filter((p) => p.side !== "pre"), before = r.photos.filter((p) => p.side === "pre");
  const yourCall = r.status === "needs_you" && !r.dry_run && live;
  const showWindow = live && !["clean", "skipped", "saved", "approved", "denied"].includes(r.status);
  const canRecheck = ["clean", "no_evidence", "error", "needs_you"].includes(r.status) && live && (r.dry_run || r.status !== "needs_you");
  const name = r.guest_first ?? "Guest";
  return (
    <article className="space-y-4" aria-label={`Cleaning report for ${name}`}>
      <header className="min-w-0">
        <h2 className={cn("text-[22px] font-semibold leading-tight tracking-[-0.01em]", label)}>{name}{r.dry_run ? <span className={cn("ml-2 text-[13px] font-normal", secondary)}>Test run</span> : null}</h2>
        <p className={cn("mt-0.5 text-[13px]", secondary)}>Cleaning report · trip ended <Nw>{when(r.trip_end)}</Nw></p>
      </header>

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
          {yourCall && (
            <Panel tone="orange" className="order-1" title={<span className="inline-flex items-center gap-2"><Dot />Your call</span>}>
              <p className={cn("text-[15px]", label)}>Claims Closer compared the photos and wants you to decide. File the cleaning report with Turo, or skip it.</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <button type="button" className={btnPrimary} disabled={!!busy} onClick={() => act("file")}>{busy === "file" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span>File the <Nw>$150</Nw> report</span></button>
                <button type="button" className={btnPlain} disabled={!!busy} onClick={() => act("skip")}><X className="h-4 w-4" /> Skip</button>
              </div>
            </Panel>
          )}

          <Panel className="order-2" title="What Claims Closer found">
            <p className={cn("text-[15px] font-medium", CLEAN_TONE[r.status] ?? label)}>{cleanLabel(r.status)}</p>
            {r.reasons && <p className={cn("mt-1.5 text-[13px] leading-snug", secondary)}>{r.reasons}</p>}
            {r.status === "error" && r.last_error && <p className={cn("mt-1.5 text-[13px]", secondary)}>{r.last_error}</p>}
            {canRecheck && (
              <button type="button" className={cn(btnPlain, "mt-2")} disabled={!!busy} onClick={() => act("recheck")}>
                {busy === "recheck" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check again
              </button>
            )}
          </Panel>

          {r.photos.length > 0 && (
            <section className={cn(card, "order-4 p-1.5")} aria-label="Photos">
              <Disclosure onToggle={setOpen} title={<>Photos <span className={cn("font-normal", secondary)}>· <Nw>{after.length} return</Nw> · <Nw>{before.length} check-in</Nw></span></>}>
                <div className="space-y-4">
                  {[["Return", after], ["Check-in", before]].map(([title, list]) => (list as CleanRow["photos"]).length > 0 && (
                    <div key={title as string}><p className={cn("text-[13px] font-semibold", label)}>{title as string}</p>
                      <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                        {(list as CleanRow["photos"]).map((p) => urls[p.uuid]
                          ? <a key={p.uuid} href={urls[p.uuid]} target="_blank" rel="noreferrer" aria-label={`${title as string} photo, open`}><img src={urls[p.uuid]} alt={`${title as string} photo`} loading="lazy"
                              className={cn("aspect-square w-full rounded-lg object-cover", p.support && "ring-2 ring-[#FF9F0A] bento:ring-[#C93400]")} /></a>
                          : <div key={p.uuid} className="aspect-square w-full animate-pulse rounded-lg bg-[#7676803d] bento:bg-[#7676801f]" />)}
                      </div></div>
                  ))}
                  {r.photos.some((p) => p.support) && <p className={cn("text-[13px]", secondary)}>An orange outline marks a photo that backs up what it found.</p>}
                </div>
              </Disclosure>
            </section>
          )}
        </div>

        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <Panel className="order-3" title="Key facts">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 xl:grid-cols-1">
              <Fact name="Trip ended"><Nw>{when(r.trip_end)}</Nw></Fact>
              {showWindow && <Fact name="Turo's window closes"><Nw>{when(r.deadline)}</Nw></Fact>}
              {r.filed_at && <Fact name="Filed with Turo"><Nw>{when(r.filed_at)}</Nw></Fact>}
              <Fact name="Fee"><Nw>$150</Nw></Fact>
            </dl>
          </Panel>
        </div>
      </div>
    </article>
  );
}

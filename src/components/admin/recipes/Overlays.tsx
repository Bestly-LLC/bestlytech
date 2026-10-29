import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Ico } from "./Ico";
import { RxPortal, call, table, type GroceryRow, type HandoffRow } from "./rx";
import { GroceriesList } from "./Library";
import { remainingText, type LiveTimer } from "./useTimers";

/** "Cook Pineapple Tepache? Sent from iPhone." Slides in on the iPad or desktop when the iPhone sends a recipe or a link.
 *  It lives above the Pantry / Recipes switch, so it shows whichever side of Kitchen is open. */
export function HandoffWatcher() {
  const [, setSp] = useSearchParams();
  const [row, setRow] = useState<HandoffRow | null>(null);
  const [shown, setShown] = useState(false);
  const small = typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches; // the phone is the sender

  useEffect(() => {
    if (small) return;
    let live = true;
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    void table("recipe_handoff").select("id, kind, recipe_id, title, url, source, status, created_at").eq("status", "pending").gte("created_at", since)
      .order("created_at", { ascending: false }).limit(1).then(({ data }) => {
        if (live && data?.[0]) { setRow(data[0] as HandoffRow); setShown(true); }
      });
    const ch = supabase.channel("recipe-handoff")
      .on("postgres_changes", { event: "*", schema: "public", table: "recipe_handoff" }, (pl) => {
        const n = pl.new as unknown as HandoffRow;
        if (!n?.id) return;
        if (n.status === "pending") { setRow(n); setShown(true); }
        else setRow((cur) => { if (cur?.id === n.id) setShown(false); return cur; });
      })
      .subscribe();
    return () => { live = false; void supabase.removeChannel(ch); };
  }, [small]);

  // A handoff nobody answers fades away on its own after 10 minutes.
  useEffect(() => {
    if (!shown || !row) return;
    const left = Date.parse(row.created_at) + 10 * 60_000 - Date.now();
    const t = window.setTimeout(() => setShown(false), Math.max(1000, left));
    return () => window.clearTimeout(t);
  }, [shown, row]);

  const answer = useCallback(async (go: boolean) => {
    if (!row) return;
    setShown(false);
    await call("recipe_handoff_resolve", { p_id: row.id, p_status: go ? "opened" : "dismissed" }).catch(() => undefined);
    if (!go) return;
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      n.set("tab", "recipes");
      if (row.kind === "cook" && row.recipe_id) { n.set("recipe", String(row.recipe_id)); n.set("cook", "1"); n.delete("link"); }
      else if (row.url) { n.set("link", row.url); n.delete("recipe"); n.delete("cook"); }
      return n;
    });
  }, [row, setSp]);

  if (small) return null;
  const isLink = row?.kind === "link";
  return (
    <RxPortal>
      <div className={"handoff" + (shown ? " show" : "")} role="dialog" aria-label={`Sent from ${row?.source ?? "iPhone"}`} aria-hidden={!shown}>
        <div className="row" style={{ gap: 12, flexWrap: "nowrap", alignItems: "flex-start" }}>
          <span className="owner" style={{ padding: 10 }}><Ico n="leaf" size={20} /></span>
          <div>
            <div className="t">{isLink ? "Read this recipe link?" : `Cook ${row?.title ?? "this recipe"}?`}</div>
            <div className="muted">Sent from {row?.source ?? "iPhone"}</div>
          </div>
        </div>
        <div className="row">
          <button className="btn primary" style={{ flex: 1 }} tabIndex={shown ? 0 : -1} onClick={() => void answer(true)}>{isLink ? "Read the link" : "Start Cooking"}</button>
          <button className="btn" tabIndex={shown ? 0 : -1} onClick={() => void answer(false)}>Not now</button>
        </div>
      </div>
    </RxPortal>
  );
}

/** Running timers, floating above the page and above cook mode. */
export function TimersBar({ timers, remaining, onPlus, onStop }: {
  timers: LiveTimer[]; remaining: (t: LiveTimer) => number; onPlus: (id: string) => void; onStop: (id: string) => void;
}) {
  if (!timers.length) return null;
  return (
    <RxPortal>
      <div className="timers" aria-live="polite">
        {timers.map((t) => (
          <div key={t.key + t.id} className={"pill" + (t.done ? " done" : "")}>
            <span className="pl">{t.label}</span>
            <span className="pt">{t.done ? "Done" : remainingText(remaining(t))}</span>
            <button className="pb" onClick={() => onPlus(t.id)} aria-label={`Add one minute to the ${t.label} timer`}>+1 min</button>
            <button className="pb" onClick={() => onStop(t.id)} aria-label={`${t.done ? "Dismiss" : "Stop"} the ${t.label} timer`}>{t.done ? "Dismiss" : <Ico n="x" size={18} />}</button>
          </div>
        ))}
      </div>
    </RxPortal>
  );
}

export function GroceriesSheet({ open, items, onClose, onDone }: { open: boolean; items: GroceryRow[]; onClose: () => void; onDone: (g: GroceryRow) => void }) {
  if (!open) return null;
  return (
    <RxPortal>
      <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Groceries">
          <div className="shead"><h2>Groceries</h2><button className="iconbtn" onClick={onClose} aria-label="Close"><Ico n="x" /></button></div>
          <p className="muted">Things Basil found missing for your recipes. Tap one when you have bought it.</p>
          <GroceriesList items={items} onToggle={onDone} />
        </div>
      </div>
    </RxPortal>
  );
}

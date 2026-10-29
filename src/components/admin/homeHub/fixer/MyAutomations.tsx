import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "@/components/admin/homeHub/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { pollInterval } from "@/lib/polling";
import { Wrench, RefreshCw, Search, Loader2, ListChecks } from "lucide-react";
import { callFixer, type InvItem, type Inventory } from "./api";
import { Banner, Prose, whenLong } from "./ui";

/* "My automations": every automation and script in Home Assistant, the ones made in its editor and the ones in package files,
   each with one plain line about what it does, when it last ran, an on/off switch and a "Fix this" button.
   The list is read by the Pi (agent 1.6.2) and turned into plain words by the ha-fixer edge function; no AI is used for it. */

type Kind = "automation" | "script";
type Filter = "all" | "on" | "off" | "mine";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
  { id: "mine", label: "Made by Tinker" },
];

function Row({ item, busy, error, onToggle, onFix }: {
  item: InvItem;
  busy: boolean;
  error: string | null;
  onToggle: (on: boolean) => void;
  onFix: () => void;
}) {
  const isAuto = item.kind === "automation";
  const on = item.state === "on";
  const place = item.where === "ui" ? "Home Assistant editor" : item.where === "package" ? `File ${item.file ?? ""}`.trim() : "Place unknown";
  const ran = item.last_run ? `Last ran ${whenLong(item.last_run)}` : "Has not run since Home Assistant started";
  return (
    <li className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-snug text-white">{item.name}</h3>
          <p className="mt-1 text-sm leading-relaxed text-white/70"><Prose>{item.line}</Prose></p>
        </div>
        {isAuto && (
          <label className="inline-flex min-h-[44px] shrink-0 items-center gap-2.5 text-sm text-white/85">
            <Switch
              checked={on}
              disabled={busy || item.state === "unavailable"}
              aria-label={`${item.name}: ${on ? "on, tap to turn off" : "off, tap to turn on"}`}
              onCheckedChange={onToggle}
            />
            <span className="w-7 whitespace-nowrap tabular-nums">{item.state === "unavailable" ? "Away" : on ? "On" : "Off"}</span>
          </label>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/60">
          <span><Prose>{ran}</Prose></span>
          <span aria-hidden className="text-white/25">/</span>
          <span>{place}</span>
          {item.mine && <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-amber-200">Made by Tinker</span>}
        </div>
        <Button type="button" variant="outline" onClick={onFix} className="h-11 border-white/15 bg-transparent px-4 text-white/85 hover:bg-white/5 hover:text-white motion-safe:active:scale-[0.97] motion-safe:transition-transform">
          <Wrench aria-hidden /> Fix this
        </Button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/[0.07] px-3.5 py-3 text-sm text-red-200"><Prose>{error}</Prose></p>}
    </li>
  );
}

export function MyAutomations({ agentOld, onFix }: { agentOld: string | null; onFix: (item: { entity_id: string; name: string }) => void }) {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("automation");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const asked = useRef(false);
  const lastCheck = useRef(0);

  const load = useCallback(async () => {
    let { data, error } = await supabase.from("ha_inventory" as never).select("captured_at, requested_at, view, counts, error").eq("id", true).maybeSingle();
    if (error && !/does not exist|schema cache|relation/i.test(error.message) && Date.now() - lastCheck.current > 60_000) {
      lastCheck.current = Date.now();
      try { await supabase.rpc("tinker_page_check" as never); } catch { /* the reload below decides */ }
      ({ data, error } = await supabase.from("ha_inventory" as never).select("captured_at, requested_at, view, counts, error").eq("id", true).maybeSingle());
      if (error) { try { await supabase.rpc("tinker_page_check" as never, { p_still_failing: true, p_load_error: error.message } as never); } catch { /* best effort */ } }
    }
    if (error) setLoadError("Tinker can't open the list right now. He's been told and is on it.");
    else { setLoadError(null); setInv((data as unknown as Inventory | null) ?? null); }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("ha_inventory_page")
      .on("postgres_changes", { event: "*", schema: "public", table: "ha_inventory" }, () => { clearTimeout(timer); timer = setTimeout(load, 250); })
      .subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [load]);

  const waiting = !!inv?.requested_at && (!inv.captured_at || Date.parse(inv.requested_at) > Date.parse(inv.captured_at)) && Date.now() - Date.parse(inv.requested_at) < 4 * 60_000;
  useEffect(() => {
    if (!waiting && !asking) return;
    const iv = setInterval(load, pollInterval(3000, 0.05));
    return () => clearInterval(iv);
  }, [waiting, asking, load]);

  const refresh = useCallback(async () => {
    setAsking(true);
    setAskError(null);
    const r = await callFixer({ op: "inventory" });
    if (!r.ok) setAskError(r.error ?? "Something went wrong.");
    await load();
    setAsking(false);
  }, [load]);

  // Ask for a list once when the tab opens with nothing recent. No AI, so it costs nothing.
  useEffect(() => {
    if (!loaded || asked.current || loadError || agentOld) return;
    const age = inv?.captured_at ? Date.now() - Date.parse(inv.captured_at) : Infinity;
    if (age > 6 * 3_600_000 && !waiting) { asked.current = true; void refresh(); }
  }, [loaded, inv, waiting, loadError, agentOld, refresh]);

  const toggle = async (item: InvItem, on: boolean) => {
    setBusy((b) => ({ ...b, [item.entity_id]: true }));
    setErrs((e) => { const { [item.entity_id]: _d, ...rest } = e; return rest; });
    setInv((cur) => (cur ? { ...cur, view: cur.view.map((v) => (v.entity_id === item.entity_id ? { ...v, state: on ? "on" : "off" } : v)) } : cur));
    const r = await callFixer({ op: "toggle", entity_id: item.entity_id, enabled: on });
    setBusy((b) => { const { [item.entity_id]: _d, ...rest } = b; return rest; });
    if (!r.ok) setErrs((e) => ({ ...e, [item.entity_id]: r.error ?? "Something went wrong." }));
    await load();
  };

  const view = inv?.view ?? [];
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return view.filter((v) => {
      if (v.kind !== kind) return false;
      if (kind === "automation" && filter === "on" && v.state !== "on") return false;
      if (kind === "automation" && filter === "off" && v.state === "on") return false;
      if (filter === "mine" && !v.mine) return false;
      if (!words.length) return true;
      const hay = `${v.name} ${v.line} ${v.file ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [view, kind, filter, q]);

  const c = inv?.counts;
  const age = inv?.captured_at ? whenLong(inv.captured_at) : null;
  const busyRefresh = asking || waiting;

  return (
    <div className="space-y-5">
      {agentOld && (
        <Banner tone="amber" title="Home Hub needs an update">
          {`Your Pi's Home Hub is on ${agentOld}. Tinker needs 1.6.2 to list and fix automations. Tap Refresh and he asks it to update on its own.`}
        </Banner>
      )}

      <section aria-label="My automations" className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 sm:p-6">
        <span aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-[radial-gradient(closest-side,rgba(74,222,128,0.08),transparent)] blur-2xl" />
        <div className="relative space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-white">Everything running in your home</h2>
              <p className="mt-0.5 text-xs text-white/60">
                {c
                  ? <><span className="whitespace-nowrap">{c.automations} automations</span>, <span className="whitespace-nowrap">{c.scripts} scripts</span>, <span className="whitespace-nowrap">{c.on} on</span>{age ? <>. Updated <span className="whitespace-nowrap">{age}</span>.</> : "."}</>
                  : <Prose>Tinker reads them from Home Assistant, the ones made in its editor and the ones in your package files.</Prose>}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => void refresh()} disabled={busyRefresh} className="h-11 border-white/15 bg-transparent px-4 text-white/85 hover:bg-white/5 hover:text-white">
              <RefreshCw className={busyRefresh ? "motion-safe:animate-spin" : ""} aria-hidden /> Refresh
            </Button>
          </div>

          <div role="group" aria-label="Show" className="inline-grid grid-cols-2 gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] p-1">
            {(["automation", "script"] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 motion-safe:transition-colors ${kind === k ? "bg-white/[0.13] text-white" : "text-white/65 hover:text-white/90"}`}
              >
                {k === "automation" ? `Automations${c ? ` (${c.automations})` : ""}` : `Scripts${c ? ` (${c.scripts})` : ""}`}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" aria-hidden />
            <label htmlFor="inv-search" className="sr-only">Search your automations</label>
            <input
              id="inv-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or what it does"
              className="h-12 w-full rounded-xl border border-white/[0.1] bg-black/30 pl-10 pr-4 text-base text-white placeholder:text-white/55 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            />
          </div>

          {kind === "automation" && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full border px-4 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 motion-safe:active:scale-[0.97] motion-safe:transition-transform ${filter === f.id ? "border-white/25 bg-white/[0.12] text-white" : "border-white/[0.1] bg-white/[0.04] text-white/80 hover:bg-white/[0.08]"}`}
                >{f.label}</button>
              ))}
            </div>
          )}

          {askError && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/[0.07] px-3.5 py-3 text-sm text-red-200"><Prose>{askError}</Prose></p>}
          {inv?.error && !waiting && <p role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-3 text-sm text-amber-100"><Prose>{inv.error}</Prose></p>}
        </div>
      </section>

      {loadError && <p role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-3 text-sm text-amber-100"><Prose>{loadError}</Prose></p>}

      {!loaded ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl bg-white/[0.04]" />)}</div>
      ) : view.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.05]" aria-hidden>
              {busyRefresh ? <Loader2 className="h-5 w-5 text-white/60 motion-safe:animate-spin" /> : <ListChecks className="h-5 w-5 text-white/60" />}
            </span>
            <p className="text-sm font-medium text-white/90">{busyRefresh ? "Tinker is reading your home" : "No list yet"}</p>
            <p className="max-w-sm text-sm text-white/60"><Prose>{busyRefresh ? "This takes about half a minute." : "Tap Refresh and Tinker reads every automation and script from Home Assistant."}</Prose></p>
          </div>
        </Panel>
      ) : shown.length === 0 ? (
        <Panel><p className="py-4 text-center text-sm text-white/65"><Prose>Nothing matches. Clear the search or pick All.</Prose></p></Panel>
      ) : (
        <ul className="space-y-3" aria-label={kind === "automation" ? "Automations" : "Scripts"}>
          {shown.map((item) => (
            <Row
              key={item.entity_id}
              item={item}
              busy={!!busy[item.entity_id]}
              error={errs[item.entity_id] ?? null}
              onToggle={(on) => void toggle(item, on)}
              onFix={() => onFix({ entity_id: item.entity_id, name: item.name })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

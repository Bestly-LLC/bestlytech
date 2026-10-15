import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { ago, Panel } from "@/components/admin/homeHub/shared";
import { pollInterval } from "@/lib/polling";
import { cn } from "@/lib/utils";
import { Segmented, TAP } from "@/components/admin/kitchen/Segmented";
import { RecipeSheet } from "@/components/admin/kitchen/RecipeSheet";
import { Lines } from "@/components/Lines";
import {
  Apple, ChefHat, ChevronRight, Clock, CookingPot, Loader2, Mic, MousePointerClick, Package, Plus, Receipt, RefreshCw,
  Refrigerator, Search, Snowflake, Truck, Undo2, UtensilsCrossed, type LucideIcon,
} from "lucide-react";

// Basil (Kitchen Manager) lives in Supabase: pantry_items, pantry_events, basil_kitchen*() RPCs.
// The same events table backs "Hey Scout, used the salmon" (basil_voice) so voice and taps share one history.

type Status = "have" | "low" | "out" | "arriving";
type Loc = "fridge" | "freezer" | "pantry" | "counter";

interface Item {
  id: string; name: string; category: string | null; location: Loc; qty: number | null; unit: string | null;
  status: Status; use_soon: boolean; use_by: string | null; source: string | null; updated_at: string;
}
interface Idea { name: string; how: string; uses_soon: number; minutes?: number | null; serves?: number | null; omni?: boolean }
interface ChefIdea { name: string; how: string; minutes: number | null; serves: number | null; omni: boolean; chef_note?: string | null }
interface KitchenEvent {
  id: number; at: string; source: string; action: string; item_id: string | null; item_name: string | null;
  before_status: Status | null; after_status: Status | null; said: string | null;
}
interface Kitchen { items: Item[]; ideas: Idea[]; ideas_total?: number; events: KitchenEvent[]; last_tick: string | null; now: string }

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

const LOCS: { key: Loc; label: string; icon: LucideIcon }[] = [
  { key: "fridge", label: "Fridge", icon: Refrigerator },
  { key: "freezer", label: "Freezer", icon: Snowflake },
  { key: "pantry", label: "Pantry", icon: Package },
  { key: "counter", label: "Counter", icon: Apple },
];

const STATUS_WORD: Record<Status, string> = { have: "in stock", low: "low", out: "used up", arriving: "on the way" };

const SETTABLE: { key: Exclude<Status, "arriving">; label: string; thumb: string; ink: string }[] = [
  { key: "have", label: "Have", thumb: "bg-white/[0.14]", ink: "text-white" },
  { key: "low", label: "Low", thumb: "bg-amber-500/25", ink: "text-amber-200" },
  { key: "out", label: "Out", thumb: "bg-red-500/25", ink: "text-red-200" },
];

const SUFFIX_S = /[^s]s$/i;

function timeLabel(iso: string, now: number) {
  const age = now - new Date(iso).getTime();
  if (age < 86_400_000) return ago(iso, now);
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const STATUSES: Status[] = ["have", "low", "out", "arriving"];
const parseLoc = (v: string | null): Loc | "all" => (LOCS.some((l) => l.key === v) ? (v as Loc) : "all");
const parseStatus = (v: string | null): Status | null => (STATUSES.includes(v as Status) ? (v as Status) : null);
const countLabel = (n: number) => `${n}\u00a0${n === 1 ? "item" : "items"}`;

/** Wide screens get the Dialog and the "/" hint; phones get the bottom sheet. Tracks the `sm:` breakpoint. */
function useMinWidth(px: number) {
  const query = `(min-width: ${px}px)`;
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return match;
}

const canUndoEvent = (e: KitchenEvent) =>
  ["have", "low", "out", "arriving"].includes(e.action) && !!e.item_id && !!e.before_status;

export default function HomeHubKitchen() {
  const [data, setData] = useState<Kitchen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sp, setSp] = useSearchParams();
  const [query, setQuery] = useState(() => sp.get("q") ?? "");
  const loc = parseLoc(sp.get("where"));
  const statusFilter = parseStatus(sp.get("status"));
  const [addOpen, setAddOpen] = useState(false);
  // "New ideas" swaps the three on screen; the 60 s refresh keeps them until the page reloads.
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [recipe, setRecipe] = useState<string | null>(null);
  // The chef's newest recipes (from this page, Scout chat or Hey Scout). basil-chef edge function cooks new ones.
  const [chef, setChef] = useState<ChefIdea[]>([]);
  const [chefBusy, setChefBusy] = useState(false);
  const [undoing, setUndoing] = useState<number | null>(null);
  const [arriving, setArriving] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [stuck, setStuck] = useState(false);
  const wide = useMinWidth(640);

  // Filters live in the URL (?q=, ?where=, ?status=) so back/forward, a shared link and the lightning panel all work.
  // replace: true, so typing never floods history. The search text stays local while typing and is mirrored out;
  // lastQ remembers what we wrote so our own echo is never mistaken for a new link.
  const lastQ = useRef(query.trim());
  const setParam = useCallback((key: string, value: string | null) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      if (value) n.set(key, value); else n.delete(key);
      return n;
    }, { replace: true });
  }, [setSp]);
  const setLoc = useCallback((v: Loc | "all") => setParam("where", v === "all" ? null : v), [setParam]);
  const setStatusFilter = useCallback((v: Status | null) => setParam("status", v), [setParam]);
  useEffect(() => {
    const t = query.trim();
    if (t === lastQ.current) return;
    lastQ.current = t;
    setParam("q", t || null);
  }, [query, setParam]);
  useEffect(() => {
    const urlQ = (sp.get("q") ?? "").trim();
    if (urlQ !== lastQ.current) { lastQ.current = urlQ; setQuery(urlQ); }
  }, [sp]);
  const clearFilters = () => { lastQ.current = ""; setQuery(""); setSp((prev) => { const n = new URLSearchParams(prev); ["q", "where", "status"].forEach((k) => n.delete(k)); return n; }, { replace: true }); };
  const findItem = (name: string) => { lastQ.current = name; setQuery(name); setSp((prev) => { const n = new URLSearchParams(prev); n.set("q", name); n.delete("where"); n.delete("status"); return n; }, { replace: true }); };

  // "/" jumps to search from anywhere that is not already a field (desktop habit; harmless on a phone).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || e.defaultPrevented || addOpen) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (!searchRef.current) return;
      e.preventDefault();
      searchRef.current.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addOpen]);

  // The search bar only turns into a material once the list is scrolling under it (scroll edge effect).
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const el = barRef.current;
      if (!el) return;
      const top = parseFloat(getComputedStyle(el).top) || 0;
      setStuck(el.getBoundingClientRect().top <= top + 1 && window.scrollY > 0);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [loaded]);

  const load = useCallback(async () => {
    const [{ data: d, error: e }, { data: c }] = await Promise.all([rpc("basil_kitchen"), rpc("basil_kitchen_chef_recent", { p_limit: 3 })]);
    if (e) setError(e.message);
    else { setData(d as Kitchen); setError(null); }
    if (Array.isArray(c)) setChef(c as ChefIdea[]);
    setNow(Date.now());
    setLoaded(true);
  }, []);

  const cook = async (ask: string) => {
    setChefBusy(true);
    const { data: res, error: e } = await supabase.functions.invoke("basil-chef", { body: { ask, count: 3 } });
    setChefBusy(false);
    if (e) {
      const body = await (e as { context?: Response }).context?.json?.().catch(() => null);
      toast.error(body?.error ?? `The chef couldn't cook just now. ${e.message}`);
      return false;
    }
    const list = (res as { recipes?: ChefIdea[] })?.recipes ?? [];
    if (!list.length) { toast.error("The chef came up empty. Try again in a minute."); return false; }
    setChef(list);
    toast.success(list.length === 1 ? "1 new recipe from the chef" : `${list.length} new recipes from the chef`);
    return true;
  };

  useEffect(() => {
    load();
    const iv = setInterval(() => { if (document.visibilityState === "visible") load(); }, pollInterval(60_000));
    return () => clearInterval(iv);
  }, [load]);

  const patchItem = (id: string, patch: Partial<Item>) =>
    setData((d) => d && { ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

  const undo = useCallback(async (eventId: number, name: string) => {
    setUndoing(eventId);
    const { data: res, error: e } = await rpc("basil_kitchen_undo", { p_event_id: eventId });
    setUndoing(null);
    if (e) { toast.error(`Couldn't undo ${name}: ${e.message}`); return; }
    const back = (res as { status?: Status } | null)?.status;
    toast.success(back ? `${name} is ${STATUS_WORD[back]} again` : `Undid ${name}`);
    load();
  }, [load]);

  // Optimistic: the row changes on tap, the server catches up, a failure puts it back.
  const setStatus = useCallback(async (item: Item, status: Status) => {
    if (item.status === status) return;
    const before = item.status;
    patchItem(item.id, { status, use_soon: status === "out" ? false : item.use_soon });
    const { data: res, error: e } = await rpc("basil_kitchen_set", { p_id: item.id, p_status: status });
    if (e) {
      patchItem(item.id, { status: before, use_soon: item.use_soon });
      toast.error(`Couldn't update ${item.name}. ${e.message}`);
      return;
    }
    const eventId = (res as { event_id?: number } | null)?.event_id;
    const verb = status === "low" || !SUFFIX_S.test(item.name) ? "is" : "are";
    toast.success(`${item.name} ${verb} ${STATUS_WORD[status]}`, eventId ? {
      duration: 6000,
      action: { label: "Undo", onClick: () => undo(eventId, item.name) },
    } : undefined);
    load();
  }, [load, undo]);

  const edit = useCallback(async (item: Item, patch: { use_soon?: boolean; location?: Loc }) => {
    patchItem(item.id, patch);
    const { error: e } = await rpc("basil_kitchen_edit", { p_id: item.id, p_use_soon: patch.use_soon ?? null, p_location: patch.location ?? null });
    if (e) { toast.error(`Couldn't update ${item.name}. ${e.message}`); load(); return; }
    if (patch.location) toast.success(`Moved ${item.name} to the ${patch.location}`);
    else toast.success(patch.use_soon ? `${item.name} flagged to use soon` : `${item.name} no longer flagged`);
  }, [load]);

  const markArrived = useCallback(async () => {
    setArriving(true);
    const { data: res, error: e } = await rpc("basil_kitchen_arrived");
    setArriving(false);
    if (e) { toast.error(`Couldn't mark the order as here. ${e.message}`); return; }
    const n = Number((res as { delivered?: number } | null)?.delivered ?? 0);
    toast.success(n > 0 ? `Got it. ${countLabel(n)} ${n === 1 ? "is" : "are"} in stock` : "Nothing was on the way");
    load();
  }, [load]);

  const items = data?.items ?? [];
  const counts = useMemo(() => {
    const c: Record<Status, number> = { have: 0, low: 0, out: 0, arriving: 0 };
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);
  const useSoon = items.filter((i) => i.use_soon && (i.status === "have" || i.status === "low"));

  const q = query.trim().toLowerCase();
  const filtered = items.filter((i) =>
    (loc === "all" || i.location === loc) &&
    (!statusFilter || i.status === statusFilter) &&
    (!q || i.name.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q)));
  const groups = LOCS.map((l) => ({ ...l, items: filtered.filter((i) => i.location === l.key) })).filter((g) => g.items.length);
  const filtering = !!(q || loc !== "all" || statusFilter);

  const description = data?.last_tick
    ? `Basil keeps track of the kitchen. Last check ${ago(data.last_tick, now)}.`
    : "Basil keeps track of the kitchen.";

  return (
    <div className="relative space-y-6">
      {/* Phone: the menu sits beside the title instead of costing a whole row under it. */}
      <div className="absolute right-0 top-0 sm:hidden">
        <ActionMenu label="More kitchen actions" className="h-11 w-11" items={[{ label: "Refresh now", icon: RefreshCw, onSelect: load }]} />
      </div>
      <PageHeader
        title="Kitchen"
        description={description}
        actions={
          <>
            <Button onClick={() => setAddOpen(true)} className="hidden sm:inline-flex motion-safe:active:scale-[0.97] motion-safe:transition-transform">
              <Plus className="h-4 w-4 mr-1.5" aria-hidden />
              Add item
            </Button>
            <ActionMenu
              label="More kitchen actions"
              className="hidden sm:inline-flex"
              items={[{ label: "Refresh now", icon: RefreshCw, onSelect: load }]}
            />
          </>
        }
      />

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
          <span>Couldn't load the kitchen. {error}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      {!loaded ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-2xl bg-white/[0.04]" />
          <div className="grid grid-cols-4 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 sm:h-20 rounded-2xl bg-white/[0.04]" />)}</div>
          <Skeleton className="h-96 rounded-2xl bg-white/[0.04]" />
        </div>
      ) : data && (
        <>
          <div className="space-y-3">
            <Tonight
              ideas={ideas ?? data.ideas} total={data.ideas_total ?? null} useSoon={useSoon} onFind={findItem} tabbable={!wide}
              onOpen={setRecipe} busy={ideasBusy}
              chef={<ChefRow recipes={chef} busy={chefBusy} tabbable={!wide} onOpen={setRecipe} onCook={cook} />}
              onMore={async () => {
                setIdeasBusy(true);
                const { data: res, error: e } = await rpc("basil_kitchen_ideas", { p_skip: (ideas ?? data.ideas).map((i) => i.name) });
                setIdeasBusy(false);
                if (e) { toast.error(`Couldn't get new ideas. ${e.message}`); return; }
                setIdeas((res as { ideas: Idea[] }).ideas);
              }}
            />
            {counts.arriving > 0 && <ArrivingBanner count={counts.arriving} busy={arriving} onArrived={markArrived} />}
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3" role="group" aria-label="Filter by status">
            <StatTile label="In stock" short="In stock" value={counts.have} active={statusFilter === "have"} onClick={() => setStatusFilter(statusFilter === "have" ? null : "have")} />
            <StatTile label="Running low" short="Low" value={counts.low} tone="amber" active={statusFilter === "low"} onClick={() => setStatusFilter(statusFilter === "low" ? null : "low")} />
            <StatTile label="Used up" short="Used up" value={counts.out} tone="red" active={statusFilter === "out"} onClick={() => setStatusFilter(statusFilter === "out" ? null : "out")} />
            <StatTile label="On the way" short="Coming" value={counts.arriving} tone="sky" icon={Truck} active={statusFilter === "arriving"} onClick={() => setStatusFilter(statusFilter === "arriving" ? null : "arriving")} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Panel className="min-w-0">
              <div
                ref={barRef}
                className={cn(
                  "sticky top-12 sm:top-14 bento:top-16 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-4 px-4 sm:px-6 pt-4 sm:pt-6 pb-3 flex flex-col lg:flex-row gap-3 rounded-t-2xl border-b",
                  "motion-safe:transition-[background-color,border-color] motion-safe:duration-200",
                  stuck ? "bg-black/85 backdrop-blur-xl backdrop-saturate-150 border-white/[0.08]" : "bg-transparent border-transparent",
                )}
              >
                <div className="flex flex-1 gap-2">
                  <div className="group relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/45" aria-hidden />
                    <Input
                      ref={searchRef}
                      type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Escape") return;
                        e.preventDefault();
                        if (query) setQuery(""); else e.currentTarget.blur();
                      }}
                      placeholder="Find an item" aria-label="Find an item" aria-keyshortcuts="/"
                      className={cn("pl-9 h-11 sm:h-10 text-base sm:text-sm bg-white/[0.04] border-white/[0.08]", "xl:pr-9")}
                    />
                    {!query && (
                      <kbd
                        aria-hidden
                        className="pointer-events-none absolute right-3 top-1/2 hidden h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-md border border-white/[0.14] px-1.5 font-sans text-[0.6875rem] font-medium text-white/55 xl:flex group-focus-within:opacity-0 motion-safe:transition-opacity"
                      >
                        /
                      </kbd>
                    )}
                  </div>
                  <Button
                    type="button" size="icon" aria-label="Add item" onClick={() => setAddOpen(true)}
                    className="h-11 w-11 shrink-0 sm:hidden motion-safe:active:scale-[0.95] motion-safe:transition-transform"
                  >
                    <Plus className="h-5 w-5" aria-hidden />
                  </Button>
                </div>
                <Segmented
                  label="Where"
                  dense
                  className="w-full lg:w-auto"
                  value={loc}
                  onChange={(v) => setLoc(v as Loc | "all")}
                  options={[{ key: "all", label: "All" }, ...LOCS.map((l) => ({ key: l.key, label: l.label }))]}
                />
              </div>

              <LatestChange events={data.events} now={now} undoing={undoing} onUndo={undo} />

              <p className="sr-only" aria-live="polite">
                {filtering ? `${filtered.length} ${filtered.length === 1 ? "item" : "items"} shown` : ""}
              </p>
              {groups.length === 0 ? (
                <EmptyState
                  compact icon={ChefHat}
                  title={filtering ? "Nothing matches" : "The kitchen list is empty"}
                  description={filtering ? "Try another word or clear the filters." : "Add an item, or Basil fills this from your Costco and Instacart receipts."}
                  action={filtering ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : undefined}
                />
              ) : (
                <div className="2xl:columns-2 2xl:gap-8">
                  {groups.map((g) => (
                    <section key={g.key} aria-label={g.label} className="mb-6 last:mb-0 break-inside-avoid 2xl:last:mb-6">
                      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/60 mb-1">
                        <g.icon className="h-3.5 w-3.5" aria-hidden />
                        {g.label}
                        <span className="tabular-nums font-normal">{g.items.length}</span>
                      </h2>
                      <ul className="divide-y divide-white/[0.05] [&_button]:scroll-mt-48 [&_button]:scroll-mb-24">
                        {g.items.map((item) => (
                          <ItemRow key={item.id} item={item} onStatus={setStatus} onEdit={edit} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </Panel>

            <div className="space-y-6 min-w-0 xl:sticky xl:top-20 bento:xl:top-24 xl:self-start xl:max-h-[calc(100vh-6.5rem)] xl:overflow-y-auto xl:overscroll-contain">
              <VoiceHelp />
              <Recent events={data.events} now={now} undoing={undoing} onUndo={undo} />
            </div>
          </div>
        </>
      )}

      <AddItem open={addOpen} onOpenChange={setAddOpen} onAdded={load} wide={wide} />
      <RecipeSheet name={recipe} onClose={() => setRecipe(null)} onReopen={setRecipe} wide={wide} onPantryChanged={load} />
    </div>
  );
}

/* ---------- Tonight: the one thing this page is for ---------- */

function Tonight({ ideas, total, useSoon, onFind, tabbable, onOpen, onMore, busy, chef }: {
  ideas: Idea[]; total: number | null; useSoon: Item[]; onFind: (name: string) => void; tabbable: boolean;
  onOpen: (name: string) => void; onMore: () => void; busy: boolean; chef?: ReactNode;
}) {
  const canMore = total == null ? ideas.length > 0 : total > ideas.length;
  return (
    <section
      aria-label="Tonight"
      className="bento-tile bento-butter rounded-2xl border border-white/[0.08] bg-gradient-to-br from-amber-500/[0.10] via-white/[0.03] to-transparent p-4 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <UtensilsCrossed className="h-4 w-4" aria-hidden />
          Tonight you could make
        </h2>
        {canMore && (
          <button
            type="button" onClick={onMore} disabled={busy}
            className={cn(TAP, "-my-2 -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-white/75 hover:bg-white/[0.06] hover:text-white disabled:opacity-60")}
          >
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden />
            New ideas
          </button>
        )}
      </div>
      {ideas.length === 0 ? (
        <p className="mt-3 text-white/70">Nothing fully makeable right now. Might be time for a Costco run.</p>
      ) : (
        <ol
          // Phone: one swipeable row, the next card peeking. From sm: the three-up grid. Keyboard users can scroll the row.
          tabIndex={tabbable ? 0 : undefined}
          aria-label={tabbable ? "Dinner ideas, swipe for more" : undefined}
          aria-busy={busy}
          className={cn(
            "mt-4 -mx-4 flex gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0",
            "rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
          )}
        >
          {ideas.map((idea, n) => (
            <IdeaCard key={idea.name} n={n} name={idea.name} how={idea.how} minutes={idea.minutes} omni={idea.omni}
              soon={idea.uses_soon > 0} onOpen={onOpen} />
          ))}
        </ol>
      )}
      {chef}
      {useSoon.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-white/60">Use soon</span>
          {useSoon.map((i) => (
            <button
              key={i.id} type="button" onClick={() => onFind(i.name)}
              className={cn(TAP, "min-h-11 sm:min-h-9 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-medium text-amber-100 hover:bg-amber-500/20 motion-safe:active:scale-[0.97] motion-safe:transition-transform")}
            >
              {i.name}
              {i.use_by && <span className="text-amber-200/80"> · by {new Date(`${i.use_by}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function IdeaCard({ n, name, how, minutes, omni, soon, onOpen }: {
  n: number; name: string; how: string; minutes?: number | null; omni?: boolean; soon?: boolean; onOpen: (name: string) => void;
}) {
  return (
    <li className="relative w-[82%] shrink-0 snap-start sm:w-auto sm:shrink motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
      <button
        type="button" onClick={() => onOpen(name)}
        className={cn(TAP, "group flex h-full w-full flex-col rounded-xl bg-white/[0.04] p-4 text-left hover:bg-white/[0.07] motion-safe:transition-[background-color,transform] motion-safe:duration-150 motion-safe:active:scale-[0.98]")}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="text-lg font-semibold text-white leading-tight tracking-[-0.01em] text-balance">
            <span className="sr-only">{n + 1}. </span>{name}
          </span>
          <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-white/40 group-hover:text-white/70" aria-hidden />
        </span>
        <span className="mt-1.5 text-sm text-white/70 text-pretty">{how}</span>
        <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs font-medium text-white/60">
          {minutes != null && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap"><Clock className="h-3.5 w-3.5" aria-hidden />{minutes}{"\u00a0"}min</span>
          )}
          {omni && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-white/75"><CookingPot className="h-3.5 w-3.5" aria-hidden />Omni Cook</span>
          )}
          {soon && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-amber-200"><Clock className="h-3.5 w-3.5" aria-hidden />Uses something to eat soon</span>
          )}
        </span>
      </button>
    </li>
  );
}

/* ---------- From the chef: new recipes from the pantry (basil-chef, free AI) ---------- */

const CHEF_ASKS = [
  { label: "Surprise me", ask: "" },
  { label: "Under 30 minutes", ask: "something quick, under 30 minutes" },
  { label: "Use the Omni Cook", ask: "dishes where the Omni Cook does most of the work" },
  { label: "Something light", ask: "something light and fresh" },
];

function ChefRow({ recipes, busy, tabbable, onOpen, onCook }: {
  recipes: ChefIdea[]; busy: boolean; tabbable: boolean; onOpen: (name: string) => void; onCook: (ask: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus({ preventScroll: true }); }, [open]);
  const close = () => { setOpen(false); requestAnimationFrame(() => openerRef.current?.focus({ preventScroll: true })); };
  const go = async (a: string) => {
    if (busy) return;
    if (await onCook(a)) { setOpen(false); setAsk(""); }
  };
  return (
    <div className="mt-5 border-t border-white/[0.08] pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <ChefHat className="h-4 w-4" aria-hidden />
          From the chef
        </h3>
        {!open && (
          <button
            ref={openerRef} type="button" onClick={() => setOpen(true)} disabled={busy} aria-controls="chef-ask" aria-expanded={false}
            className={cn(TAP, "-my-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 text-sm font-medium text-white hover:bg-white/[0.13] disabled:opacity-60 motion-safe:active:scale-[0.97] motion-safe:transition-[background-color,transform]")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ChefHat className="h-4 w-4" aria-hidden />}
            {busy ? "Cooking" : "Ask the chef"}
          </button>
        )}
      </div>

      {open && (
        <form
          id="chef-ask"
          onSubmit={(e) => { e.preventDefault(); go(ask.trim()); }}
          onKeyDown={(e) => { if (e.key === "Escape" && !busy) { e.preventDefault(); close(); } }}
          className="mt-3 max-w-2xl space-y-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200"
        >
          <Label htmlFor="chef-ask-input" className="block text-sm font-medium text-white/80">
            <Lines>What are you in the mood for? Optional.</Lines>
          </Label>
          <div className="flex gap-2">
            <Input
              id="chef-ask-input" ref={inputRef} value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={200}
              placeholder="Something with salmon" enterKeyHint="go" autoComplete="off" disabled={busy}
              className="h-11 sm:h-10 min-w-0 flex-1 text-base sm:text-sm bg-white/[0.04] border-white/[0.08]"
            />
            <Button type="submit" disabled={busy} className="h-11 sm:h-10 shrink-0 motion-safe:active:scale-[0.97] motion-safe:transition-transform">
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <ChefHat className="mr-1.5 h-4 w-4" aria-hidden />}
              {busy ? "Cooking" : "Cook"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick asks">
            {CHEF_ASKS.map((c) => (
              <button
                key={c.label} type="button" disabled={busy} onClick={() => go(c.ask)}
                className={cn(TAP, "min-h-11 sm:min-h-9 rounded-full border border-white/[0.12] bg-white/[0.03] px-3 text-xs font-medium text-white/85 hover:bg-white/[0.08] disabled:opacity-50 motion-safe:active:scale-[0.97] motion-safe:transition-transform")}
              >
                {c.label}
              </button>
            ))}
            <button
              type="button" disabled={busy} onClick={close}
              className={cn(TAP, "min-h-11 sm:min-h-9 rounded-full px-3 text-xs font-medium text-white/60 hover:text-white disabled:opacity-50")}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <p className="sr-only" aria-live="polite">{busy ? "The chef is writing recipes from your pantry." : ""}</p>
      {busy ? (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-3" aria-hidden>
            {[0, 1, 2].map((i) => <Skeleton key={i} className={cn("h-36 rounded-xl bg-white/[0.05]", i > 0 && "hidden sm:block")} />)}
          </div>
          <p className="mt-2 text-xs text-white/60"><Lines>Reading your pantry and writing recipes. About 10 seconds.</Lines></p>
        </div>
      ) : recipes.length > 0 ? (
        <ol
          tabIndex={tabbable ? 0 : undefined}
          aria-label={tabbable ? "Chef recipes, swipe for more" : "Chef recipes"}
          className={cn(
            "mt-4 -mx-4 flex gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0",
            "rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
          )}
        >
          {recipes.map((r, n) => (
            <IdeaCard key={r.name} n={n} name={r.name} how={r.how} minutes={r.minutes} omni={r.omni} onOpen={onOpen} />
          ))}
        </ol>
      ) : !open && (
        <p className="mt-2 text-sm text-white/65 text-pretty">
          <Lines>New recipes from what you have, with Omni Cook steps when they help.</Lines>
        </p>
      )}
    </div>
  );
}

/* ---------- Pieces ---------- */

function StatTile({ label, short, value, tone, icon: Icon, active, onClick }: {
  label: string; short: string; value: number; tone?: "amber" | "red" | "sky"; icon?: LucideIcon; active: boolean; onClick: () => void;
}) {
  const ink = tone === "amber" ? "text-amber-200" : tone === "red" ? "text-red-200" : tone === "sky" ? "text-sky-200" : "text-white";
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border px-1 py-2 min-h-16 text-center",
        "sm:items-stretch sm:justify-start sm:p-4 sm:min-h-20 sm:text-left motion-safe:active:scale-[0.98] motion-safe:transition-transform", TAP,
        active ? "border-white/30 bg-white/[0.08]" : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]",
      )}
    >
      <span className="order-2 flex items-center gap-1.5 whitespace-nowrap text-xs text-white/60 sm:order-1">
        {Icon && <Icon className="hidden h-3.5 w-3.5 sm:block" aria-hidden />}
        <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span>
      </span>
      <span className={cn("order-1 block text-xl font-semibold leading-tight tabular-nums whitespace-nowrap sm:order-2 sm:mt-1 sm:text-2xl", ink)}>{value}</span>
    </button>
  );
}

function ItemRow({ item, onStatus, onEdit }: {
  item: Item; onStatus: (item: Item, s: Status) => void; onEdit: (item: Item, patch: { use_soon?: boolean; location?: Loc }) => void;
}) {
  const detail = [item.category, item.qty != null ? `${item.qty} ${item.unit ?? ""}`.trim() : null].filter(Boolean).join(" · ");
  return (
    // Phone: name and menu on one line, the status control full width under them (nothing squeezes the name).
    // From sm: everything on one line.
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 py-2.5 sm:flex sm:py-3 sm:gap-3 xl:py-2">
      <div className="min-w-0 flex-1 flex flex-col xl:flex-row xl:flex-wrap xl:items-baseline xl:gap-x-2">
        <p className={cn("font-medium break-words", item.status === "out" ? "text-white/55" : "text-white")}>{item.name}</p>
        {((item.use_soon && item.status !== "out") || item.status === "arriving") && (
          <div className="flex flex-wrap gap-1.5 mt-1 xl:mt-0">
            {item.use_soon && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-200">
                <Clock className="h-3 w-3" aria-hidden />Use soon
              </span>
            )}
            {item.status === "arriving" && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-200">
                <Truck className="h-3 w-3" aria-hidden />On the way
              </span>
            )}
          </div>
        )}
        {detail && <p className="text-xs text-white/55 mt-0.5 xl:mt-0">{detail}</p>}
      </div>
      <div className="contents sm:flex sm:items-center sm:gap-2 sm:shrink-0">
        <Segmented
          label={`${item.name} status`}
          value={item.status}
          onChange={(v) => onStatus(item, v as Status)}
          options={SETTABLE}
          className="col-span-2 row-start-2 w-full sm:w-auto"
        />
        <ActionMenu
          label={`More for ${item.name}`}
          className="col-start-2 row-start-1 h-11 w-11 sm:h-9 sm:w-9"
          items={[
            { label: item.use_soon ? "Clear use soon" : "Flag to use soon", icon: Clock, onSelect: () => onEdit(item, { use_soon: !item.use_soon }) },
            ...LOCS.filter((l) => l.key !== item.location).map((l) => ({
              group: "Move to", label: l.label, icon: l.icon, onSelect: () => onEdit(item, { location: l.key }),
            })),
          ]}
        />
      </div>
    </li>
  );
}

function VoiceHelp() {
  const lines = [
    "used the salmon",
    "we're low on eggs",
    "do we have almond flour?",
    "what's for dinner?",
    "add hot sauce to the fridge",
    "undo",
  ];
  return (
    <Panel title="Tell Scout" icon={<Mic className="h-4 w-4" aria-hidden />}>
      <p className="text-sm text-white/70 text-pretty">Say "Hey Scout" near the desk mic, then any of these. Basil updates the list right away.</p>
      <ul className="mt-3 space-y-1.5">
        {lines.map((l) => (
          <li key={l} className="text-sm text-white/90">"{l}"</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-white/55 text-pretty">Plain "add milk" still goes to your shopping list.</p>
    </Panel>
  );
}

const SOURCE_ICON: Record<string, LucideIcon> = { voice: Mic, ui: MousePointerClick, receipt: Receipt, basil: ChefHat };
const SOURCE_LABEL: Record<string, string> = { voice: "By voice", ui: "On this page", receipt: "From a receipt", basil: "By Basil" };

function eventText(e: KitchenEvent): string {
  const name = e.item_name ?? "Item";
  if (e.action === "add") return `${name} added`;
  if (e.action === "undo") return `${name} back to ${STATUS_WORD[e.after_status ?? "have"]}`;
  if (e.action.startsWith("undone:")) return `${name} ${STATUS_WORD[(e.after_status ?? "have") as Status]} (undone)`;
  if (e.said?.toLowerCase().startsWith("delivered")) return `${name} arrived`;
  if (e.after_status) return `${name} ${STATUS_WORD[e.after_status]}`;
  return name;
}

/** An order is on the way: one tap says it is all here (basil_kitchen_arrived flips every "on the way" item to in stock). */
function ArrivingBanner({ count, busy, onArrived }: { count: number; busy: boolean; onArrived: () => void }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/[0.08] px-4 py-2.5"
    >
      <Truck className="h-4 w-4 shrink-0 text-sky-200" aria-hidden />
      <p className="min-w-0 flex-1 text-sm font-medium text-white">
        <span className="whitespace-nowrap">{countLabel(count)}</span> on the way
      </p>
      <Button
        type="button" variant="outline" size="sm" disabled={busy} onClick={onArrived}
        className="h-11 shrink-0 whitespace-nowrap sm:h-9 motion-safe:active:scale-[0.97] motion-safe:transition-transform"
      >
        {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
        It's all here
      </Button>
    </div>
  );
}

/** Phone only: the newest change that can still be undone, one line, so a voice mistake is a tap away without scrolling to Recent. */
function LatestChange({ events, now, undoing, onUndo }: {
  events: KitchenEvent[]; now: number; undoing: number | null; onUndo: (id: number, name: string) => void;
}) {
  const e = events.find(canUndoEvent);
  if (!e) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-xl bg-white/[0.04] pl-3 sm:hidden">
      <p className="min-w-0 flex-1 text-sm text-white/80">
        <span className="font-medium text-white">{eventText(e)}</span>
        <span className="whitespace-nowrap text-white/55"> · {timeLabel(e.at, now)}</span>
      </p>
      <Button
        variant="ghost" className="h-11 shrink-0 px-3 text-white/80 hover:text-white"
        disabled={undoing === e.id} onClick={() => onUndo(e.id, e.item_name ?? "item")}
        aria-label={`Undo: ${eventText(e)}`}
      >
        {undoing === e.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="mr-1 h-4 w-4" aria-hidden />}
        Undo
      </Button>
    </div>
  );
}

function Recent({ events, now, undoing, onUndo }: {
  events: KitchenEvent[]; now: number; undoing: number | null; onUndo: (id: number, name: string) => void;
}) {
  return (
    <Panel title="Recent" icon={<Clock className="h-4 w-4" aria-hidden />}>
      {events.length === 0 ? (
        <p className="text-sm text-white/60">Changes from this page and from Hey Scout show up here.</p>
      ) : (
        <ul className="divide-y divide-white/[0.05] -my-2">
          {events.map((e) => {
            const Icon = SOURCE_ICON[e.source] ?? MousePointerClick;
            const canUndo = canUndoEvent(e);
            return (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-white/45" aria-label={SOURCE_LABEL[e.source] ?? e.source} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm text-white/90 break-words", e.action.startsWith("undone:") && "text-white/50 line-through")}>{eventText(e)}</p>
                  <p className="text-xs text-white/55 break-words">
                    {timeLabel(e.at, now)}
                    {e.said && <> · "{e.said}"</>}
                  </p>
                </div>
                {canUndo && (
                  <Button
                    variant="ghost" size="sm" className="h-11 sm:h-9 shrink-0 text-white/70 hover:text-white"
                    disabled={undoing === e.id}
                    onClick={() => onUndo(e.id, e.item_name ?? "item")}
                  >
                    {undoing === e.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="h-4 w-4 mr-1" aria-hidden />}
                    Undo
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** Wide screens: a centered dialog. Phones: a bottom sheet you can drag away, with the field near the thumb. */
function AddItem({ open, onOpenChange, onAdded, wide }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void; wide: boolean }) {
  const title = "Add to the kitchen";
  const sub = "It goes on the list as in stock.";
  if (wide) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{sub}</DialogDescription>
          </DialogHeader>
          <AddForm onDone={() => onOpenChange(false)} onAdded={onAdded} />
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{sub}</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <AddForm onDone={() => onOpenChange(false)} onAdded={onAdded} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function AddForm({ onDone, onAdded }: { onDone: () => void; onAdded: () => void }) {
  // Mounted fresh each time the dialog or sheet opens, so the fields always start empty.
  const [name, setName] = useState("");
  const [where, setWhere] = useState<Loc | "auto">("auto");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const n = name.trim();
    if (n.length < 2) { nameRef.current?.focus(); return; }
    setBusy(true);
    const { data: res, error } = await rpc("basil_kitchen_add", { p_name: n, p_location: where === "auto" ? null : where, p_category: category.trim() || null });
    setBusy(false);
    if (error) { toast.error(`Couldn't add ${n}. ${error.message}`); return; }
    const r = res as Item;
    toast.success(`Added ${r.name} to the ${r.location}`);
    onDone();
    onAdded();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="kitchen-name">What is it?</Label>
        <Input
          id="kitchen-name" ref={nameRef} autoFocus autoComplete="off" maxLength={80}
          value={name} onChange={(e) => setName(e.target.value)} placeholder="Coconut oil"
          className="h-11 text-base sm:text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label id="kitchen-where">Where does it live?</Label>
        <Segmented
          label="Where does it live?"
          dense
          value={where}
          onChange={(v) => setWhere(v as Loc | "auto")}
          options={[{ key: "auto", label: "Auto" }, ...LOCS.map((l) => ({ key: l.key, label: l.label }))]}
          className="w-full"
        />
        <p className="text-xs text-white/55">Auto lets Basil pick the spot from what it is.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="kitchen-category">Kind <span className="text-white/50 font-normal">(optional)</span></Label>
        <Input
          id="kitchen-category" autoComplete="off" maxLength={40}
          value={category} onChange={(e) => setCategory(e.target.value)} placeholder="baking, snack, protein"
          className="h-11 text-base sm:text-sm"
        />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={onDone}>Cancel</Button>
        <Button type="submit" className="h-11 sm:h-10" disabled={busy || name.trim().length < 2}>
          {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden />}
          Add
        </Button>
      </div>
    </form>
  );
}

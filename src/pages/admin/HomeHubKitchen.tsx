import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
import { ago, Panel } from "@/components/admin/homeHub/shared";
import { pollInterval } from "@/lib/polling";
import { cn } from "@/lib/utils";
import {
  Apple, ChefHat, Clock, Loader2, Mic, MousePointerClick, Package, Plus, Receipt, RefreshCw,
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
interface Idea { name: string; how: string; uses_soon: number }
interface KitchenEvent {
  id: number; at: string; source: string; action: string; item_id: string | null; item_name: string | null;
  before_status: Status | null; after_status: Status | null; said: string | null;
}
interface Kitchen { items: Item[]; ideas: Idea[]; events: KitchenEvent[]; last_tick: string | null; now: string }

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

const LOCS: { key: Loc; label: string; icon: LucideIcon }[] = [
  { key: "fridge", label: "Fridge", icon: Refrigerator },
  { key: "freezer", label: "Freezer", icon: Snowflake },
  { key: "pantry", label: "Pantry", icon: Package },
  { key: "counter", label: "Counter", icon: Apple },
];

const STATUS_WORD: Record<Status, string> = { have: "in stock", low: "low", out: "used up", arriving: "on the way" };

const SETTABLE: { key: Exclude<Status, "arriving">; label: string; on: string }[] = [
  { key: "have", label: "Have", on: "bg-white/[0.14] text-white" },
  { key: "low", label: "Low", on: "bg-amber-500/20 text-amber-200" },
  { key: "out", label: "Out", on: "bg-red-500/20 text-red-200" },
];

const SUFFIX_S = /[^s]s$/i;
const TAP = "touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50";

function timeLabel(iso: string, now: number) {
  const age = now - new Date(iso).getTime();
  if (age < 86_400_000) return ago(iso, now);
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function HomeHubKitchen() {
  const [data, setData] = useState<Kitchen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [loc, setLoc] = useState<Loc | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [undoing, setUndoing] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data: d, error: e } = await rpc("basil_kitchen");
    if (e) setError(e.message);
    else { setData(d as Kitchen); setError(null); }
    setNow(Date.now());
    setLoaded(true);
  }, []);

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
    <div className="space-y-6">
      <PageHeader
        title="Kitchen"
        description={description}
        actions={
          <>
            <Button onClick={() => setAddOpen(true)} className="motion-safe:active:scale-[0.97] motion-safe:transition-transform">
              <Plus className="h-4 w-4 mr-1.5" aria-hidden />
              Add item
            </Button>
            <ActionMenu
              label="More kitchen actions"
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-2xl bg-white/[0.04]" />)}</div>
          <Skeleton className="h-96 rounded-2xl bg-white/[0.04]" />
        </div>
      ) : data && (
        <>
          <Tonight ideas={data.ideas} useSoon={useSoon} onFind={(name) => { setQuery(name); setLoc("all"); setStatusFilter(null); }} />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label="Filter by status">
            <StatTile label="In stock" value={counts.have} active={statusFilter === "have"} onClick={() => setStatusFilter(statusFilter === "have" ? null : "have")} />
            <StatTile label="Running low" value={counts.low} tone="amber" active={statusFilter === "low"} onClick={() => setStatusFilter(statusFilter === "low" ? null : "low")} />
            <StatTile label="Used up" value={counts.out} tone="red" active={statusFilter === "out"} onClick={() => setStatusFilter(statusFilter === "out" ? null : "out")} />
            <StatTile label="On the way" value={counts.arriving} tone="sky" icon={Truck} active={statusFilter === "arriving"} onClick={() => setStatusFilter(statusFilter === "arriving" ? null : "arriving")} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Panel className="min-w-0">
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/45" aria-hidden />
                  <Input
                    type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find an item" aria-label="Find an item"
                    className="pl-9 h-11 sm:h-10 text-base sm:text-sm bg-white/[0.04] border-white/[0.08]"
                  />
                </div>
                <Segmented
                  label="Where"
                  className="w-full sm:w-auto"
                  value={loc}
                  onChange={(v) => setLoc(v as Loc | "all")}
                  options={[{ key: "all", label: "All" }, ...LOCS.map((l) => ({ key: l.key, label: l.label }))]}
                />
              </div>

              {groups.length === 0 ? (
                <EmptyState
                  compact icon={ChefHat}
                  title={filtering ? "Nothing matches" : "The kitchen list is empty"}
                  description={filtering ? "Try another word or clear the filters." : "Add an item, or Basil fills this from your Costco and Instacart receipts."}
                  action={filtering ? <Button variant="outline" onClick={() => { setQuery(""); setLoc("all"); setStatusFilter(null); }}>Clear filters</Button> : undefined}
                />
              ) : (
                <div className="space-y-6">
                  {groups.map((g) => (
                    <section key={g.key} aria-label={g.label}>
                      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/60 mb-1">
                        <g.icon className="h-3.5 w-3.5" aria-hidden />
                        {g.label}
                        <span className="tabular-nums font-normal">{g.items.length}</span>
                      </h3>
                      <ul className="divide-y divide-white/[0.05]">
                        {g.items.map((item) => (
                          <ItemRow key={item.id} item={item} onStatus={setStatus} onEdit={edit} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </Panel>

            <div className="space-y-6 min-w-0">
              <VoiceHelp />
              <Recent events={data.events} now={now} undoing={undoing} onUndo={undo} />
            </div>
          </div>
        </>
      )}

      <AddDialog open={addOpen} onOpenChange={setAddOpen} onAdded={load} />
    </div>
  );
}

/* ---------- Tonight: the one thing this page is for ---------- */

function Tonight({ ideas, useSoon, onFind }: { ideas: Idea[]; useSoon: Item[]; onFind: (name: string) => void }) {
  return (
    <section
      aria-label="Tonight"
      className="bento-tile bento-butter rounded-2xl border border-white/[0.08] bg-gradient-to-br from-amber-500/[0.10] via-white/[0.03] to-transparent p-4 sm:p-6"
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <UtensilsCrossed className="h-4 w-4" aria-hidden />
        Tonight you could make
      </h2>
      {ideas.length === 0 ? (
        <p className="mt-3 text-white/70">Nothing fully makeable right now. Might be time for a Costco run.</p>
      ) : (
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {ideas.map((idea, n) => (
            <li key={idea.name} className="rounded-xl bg-white/[0.04] p-4">
              <p className="text-lg font-semibold text-white leading-tight tracking-[-0.01em] text-balance">
                <span className="sr-only">{n + 1}. </span>{idea.name}
              </p>
              <p className="mt-1.5 text-sm text-white/70 text-pretty">{idea.how}</p>
              {idea.uses_soon > 0 && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-200">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  Uses something to eat soon
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
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

/* ---------- Pieces ---------- */

function StatTile({ label, value, tone, icon: Icon, active, onClick }: {
  label: string; value: number; tone?: "amber" | "red" | "sky"; icon?: LucideIcon; active: boolean; onClick: () => void;
}) {
  const ink = tone === "amber" ? "text-amber-200" : tone === "red" ? "text-red-200" : tone === "sky" ? "text-sky-200" : "text-white";
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className={cn(
        "text-left rounded-2xl border p-4 min-h-20 motion-safe:active:scale-[0.98] motion-safe:transition-transform", TAP,
        active ? "border-white/30 bg-white/[0.08]" : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-white/60">{Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}{label}</span>
      <span className={cn("block text-2xl font-semibold tabular-nums mt-1 whitespace-nowrap", ink)}>{value}</span>
    </button>
  );
}

function Segmented({ label, value, onChange, options, className }: {
  label: string; value: string; onChange: (v: string) => void; options: { key: string; label: ReactNode; on?: string }[]; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex sm:inline-flex rounded-xl bg-white/[0.05] p-1", className)}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key} type="button" aria-pressed={on} onClick={() => onChange(o.key)}
            className={cn(
              "flex-1 sm:flex-none min-h-11 sm:min-h-8 px-2 sm:px-3 rounded-lg text-sm font-medium whitespace-nowrap motion-safe:transition-colors motion-safe:active:scale-[0.96]", TAP,
              on ? (o.on ?? "bg-white/[0.14] text-white") : "text-white/60 hover:text-white",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ItemRow({ item, onStatus, onEdit }: {
  item: Item; onStatus: (item: Item, s: Status) => void; onEdit: (item: Item, patch: { use_soon?: boolean; location?: Loc }) => void;
}) {
  const detail = [item.category, item.qty != null ? `${item.qty} ${item.unit ?? ""}`.trim() : null].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className={cn("font-medium break-words", item.status === "out" ? "text-white/55" : "text-white")}>{item.name}</p>
        {((item.use_soon && item.status !== "out") || item.status === "arriving") && (
          <div className="flex flex-wrap gap-1.5 mt-1">
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
        {detail && <p className="text-xs text-white/55 mt-0.5">{detail}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Segmented
          label={`${item.name} status`}
          value={item.status}
          onChange={(v) => onStatus(item, v as Status)}
          options={SETTABLE.map((s) => ({ key: s.key, label: s.label, on: s.on }))}
        />
        <ActionMenu
          label={`More for ${item.name}`}
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

const SOURCE_ICON: Record<string, LucideIcon> = { voice: Mic, ui: MousePointerClick, receipt: Receipt };

function eventText(e: KitchenEvent): string {
  const name = e.item_name ?? "Item";
  if (e.action === "add") return `${name} added`;
  if (e.action === "undo") return `${name} back to ${STATUS_WORD[e.after_status ?? "have"]}`;
  if (e.action.startsWith("undone:")) return `${name} ${STATUS_WORD[(e.after_status ?? "have") as Status]} (undone)`;
  if (e.after_status) return `${name} ${STATUS_WORD[e.after_status]}`;
  return name;
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
            const canUndo = ["have", "low", "out", "arriving"].includes(e.action) && !!e.item_id && !!e.before_status;
            return (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
                <Icon className="h-4 w-4 mt-0.5 shrink-0 text-white/45" aria-label={e.source === "voice" ? "By voice" : e.source === "ui" ? "On this page" : e.source} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm text-white/90 break-words", e.action.startsWith("undone:") && "text-white/50 line-through")}>{eventText(e)}</p>
                  <p className="text-xs text-white/55 break-words">
                    {timeLabel(e.at, now)}
                    {e.said && <> · "{e.said}"</>}
                  </p>
                </div>
                {canUndo && (
                  <Button
                    variant="ghost" size="sm" className="h-9 shrink-0 text-white/70 hover:text-white"
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

function AddDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [where, setWhere] = useState<Loc | "auto">("auto");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setName(""); setWhere("auto"); setCategory(""); } }, [open]);

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
    onOpenChange(false);
    onAdded();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Add to the kitchen</DialogTitle>
            <DialogDescription>It goes on the list as in stock.</DialogDescription>
          </DialogHeader>
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
              value={where}
              onChange={(v) => setWhere(v as Loc | "auto")}
              options={[{ key: "auto", label: "Basil picks" }, ...LOCS.map((l) => ({ key: l.key, label: l.label }))]}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kitchen-category">Kind <span className="text-white/50 font-normal">(optional)</span></Label>
            <Input
              id="kitchen-category" autoComplete="off" maxLength={40}
              value={category} onChange={(e) => setCategory(e.target.value)} placeholder="baking, snack, protein"
              className="h-11 text-base sm:text-sm"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

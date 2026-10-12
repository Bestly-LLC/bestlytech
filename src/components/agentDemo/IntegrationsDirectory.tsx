import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Building2, CalendarDays, Car, CreditCard, FolderOpen, Headset, House, Mail, Mic, Phone, Search,
  SearchX, Scale, ShoppingBag, Stethoscope, UtensilsCrossed, Users, Workflow, Wrench, X, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INTEGRATIONS, appCountLabel, searchIntegrations, squash, type IntegrationIcon } from "./integrations";

const ICONS: Record<IntegrationIcon, LucideIcon> = {
  calendar: CalendarDays,
  crm: Users,
  helpdesk: Headset,
  payments: CreditCard,
  crews: Wrench,
  health: Stethoscope,
  restaurant: UtensilsCrossed,
  realestate: House,
  property: Building2,
  law: Scale,
  auto: Car,
  store: ShoppingBag,
  phone: Phone,
  email: Mail,
  files: FolderOpen,
  automation: Workflow,
};

/** Phones show this many names per group until "Show all" is pressed. Nothing is ever cut off mid-name. */
const PHONE_FIRST = 6;

/** The typed letters, marked inside a name. A match that only lines up after ignoring spaces marks the whole name. */
function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q);
  if (at < 0) {
    return squash(text).includes(squash(query)) ? <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground">{text}</mark> : <>{text}</>;
  }
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

/**
 * The "works inside the apps you already use" directory: a search box, a filter row and one card per kind of software.
 * Plain DOM and text only (no logos, no images), so it stays fast. The data lives in integrations.ts.
 */
export function IntegrationsDirectory({ onAskMaya }: { onAskMaya: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const searching = squash(query).length > 0;
  const groups = useMemo(() => {
    const found = searchIntegrations(query);
    return !searching && filter !== "all" ? found.filter((g) => g.category.id === filter) : found;
  }, [query, searching, filter]);

  const sq = squash(query);
  const matches = searching ? groups.reduce((n, g) => n + g.names.filter((x) => squash(x).includes(sq)).length, 0) : 0;
  const titleHits = groups.filter((g) => g.wholeGroup).length;
  const status = !searching
    ? ""
    : groups.length === 0
      ? `Nothing found for ${query.trim()}.`
      : matches > 0
        ? `${matches} ${matches === 1 ? "match" : "matches"} in ${groups.length} ${groups.length === 1 ? "group" : "groups"}.`
        : `Showing ${titleHits} ${titleHits === 1 ? "group" : "groups"}.`;

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  return (
    <div>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <p className="flex items-center gap-2.5 text-base font-semibold text-foreground sm:text-lg">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Zap className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <span>Not on the list? We build new connections fast, usually the same day.</span>
        </p>
        <p className="text-base text-muted-foreground">
          <span className="font-semibold text-foreground">{appCountLabel()} apps</span>, plus thousands more through Zapier.
        </p>
      </div>

      {/* Search */}
      <div className="mt-8 max-w-2xl">
        <label htmlFor="int-search" className="mb-2 block font-modern text-lg font-semibold tracking-[-0.012em] [word-spacing:0.05em] text-foreground">
          Does it work with your software?
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            id="int-search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={query}
            placeholder="Type a name, like ServiceTitan"
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim()) setFilter("all");
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
            aria-describedby="int-status"
            className={`h-[52px] w-full rounded-2xl border border-border bg-card pl-12 pr-12 text-base text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden ${focusRing}`}
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                document.getElementById("int-search")?.focus();
              }}
              aria-label="Clear the search"
              className={`absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground ${focusRing}`}
            >
              <X className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p id="int-status" role="status" aria-live="polite" className="mt-2 min-h-[1.5rem] text-sm text-muted-foreground">
          {status}
        </p>
      </div>

      {/* Filter: one row that scrolls sideways on a phone, wraps on a wide screen */}
      {!searching ? (
      <div
        role="group"
        aria-label="Show one kind of software"
        className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {[{ id: "all", title: "All" }, ...INTEGRATIONS.map((c) => ({ id: c.id, title: c.title }))].map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setFilter(f.id);
                setQuery("");
              }}
              className={`inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-150 active:duration-0 motion-reduce:transition-none ${focusRing} ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-primary/50"
              }`}
            >
              {f.title}
            </button>
          );
        })}
      </div>
      ) : null}

      {/* Results */}
      {groups.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-primary/40 bg-primary/[0.04] p-6 sm:p-8">
          <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <SearchX className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="font-modern text-xl font-semibold tracking-[-0.012em] [word-spacing:0.05em] text-foreground">
            Not listed yet, and that&rsquo;s fine.
          </h3>
          <p className="mt-2 max-w-xl text-lg text-foreground/75">We connect new software fast, usually the same day.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button size="lg" className="min-h-[44px]" onClick={onAskMaya}>
              <Mic className="mr-2 h-4 w-4" aria-hidden="true" /> Ask Maya
            </Button>
            <Button size="lg" variant="outline" className="min-h-[44px]" asChild>
              <Link to="/contact?topic=agent">
                Tell us what you use <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Software Maya connects to">
          {groups.map(({ category: c, names }) => {
            const Icon = ICONS[c.icon];
            const expanded = open.has(c.id);
            const collapsible = !searching && names.length > PHONE_FIRST;
            return (
              <li key={c.id} className="flex flex-col rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-modern text-lg font-semibold leading-snug tracking-[-0.012em] [word-spacing:0.05em] text-foreground">{c.title}</h3>
                </div>
                <p className="mt-4 text-muted-foreground">{c.does}</p>
                <ul className="mt-4 flex flex-wrap gap-2" aria-label={`${c.title}: names`}>
                  {names.map((n, i) => (
                    <li
                      key={n}
                      className={`whitespace-nowrap rounded-full border border-border bg-background px-3 py-1 text-sm text-foreground ${
                        collapsible && !expanded && i >= PHONE_FIRST ? "max-sm:hidden" : ""
                      }`}
                    >
                      <Marked text={n} query={query} />
                    </li>
                  ))}
                </ul>
                {collapsible ? (
                  <button
                    type="button"
                    onClick={() => toggle(c.id)}
                    aria-expanded={expanded}
                    className={`mt-3 inline-flex min-h-[44px] items-center self-start rounded-full px-1 text-sm font-semibold text-primary hover:underline sm:hidden ${focusRing}`}
                  >
                    {expanded ? "Show fewer" : `Show all ${names.length}`}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-8 text-sm text-muted-foreground">
        App and company names belong to their owners. Listing them means we can connect Maya to them for you, not that they
        endorse or partner with Bestly.
      </p>
    </div>
  );
}

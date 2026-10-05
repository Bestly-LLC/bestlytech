import { useMemo, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, AppWindow, ArrowDown, ArrowRight, BookOpen, Bot, Box, Building2, Camera, CheckCircle2, ChevronDown, ChevronRight,
  ChevronsUpDown, CircleDashed, Clapperboard, Cloud, Compass, Cookie, Droplet, Droplets, ExternalLink, Flower2, Gem,
  Globe, GraduationCap, Headphones, HeartHandshake, House, KeyRound, Laptop, Leaf, Lightbulb, Megaphone, MessageCircle,
  Mic, Monitor, Package, PackageCheck, LayoutDashboard, Flower, Projector, RefreshCw, Rocket, School, Server, ShieldCheck, ShoppingBag, Smartphone, Sparkles, Store, Tv,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { products as siteProducts } from "@/config/products";
import { pollInterval } from "@/lib/polling";
import { cn } from "@/lib/utils";
import { Sheet, btnPlain, btnTinted, card, field, label, separator } from "@/pages/admin/laxUi";
import { AgentIcon, HEALTH, nb, when, type Agent } from "@/pages/admin/Team";

/**
 * The Products view of the Team page: every Bestly app, site and idea, the three jobs each one needs
 * (Marketing, Updates, Security), who owns each job, and whether it is healthy. The data comes from one
 * database call (admin_products, see docs/products-team-opusplan.md); people's names, faces and health
 * come from the org chart the Team page already loaded.
 */

/* ---------------------------------------------------------------- data */

export type DutyKey = "marketing" | "updates" | "security";
type PHealth = "green" | "yellow" | "red" | "grey";
export type ProductDuty = {
  duty: DutyKey; required: boolean; agent_slug: string | null; tools: string[]; health: PHealth; detail: string | null; note: string | null;
};
export type Product = {
  slug: string; name: string; kind: "app" | "web" | "service" | "physical" | "client" | "idea";
  status: "live" | "beta" | "building" | "planned" | "idea" | "paused" | "retired";
  platforms: string[] | null; url: string | null; store_url: string | null; icon: string | null; blurb: string | null;
  sort: number | null; lead_slug: string | null; assets: string[] | null; health: PHealth; headline: string | null; duties: ProductDuty[];
};
export type ProductsData = { checked_at: string | null; audit_at: string | null; products: Product[]; unmapped_hosts: string[] | null };

type RpcResult = Promise<{ data: unknown; error: { message: string } | null }>;
/** always bound: an unbound supabase.rpc crashes with "Cannot read properties of undefined (reading 'rest')" */
const rpc = (fn: string, args?: Record<string, unknown>): RpcResult =>
  (supabase.rpc.bind(supabase) as unknown as (fn: string, args?: Record<string, unknown>) => RpcResult)(fn, args);

/** Shared by the Products view and the "Looks after" section on a person's card (same query key, one fetch). */
export function useAdminProducts(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await rpc("admin_products");
      if (error) throw new Error(error.message);
      return data as unknown as ProductsData;
    },
    refetchInterval: () => (document.hidden ? false : pollInterval(60_000)),
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    enabled: opts?.enabled ?? true,
  });
}

/* ---------------------------------------------------------------- words, icons, colours */

/**
 * Text colours checked for 4.5:1 on every surface used here (page, card, inset list, tinted pill) in both modes.
 * The shared secondary/tertiary tokens in laxUi are Apple's label levels and fall short on the light theme,
 * so this view uses its own.
 */
const sec = "text-[#EBEBF5b3] bento:text-[#55555A]";
const ter = "text-[#A1A1A6] bento:text-[#6C6C70]";
const ok = {
  green: "text-[#30D158] bento:text-[#1E7A34]",
  orange: "text-[#FF9F0A] bento:text-[#B33100]",
  red: "text-[#FF6961] bento:text-[#D70015]",
};

const DUTIES: Record<DutyKey, { word: string; Icon: ComponentType<{ className?: string }>; tile: string }> = {
  marketing: { word: "Marketing", Icon: Megaphone, tile: "bg-[#FF2D55]" },
  updates: { word: "Updates", Icon: RefreshCw, tile: "bg-[#0A84FF]" },
  security: { word: "Security", Icon: ShieldCheck, tile: "bg-[#5E5CE6]" },
};
export const dutyWord = (d: DutyKey) => DUTIES[d].word;

/** health of a product or one of its jobs: always an icon and a word, never colour alone */
const PH: Record<PHealth, { word: string; Icon: ComponentType<{ className?: string }>; text: string }> = {
  green: { word: "All good", Icon: CheckCircle2, text: ok.green },
  yellow: { word: "Needs a look", Icon: AlertTriangle, text: ok.orange },
  red: { word: "Needs fixing", Icon: XCircle, text: ok.red },
  grey: { word: "Nothing to check yet", Icon: CircleDashed, text: sec },
};
const RANK: Record<PHealth, number> = { red: 0, yellow: 1, green: 2, grey: 3 };

const GREY_PILL = "bg-[#7676803d] text-[#AEAEB2] bento:bg-[#7676801f] bento:text-[#636366]";
const STATUS: Record<string, { word: string; cls: string }> = {
  live: { word: "Live", cls: "bg-[#30D15826] text-[#30D158] bento:bg-[#34C7591f] bento:text-[#1E7A34]" },
  beta: { word: "Beta", cls: "bg-[#0A84FF26] text-[#409CFF] bento:bg-[#007AFF1a] bento:text-[#0062CC]" },
  building: { word: "Building", cls: "bg-[#FF9F0A26] text-[#FF9F0A] bento:bg-[#FF95001f] bento:text-[#B33100]" },
  planned: { word: "Planned", cls: GREY_PILL },
  paused: { word: "Paused", cls: GREY_PILL },
  idea: { word: "Idea", cls: GREY_PILL },
};

/** the icon named in team_products.icon -> a component (anything unknown falls back to Box) */
const PRODUCT_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  box: Box, package: Package, smartphone: Smartphone, globe: Globe, cloud: Cloud, server: Server, "shield-check": ShieldCheck,
  cookie: Cookie, droplets: Droplets, droplet: Droplet, gem: Gem, leaf: Leaf, "flower-2": Flower2, "shopping-bag": ShoppingBag,
  compass: Compass, "heart-handshake": HeartHandshake, "graduation-cap": GraduationCap, "building-2": Building2, house: House,
  home: House, clapperboard: Clapperboard, megaphone: Megaphone, tv: Tv, lightbulb: Lightbulb, "key-round": KeyRound,
  camera: Camera, headphones: Headphones, "book-open": BookOpen, "message-circle": MessageCircle, sparkles: Sparkles,
  "app-window": AppWindow, laptop: Laptop, monitor: Monitor, store: Store, school: School, bot: Bot, rocket: Rocket, mic: Mic,
  "package-check": PackageCheck, "layout-dashboard": LayoutDashboard, flower: Flower, projector: Projector,
};

const siteImage = (slug: string) => siteProducts.find((x) => x.id === slug)?.image;

/** focus rings: always visible from the keyboard, offset colour matches the surface the control sits on */
const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF] bento:focus-visible:ring-[#007AFF]";
const FOCUS_PAGE = cn(RING, "focus-visible:ring-offset-2 focus-visible:ring-offset-[#000] bento:focus-visible:ring-offset-[#F3F2EE]");
const FOCUS_CARD = cn(RING, "focus-visible:ring-offset-2 focus-visible:ring-offset-[#1C1C1E] bento:focus-visible:ring-offset-[#fff]");
const FOCUS_INSET = cn(RING, "focus-visible:ring-inset");
/** press feedback: transform, background and opacity only, and only when motion is welcome */
const PRESS = "transition-[transform,background-color,opacity] duration-150 motion-safe:active:scale-[0.98]";
const HOVER = "hover:bg-[#ffffff0a] bento:hover:bg-[#0000000a]";

const SUBHEAD = cn("px-1 text-[13px] font-semibold uppercase tracking-[0.02em]", sec);
const LIST = cn("divide-y overflow-hidden rounded-[14px] bg-[#2C2C2E] bento:bg-[#F2F2F7]", separator);

/** "Spark", "Ares", and for longer names ("Social Poster") the first word fits better in a row */
const shortName = (n: string) => (n.length <= 14 ? n : n.split(" ")[0]);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* ---------------------------------------------------------------- small pieces */

function ProductTile({ p, size = "md" }: { p: Product; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 rounded-[13px]" : "h-11 w-11 rounded-[10px]";
  const img = siteImage(p.slug);
  if (img) {
    return <img src={img} alt="" className={cn(box, "shrink-0 object-cover ring-1 ring-inset ring-[#ffffff1f] bento:ring-[#0000001a]")} />;
  }
  const Icon = (p.icon && PRODUCT_ICONS[p.icon]) || Box;
  const tone =
    p.kind === "client" ? "bg-[#64D2FF26] text-[#64D2FF] bento:bg-[#32ADE61f] bento:text-[#0071A4]"
      : p.kind === "idea" ? "bg-[#FFD60A26] text-[#FFD60A] bento:bg-[#FFCC001f] bento:text-[#A05A00]"
      : "bg-[#0A84FF1f] text-[#409CFF] bento:bg-[#007AFF14] bento:text-[#007AFF]";
  return (
    <span className={cn(box, "grid shrink-0 place-items-center", tone)}>
      <Icon className={size === "lg" ? "h-7 w-7" : "h-[22px] w-[22px]"} />
    </span>
  );
}

function StatusPill({ status }: { status: Product["status"] }) {
  const s = STATUS[status] ?? STATUS.planned;
  return <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", s.cls)}>{s.word}</span>;
}

/** icon + word for a product's overall health; the sentence that explains it lives on the worst duty row */
function HealthLine({ health }: { health: PHealth }) {
  const m = PH[health] ?? PH.grey;
  return (
    <span className="mt-1.5 flex items-center gap-1.5 text-[13px] leading-snug">
      <m.Icon className={cn("h-3.5 w-3.5 shrink-0", m.text)} aria-hidden />
      <span className={cn("font-medium", m.text)}>{m.word}</span>
    </span>
  );
}

/** an owner's face; a bot that isn't on the org chart yet gets a plain bot */
function Face({ a, size = "sm" }: { a: Agent | undefined; size?: "sm" | "md" }) {
  if (a) return <AgentIcon a={a} size={size} />;
  return (
    <span className={cn("grid shrink-0 place-items-center bg-[#7676803d] text-[#8E8E93] bento:bg-[#7676801f]", size === "md" ? "h-11 w-11 rounded-[13px]" : "h-7 w-7 rounded-[9px]")}>
      <Bot className={size === "md" ? "h-[22px] w-[22px]" : "h-4 w-4"} aria-hidden />
    </span>
  );
}

const AGENT_TEXT: Record<string, string> = { green: ok.green, yellow: ok.orange, red: ok.red };

function OwnerHealth({ a }: { a: Agent | undefined }) {
  if (!a || a.kind === "human") return null;
  const h = HEALTH[a.health] ?? HEALTH.unknown;
  return (
    <>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", h.dot)} aria-hidden />
      <span className="sr-only">{h.word}</span>
    </>
  );
}

/* ---------------------------------------------------------------- how products report */

function OrgNode({ slug, name, role, bySlug, onOpen }: {
  slug: string; name: string; role: string; bySlug: Map<string, Agent>; onOpen: (slug: string) => void;
}) {
  const a = bySlug.get(slug);
  const h = a && a.kind !== "human" ? HEALTH[a.health] ?? HEALTH.unknown : null;
  const hText = a ? AGENT_TEXT[a.health] ?? sec : sec;
  const health = (cls: string) => h && (
    <span className={cn("items-center gap-1.5 whitespace-nowrap text-[12px] font-medium", hText, cls)}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", h.dot)} aria-hidden />{h.word}
    </span>
  );
  const body = (
    <>
      <span className="md:hidden"><Face a={a} size="sm" /></span>
      <span className="hidden md:block"><Face a={a} size="md" /></span>
      <span className="min-w-0 flex-1 text-left md:flex-none">
        <span className="flex items-center gap-2">
          <span className={cn("text-[15px] font-semibold leading-tight", label)}>{a?.name ?? name}</span>
          {health("inline-flex md:hidden")}
        </span>
        <span className={cn("block text-[13px] leading-snug", sec)}>{role}</span>
        {health("mt-0.5 hidden md:inline-flex")}
      </span>
    </>
  );
  const cls = "flex min-h-[52px] w-full items-center gap-3 rounded-[16px] bg-[#2C2C2E] p-2 pr-3 text-left bento:bg-[#F2F2F7] md:min-h-[64px] md:w-auto md:p-2.5 md:pr-4";
  if (!a) return <div className={cls}>{body}</div>;
  return (
    <button type="button" data-bm-host onClick={() => onOpen(slug)}
      className={cn(cls, PRESS, "hover:bg-[#3A3A3C] bento:hover:bg-[#E5E5EA]", FOCUS_CARD)}>
      {body}
    </button>
  );
}

function Arrow() {
  return (
    <span aria-hidden className={cn("flex h-4 items-center justify-center md:h-auto md:w-7", ter)}>
      <ArrowDown className="h-3.5 w-3.5 md:hidden" />
      <ArrowRight className="hidden h-4 w-4 md:block" />
    </span>
  );
}

const DASH = "before:border-[#8E8E93] after:border-[#8E8E93] bento:before:border-[#8E8E93] bento:after:border-[#8E8E93]";

function ReportingStrip({ bySlug, onOpen }: { bySlug: Map<string, Agent>; onOpen: (slug: string) => void }) {
  const lead = (slug: string, name: string, role: string) => <OrgNode slug={slug} name={name} role={role} bySlug={bySlug} onOpen={onOpen} />;
  return (
    <section className={cn(card, "space-y-3 p-3 sm:p-5 md:space-y-4")} aria-label="How products report">
      <header className="px-1 md:px-0">
        <h2 className={cn("text-[17px] font-semibold", label)}>How products report</h2>
        <p className={cn("text-[13px] leading-snug", sec)} style={{ textWrap: "pretty" } as never}>
          <span className="md:hidden">Problems go up this line, from Atlas to Scout to you.</span>
          <span className="hidden md:inline">Every product has an owner for marketing, updates and security. Problems go up this line: Atlas, then Scout, then you.</span>
        </p>
      </header>
      <div className="flex flex-col md:flex-row md:items-center md:justify-start">
        {lead("jared", "You", "Founder")}
        <Arrow />
        {lead("scout", "Scout", "Chief of Staff")}
        <Arrow />
        {lead("atlas", "Atlas", "Head of Product")}

        {/* Atlas works with two functional leads: a dashed line, because they don't report to him */}
        <div className="ml-[1.375rem] md:ml-0 md:flex md:items-center">
          <span aria-hidden className="block h-2 w-0 border-l border-dashed border-[#8E8E93] md:h-0 md:w-5 md:border-l-0 md:border-t" />
          <div className="relative flex flex-col gap-2 pl-5">
            <div className={cn("relative before:absolute before:-left-5 before:top-1/2 before:w-5 before:border-t before:border-dashed",
              "after:absolute after:-left-5 after:top-0 after:-bottom-2 after:border-l after:border-dashed md:after:top-1/2", DASH)}>
              {lead("spark", "Spark", "Marketing")}
            </div>
            <div className={cn("relative before:absolute before:-left-5 before:top-1/2 before:w-5 before:border-t before:border-dashed",
              "after:absolute after:-left-5 after:-top-2 after:bottom-1/2 after:border-l after:border-dashed", DASH)}>
              {lead("security-auditor", "Ares", "Security")}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- product card */

function DutyRow({ p, d, bySlug, onOpenAgent, onAssign }: {
  p: Product; d: ProductDuty; bySlug: Map<string, Agent>; onOpenAgent: (slug: string) => void; onAssign: () => void;
}) {
  const meta = DUTIES[d.duty];
  const m = PH[d.health] ?? PH.grey;
  const owner = d.agent_slug ? bySlug.get(d.agent_slug) : undefined;
  const grid = "grid w-full grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left";
  const tile = (
    <span className={cn("grid h-7 w-7 place-items-center rounded-[8px] text-[#fff]", meta.tile)}>
      <meta.Icon className="h-4 w-4" aria-hidden />
    </span>
  );
  const detail = (
    <span className="col-span-3 flex items-start gap-1.5 text-[13px] leading-snug sm:col-span-2 sm:col-start-2">
      <m.Icon className={cn("mt-[2px] h-3.5 w-3.5 shrink-0", m.text)} aria-hidden />
      <span className={sec} style={{ textWrap: "pretty" } as never}>
        <span className="sr-only">{m.word}. </span>
        {nb(d.detail) || m.word}
      </span>
    </span>
  );

  if (!d.agent_slug) {
    return (
      <li className={grid}>
        {tile}
        <span className={cn("text-[15px] font-medium", label)}>{meta.word}</span>
        <span className="flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-semibold", ok.red)}>
            <XCircle className="h-3.5 w-3.5" aria-hidden />No one
          </span>
          <button type="button" onClick={onAssign}
            className={cn(btnTinted, "px-4 focus-visible:ring-offset-[#2C2C2E] bento:focus-visible:ring-offset-[#F2F2F7]")}
            aria-label={`Assign someone to ${meta.word.toLowerCase()} for ${p.name}`}>
            Assign
          </button>
        </span>
        {detail}
      </li>
    );
  }
  return (
    <li>
      <button type="button" data-bm-host onClick={() => onOpenAgent(d.agent_slug!)}
        className={cn(grid, "min-h-[56px]", PRESS, HOVER, FOCUS_INSET)}
        aria-label={`${meta.word} for ${p.name}: ${owner?.name ?? d.agent_slug}. ${m.word}. ${d.detail ?? ""}`}>
        {tile}
        <span className={cn("text-[15px] font-medium", label)}>{meta.word}</span>
        <span className="flex items-center justify-end gap-1.5">
          <Face a={owner} />
          <span className={cn("whitespace-nowrap text-[13px] font-medium", label)}>{shortName(owner?.name ?? d.agent_slug)}</span>
          <OwnerHealth a={owner} />
        </span>
        {detail}
      </button>
    </li>
  );
}

function ProductCard({ p, bySlug, onOpenAgent, onOpenProduct }: {
  p: Product; bySlug: Map<string, Agent>; onOpenAgent: (slug: string) => void; onOpenProduct: (slug: string) => void;
}) {
  const duties = p.duties.filter((d) => d.required);
  const platforms = (p.platforms ?? []).join(", ");
  return (
    <article className={cn(card, "flex flex-col gap-3 p-3 sm:p-3")} aria-label={p.name}>
      <button type="button" onClick={() => onOpenProduct(p.slug)} aria-haspopup="dialog"
        className={cn("group flex w-full items-start gap-3 rounded-[16px] p-2 text-left", PRESS, HOVER, FOCUS_CARD)}>
        <ProductTile p={p} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("text-[17px] font-semibold leading-tight", label)}>{p.name}</span>
            <StatusPill status={p.status} />
          </span>
          {platforms && <span className={cn("mt-0.5 block text-[13px] leading-snug", sec)}>{platforms}</span>}
          <HealthLine health={p.health} />
        </span>
        <ChevronRight className={cn("mt-3 h-4 w-4 shrink-0", ter)} aria-hidden />
      </button>

      {duties.length > 0 && (
        <ul className={LIST} aria-label={`Who looks after ${p.name}`}>
          {duties.map((d) => (
            <DutyRow key={d.duty} p={p} d={d} bySlug={bySlug} onOpenAgent={onOpenAgent} onAssign={() => onOpenProduct(p.slug)} />
          ))}
        </ul>
      )}
    </article>
  );
}

/* ---------------------------------------------------------------- ideas and unmapped hosts */

function IdeasList({ ideas, onOpenProduct }: { ideas: Product[]; onOpenProduct: (slug: string) => void }) {
  return (
    <div className={cn(card, "p-3 sm:p-3")}>
      <ul className={LIST}>
        {ideas.map((p) => (
          <li key={p.slug}>
            <button type="button" onClick={() => onOpenProduct(p.slug)} aria-haspopup="dialog"
              className={cn("flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left", PRESS, HOVER, FOCUS_INSET)}>
              <span className="min-w-0">
                <span className={cn("block text-[15px] font-medium", label)}>{p.name}</span>
                {p.blurb && <span className={cn("block text-[13px] leading-snug", sec)} style={{ textWrap: "pretty" } as never}>{nb(p.blurb)}</span>}
              </span>
              <ChevronRight className={cn("h-4 w-4 shrink-0", ter)} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UnmappedCard({ hosts, auditor }: { hosts: string[]; auditor: string }) {
  return (
    <section className={cn(card, "space-y-3 p-4 sm:p-4")} aria-label="Not on a product yet">
      <header className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-[#FF9F0A26] text-[#FF9F0A] bento:bg-[#FF95001f] bento:text-[#B33100]">
          <Globe className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className={cn("text-[17px] font-semibold", label)}>Not on a product yet</h2>
          <p className={cn("text-[13px] leading-snug", sec)} style={{ textWrap: "pretty" } as never}>
            {auditor} checks these every night, but they don't belong to a product yet.
          </p>
        </div>
      </header>
      <ul className={LIST}>
        {hosts.map((h) => (
          <li key={h} className="flex min-h-[44px] items-center gap-3 px-4 py-2.5">
            <Globe className={cn("h-4 w-4 shrink-0", ter)} aria-hidden />
            <span className={cn("min-w-0 text-[15px] [overflow-wrap:anywhere]", label)}>{h}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- product sheet */

function ProductSheet({ p, bySlug, employees, onClose }: {
  p: Product | null; bySlug: Map<string, Agent>; employees: Agent[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Partial<Record<DutyKey, string>>>({});
  if (!p) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const duties = p.duties.filter((d) => d.required);
  const ares = bySlug.get("security-auditor")?.name ?? "Ares";
  const atlas = bySlug.get(p.lead_slug ?? "atlas")?.name ?? "Atlas";
  const platforms = (p.platforms ?? []).join(", ");
  const assets = p.assets ?? [];

  const assign = async (duty: DutyKey, slug: string) => {
    if (!slug) return;
    setPending((s) => ({ ...s, [duty]: slug }));
    try {
      const { error } = await rpc("admin_product_duty_set", { p_product: p.slug, p_duty: duty, p_agent: slug });
      if (error) throw new Error(error.message);
      toast.success(`${bySlug.get(slug)?.name ?? slug} now looks after ${DUTIES[duty].word.toLowerCase()} for ${p.name}`);
      await qc.invalidateQueries({ queryKey: ["admin-products"] });
    } catch (e) {
      toast.error(`Couldn't change the owner. ${(e as Error).message || "Try again."}`);
    } finally {
      setPending((s) => { const n = { ...s }; delete n[duty]; return n; });
    }
  };

  const links: { href: string; text: string }[] = [];
  if (p.url) links.push({ href: p.url, text: p.url.startsWith("/") ? "Open its page" : "Open site" });
  if (p.store_url) links.push({ href: p.store_url, text: "Open store page" });

  return (
    <Sheet open onClose={onClose} title={p.name}>
      <div className="space-y-5">
        <div className="flex items-start gap-4">
          <ProductTile p={p} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={p.status} />
              {platforms && <span className={cn("text-[13px]", sec)}>{platforms}</span>}
            </div>
            <HealthLine health={p.health} />
          </div>
        </div>

        {p.blurb && <p className={cn("text-[15px] leading-relaxed", label)} style={{ textWrap: "pretty" } as never}>{nb(p.blurb)}</p>}

        {links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {links.map((l) => l.href.startsWith("/")
              ? <Link key={l.text} to={l.href} className={btnTinted} onClick={onClose}>{l.text}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
              : <a key={l.text} href={l.href} target="_blank" rel="noopener noreferrer" className={btnTinted}>
                  {l.text}<ExternalLink className="h-4 w-4" aria-hidden /><span className="sr-only"> (opens in a new tab)</span>
                </a>)}
          </div>
        )}

        {duties.length > 0 ? (
          <div className="space-y-2">
            <h4 className={SUBHEAD}>Who looks after it</h4>
            <p className={cn("px-1 text-[13px] leading-snug", sec)}>Changes save right away. {atlas} checks every product every 30&nbsp;minutes.</p>
            <ul className="space-y-3">
              {duties.map((d) => {
                const meta = DUTIES[d.duty];
                const m = PH[d.health] ?? PH.grey;
                const saving = d.duty in pending;
                const value = pending[d.duty] ?? d.agent_slug ?? "";
                const inList = employees.some((e) => e.slug === value);
                const extra = value && !inList ? bySlug.get(value) : undefined;
                const id = `owner-${p.slug}-${d.duty}`;
                return (
                  <li key={d.duty} className="space-y-3 rounded-[14px] bg-[#2C2C2E] p-4 bento:bg-[#fff]">
                    <div className="flex items-start gap-3">
                      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[#fff]", meta.tile)}>
                        <meta.Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className={cn("text-[15px] font-semibold leading-tight", label)}>{meta.word}</p>
                        <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-snug">
                          <m.Icon className={cn("mt-[2px] h-3.5 w-3.5 shrink-0", m.text)} aria-hidden />
                          <span className={sec} style={{ textWrap: "pretty" } as never}>
                            <span className="sr-only">{m.word}. </span>{nb(d.detail) || m.word}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={id} className={cn("block px-1 text-[13px] font-medium", sec)}>Owner</label>
                      <div className="relative">
                        <select id={id} value={value} disabled={saving} onChange={(e) => assign(d.duty, e.target.value)}
                          className={cn(field, "min-h-[44px] appearance-none pr-10 disabled:opacity-60", "bg-[#3A3A3C] focus:bg-[#3A3A3C] bento:bg-[#7676801f] bento:focus:bg-[#7676801f]")}>
                          {!value && <option value="" disabled>Pick someone</option>}
                          {extra && <option value={extra.slug}>{extra.name}</option>}
                          {employees.map((e) => <option key={e.slug} value={e.slug}>{e.name} — {e.role}</option>)}
                        </select>
                        <ChevronsUpDown className={cn("pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2", ter)} aria-hidden />
                      </div>
                      <p className={saving ? cn("px-1 text-[12px]", ter) : "sr-only"} aria-live="polite">{saving ? "Saving…" : ""}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {p.kind === "client" && <p className={cn("px-1 text-[12px]", ter)}>Marketing is the client's job, so it isn't listed.</p>}
          </div>
        ) : (
          <p className={cn("px-1 text-[13px]", sec)}>No one has jobs here yet. They start when it becomes a product.</p>
        )}

        {p.kind !== "idea" && (
          <div className="space-y-2">
            <h4 className={SUBHEAD}>{ares} checks</h4>
            {assets.length > 0 ? (
              <ul className="divide-y divide-[#38383A] rounded-[14px] bg-[#2C2C2E] bento:divide-[#C6C6C8] bento:bg-[#fff]">
                {assets.map((a) => (
                  <li key={a} className="flex min-h-[44px] items-center gap-3 px-4 py-2.5">
                    <ShieldCheck className={cn("h-4 w-4 shrink-0", ter)} aria-hidden />
                    <span className={cn("min-w-0 text-[15px] [overflow-wrap:anywhere]", label)}>{a}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={cn("rounded-[14px] bg-[#2C2C2E] px-4 py-3 text-[13px] leading-snug bento:bg-[#fff]", sec)}>
                Nothing yet, so {ares} isn't checking this one at night.
              </p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- loading */

function ProductsSkeleton() {
  const bar = "rounded-full bg-[#7676803d] bento:bg-[#7676801f]";
  return (
    <div className="space-y-6 motion-safe:animate-pulse" aria-busy="true" aria-label="Loading products">
      <div className="flex flex-wrap gap-2">
        {[88, 64, 84, 112, 112, 80].map((w, i) => <div key={i} className={cn("h-9", bar)} style={{ width: `${w / 16}rem` }} />)}
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="space-y-2"><div className={cn("h-5 w-24", bar)} /><div className={cn("h-3 w-56 max-w-full", bar)} /></div>
          <div className={cn("h-4 w-16", bar)} />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={cn(card, "space-y-3 p-3 sm:p-3")}>
              <div className="flex gap-3 p-2">
                <div className="h-11 w-11 shrink-0 rounded-[10px] bg-[#7676803d] bento:bg-[#7676801f]" />
                <div className="flex-1 space-y-2 pt-1"><div className={cn("h-4 w-2/3", bar)} /><div className={cn("h-3 w-1/2", bar)} /></div>
              </div>
              <div className={cn(LIST, "px-3")}>
                {Array.from({ length: 3 }).map((__, k) => (
                  <div key={k} className="flex h-[4.5rem] items-center gap-3">
                    <div className="h-7 w-7 shrink-0 rounded-[8px] bg-[#7676803d] bento:bg-[#7676801f]" />
                    <div className="flex-1 space-y-2"><div className={cn("h-3.5 w-1/3", bar)} /><div className={cn("h-3 w-5/6", bar)} /></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the view */

type PFilter = "all" | "live" | "coming" | "attention" | "clients" | "ideas";
type SectionKey = "live" | "coming" | "clients" | "ideas";

const isIdea = (p: Product) => p.kind === "idea" || p.status === "idea";
const isClient = (p: Product) => p.kind === "client";
const isLive = (p: Product) => !isIdea(p) && !isClient(p) && (p.status === "live" || p.status === "paused");
const isComing = (p: Product) => !isIdea(p) && !isClient(p) && (p.status === "beta" || p.status === "building" || p.status === "planned");
const needsLook = (p: Product) => !isIdea(p) && (p.health === "red" || p.health === "yellow");

/** which sections are open, remembered per browser (never relied on: it can be blocked or empty) */
const OPEN_KEY = "team-products-sections";
const OPEN_DEFAULT: Record<SectionKey, boolean> = { live: true, coming: true, clients: false, ideas: false };
function readOpen(): Record<SectionKey, boolean> {
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    if (raw) return { ...OPEN_DEFAULT, ...(JSON.parse(raw) as Partial<Record<SectionKey, boolean>>) };
  } catch { /* private window or blocked storage: use the defaults */ }
  return OPEN_DEFAULT;
}
function useSectionOpen() {
  const [open, setOpen] = useState(readOpen);
  const toggle = (k: SectionKey) => setOpen((o) => {
    const n = { ...o, [k]: !o[k] };
    try { window.localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  return [open, toggle] as const;
}

function Group({ id, title, blurb, total, open, onToggle, plain, children }: {
  id: string; title: string; blurb: string; total: string; open: boolean; onToggle: () => void; plain?: boolean; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2>
        <button type="button" aria-expanded={open} aria-controls={`products-${id}`} onClick={onToggle}
          className={cn("flex min-h-[44px] w-full items-center gap-3 rounded-[14px] px-1 py-1 text-left", PRESS, HOVER, FOCUS_PAGE)}>
          <span className="min-w-0 flex-1">
            <span className={cn("block text-[20px] font-bold leading-tight tracking-[-0.01em]", label)}>{title}</span>
            <span className={cn("block text-[13px] font-normal leading-snug", sec)}>{blurb}</span>
          </span>
          <span className={cn("whitespace-nowrap text-[13px] font-medium", ter)}>{total}</span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 motion-safe:transition-transform motion-safe:duration-200", ter, !open && "-rotate-90")} aria-hidden />
        </button>
      </h2>
      {open && <div id={`products-${id}`} className={plain ? undefined : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"}>{children}</div>}
    </section>
  );
}

export function TeamProducts({ agents, onOpenAgent, loadingAgents }: {
  agents: Agent[]; onOpenAgent: (slug: string) => void;
  /** the org chart is still loading, so names and faces would flash as raw ids */
  loadingAgents?: boolean;
}) {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useAdminProducts();
  const [filter, setFilter] = useState<PFilter>("all");
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  const [sections, toggleSection] = useSectionOpen();

  const bySlug = useMemo(() => new Map(agents.map((a) => [a.slug, a])), [agents]);
  const employees = useMemo(
    () => agents.filter((a) => a.kind === "agent" && !a.profile?.tool && (a.status === "active" || a.status === "new")),
    [agents],
  );
  // worst first inside every section: red, yellow, green, grey, then the order set in the database
  const all = useMemo(
    () => [...(data?.products ?? [])].filter((p) => p.status !== "retired")
      .sort((a, b) => (RANK[a.health] ?? 3) - (RANK[b.health] ?? 3) || (a.sort ?? 999) - (b.sort ?? 999)),
    [data],
  );
  const opened = openProduct ? all.find((p) => p.slug === openProduct) ?? null : null;

  const counts = useMemo(() => ({
    all: all.length,
    live: all.filter(isLive).length,
    coming: all.filter(isComing).length,
    attention: all.filter(needsLook).length,
    clients: all.filter(isClient).length,
    ideas: all.filter(isIdea).length,
  }), [all]);

  const chips: { key: PFilter; text: string; tone?: string }[] = [
    { key: "all", text: count(counts.all, "product", "products") },
    { key: "live", text: `${counts.live} live` },
    { key: "coming", text: `${counts.coming} coming` },
    { key: "attention", text: `${counts.attention} ${counts.attention === 1 ? "needs" : "need"} a look`, tone: counts.attention ? ok.orange : undefined },
    { key: "clients", text: count(counts.clients, "client site", "client sites") },
    { key: "ideas", text: count(counts.ideas, "idea", "ideas") },
  ];

  const show = (f: PFilter) => filter === "all" || filter === f;
  const pick = (test: (p: Product) => boolean) => all.filter((p) => test(p) && (filter !== "attention" || needsLook(p)));
  const live = show("live") || filter === "attention" ? pick(isLive) : [];
  const coming = show("coming") || filter === "attention" ? pick(isComing) : [];
  const clients = show("clients") || filter === "attention" ? pick(isClient) : [];
  const ideas = filter === "all" || filter === "ideas" ? all.filter(isIdea) : [];
  const unmapped = filter === "all" ? data?.unmapped_hosts ?? [] : [];
  const nothing = !live.length && !coming.length && !clients.length && !ideas.length;
  // picking a chip means "show me these", so a section that was folded away opens for it
  const isOpen = (k: SectionKey) => filter !== "all" || sections[k];
  const card_ = (p: Product) => <ProductCard key={p.slug} p={p} bySlug={bySlug} onOpenAgent={onOpenAgent} onOpenProduct={setOpenProduct} />;

  const stale = error && data;
  return (
    <div className="space-y-6">
      <ReportingStrip bySlug={bySlug} onOpen={onOpenAgent} />

      {(isLoading && !data) || loadingAgents ? (
        <ProductsSkeleton />
      ) : error && !data ? (
        <div className={cn(card, "flex flex-wrap items-center justify-between gap-3")} role="alert">
          <p className={cn("text-[15px]", label)}>Couldn't load the products. {(error as Error).message}</p>
          <button type="button" className={btnTinted} onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Trying…" : "Retry"}</button>
        </div>
      ) : data ? (
        <>
          {stale && (
            <div className={cn(card, "flex flex-wrap items-center justify-between gap-3 p-4 sm:p-4")} role="alert">
              <p className={cn("flex items-start gap-2 text-[15px]", label)}>
                <AlertTriangle className={cn("mt-1 h-4 w-4 shrink-0", ok.orange)} aria-hidden />
                <span>Couldn't refresh the products. Showing what we had at {when(new Date(dataUpdatedAt).toISOString())}.</span>
              </p>
              <button type="button" className={btnPlain} onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Trying…" : "Retry"}</button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter the products">
            {chips.map((c) => (
              <button key={c.key} type="button" aria-pressed={filter === c.key}
                onClick={() => setFilter(filter === c.key && c.key !== "all" ? "all" : c.key)}
                className={cn("min-h-[44px] whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-[transform,background-color] duration-150 motion-safe:active:scale-[0.97] sm:min-h-[36px]", FOCUS_PAGE,
                  filter === c.key ? "bg-[#636366] text-[#fff] bento:bg-[#000] bento:text-[#fff]" : "bg-[#7676803d] bento:bg-[#7676801f]",
                  filter !== c.key && (c.tone ?? label))}>
                {c.text}
              </button>
            ))}
            <span className={cn("ml-auto text-[12px]", ter)}>
              <span className="whitespace-nowrap">Checked {when(data.checked_at)}</span>
              {data.audit_at && <span className="whitespace-nowrap"> · Last audit {when(data.audit_at)}</span>}
            </span>
          </div>

          {all.length === 0 ? (
            <div className={cn(card, "text-center")}>
              <p className={cn("text-[15px]", label)}>No products yet.</p>
              <p className={cn("text-[13px]", sec)}>Apps, sites and ideas show up here once they're added.</p>
            </div>
          ) : (
            <>
              {live.length > 0 && (
                <Group id="live" title="Live" blurb="Out in the world. Each one has an owner for marketing, updates and security."
                  total={count(live.length, "product", "products")} open={isOpen("live")} onToggle={() => toggleSection("live")}>
                  {live.map(card_)}
                </Group>
              )}
              {coming.length > 0 && (
                <Group id="coming" title="Coming next" blurb="Being built or tested. Owners are in place before launch."
                  total={count(coming.length, "product", "products")} open={isOpen("coming")} onToggle={() => toggleSection("coming")}>
                  {coming.map(card_)}
                </Group>
              )}
              {clients.length > 0 && (
                <Group id="clients" title="Client sites" blurb="Built for clients. Marketing is theirs; updates and security are ours."
                  total={count(clients.length, "site", "sites")} open={isOpen("clients")} onToggle={() => toggleSection("clients")}>
                  {clients.map(card_)}
                </Group>
              )}
              {ideas.length > 0 && (
                <Group id="ideas" title="Ideas" blurb="Not started. Nobody has jobs here until one becomes a product."
                  total={count(ideas.length, "idea", "ideas")} open={isOpen("ideas")} onToggle={() => toggleSection("ideas")} plain>
                  <IdeasList ideas={ideas} onOpenProduct={setOpenProduct} />
                </Group>
              )}
              {unmapped.length > 0 && <UnmappedCard hosts={unmapped} auditor={bySlug.get("security-auditor")?.name ?? "Ares"} />}
              {nothing && (
                <div className={cn(card, "text-center")}>
                  <p className={cn("text-[15px]", label)}>Nothing here right now.</p>
                </div>
              )}
            </>
          )}
        </>
      ) : null}

      <ProductSheet p={opened} bySlug={bySlug} employees={employees} onClose={() => setOpenProduct(null)} />
    </div>
  );
}

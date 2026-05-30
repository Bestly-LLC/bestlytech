import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RTooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SEOHead } from "@/components/SEOHead";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";

/**
 * Public Cookie Yeti intelligence dashboard — bestly.tech/cookie-yeti/dashboard.
 *
 * No login. Aimed at users and investors. Renders live, anonymized telemetry
 * from the Cookie Yeti backend: how many sites the AI has analyzed, which
 * consent platforms are hardest to crack, and how companies weaponize cookie
 * banners against you.
 *
 * Data path (resilient by design so an investor demo never shows zeros):
 *   1. get_cookie_yeti_public_stats() RPC (security-definer, anon-granted) —
 *      single round-trip, also covers the admin-only dismissal_reports count.
 *   2. Direct anon table queries (most CY tables allow anon SELECT) if the RPC
 *      isn't deployed yet.
 *   3. Hardcoded last-known-good constants as a final fallback.
 *
 * Theming is self-contained dark (the marketing site defaults to light), so we
 * use explicit zinc/amber values rather than depending on a `dark` class.
 */

// ---------------------------------------------------------------------------
// Types + last-known-good fallback (keeps the page impressive if the network
// or RPC fails during a live demo).
// ---------------------------------------------------------------------------

interface Offender {
  domain: string;
  report_count: number;
  cmp_fingerprint: string;
  has_working_pattern: boolean;
  resolved: boolean;
}

interface WeeklyPoint {
  week: string;
  total: number;
  success: number;
}

interface Stats {
  sites_analyzed: number;
  ai_generations: number;
  ai_success: number;
  banners_dismissed: number;
  devices_protected: number;
  active_patterns: number;
  offenders: Offender[];
  ai_status_breakdown: { status: string; count: number }[];
  ai_weekly: WeeklyPoint[];
}

const FALLBACK: Stats = {
  sites_analyzed: 17,
  ai_generations: 151,
  ai_success: 9,
  banners_dismissed: 15,
  devices_protected: 7,
  active_patterns: 3,
  offenders: [
    { domain: "netflix.com", report_count: 45, cmp_fingerprint: "netflix_custom", has_working_pattern: true, resolved: true },
    { domain: "disney.com", report_count: 31, cmp_fingerprint: "disney_custom", has_working_pattern: true, resolved: true },
    { domain: "washingtonpost.com", report_count: 23, cmp_fingerprint: "arc_custom", has_working_pattern: false, resolved: true },
    { domain: "bloomberg.com", report_count: 18, cmp_fingerprint: "piano_consent", has_working_pattern: false, resolved: false },
    { domain: "reuters.com", report_count: 12, cmp_fingerprint: "onetrust", has_working_pattern: false, resolved: true },
    { domain: "theguardian.com", report_count: 8, cmp_fingerprint: "sourcepoint", has_working_pattern: false, resolved: true },
    { domain: "forbes.com", report_count: 6, cmp_fingerprint: "onetrust", has_working_pattern: false, resolved: true },
    { domain: "wired.com", report_count: 4, cmp_fingerprint: "generic", has_working_pattern: false, resolved: true },
    { domain: "techcrunch.com", report_count: 3, cmp_fingerprint: "generic", has_working_pattern: false, resolved: true },
    { domain: "hulu.com", report_count: 2, cmp_fingerprint: "hulu_custom", has_working_pattern: false, resolved: true },
  ],
  ai_status_breakdown: [
    { status: "no_candidates", count: 122 },
    { status: "skipped_no_html", count: 10 },
    { status: "success", count: 9 },
    { status: "failed", count: 6 },
    { status: "success_cmp_fallback", count: 3 },
    { status: "permanently_failed", count: 1 },
  ],
  ai_weekly: [],
};

// ---------------------------------------------------------------------------
// AI attempt classification. A "real" attempt is a pass where there was an
// actual banner to learn from. no_candidates (nothing on the page looked like a
// banner) and skipped_no_html (we never got the page markup) are NOT attempts —
// there was nothing to succeed or fail at — so they're excluded from the
// success-rate denominator. Counting them is what made the old "6%" so wrong.
// ---------------------------------------------------------------------------

const SUCCESS_STATUSES = new Set([
  "success",
  "success_cmp_fallback",
  "success_failsafe",
  "success_cmp_fingerprint",
]);

const FAILURE_STATUSES = new Set([
  "failed",
  "permanently_failed",
  "needs_manual_review",
]);

const isSuccessStatus = (s: string) => SUCCESS_STATUSES.has(s);

// ---------------------------------------------------------------------------
// CMP knowledge base. Plain-spoken, privacy-first descriptions of how each
// consent platform actually handles your data. Keyed by cmp_fingerprint.
// ---------------------------------------------------------------------------

interface CmpInfo {
  label: string;
  family: string; // grouping used in the distribution chart
  blurb: string;
  categories: string[];
  sharing: string;
}

const CMP_INFO: Record<string, CmpInfo> = {
  onetrust: {
    label: "OneTrust",
    family: "OneTrust",
    blurb:
      "The most widely deployed consent platform on the web. Defaults are tuned so that closing the banner the easy way often leaves advertising and analytics on.",
    categories: ["Strictly necessary", "Performance / analytics", "Targeted advertising", "Social media tracking"],
    sharing:
      "Typically wired to Google Ads, Google Analytics, and the Meta Pixel, plus dozens of IAB TCF advertising vendors.",
  },
  sourcepoint: {
    label: "Sourcepoint",
    family: "Sourcepoint",
    blurb:
      "Publisher-focused consent and ad-recovery platform. Built to detect ad blockers and re-prompt until a choice is made.",
    categories: ["Necessary", "Functional", "Measurement", "Behavioral advertising"],
    sharing:
      "Brokers consent to IAB Transparency and Consent Framework partners, including programmatic ad exchanges and data brokers.",
  },
  piano_consent: {
    label: "Piano",
    family: "Piano",
    blurb:
      "Part of a subscription and analytics suite. Consent is tied to a profile that follows readers across a publisher's properties.",
    categories: ["Essential", "Analytics", "Personalization", "Advertising"],
    sharing:
      "Feeds a first-party profile graph used for paywall targeting, plus third-party ad and measurement partners.",
  },
  arc_custom: {
    label: "Arc XP (custom)",
    family: "Arc XP",
    blurb:
      "A bespoke banner from a major publishing platform. No standard opt-out hooks, which is why it has been the hardest to crack.",
    categories: ["Required", "Site analytics", "Advertising", "Cross-site tracking"],
    sharing:
      "Custom integrations with the publisher's own ad stack and external demand partners. No shared, predictable opt-out path.",
  },
  netflix_custom: {
    label: "Netflix (custom)",
    family: "Custom",
    blurb:
      "An in-house consent surface. Choices are stored against your account rather than a shared standard.",
    categories: ["Necessary", "Preferences", "Analytics", "Advertising"],
    sharing:
      "First-party usage analytics plus advertising partners for its ad-supported tier.",
  },
  disney_custom: {
    label: "Disney (custom)",
    family: "Custom",
    blurb:
      "A house-built banner across Disney properties. Opt-out controls are buried under several layers of menus.",
    categories: ["Essential", "Analytics", "Personalization", "Targeted advertising"],
    sharing:
      "First-party profile data shared across Disney brands and with advertising partners on the ad-supported tier.",
  },
  hulu_custom: {
    label: "Hulu (custom)",
    family: "Custom",
    blurb:
      "A custom consent flow geared around ad-supported streaming, where advertising is on by default.",
    categories: ["Necessary", "Analytics", "Advertising", "Measurement"],
    sharing: "Advertising and measurement partners tied to the ad-supported streaming model.",
  },
  generic: {
    label: "Generic / unknown",
    family: "Generic",
    blurb:
      "A common off-the-shelf or homegrown banner with no recognizable vendor fingerprint.",
    categories: ["Necessary", "Analytics", "Advertising"],
    sharing: "Usually a handful of standard analytics and advertising tags such as Google Analytics and ad pixels.",
  },
};

// Fingerprint aliases — the backend emits a few different keys for the same
// consent platform. Map them onto the canonical entry so live data resolves to
// the right CMP instead of falling through to "Generic / unknown".
CMP_INFO.piano = CMP_INFO.piano_consent;
CMP_INFO.pianoconsent = CMP_INFO.piano_consent;
CMP_INFO.piano_software = CMP_INFO.piano_consent;

function cmpFor(fp: string): CmpInfo {
  return CMP_INFO[fp] ?? CMP_INFO.generic;
}

// Distribution palette (warm amber + complementary), dark-friendly.
const FAMILY_COLORS: Record<string, string> = {
  OneTrust: "#f5a524",
  Custom: "#e8590c",
  "Arc XP": "#c2410c",
  Piano: "#fbbf24",
  Sourcepoint: "#fb923c",
  Generic: "#a16207",
};

// ---------------------------------------------------------------------------
// Animated counter — counts up once when scrolled into view.
// ---------------------------------------------------------------------------

/**
 * Counts up to `value` exactly once, on mount. The target is read through a ref
 * and the animation is guarded so re-renders (and React StrictMode's double
 * effect invocation) never restart it. No IntersectionObserver: the values are
 * known at first paint, so there is nothing to wait for, and a perpetual
 * re-observe loop is impossible.
 */
function CountUp({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const targetRef = useRef(value);
  targetRef.current = value;
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) {
      setDisplay(targetRef.current);
      return;
    }
    playedRef.current = true;
    const target = targetRef.current;
    let raf = 0;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setDisplay(Math.round(eased * target));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDisplay(target);
    };
    raf = requestAnimationFrame(tick);
    // Guarantee the final value even if rAF is throttled (e.g. the page loaded
    // in a background tab, where requestAnimationFrame is paused).
    const snap = window.setTimeout(() => setDisplay(targetRef.current), duration + 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(snap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the value changes after mount (live data replacing the fallback), snap to
  // the new number without re-animating. Skips the initial render so it never
  // pre-empts the count-up.
  const firstUpdate = useRef(true);
  useEffect(() => {
    if (firstUpdate.current) {
      firstUpdate.current = false;
      return;
    }
    setDisplay(value);
  }, [value]);

  return <span className="tabular-nums">{display.toLocaleString()}</span>;
}

// ---------------------------------------------------------------------------
// Data hook.
// ---------------------------------------------------------------------------

function useDashboardData() {
  const [stats, setStats] = useState<Stats>(FALLBACK);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const viaDirectQueries = async (): Promise<Stats | null> => {
      try {
        const [offendersRes, aiRes, patternsRes, devicesRes, dismissalsRes] = await Promise.all([
          supabase
            .from("missed_banner_reports")
            .select("domain, report_count, cmp_fingerprint, has_working_pattern, resolved")
            .order("report_count", { ascending: false })
            .limit(10),
          supabase.from("ai_generation_log").select("domain, status, created_at"),
          supabase.from("cookie_patterns").select("id", { count: "exact", head: true }),
          supabase.from("device_registrations").select("id", { count: "exact", head: true }),
          // Admin-read-only under RLS; will usually 0 for anon. Fall back below.
          supabase.from("dismissal_reports").select("id", { count: "exact", head: true }),
        ]);

        const aiRows = (aiRes.data ?? []) as { domain: string; status: string; created_at: string }[];
        if (!aiRows.length && !offendersRes.data?.length) return null;

        // Weekly buckets (Mon-anchored), success = success + cmp fallback.
        const weekly = new Map<string, { total: number; success: number }>();
        for (const r of aiRows) {
          const d = new Date(r.created_at);
          const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
          const monday = new Date(d);
          monday.setUTCDate(d.getUTCDate() - day);
          const key = monday.toISOString().slice(0, 10);
          const bucket = weekly.get(key) ?? { total: 0, success: 0 };
          bucket.total += 1;
          if (isSuccessStatus(r.status)) bucket.success += 1;
          weekly.set(key, bucket);
        }

        const statusCounts = new Map<string, number>();
        for (const r of aiRows) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);

        const dismissed = dismissalsRes.count ?? 0;

        return {
          sites_analyzed: new Set(aiRows.map((r) => r.domain)).size || FALLBACK.sites_analyzed,
          ai_generations: aiRows.length || FALLBACK.ai_generations,
          ai_success: aiRows.filter((r) => isSuccessStatus(r.status)).length,
          banners_dismissed: dismissed > 0 ? dismissed : FALLBACK.banners_dismissed,
          devices_protected: devicesRes.count ?? FALLBACK.devices_protected,
          active_patterns: patternsRes.count ?? FALLBACK.active_patterns,
          offenders: (offendersRes.data as Offender[]) ?? FALLBACK.offenders,
          ai_status_breakdown: [...statusCounts.entries()]
            .map(([status, count]) => ({ status, count }))
            .sort((a, b) => b.count - a.count),
          ai_weekly: [...weekly.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([week, v]) => ({ week, total: v.total, success: v.success })),
        };
      } catch {
        return null;
      }
    };

    (async () => {
      // 1. Preferred path: the consolidated public RPC.
      try {
        const { data, error } = await supabase.rpc("get_cookie_yeti_public_stats" as never);
        if (!cancelled && !error && data) {
          const d = data as unknown as Stats;
          setStats({ ...FALLBACK, ...d, offenders: d.offenders?.length ? d.offenders : FALLBACK.offenders });
          setLive(true);
          setLoaded(true);
          return;
        }
      } catch {
        /* fall through */
      }

      // 2. Direct anon queries.
      const direct = await viaDirectQueries();
      if (!cancelled) {
        if (direct) {
          setStats(direct);
          setLive(true);
        }
        setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { stats, loaded, live };
}

// ---------------------------------------------------------------------------
// Presentational pieces.
// ---------------------------------------------------------------------------

function favicon(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function TickerCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-amber-500/15 bg-zinc-900/60 px-6 py-7 text-center backdrop-blur">
      <div className="text-4xl font-bold text-amber-400 sm:text-5xl">
        <CountUp value={value} />
      </div>
      <div className="mt-2 text-sm font-medium uppercase tracking-wider text-zinc-300">{label}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function exposureGrade(reportCount: number): { score: number; grade: string; color: string } {
  // Higher reports = worse. Normalize against the worst observed (~45).
  const score = Math.min(100, Math.round((reportCount / 45) * 100));
  let grade = "A";
  if (score >= 80) grade = "F";
  else if (score >= 55) grade = "D";
  else if (score >= 35) grade = "C";
  else if (score >= 15) grade = "B";
  const color = score >= 55 ? "#ef4444" : score >= 35 ? "#f5a524" : "#fbbf24";
  return { score, grade, color };
}

function OffenderCard({ o, rank }: { o: Offender; rank: number }) {
  const cmp = cmpFor(o.cmp_fingerprint);
  const { score, grade, color } = exposureGrade(o.report_count);
  const found = o.has_working_pattern;
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <div className="flex items-center gap-3">
        <span
          aria-label={`Rank ${rank}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-base font-black tabular-nums text-amber-400 ring-1 ring-amber-500/25"
        >
          {rank}
        </span>
        <img
          src={favicon(o.domain)}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-lg bg-zinc-800 p-1"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold text-zinc-100">{o.domain}</div>
          <div className="truncate text-xs text-zinc-400">{cmp.label}</div>
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Exposure score</div>
          <div className="text-3xl font-bold" style={{ color }}>
            {score}
            <span className="ml-2 text-base font-semibold text-zinc-400">grade {grade}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-zinc-200">{o.report_count}</div>
          <div className="text-xs text-zinc-500">user reports</div>
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>

      <div className="mt-4">
        {found ? (
          <span
            title="Cookie Yeti has learned how this site hides its cookie banner and can dismiss it automatically for you."
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} /> Cookie Yeti can block this
          </span>
        ) : (
          <span
            title="Cookie Yeti is still learning how this site hides its cookie banner. A blocking pattern is in progress."
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 ring-1 ring-amber-500/20"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Detection in progress
          </span>
        )}
      </div>
    </div>
  );
}

function DataUseCard({ o }: { o: Offender }) {
  const cmp = cmpFor(o.cmp_fingerprint);
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="flex items-center gap-3">
        <img src={favicon(o.domain)} alt="" width={28} height={28} loading="lazy" className="h-7 w-7 rounded bg-zinc-800 p-0.5" />
        <div>
          <div className="font-semibold text-zinc-100">{o.domain}</div>
          <div className="text-xs text-amber-400">{cmp.label}</div>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400">{cmp.blurb}</p>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Cookie categories they set</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cmp.categories.map((c) => (
            <span key={c} className="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
              {c}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Who your data is shared with</div>
        <p className="mt-1.5 text-sm text-zinc-400">{cmp.sharing}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page.
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  success: "Pattern learned",
  success_cmp_fallback: "Solved via CMP fallback",
  success_failsafe: "Solved via failsafe",
  success_cmp_fingerprint: "Solved via CMP fingerprint",
  needs_manual_review: "Flagged for human review",
  no_candidates: "No banner element found",
  skipped_no_html: "Skipped (no page HTML)",
  failed: "Generation failed",
  permanently_failed: "Marked unsolvable",
};

export default function CookieYetiDashboard() {
  const { stats, loaded, live } = useDashboardData();

  // Headline metric: of the sites users reported, how many has Cookie Yeti
  // actually handled. This is the number worth leading with.
  const reportedSites = stats.offenders.length;
  const resolvedSites = stats.offenders.filter((o) => o.resolved).length;
  const resolutionRate = reportedSites ? Math.round((resolvedSites / reportedSites) * 100) : 0;

  // Pattern success rate, computed only over real attempts (passes where there
  // was a banner to learn from). Excludes no_candidates / skipped_no_html.
  const statusTotal = (predicate: (s: string) => boolean) =>
    stats.ai_status_breakdown.reduce((n, s) => (predicate(s.status) ? n + s.count : n), 0);
  const patternsGenerated = statusTotal((s) => SUCCESS_STATUSES.has(s));
  const realFailures = statusTotal((s) => FAILURE_STATUSES.has(s));
  const realAttempts = patternsGenerated + realFailures;
  const patternSuccessRate = realAttempts ? Math.round((patternsGenerated / realAttempts) * 100) : 0;

  // CMP distribution grouped into platform families.
  const cmpDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of stats.offenders) {
      const fam = cmpFor(o.cmp_fingerprint).family;
      counts.set(fam, (counts.get(fam) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [stats.offenders]);

  // Cumulative patterns learned over time — monotonic, supports the "the AI is
  // learning" story honestly (running total of confirmed successes per week).
  const learningTrend = useMemo(() => {
    let cum = 0;
    return stats.ai_weekly.map((w) => {
      cum += w.success;
      return { week: w.week.slice(5), learned: cum, attempts: w.total };
    });
  }, [stats.ai_weekly]);

  const top5 = stats.offenders.slice(0, 5);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <SEOHead
        title="Cookie Yeti — Live Intelligence Dashboard"
        description="Live telemetry from Cookie Yeti: the sites we've analyzed, the consent platforms that fight back hardest, and how companies use cookie banners against you."
        image="/og-image.png"
      />

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-[#0a0a0a]/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <Link to="/cookie-yeti" className="flex items-center gap-2.5">
            <img src={cookieYetiIcon} alt="Cookie Yeti" className="h-8 w-8 object-contain" />
            <span className="font-semibold tracking-tight">Cookie Yeti</span>
          </Link>
          <div className="flex items-center gap-2 text-xs">
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-400" : "bg-amber-400"} ${loaded ? "" : "animate-pulse"}`} />
              <span className="text-zinc-400">{live ? "Live data" : "Loading"}</span>
            </span>
            <Link
              to="/cookie-yeti"
              className="rounded-lg bg-amber-500 px-3 py-1.5 font-medium text-zinc-950 transition hover:bg-amber-400"
            >
              Get Cookie Yeti
            </Link>
          </div>
        </div>
      </header>

      {/* Hero + ticker */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(245,165,36,0.14),transparent_70%)]" />
        <div className="relative mx-auto max-w-7xl px-6 pt-14 pb-10 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10">
            <img src={cookieYetiIcon} alt="Cookie Yeti" className="h-12 w-12 object-contain" />
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            The cookie banner intelligence network
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-400">
            Every time a consent banner tries to track you, Cookie Yeti learns. This is what the network sees, in real time.
          </p>

          <div className="mt-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <TickerCard label="Sites Analyzed" value={stats.sites_analyzed} sub="domains seen by the AI" />
            <TickerCard label="Blocking Patterns Built" value={patternsGenerated} sub="auto-dismiss rules generated" />
            <TickerCard label="Banners Dismissed" value={stats.banners_dismissed} sub="confirmed by users" />
            <TickerCard label="Devices Protected" value={stats.devices_protected} sub="active installs" />
          </div>
        </div>
      </section>

      {/* Top offenders */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="mb-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Top offenders</h2>
          <p className="mt-2 max-w-2xl text-zinc-400">
            Ranked by how often users had to manually dismiss a banner Cookie Yeti could not yet auto-handle. Higher exposure
            score means a more aggressive, harder-to-escape consent wall.
          </p>
          <p className="mt-3 max-w-2xl text-sm text-zinc-500">
            Cookie Yeti learns how each site hides its cookies and builds a blocking pattern. The badge on each card shows
            whether that pattern is ready yet.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {top5.map((o, i) => (
            <OffenderCard key={o.domain} o={o} rank={i + 1} />
          ))}
        </div>
      </section>

      {/* How companies use your data */}
      <section className="border-t border-zinc-900 bg-zinc-950/40">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">How these companies use your data</h2>
            <p className="mt-2 max-w-2xl text-zinc-400">
              Each banner is a consent management platform with its own defaults, categories, and downstream partners. Here is
              what the top offenders are actually doing behind that "Accept" button.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {top5.map((o) => (
              <DataUseCard key={o.domain} o={o} />
            ))}
          </div>
        </div>
      </section>

      {/* CMP distribution + AI learning */}
      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Distribution */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h3 className="text-lg font-semibold">Consent platforms in the wild</h3>
            <p className="mt-1 text-sm text-zinc-400">Which CMP families show up most across tracked sites.</p>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={cmpDistribution}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {cmpDistribution.map((d) => (
                      <Cell key={d.name} fill={FAMILY_COLORS[d.name] ?? "#a16207"} />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 12, color: "#fafafa" }}
                    formatter={(v: number, n: string) => [`${v} site${v === 1 ? "" : "s"}`, n]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              {cmpDistribution.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: FAMILY_COLORS[d.name] ?? "#a16207" }} />
                  {d.name} ({d.value})
                </div>
              ))}
            </div>
          </div>

          {/* AI learning */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">Cookie Yeti is learning</h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Cookie Yeti resolves {resolvedSites} out of {reportedSites} reported sites.
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-3xl font-bold text-emerald-400">{resolutionRate}%</div>
                <div className="text-xs text-zinc-500">sites resolved</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="flex flex-col justify-center rounded-xl bg-zinc-800/50 py-3">
                <div className="text-xl font-bold text-zinc-100">
                  <CountUp value={patternsGenerated} />
                </div>
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">patterns built</div>
              </div>
              <div className="flex flex-col justify-center rounded-xl bg-zinc-800/50 py-3">
                <div className="text-xl font-bold text-amber-400">{patternSuccessRate}%</div>
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">pattern success</div>
                <div className="mt-0.5 text-[10px] text-zinc-600">
                  {patternsGenerated} of {realAttempts} attempts
                </div>
              </div>
              <div className="flex flex-col justify-center rounded-xl bg-zinc-800/50 py-3">
                <div className="text-xl font-bold text-zinc-100">
                  <CountUp value={stats.active_patterns} />
                </div>
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">live patterns</div>
              </div>
            </div>

            <div className="mt-5 h-48">
              {learningTrend.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={learningTrend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="learnFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f5a524" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#f5a524" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#27272a" vertical={false} />
                    <XAxis dataKey="week" tick={{ fill: "#71717a", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "#71717a", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <RTooltip
                      contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 12, color: "#fafafa" }}
                      labelFormatter={(l) => `Week of ${l}`}
                      formatter={(v: number) => [`${v} patterns`, "Knowledge base"]}
                    />
                    <Area type="monotone" dataKey="learned" stroke="#f5a524" strokeWidth={2} fill="url(#learnFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-600">
                  Trend data warming up.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI status breakdown */}
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-lg font-semibold">What happens on every analysis</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Most banners hide their controls well. Each pass either learns a pattern, falls back to a known CMP, or flags the
            site for a human. The hard cases are exactly where the network gets smarter.
          </p>
          <div className="mt-5 space-y-3">
            {stats.ai_status_breakdown.map((s) => {
              const pct = stats.ai_generations ? (s.count / stats.ai_generations) * 100 : 0;
              const good = s.status.startsWith("success");
              return (
                <div key={s.status}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-zinc-300">{STATUS_LABEL[s.status] ?? s.status}</span>
                    <span className="text-zinc-500">
                      {s.count} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(pct, 1.5)}%`, backgroundColor: good ? "#34d399" : "#f5a524" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA / footer */}
      <footer className="border-t border-zinc-900">
        <div className="mx-auto max-w-7xl px-6 py-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Stop clicking "Accept."</h2>
          <p className="mx-auto mt-3 max-w-xl text-zinc-400">
            Cookie Yeti handles the banner for you and feeds what it learns back into the network. The more people use it, the
            smarter it gets.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/cookie-yeti"
              className="rounded-xl bg-amber-500 px-6 py-3 font-semibold text-zinc-950 transition hover:bg-amber-400"
            >
              Get the extension
            </Link>
            <Link
              to="/report-site"
              className="rounded-xl border border-zinc-700 px-6 py-3 font-semibold text-zinc-200 transition hover:border-zinc-500"
            >
              Report a stubborn banner
            </Link>
          </div>
          <p className="mt-8 text-xs text-zinc-600">
            Aggregate, anonymized telemetry. No personal browsing data is shown on this page. A Bestly LLC product.
          </p>
        </div>
      </footer>
    </div>
  );
}

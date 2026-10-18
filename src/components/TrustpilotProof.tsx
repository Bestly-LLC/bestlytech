/**
 * Trustpilot social proof for bestly.tech: one data hook, three placements.
 *
 *   <TrustpilotProof variant="section" />  homepage: header + up to 3 newest reviews + two links
 *   <TrustpilotProof variant="inline" />   one line under a hero (stars, "4.8 · 12 reviews on Trustpilot")
 *   <TrustpilotProof variant="footer" />   sitewide footer: logo + "4.8 · 12 reviews"
 *
 * Every variant renders NOTHING while loading, on an error, and at 0 reviews. There is no empty
 * state and no "be the first": the whole thing appears by itself when the first real review row
 * lands in trustpilot_reviews (the Pi reader fills it from Trustpilot's "new review" emails).
 * On an error it logs which call failed and still renders nothing. It never invents numbers.
 *
 * Trustpilot rules, so nobody "improves" this later:
 *   - Their logo and star images are used unaltered, straight from their brand-asset CDN.
 *   - We never draw our own stars next to their logo.
 *   - Our average is not their "TrustScore". Never write that word here.
 *   - Newest reviews, no filtering by star count (no cherry-picking). The RPC enforces it too.
 */
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Lines } from "@/components/Lines";

const PROFILE_URL = "https://www.trustpilot.com/review/bestly.tech";
const WRITE_URL = "https://bestly.tech/review";
const ASSETS = "https://cdn.trustpilot.net/brand-assets/4.1.0";
const LOGO_BLACK = `${ASSETS}/logo-black.svg`;
const LOGO_WHITE = `${ASSETS}/logo-white.svg`;
// Both official images are 1132.8 x 278.2 (logo) and 512 x 96 (stars).
const LOGO_RATIO = 1132.8 / 278.2;
const STARS_RATIO = 512 / 96;

interface TpReview {
  stars: number;
  title: string | null;
  snippet: string | null;
  reviewer_first_name: string | null;
  received_at: string;
}
interface TpSummary {
  avg_rating: number;
  review_count: number;
  last_review_at: string | null;
  reviews: TpReview[];
}

const RPC = "get_trustpilot_public_summary";

/** Dev-only preview hook so the design can be checked with mock data. Never set in production. */
declare global {
  interface Window {
    __TP_MOCK__?: unknown;
  }
}

function readMock(): unknown {
  if (!import.meta.env.DEV) return undefined;
  return typeof window !== "undefined" ? window.__TP_MOCK__ : undefined;
}

function parse(raw: unknown): TpSummary | null {
  if (!raw || typeof raw !== "object") throw new Error("answer was not an object");
  const o = raw as Record<string, unknown>;
  const count = Number(o.review_count);
  if (!Number.isFinite(count)) throw new Error("review_count was not a number");
  if (count <= 0) return null;
  const avg = Number(o.avg_rating);
  if (!Number.isFinite(avg) || avg < 1 || avg > 5) throw new Error("avg_rating was missing while reviews exist");
  const reviews = (Array.isArray(o.reviews) ? o.reviews : [])
    .filter((r): r is TpReview => !!r && typeof r === "object" && Number.isFinite(Number((r as TpReview).stars)))
    .map((r) => ({ ...r, stars: Math.min(5, Math.max(1, Math.round(Number(r.stars)))) }));
  return { avg_rating: avg, review_count: Math.round(count), last_review_at: (o.last_review_at as string) ?? null, reviews };
}

async function fetchSummary(): Promise<TpSummary | null> {
  const mock = readMock();
  if (mock !== undefined) return parse(mock);
  try {
    const { data, error } = await supabase.rpc(RPC as never);
    if (error) throw new Error(error.message);
    return parse(data);
  } catch (e) {
    console.error(`${RPC} failed, so the Trustpilot proof is hidden:`, e);
    throw e;
  }
}

function useTrustpilot(): TpSummary | null {
  const { data } = useQuery({
    queryKey: ["trustpilot-public-summary"],
    queryFn: fetchSummary,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  return data ?? null;
}

/** Official star image: the average rounded DOWN to the nearest half star. */
const starsSrc = (n: number) => `${ASSETS}/stars/stars-${(Math.floor(n * 2) / 2).toString()}.svg`;
const starsLabel = (n: number) => `Rated ${n} out of 5 stars`;

const nowrap = (text: string) => <span className="whitespace-nowrap">{text}</span>;
const countLabel = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "review" : "reviews"}`;
const avgLabel = (n: number) => n.toFixed(1);

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Stars({ value, height, label }: { value: number; height: number; label?: string }) {
  return (
    <img
      src={starsSrc(value)}
      alt={label ?? starsLabel(Math.floor(value * 2) / 2)}
      width={Math.round(height * STARS_RATIO)}
      height={height}
      loading="lazy"
      decoding="async"
      style={{ height, width: "auto" }}
    />
  );
}

/** Short fade on mount only; none under prefers-reduced-motion. */
function Fade({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.35, ease: [0.32, 0.72, 0, 1] }}
    >
      {children}
    </motion.div>
  );
}

const LINK_PROPS = { target: "_blank", rel: "noopener noreferrer" } as const;

/* ------------------------------------------------------------------ section */

function ReviewCard({ r }: { r: TpReview }) {
  const date = formatDate(r.received_at);
  return (
    <article
      className="flex h-full flex-col rounded-2xl border border-[rgba(15,33,51,0.08)] bg-white p-6 text-left shadow-[0_1px_2px_rgba(15,33,51,0.04),0_18px_44px_-20px_rgba(15,33,51,0.16)]"
    >
      <div className="self-start">
        <Stars value={r.stars} height={22} label={starsLabel(r.stars)} />
      </div>
      {r.title ? (
        <h3 className="mt-4 text-lg font-semibold leading-snug tracking-[-0.01em] text-[rgb(15,33,51)]">{r.title}</h3>
      ) : null}
      {r.snippet ? (
        <p className="mt-2 text-[0.95rem] leading-relaxed text-[rgba(15,33,51,0.78)]">
          <Lines>{r.snippet}</Lines>
        </p>
      ) : null}
      <p className="mt-auto pt-5 text-sm text-[rgba(15,33,51,0.62)]">
        {r.reviewer_first_name ? <span className="font-medium text-[rgb(15,33,51)]">{r.reviewer_first_name}</span> : null}
        {r.reviewer_first_name && date ? <span aria-hidden="true">{" · "}</span> : null}
        {date ? nowrap(date) : null}
      </p>
    </article>
  );
}

function Section({ s }: { s: TpSummary }) {
  const shown = s.reviews.slice(0, 3);
  return (
    <section
      aria-label="Customer reviews on Trustpilot"
      className="relative overflow-hidden bg-[hsl(36_41%_97%)] text-[rgb(15,33,51)]"
    >
      {/* feathered periwinkle glow: soft on every side, no edge */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[28rem] w-[60rem] max-w-none -translate-x-1/2 -translate-y-1/3 bg-[radial-gradient(closest-side,rgba(76,95,201,0.10),rgba(76,95,201,0.04)_55%,transparent)]"
      />
      <Fade className="relative mx-auto max-w-5xl px-6 py-20 text-center lg:px-8 lg:py-24">
        <a
          href={PROFILE_URL}
          {...LINK_PROPS}
          aria-label={`${avgLabel(s.avg_rating)} out of 5 from ${countLabel(s.review_count)} on Trustpilot. Open our Trustpilot page.`}
          className="group mx-auto inline-flex min-h-[44px] flex-col items-center gap-3 rounded-2xl px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(76,95,201)] focus-visible:ring-offset-2"
        >
          <img
            src={LOGO_BLACK}
            alt="Trustpilot"
            width={Math.round(28 * LOGO_RATIO)}
            height={28}
            loading="lazy"
            decoding="async"
            style={{ height: 28, width: "auto" }}
          />
          <Stars value={s.avg_rating} height={34} />
          <span className="text-base text-[rgba(15,33,51,0.78)]">
            <span className="font-semibold text-[rgb(15,33,51)]">{nowrap(`${avgLabel(s.avg_rating)} out of 5`)}</span>
            <span aria-hidden="true">{" · "}</span>
            {nowrap(countLabel(s.review_count))}
          </span>
        </a>

        <h2 className="mx-auto mt-8 max-w-2xl font-display text-[clamp(1.75rem,3.6vw,2.75rem)] font-normal leading-[1.08] tracking-[-0.025em]">
          <Lines>What people say about us. We can&rsquo;t edit these reviews.</Lines>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[rgba(15,33,51,0.68)]">
          <Lines>Trustpilot is a separate, independent review site. These are the newest reviews, shown as they were posted.</Lines>
        </p>

        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {shown.map((r, i) => (
            <ReviewCard key={`${r.received_at}-${i}`} r={r} />
          ))}
        </div>

        <div className="mt-12 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <a
            href={PROFILE_URL}
            {...LINK_PROPS}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[rgba(15,33,51,0.16)] bg-white px-6 py-3 text-base font-medium text-[rgb(15,33,51)] shadow-[0_1px_2px_rgba(15,33,51,0.04)] transition-[background-color,box-shadow] duration-200 hover:bg-[rgba(15,33,51,0.03)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(76,95,201)] focus-visible:ring-offset-2"
          >
            Read all reviews on Trustpilot
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
          <a
            href={WRITE_URL}
            {...LINK_PROPS}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[rgb(76,95,201)] px-6 py-3 text-base font-medium text-white shadow-[0_10px_28px_-12px_rgba(76,95,201,0.7)] transition-[background-color,transform] duration-200 hover:bg-[rgb(66,85,190)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(76,95,201)] focus-visible:ring-offset-2"
          >
            Write a review
          </a>
        </div>
      </Fade>
    </section>
  );
}

/* ------------------------------------------------------------------- inline */

function Inline({ s, className }: { s: TpSummary; className?: string }) {
  return (
    <Fade className={className ?? "flex justify-center px-6 py-3"}>
      <a
        href={PROFILE_URL}
        {...LINK_PROPS}
        className="inline-flex min-h-[44px] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <Stars value={s.avg_rating} height={20} />
        <span>
          <span className="font-semibold text-foreground">{nowrap(avgLabel(s.avg_rating))}</span>
          <span aria-hidden="true">{" · "}</span>
          {nowrap(`${countLabel(s.review_count)} on Trustpilot`)}
        </span>
      </a>
    </Fade>
  );
}

/* ------------------------------------------------------------------- footer */

function FooterMark({ s }: { s: TpSummary }) {
  const h = 20;
  const w = Math.round(h * LOGO_RATIO);
  return (
    <a
      href={PROFILE_URL}
      {...LINK_PROPS}
      aria-label={`${avgLabel(s.avg_rating)} from ${countLabel(s.review_count)} on Trustpilot`}
      className="inline-flex min-h-[44px] items-center gap-3 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      {/* Official logo, light and dark variants, unaltered. The site toggles dark with a class. */}
      <img src={LOGO_BLACK} alt="Trustpilot" width={w} height={h} loading="lazy" decoding="async" style={{ height: h, width: "auto" }} className="dark:hidden" />
      <img src={LOGO_WHITE} alt="Trustpilot" width={w} height={h} loading="lazy" decoding="async" style={{ height: h, width: "auto" }} className="hidden dark:block" />
      <span>
        <span className="font-semibold text-foreground">{nowrap(avgLabel(s.avg_rating))}</span>
        <span aria-hidden="true">{" · "}</span>
        {nowrap(countLabel(s.review_count))}
      </span>
    </a>
  );
}

/* ------------------------------------------------------------------- export */

export function TrustpilotProof({
  variant,
  className,
}: {
  variant: "section" | "inline" | "footer";
  /** Inline only: replaces the default wrapper spacing. Applied only when something renders. */
  className?: string;
}) {
  const s = useTrustpilot();
  if (!s) return null;
  if (variant === "section") return <Section s={s} />;
  if (variant === "inline") return <Inline s={s} className={className} />;
  return <FooterMark s={s} />;
}

export default TrustpilotProof;

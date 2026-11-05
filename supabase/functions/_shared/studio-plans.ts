// studio-plans — the only place Studio's prices and plan words live.
//
// Two tiers. No ladder, no add-on maze, no "contact us" in the middle of a
// signup. If a number needs to change, it changes HERE and every surface that
// shows a price reads it from the plans action of the studio-start function:
// the /start wizard, the /real-estate landing page, the board's Settings.
//
// Prices are in cents. Stripe wants cents; the browser wants dollars. Both are
// derived from these numbers so they can never disagree.
//
// Jared's locked decisions, 2026-10-20:
//   Carousels $29/mo, Premium $79/mo, 4 videos a month on Premium,
//   $15 for an extra video, annual is two months free, 7-day trial,
//   done-for-you stays sales-led and is never sold inside the wizard.

export type PlanId = "carousels" | "premium";
export type Cadence = "monthly" | "annual";

export type Plan = {
  id: PlanId;
  name: string;
  /** One line a person who has never heard of us understands. */
  tagline: string;
  /** What they actually get, in their words, in the order they care about. */
  gets: string[];
  /** What they do not get. Said out loud, so nobody feels tricked later. */
  not_included: string[];
  monthly_cents: number;
  annual_cents: number;
  videos_per_month: number;
  /** Whether the extra-video button appears for this plan. */
  extra_videos: boolean;
};

const CAROUSELS_CENTS = 2900;
const PREMIUM_CENTS = 7900;
const EXTRA_VIDEO_CENTS = 1500;

export const TRIAL_DAYS = 7;

export const PLANS: Record<PlanId, Plan> = {
  carousels: {
    id: "carousels",
    name: "Carousels",
    tagline: "We turn your listing photos into posts and publish them for you.",
    gets: [
      "A post for every new listing, just-sold and open house",
      "Neighborhood and market posts, the ones your neighbors actually read",
      "We post it to your accounts at the times that work, and repost around open house day",
      "Send us the photos by email. That is the whole job on your end.",
    ],
    not_included: ["No video"],
    monthly_cents: CAROUSELS_CENTS,
    annual_cents: CAROUSELS_CENTS * 10,
    videos_per_month: 0,
    extra_videos: false,
  },
  premium: {
    id: "premium",
    name: "Premium",
    tagline: "Everything in Carousels, plus four videos a month.",
    gets: [
      "Everything in Carousels",
      "Four videos a month: listing walk-throughs with music and a voiceover",
      "An agent-avatar video, so your face is in the feed without you filming",
      "Unused videos roll over for one month",
      "Need a fifth? Buy one for $15 in the app.",
    ],
    not_included: [],
    monthly_cents: PREMIUM_CENTS,
    annual_cents: PREMIUM_CENTS * 10,
    videos_per_month: 4,
    extra_videos: true,
  },
};

/** What a person reads before they read any price. */
export const ONE_LINE = "You send us the photos from a listing. We write the post, make it look good, and publish it for you.";

/** The escape hatch for the $500/mo done-for-you model. Never a checkout. */
export const DFY = {
  price_cents: 50000,
  line: "Want us to run the whole thing for you? Talk to us.",
  href: "https://bestly.tech/studio-call",
};

/** Price in dollars, for display. 29 -> "$29", 290 -> "$290". */
export function dollars(cents: number): string {
  return "$" + (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
}

/** The line under a plan's price: "$29 a month" / "$290 a year, two months free". */
export function priceLine(plan: Plan, cadence: Cadence): string {
  if (cadence === "monthly") return `${dollars(plan.monthly_cents)} a month`;
  const free = Math.round((plan.monthly_cents * 12 - plan.annual_cents) / plan.monthly_cents);
  return `${dollars(plan.annual_cents)} a year, ${free} months free`;
}

/** Everything a browser needs to draw a plan card, with no logic of its own. */
export function planCards(cadence: Cadence = "monthly") {
  return Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    gets: p.gets,
    not_included: p.not_included,
    price: dollars(cadence === "monthly" ? p.monthly_cents : p.annual_cents),
    when: cadence === "monthly" ? "a month" : "a year",
    price_line: priceLine(p, cadence),
    videos_per_month: p.videos_per_month,
    extra_videos: p.extra_videos,
  }));
}

export function planPayload() {
  return {
    one_line: ONE_LINE,
    trial_days: TRIAL_DAYS,
    monthly: planCards("monthly"),
    annual: planCards("annual"),
    extra_video: { cents: EXTRA_VIDEO_CENTS, price: dollars(EXTRA_VIDEO_CENTS), premium_only: true },
    dfy: DFY,
  };
}

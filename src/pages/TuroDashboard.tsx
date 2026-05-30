import { SEOHead } from "@/components/SEOHead";
import { Car, Star, Activity, DollarSign, ExternalLink, Infinity as InfinityIcon } from "lucide-react";

/**
 * Public Turo fleet dashboard — bestly.tech/turo/dashboard.
 *
 * No login. Jared checks this on his phone to glance at the two Teslas on Turo.
 * Self-contained dark theme (the marketing site defaults to light) using
 * explicit zinc/emerald values rather than depending on a `dark` class.
 *
 * Data is hand-maintained here — Turo has no public fleet API, so the numbers
 * are updated by editing this file. Mobile-first: stacks to one column on
 * phones, two cards side-by-side on wider screens.
 */

interface Extra {
  name: string;
  price: string;
}

interface Vehicle {
  name: string;
  plate: string;
  model: string;
  year: number;
  trips: number;
  rating: number;
  dailyRate: number;
  threeDayTakeHome: number;
  status: "On trip" | "Listed";
  statusDetail: string;
  listingId: string;
  listingUrl: string;
}

const EXTRAS: Extra[] = [
  { name: "Phone mount", price: "$15" },
  { name: "Cooler", price: "$50" },
  { name: "Fresh flowers", price: "$65" },
  { name: "One-way trip", price: "$200" },
  { name: "Beach wagon", price: "$40" },
  { name: "Portable speaker", price: "$25" },
  { name: "Pet fee", price: "$10/day" },
  { name: "Prepaid EV recharge", price: "$25" },
];

const VEHICLES: Vehicle[] = [
  {
    name: "Blue Steel",
    plate: "8Z0G117",
    model: "Tesla Model 3",
    year: 2020,
    trips: 80,
    rating: 4.95,
    dailyRate: 77,
    threeDayTakeHome: 175,
    status: "On trip",
    statusDetail: "May 17 – Jun 13",
    listingId: "2522178",
    listingUrl:
      "https://turo.com/us/en/suv-rental/united-states/los-angeles-ca/tesla-model-3/2522178",
  },
  {
    name: "NOMAD",
    plate: "9SRD426",
    model: "Tesla Model Y",
    year: 2021,
    trips: 8,
    rating: 4.86,
    dailyRate: 78,
    threeDayTakeHome: 163,
    status: "Listed",
    statusDetail: "Available now",
    listingId: "3494788",
    listingUrl:
      "https://turo.com/us/en/suv-rental/united-states/los-angeles-ca/tesla-model-y/3494788",
  },
];

const SUMMARY = {
  totalTrips: 88,
  avgRating: 4.98,
  activeVehicles: 2,
  monthlyRevenue: "~$2,600",
};

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
      <div className="mb-2 flex items-center gap-2 text-zinc-400">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white sm:text-3xl">{value}</div>
    </div>
  );
}

function StatusBadge({ status, detail }: { status: Vehicle["status"]; detail: string }) {
  const onTrip = status === "On trip";
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
          onTrip
            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
            : "bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${onTrip ? "bg-emerald-400" : "bg-sky-400"}`}
        />
        {status}
      </span>
      <span className="text-xs text-zinc-500">{detail}</span>
    </div>
  );
}

function VehicleCard({ v }: { v: Vehicle }) {
  return (
    <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-white sm:text-2xl">{v.name}</h3>
            <span className="rounded-md bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-400">
              {v.plate}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-zinc-400">
            {v.year} {v.model}
          </p>
        </div>
        <Car className="h-6 w-6 shrink-0 text-emerald-400" />
      </div>

      <div className="mt-4">
        <StatusBadge status={v.status} detail={v.statusDetail} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-zinc-800/50 p-3">
          <div className="text-xs text-zinc-500">Trips</div>
          <div className="text-lg font-semibold text-white">{v.trips}</div>
        </div>
        <div className="rounded-xl bg-zinc-800/50 p-3">
          <div className="text-xs text-zinc-500">Rating</div>
          <div className="flex items-center gap-1 text-lg font-semibold text-white">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            {v.rating.toFixed(2)}
          </div>
        </div>
        <div className="rounded-xl bg-zinc-800/50 p-3">
          <div className="text-xs text-zinc-500">Daily rate</div>
          <div className="text-lg font-semibold text-white">${v.dailyRate}</div>
        </div>
        <div className="rounded-xl bg-zinc-800/50 p-3">
          <div className="text-xs text-zinc-500">3-day take-home</div>
          <div className="text-lg font-semibold text-white">
            ${v.threeDayTakeHome}
            <span className="ml-1 text-xs font-normal text-emerald-400">10% off</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-1.5 text-sm text-zinc-400">
        <InfinityIcon className="h-4 w-4 text-emerald-400" />
        Unlimited miles
      </div>

      <a
        href={v.listingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400"
      >
        View on Turo
        <ExternalLink className="h-4 w-4" />
      </a>
      <span className="mt-2 text-center font-mono text-xs text-zinc-600">
        Listing #{v.listingId}
      </span>
    </div>
  );
}

export default function TuroDashboard() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SEOHead
        title="Turo Fleet Dashboard"
        description="Live status of the Bestly Tesla fleet on Turo — trips, ratings, rates, and availability."
        path="/turo/dashboard"
      />

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="mb-8">
          <div className="flex items-center gap-2 text-emerald-400">
            <Car className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">
              Turo Fleet
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Tesla Fleet Dashboard
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Two electric Teslas, unlimited miles, Los Angeles.
          </p>
        </header>

        <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            icon={<Activity className="h-4 w-4" />}
            label="Total trips"
            value={String(SUMMARY.totalTrips)}
          />
          <MetricCard
            icon={<Star className="h-4 w-4" />}
            label="Avg rating"
            value={SUMMARY.avgRating.toFixed(2)}
          />
          <MetricCard
            icon={<Car className="h-4 w-4" />}
            label="Active vehicles"
            value={String(SUMMARY.activeVehicles)}
          />
          <MetricCard
            icon={<DollarSign className="h-4 w-4" />}
            label="Est. monthly"
            value={SUMMARY.monthlyRevenue}
          />
        </section>

        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {VEHICLES.map((v) => (
            <VehicleCard key={v.listingId} v={v} />
          ))}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6">
          <h2 className="text-lg font-bold text-white">Available extras</h2>
          <p className="mt-0.5 text-sm text-zinc-400">Offered on both vehicles.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EXTRAS.map((extra) => (
              <div
                key={extra.name}
                className="rounded-xl bg-zinc-800/50 p-3 text-center"
              >
                <div className="text-sm font-medium text-white">{extra.name}</div>
                <div className="mt-0.5 text-sm font-semibold text-emerald-400">
                  {extra.price}
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-8 text-center text-xs text-zinc-600">
          Bestly LLC · Numbers updated manually · Tap a card to open the live Turo
          listing
        </footer>
      </div>
    </div>
  );
}

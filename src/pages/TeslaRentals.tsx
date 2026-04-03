import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { GradientText } from "@/components/ui/GradientText";
import { GlowCard } from "@/components/ui/GlowCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { ArrowRight, Star, ExternalLink } from "lucide-react";
import teslaModel3 from "@/assets/tesla-model-y.avif";
import teslaModelY from "@/assets/tesla-model-3.avif";

const TURO_HOST_URL = "https://turo.com/us/en/host/2907746";

const vehicles = [
  {
    name: "Tesla Model 3",
    year: "2020",
    trim: "Standard Range Plus",
    range: "Unlimited Miles",
    seats: "5 seats",
    rating: "4.94",
    trips: "66 trips",
    image: teslaModel3,
  },
  {
    name: "Tesla Model Y",
    year: "2021",
    trim: "Long Range",
    range: "Unlimited Miles",
    seats: "5 seats",
    rating: "4.67",
    trips: null,
    image: teslaModelY,
  },
];

const stats = [
  { value: 68, label: "Trips Completed", suffix: "+" },
  { value: 4.9, label: "Star Rating", suffix: "", decimals: 1 },
  { value: 9, label: "Years Hosting", suffix: "" },
];

export default function TeslaRentals() {
  return (
    <>
      <SEOHead
        title="Rent a Tesla in Los Angeles | Bestly"
        description="Explore LA in a premium electric vehicle — Tesla Model 3 and Model Y available for daily, weekly, or monthly rental on Turo."
        path="/tesla-rentals"
      />

      {/* Hero */}
      <section className="relative overflow-hidden min-h-[60vh] flex items-center">
        <div className="absolute inset-0 bg-mesh" />
        <div className="absolute inset-0 bg-grid opacity-50" />
        <div className="absolute top-1/3 -left-32 w-96 h-96 bg-gradient-to-r from-[hsl(var(--gradient-start)/0.2)] to-[hsl(var(--gradient-end)/0.1)] rounded-full blur-3xl animate-float-slow" />
        <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-gradient-to-l from-[hsl(var(--gradient-end)/0.15)] to-[hsl(var(--gradient-start)/0.1)] rounded-full blur-3xl animate-float-slow" style={{ animationDelay: "-3s" }} />

        <div className="relative mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-36">
          <AnimatedSection className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-6">
              Turo Superhost · Los Angeles
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl leading-[1.1]">
              Rent a Tesla in{" "}
              <GradientText className="font-semibold">Los Angeles</GradientText>
            </h1>
            <p className="mt-8 text-lg sm:text-xl leading-relaxed text-muted-foreground max-w-2xl mx-auto">
              Explore LA in a premium electric vehicle — available for daily, weekly, or monthly rental on Turo.
            </p>
            <div className="mt-10">
              <a
                href={TURO_HOST_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5"
              >
                View All Vehicles on Turo
                <ExternalLink className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </a>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Vehicle Cards */}
      <section className="relative border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="mx-auto max-w-2xl text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Available Vehicles
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Premium electric vehicles, maintained to the highest standard.
            </p>
          </AnimatedSection>

          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 md:grid-cols-2">
            {vehicles.map((vehicle, index) => (
              <AnimatedSection key={vehicle.name} delay={index * 120}>
                <GlowCard className="h-full flex flex-col">
                  {/* Vehicle Photo */}
                  <div className="relative w-full aspect-[16/10] rounded-xl border border-border/50 mb-6 overflow-hidden">
                    <img
                      src={vehicle.image}
                      alt={`${vehicle.year} ${vehicle.name}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute bottom-3 right-3 bg-background/80 backdrop-blur-sm px-3 py-1 rounded-full border border-border/50">
                      <span className="text-xs font-medium text-muted-foreground">{vehicle.year}</span>
                    </div>
                  </div>

                  <h3 className="text-xl font-semibold text-foreground">
                    {vehicle.name}{" "}
                    <span className="text-muted-foreground font-normal">({vehicle.year})</span>
                  </h3>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {[vehicle.trim, vehicle.range, vehicle.seats].map((detail) => (
                      <span
                        key={detail}
                        className="text-xs font-medium text-primary bg-primary/10 px-3 py-1.5 rounded-full"
                      >
                        {detail}
                      </span>
                    ))}
                  </div>

                  {/* Rating */}
                  <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                    <span className="font-medium text-foreground">{vehicle.rating}</span>
                    {vehicle.trips && (
                      <>
                        <span className="text-border">·</span>
                        <span>{vehicle.trips}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-auto pt-6">
                    <a
                      href={TURO_HOST_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex w-full items-center justify-center rounded-xl border border-border bg-background/80 backdrop-blur-sm px-6 py-3 text-sm font-medium text-foreground shadow-sm transition-all hover:bg-accent hover:border-border/80"
                    >
                      Book on Turo
                      <ExternalLink className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </a>
                  </div>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="relative border-t border-border bg-secondary/30">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {stats.map((stat, index) => (
              <AnimatedSection key={stat.label} delay={index * 100} className="text-center">
                <div className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-foreground">
                  <AnimatedCounter end={stat.value} suffix={stat.suffix} />
                </div>
                <div className="mt-2 text-sm sm:text-base text-muted-foreground font-medium">
                  {stat.label}
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="relative border-t border-border">
        <div className="absolute inset-0 bg-mesh opacity-50" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Ready to Hit the Road?
            </h2>
            <p className="mt-6 text-lg text-muted-foreground">
              Browse all available vehicles and book your Tesla today.
            </p>
            <div className="mt-10">
              <a
                href={TURO_HOST_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5"
              >
                View All Vehicles on Turo
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </a>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </>
  );
}

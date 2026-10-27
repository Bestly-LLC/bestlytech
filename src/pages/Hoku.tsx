import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { WaitlistForm } from "@/components/WaitlistForm";
import { Button } from "@/components/ui/button";
import {
  Droplets,
  Leaf,
  Shield,
  Sparkles,
  FlaskConical,
  Package,
  Heart,
  CheckCircle,
  ExternalLink,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import hokuBottle from "@/assets/hoku-bottle.png";
import hokuLifestyle from "@/assets/hoku-lifestyle.jpg";
import hokuVacuum from "@/assets/hoku-vacuum.png";

const benefits = [
  {
    icon: Leaf,
    title: "Naturally Gentle",
    description: "Hypochlorous acid is the same thing your white blood cells make to keep you clean.",
  },
  {
    icon: Shield,
    title: "Three Simple Ingredients",
    description: "Water, salt, and electricity. No alcohol, no fragrance, no oils, no preservatives.",
  },
  {
    icon: Package,
    title: "Sealed Can, No Pump",
    description: "The liquid sits in a sealed bag inside the can, so air never reaches it. The last spray is the same as the first.",
  },
  {
    icon: Heart,
    title: "Gentle on Sensitive Skin",
    description: "No alcohol, no fragrance, no oils. Nothing that stings.",
  },
];

const ingredients = [
  { icon: Droplets, name: "Water", desc: "Pure H₂O foundation" },
  { icon: Sparkles, name: "Salt", desc: "Natural NaCl compound" },
  { icon: Zap, name: "Electricity", desc: "Electrolysis process" },
];

const Hoku = () => {
  return (
    <>
      <SEOHead
        title="HOKU - Hypochlorous Acid Face Spray (Coming Soon) | Bestly LLC"
        description="HOKU is a face spray made from water, salt, and electricity. It cleanses and refreshes skin. Not yet for sale. Join the waitlist."
      />

      {/* Hero — warm golden gradient matching hoku-clean.com */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(135deg, hsl(40 40% 95%), hsl(35 50% 90%), hsl(30 30% 96%))",
          }}
        />
        <div className="absolute inset-0 bg-grid opacity-20" />

        <div className="relative mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <AnimatedSection animation="fade-in-up">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ring-1"
                style={{ color: "hsl(35 60% 40%)", borderColor: "hsl(35 40% 75%)", backgroundColor: "hsl(40 50% 95%)" }}>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: "hsl(35 60% 50%)" }} />
                  <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: "hsl(35 60% 50%)" }} />
                </span>
                Coming soon · Not yet available to purchase
              </div>

              <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl" style={{ color: "hsl(35 50% 30%)" }}>
                HYPOCHLOROUS
                <br />
                ACID
              </h1>
              <p className="mt-4 text-xl font-medium tracking-[0.2em] uppercase" style={{ color: "hsl(35 40% 50%)" }}>
                Optimized to Keep You Clean
              </p>

              <p className="mt-6 text-lg leading-relaxed text-muted-foreground max-w-lg">
                A face spray that cleanses and refreshes. Just water, salt, and electricity. Gentle on sensitive skin. Not on sale yet.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild
                  className="text-white border-0"
                  style={{ backgroundColor: "hsl(35 50% 45%)" }}>
                  <a href="https://hoku-clean.com" target="_blank" rel="noopener noreferrer">
                    Join the Waitlist
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
                <Button variant="outline" size="lg" asChild
                  style={{ borderColor: "hsl(35 40% 70%)", color: "hsl(35 50% 35%)" }}>
                  <a href="#science">Learn the Science</a>
                </Button>
              </div>
            </AnimatedSection>

            <AnimatedSection animation="fade-in" delay={200} className="flex justify-center">
              <img
                src={hokuBottle}
                alt="HOKU Premium Face & Skin Refresh bottle"
                className="max-h-[500px] w-auto drop-shadow-2xl"
                loading="lazy"
              />
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Metrics */}
      <section className="border-t border-border" style={{ backgroundColor: "hsl(35 30% 96%)" }}>
        <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
          <div className="grid grid-cols-3 gap-8 text-center">
            {[
              { value: "3", label: "Simple Ingredients" },
              { value: "200+", label: "Sprays Per Can" },
              { value: "0", label: "Harsh Chemicals" },
            ].map((m) => (
              <AnimatedSection key={m.label}>
                <div className="text-3xl sm:text-4xl font-semibold" style={{ color: "hsl(35 50% 35%)" }}>{m.value}</div>
                <div className="mt-1 text-sm text-muted-foreground">{m.label}</div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Made with 3 Ingredients */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Made with 3 Ingredients
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">Pure and simple</p>
          </AnimatedSection>

          <div className="grid gap-8 sm:grid-cols-3 max-w-3xl mx-auto mb-12">
            {ingredients.map((ing, i) => (
              <AnimatedSection key={ing.name} delay={i * 100}>
                <div className="text-center p-6 rounded-2xl border border-border bg-card transition-all hover:shadow-lg">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
                    style={{ backgroundColor: "hsl(35 50% 92%)" }}>
                    <ing.icon className="h-7 w-7" style={{ color: "hsl(35 50% 45%)" }} />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{ing.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{ing.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>

          <AnimatedSection className="text-center">
            <p className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium border border-border bg-card">
              Water + Salt + Electricity = <strong style={{ color: "hsl(35 50% 35%)" }}>Hypochlorous Acid (HOCl)</strong>
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* What Makes HOKU Different */}
      <section className="border-t border-border" style={{ backgroundColor: "hsl(35 30% 96%)" }}>
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <AnimatedSection>
              <img
                src={hokuLifestyle}
                alt="HOKU lifestyle product shot"
                className="rounded-2xl shadow-premium-lg w-full object-cover max-h-[500px]"
                loading="lazy"
              />
            </AnimatedSection>

            <div>
              <AnimatedSection>
                <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl mb-10">
                  What Makes HOKU Different
                </h2>
              </AnimatedSection>

              <div className="space-y-6">
                {benefits.map((b, i) => (
                  <AnimatedSection key={b.title} delay={i * 80}>
                    <div className="flex gap-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: "hsl(35 50% 92%)" }}>
                        <b.icon className="h-5 w-5" style={{ color: "hsl(35 50% 45%)" }} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{b.title}</h3>
                        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{b.description}</p>
                      </div>
                    </div>
                  </AnimatedSection>
                ))}
              </div>

              <AnimatedSection delay={400}>
                <div className="mt-8 p-5 rounded-xl border border-border bg-card">
                  <p className="text-sm font-medium text-foreground mb-1">Why it comes in a can:</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Hypochlorous acid breaks down when it meets air, and a pump bottle pulls air in every time you press it. HOKU's can never lets air back in, so spray two hundred works like spray one.
                  </p>
                </div>
              </AnimatedSection>
            </div>
          </div>
        </div>
      </section>

      {/* The Science */}
      <section id="science" className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <AnimatedSection>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                The Science of HOCl
              </h2>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
                Hypochlorous acid is produced by your own white blood cells. HOKU makes it by running an electric current through salt water. It is manufactured as a cosmetic under FDA regulations for Bestly LLC.
              </p>
              <div className="mt-8">
                <Button variant="outline" size="lg" asChild
                  style={{ borderColor: "hsl(35 40% 70%)", color: "hsl(35 50% 35%)" }}>
                  <a href="https://hoku-clean.com/science" target="_blank" rel="noopener noreferrer">
                    Learn More About the Science
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={100}>
              <img
                src={hokuVacuum}
                alt="HOKU sealed can technology comparison"
                className="rounded-2xl shadow-premium w-full"
                loading="lazy"
              />
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Simple Daily Ritual */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Simple Daily Ritual
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              Mist HOKU onto clean skin from six to eight inches away, morning
              and night. No rinsing. Layer anything you like on top, or nothing
              at all.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border" style={{ backgroundColor: "hsl(35 30% 96%)" }}>
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Be First When HOKU Launches
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              HOKU is not on sale yet. Leave your email and we will tell you the day it goes on sale.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" asChild
                className="text-white border-0"
                style={{ backgroundColor: "hsl(35 50% 45%)" }}>
                <a href="https://hoku-clean.com" target="_blank" rel="noopener noreferrer">
                  Visit hoku-clean.com
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </div>
            <WaitlistForm
              productId="hoku"
              productName="HOKU"
              className="mt-8"
              buttonText="Notify Me at Launch"
            />
            <div className="mt-6">
              <Button variant="outline" size="lg" asChild>
                <Link to="/products">View All Products</Link>
              </Button>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Legal Notice */}
      <section className="py-12 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm text-muted-foreground">
              HOKU is a product of Bestly LLC. HOKU is a cosmetic. It is not
              intended to diagnose, treat, cure, or prevent any disease.
              Customer reviews will appear here once they are collected and
              verifiable. All products are
              subject to our{" "}
              <Link to="/terms-of-service" className="underline hover:text-foreground">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy-policy" className="underline hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </>
  );
};

export default Hoku;

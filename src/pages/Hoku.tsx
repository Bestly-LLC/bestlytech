import { SEOHead } from "@/components/SEOHead";
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
  Star,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import hokuBottle from "@/assets/hoku-bottle.png";
import hokuLifestyle from "@/assets/hoku-lifestyle.jpg";
import hokuVacuum from "@/assets/hoku-vacuum.png";

const testimonials = [
  { text: "HOKU has transformed my skincare routine. Clean, effective, and gentle!", name: "Sarah M." },
  { text: "Finally, a science-backed solution that actually works. No more harsh chemicals.", name: "David L." },
  { text: "The vacuum-sealed spray is genius. Every spray feels fresh and potent.", name: "Emma R." },
  { text: "I've tried many products but HOKU is different. My skin has never felt better.", name: "Michael K." },
];

const benefits = [
  {
    icon: Leaf,
    title: "Naturally Gentle",
    description: "HOCl is the same molecule naturally produced by your white blood cells to protect and heal.",
  },
  {
    icon: Shield,
    title: "Pharmaceutical-Grade",
    description: "Advanced electrolysis manufacturing ensures consistent purity and potency in every bottle.",
  },
  {
    icon: Package,
    title: "Vacuum-Sealed",
    description: "Proprietary packaging preserves freshness and extends shelf life without preservatives.",
  },
  {
    icon: Heart,
    title: "For All Skin Types",
    description: "Gentle enough for sensitive skin, effective enough for daily use without irritation.",
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
        title="HOKU - Premium Hypochlorous Acid Skincare | Bestly LLC"
        description="HOKU delivers pharmaceutical-grade hypochlorous acid skincare using advanced electrolysis manufacturing. Gentle, effective skincare inspired by nature."
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
                Coming Soon
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
                A skin-refreshing spray that helps cleanse away environmental debris. Known for being gentle and well-tolerated on sensitive skin.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Button size="lg" asChild
                  className="text-white border-0"
                  style={{ backgroundColor: "hsl(35 50% 45%)" }}>
                  <a href="https://hoku-clean.com/shop" target="_blank" rel="noopener noreferrer">
                    Shop the Collection
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
              { value: "100%", label: "Vacuum-Sealed" },
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
            <p className="mt-4 text-lg text-muted-foreground">Pure, simple, effective</p>
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
                  <p className="text-sm font-medium text-foreground mb-1">What competitors won't tell you:</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Most HOCl sprays lose potency with every pump. HOKU's vacuum-sealed technology ensures every spray delivers uncompromised HOCl — pure, charged, and protected.
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
                Hypochlorous acid is naturally produced by white blood cells. It's a gentle cleansing ingredient often used in dermatology for its mild, soothing properties.
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
                alt="HOKU vacuum-sealed technology comparison"
                className="rounded-2xl shadow-premium w-full"
                loading="lazy"
              />
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-t border-border" style={{ backgroundColor: "hsl(35 30% 96%)" }}>
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              What Our Customers Say
            </h2>
          </AnimatedSection>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 max-w-6xl mx-auto">
            {testimonials.map((t, i) => (
              <AnimatedSection key={t.name} delay={i * 80}>
                <div className="rounded-2xl border border-border bg-card p-6 h-full flex flex-col">
                  <div className="flex gap-0.5 mb-4">
                    {[...Array(5)].map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-current" style={{ color: "hsl(35 60% 50%)" }} />
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-grow">
                    "{t.text}"
                  </p>
                  <p className="mt-4 text-sm font-semibold text-foreground">— {t.name}</p>
                </div>
              </AnimatedSection>
            ))}
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
              Incorporate HOKU into your morning and evening skincare routine.
              After cleansing, mist your face and let it air dry before
              applying moisturizer. Gentle enough for multiple daily applications.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border" style={{ backgroundColor: "hsl(35 30% 96%)" }}>
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Ready to Experience Optimized Clean Skincare?
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Join thousands who have discovered the benefits of hypochlorous acid for clear, healthy-looking skin.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" asChild
                className="text-white border-0"
                style={{ backgroundColor: "hsl(35 50% 45%)" }}>
                <a href="https://hoku-clean.com/shop" target="_blank" rel="noopener noreferrer">
                  Shop the Collection
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </div>
            <WaitlistForm
              productId="hoku"
              productName="HOKU"
              className="mt-8"
              buttonText="Get Notified for New Products"
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
              HOKU is a product of Bestly LLC. This product is not intended to
              diagnose, treat, cure, or prevent any disease. All products are
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
    </Layout>
  );
};

export default Hoku;

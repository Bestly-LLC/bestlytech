import { useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Droplets,
  Leaf,
  Shield,
  Sparkles,
  FlaskConical,
  Package,
  Heart,
  CheckCircle,
} from "lucide-react";
import { Link } from "react-router-dom";

const Hoku = () => {
  useEffect(() => {
    document.title = "HOKU - Premium Hypochlorous Acid Skincare | Bestly LLC";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute(
        "content",
        "HOKU delivers pharmaceutical-grade hypochlorous acid skincare using advanced electrolysis manufacturing. Gentle, effective skincare inspired by nature."
      );
    }
  }, []);

  const benefits = [
    {
      icon: Leaf,
      title: "Naturally Gentle",
      description:
        "HOCl is the same molecule naturally produced by your white blood cells to protect and heal.",
    },
    {
      icon: Shield,
      title: "Pharmaceutical-Grade",
      description:
        "Advanced electrolysis manufacturing ensures consistent purity and potency in every bottle.",
    },
    {
      icon: Package,
      title: "Vacuum-Sealed",
      description:
        "Proprietary packaging technology preserves freshness and extends shelf life without preservatives.",
    },
    {
      icon: Heart,
      title: "For All Skin Types",
      description:
        "Gentle enough for sensitive skin, effective enough for daily use without irritation.",
    },
  ];

  const features = [
    {
      icon: FlaskConical,
      title: "Advanced Electrolysis",
      description:
        "Our proprietary manufacturing process creates pure, stable hypochlorous acid.",
    },
    {
      icon: Droplets,
      title: "Daily Facial Mist",
      description:
        "A refreshing spray that cleanses and refreshes while maintaining skin's natural balance.",
    },
    {
      icon: Sparkles,
      title: "Clear, Healthy Skin",
      description:
        "Helps maintain clear, healthy-looking skin with regular daily use.",
    },
    {
      icon: CheckCircle,
      title: "No Irritation",
      description:
        "Works without the dryness, redness, or sensitivity common with other active ingredients.",
    },
  ];

  return (
    <Layout>
      <div className="bg-background">
        {/* Hero Section */}
        <section className="relative overflow-hidden py-20 sm:py-32">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <div className="mb-8 flex justify-center">
                <div className="relative rounded-full px-4 py-1.5 text-sm leading-6 text-muted-foreground ring-1 ring-border">
                  <span className="inline-flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
                    </span>
                    Coming Soon
                  </span>
                </div>
              </div>
              <div className="mb-6 flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <Droplets className="h-8 w-8 text-primary" />
                </div>
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
                HOKU
              </h1>
              <p className="mt-4 text-xl text-primary font-medium">
                Premium Hypochlorous Acid Skincare
              </p>
              <p className="mt-6 text-lg leading-8 text-muted-foreground">
                Using advanced electrolysis manufacturing and vacuum-sealed
                packaging technology, HOKU delivers pharmaceutical-grade HOCl—the
                same gentle molecule naturally produced by white blood cells—in a
                daily facial mist that cleanses, refreshes, and helps maintain
                clear, healthy-looking skin without irritation.
              </p>
              <div className="mt-10 flex items-center justify-center gap-x-6">
                <Button size="lg" disabled>
                  Get Notified at Launch
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <a href="#about">Learn More</a>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* What is HOCl */}
        <section id="about" className="py-20 bg-muted/30">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                What is Hypochlorous Acid?
              </h2>
              <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
                Hypochlorous acid (HOCl) is a naturally occurring molecule that
                your body produces to fight harmful microbes and promote
                healing. It's what makes your immune system so effective at
                protecting you.
              </p>
              <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
                HOKU harnesses this powerful, gentle molecule in a stable,
                topical formulation—bringing your skin the same protection your
                body already knows and trusts.
              </p>
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-20">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                The HOKU Difference
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Premium skincare backed by science and inspired by nature.
              </p>
            </div>
            <div className="mx-auto mt-16 max-w-5xl">
              <div className="grid gap-8 sm:grid-cols-2">
                {benefits.map((benefit, index) => (
                  <Card key={index} className="border-border">
                    <CardContent className="pt-6">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                        <benefit.icon className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {benefit.title}
                      </h3>
                      <p className="mt-2 text-muted-foreground">
                        {benefit.description}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 bg-muted/30">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Product Features
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Thoughtfully formulated for everyday skincare.
              </p>
            </div>
            <div className="mx-auto mt-16 max-w-5xl">
              <div className="grid gap-8 sm:grid-cols-2">
                {features.map((feature, index) => (
                  <Card key={index} className="border-border bg-background">
                    <CardContent className="pt-6">
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                        <feature.icon className="h-6 w-6 text-primary" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {feature.title}
                      </h3>
                      <p className="mt-2 text-muted-foreground">
                        {feature.description}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* How to Use */}
        <section className="py-20">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Simple Daily Ritual
              </h2>
              <p className="mt-6 text-lg text-muted-foreground">
                Incorporate HOKU into your morning and evening skincare routine.
                After cleansing, mist your face and let it air dry before
                applying moisturizer. It's gentle enough for multiple daily
                applications.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-muted/30">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Coming Soon
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                HOKU is currently in development. Be the first to experience
                pharmaceutical-grade skincare when we launch.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button size="lg" disabled>
                  Get Notified at Launch
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <Link to="/products">View All Products</Link>
                </Button>
              </div>
            </div>
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
                <Link to="/terms" className="underline hover:text-foreground">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="underline hover:text-foreground">
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
};

export default Hoku;

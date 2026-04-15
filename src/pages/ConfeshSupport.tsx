import { useEffect } from "react";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function ConfeshSupport() {
  useEffect(() => {
    document.title = "Confesh Support | Bestly LLC";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", "Get help with Confesh: Unscripted. Contact Bestly LLC.");
    }
  }, []);

  return (
    <>
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        <AnimatedSection>
          <header className="mb-12">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              Confesh Support
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">We're here to help.</p>
          </header>
        </AnimatedSection>

        <AnimatedSection delay={80}>
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              For questions, feedback, or issues with Confesh: Unscripted:
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Email:{" "}
              <a href="mailto:support@bestly.tech" className="text-foreground hover:underline font-medium">
                support@bestly.tech
              </a>
            </p>
          </section>
        </AnimatedSection>

        <AnimatedSection delay={140}>
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">Common Questions</h2>
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-foreground mb-2">Can other trip members see my confessionals?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  No. Confessionals are completely private until the trip ends. Nobody — including the
                  director — can view your recordings until the final episode is released.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">How do I join a trip?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Tap the invite link your director shared, or enter the invite code on the Join screen.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">How do I delete my data?</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Open Settings inside the app and tap Privacy, then Delete All Data.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">Something isn't working</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Email{" "}
                  <a href="mailto:support@bestly.tech" className="text-foreground hover:underline">
                    support@bestly.tech
                  </a>{" "}
                  with your device model and iOS version. We reply within one business day.
                </p>
              </div>
            </div>
          </section>
        </AnimatedSection>

        <AnimatedSection delay={200}>
          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-4">Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              Read our full{" "}
              <a href="/confesh/privacy" className="text-foreground hover:underline">
                Privacy Policy
              </a>.
            </p>
          </section>
        </AnimatedSection>
      </div>
    </>
  );
}

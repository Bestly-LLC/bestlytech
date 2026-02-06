import { Layout } from "@/components/layout/Layout";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Link } from "react-router-dom";

export default function About() {
  return (
    <Layout>
      <SEOHead
        title="Our Story | Bestly LLC"
        description="We build things people actually want — without the trade-offs they shouldn't have to make."
      />
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        {/* Page Header */}
        <div className="mb-16">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Our Story
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            We build things people actually want — without the trade-offs they shouldn't have to make.
          </p>
        </div>

        {/* Mission */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Why We Exist</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed">
              Technology should make life better without making privacy worse. That's not a tagline — it's how we decide what to build and what to skip.
            </p>
          </div>
        </section>

        {/* Founder-Led Studio */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Lean by Design</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              We're founder-led and intentionally lean. No outside investors pushing us to monetize your data. No board meetings debating whether to sell your information. Just a small team building things we believe in.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              This structure lets us move fast and stay principled — from software to physical products, the same standards apply to everything we ship.
            </p>
          </div>
        </section>

        {/* Multi-Vertical Innovation */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">What We Touch</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              We don't limit ourselves to one lane. Our portfolio spans:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li>Mobile apps for iOS and Android</li>
              <li>Browser extensions for productivity and privacy</li>
              <li>AI tools built with transparency</li>
              <li>Consumer technology</li>
              <li>Physical products with companion apps</li>
              <li>Wellness products (cosmetic-safe, non-medical)</li>
              <li>Hardware with privacy-first data handling</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed">
              Different industries, same conviction.
            </p>
          </div>
        </section>

        {/* Commitment to Ethical Technology */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">How We Build</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              Ethical technology isn't a talking point — it's the filter for every decision we make:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li><strong className="text-foreground">Transparency:</strong> We tell you what we collect, why, and how it's used.</li>
              <li><strong className="text-foreground">User Control:</strong> Access, modify, or delete your data anytime.</li>
              <li><strong className="text-foreground">No Dark Patterns:</strong> Honest interfaces. No tricks.</li>
              <li><strong className="text-foreground">AI Disclosure:</strong> When we use AI, we explain how.</li>
              <li><strong className="text-foreground">Security:</strong> Industry-standard protections, regularly audited.</li>
            </ul>
          </div>
        </section>

        {/* Privacy-First Philosophy */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Privacy as a Feature</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              Our approach to privacy goes beyond checking boxes:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li><strong className="text-foreground">Data Minimization:</strong> Only what's strictly necessary.</li>
              <li><strong className="text-foreground">On-Device Processing:</strong> Your data stays on your device whenever possible.</li>
              <li><strong className="text-foreground">No Data Sales:</strong> Never. Period.</li>
              <li><strong className="text-foreground">No Cross-App Tracking:</strong> We don't follow you around.</li>
              <li><strong className="text-foreground">Right to Deletion:</strong> Your data, your call.</li>
            </ul>
          </div>
        </section>

        {/* Platform-Agnostic Development */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Built for Every Platform</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed">
              We build for people, not platforms. iOS, Android, web — our products deliver consistent experiences with the same privacy protections, regardless of where you use them.
            </p>
          </div>
        </section>

        {/* Wellness Products Disclaimer */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Wellness Product Safety</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              Some of our products fall into the wellness-adjacent category. For these products:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li>We make no medical claims and our products are not intended to diagnose, treat, cure, or prevent any disease.</li>
              <li>All cosmetic and wellness products are formulated to be safe for their intended use.</li>
              <li>We comply with applicable regulations including FDA guidelines for cosmetics.</li>
              <li>Product ingredients and usage instructions are clearly disclosed.</li>
              <li>Users are encouraged to consult healthcare professionals for medical concerns.</li>
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border pt-12">
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-foreground mb-4">
              Curious?
            </h2>
            <p className="text-muted-foreground mb-8">
              See what we're building or say hello.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/products"
                className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                View Products
              </Link>
              <Link
                to="/contact"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
              >
                Contact Us
              </Link>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}

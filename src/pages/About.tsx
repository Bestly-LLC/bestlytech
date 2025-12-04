import { Layout } from "@/components/layout/Layout";
import { Link } from "react-router-dom";

export default function About() {
  return (
    <Layout>
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        {/* Page Header */}
        <div className="mb-16">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            About Bestly LLC
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            A founder-led product studio committed to building technology that respects users.
          </p>
        </div>

        {/* Mission */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Our Mission</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed">
              Bestly LLC exists to create products that improve people's lives without compromising 
              their privacy or autonomy. We believe technology should serve users, not exploit them. 
              Every product we build starts with a simple question: "How can we deliver maximum value 
              while collecting minimum data?"
            </p>
          </div>
        </section>

        {/* Founder-Led Studio */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">A Founder-Led Studio</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              Bestly LLC operates as a lean, founder-led product studio. This structure allows us to 
              maintain unwavering commitment to our principles while moving quickly to bring innovative 
              products to market. Without the pressure of external investors demanding user data 
              monetization, we're free to build products that truly prioritize user interests.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Our studio model means we can work across multiple verticals—from software to physical 
              products—applying the same rigorous privacy standards and ethical design principles to 
              everything we create.
            </p>
          </div>
        </section>

        {/* Multi-Vertical Innovation */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Multi-Vertical Innovation</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              We don't limit ourselves to a single product category. Our portfolio spans:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li>Mobile applications for iOS and Android</li>
              <li>Browser extensions for productivity and privacy</li>
              <li>AI and automation tools with transparent, ethical design</li>
              <li>Consumer technology products</li>
              <li>Physical products with optional companion applications</li>
              <li>Wellness-adjacent products (cosmetic-safe, non-medical)</li>
              <li>Hardware-adjacent devices with privacy-first data handling</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed">
              This diversity allows us to identify opportunities across industries and bring fresh 
              perspectives to each market we enter.
            </p>
          </div>
        </section>

        {/* Commitment to Ethical Technology */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Commitment to Ethical Technology</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              Ethical technology isn't just a marketing phrase for us—it's the foundation of every 
              decision we make. This commitment manifests in several ways:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li><strong className="text-foreground">Transparency:</strong> We clearly disclose what data we collect, why we collect it, and how it's used.</li>
              <li><strong className="text-foreground">User Control:</strong> Users can access, modify, and delete their data at any time.</li>
              <li><strong className="text-foreground">No Dark Patterns:</strong> Our interfaces are designed to be clear and honest, never manipulative.</li>
              <li><strong className="text-foreground">AI Disclosure:</strong> When our products use artificial intelligence, we clearly explain how it works and what decisions it influences.</li>
              <li><strong className="text-foreground">Security First:</strong> We implement industry-standard security practices and regularly audit our systems.</li>
            </ul>
          </div>
        </section>

        {/* Privacy-First Philosophy */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Privacy-First Consumer Philosophy</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              Our approach to privacy goes beyond compliance. We adopt a "privacy-first" design 
              philosophy that means:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li><strong className="text-foreground">Data Minimization:</strong> We only collect data that is strictly necessary for product functionality.</li>
              <li><strong className="text-foreground">On-Device Processing:</strong> Whenever possible, data processing happens on the user's device rather than our servers.</li>
              <li><strong className="text-foreground">No Data Sales:</strong> We never sell personal information to third parties.</li>
              <li><strong className="text-foreground">No Cross-App Tracking:</strong> We don't track users across different applications without explicit consent.</li>
              <li><strong className="text-foreground">Right to Deletion:</strong> Users can request complete deletion of their data at any time.</li>
            </ul>
          </div>
        </section>

        {/* Platform-Agnostic Development */}
        <section className="mb-16">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Platform-Agnostic Development</h2>
          <div className="prose prose-neutral max-w-none">
            <p className="text-muted-foreground leading-relaxed">
              We build for users, not platforms. Our products are designed to work across iOS, Android, 
              web browsers, and various operating systems. We comply with platform guidelines while 
              maintaining our core principles. Whether you're an Apple user, Android enthusiast, or 
              primarily use desktop browsers, our products deliver consistent experiences with the 
              same privacy protections.
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
              Want to Learn More?
            </h2>
            <p className="text-muted-foreground mb-8">
              Explore our products or get in touch with any questions.
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

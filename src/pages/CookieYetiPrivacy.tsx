import { useEffect } from "react";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function CookieYetiPrivacy() {
  useEffect(() => {
    document.title = "Cookie Yeti Privacy Policy | Bestly LLC";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", "Bestly LLC Privacy Policy for Cookie Yeti. No tracking. No data selling. On-device processing only.");
    }
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const sections = [
    { title: "1. Information We Do NOT Collect", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Cookie Yeti operates entirely on your device. We do not collect, transmit, store, sell, or share any of the following:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Browsing history</li><li>Website URLs</li><li>Cookies from websites</li>
          <li>Personally identifiable information</li><li>Names, emails, addresses, phone numbers</li>
          <li>IP addresses</li><li>Device identifiers</li><li>Authentication credentials</li>
          <li>Precise location data</li><li>Financial or payment data</li>
          <li>Health, biometric, or sensitive personal data</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">
          Cookie Yeti contains no analytics, no advertising SDKs, and no third-party trackers.
        </p>
      </>
    )},
    { title: "2. Information Stored Locally on Your Device", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">Cookie Yeti stores the following locally using secure browser storage:</p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Cookie consent preferences</li><li>Daily usage counters (if applicable)</li>
          <li>Lifetime unlock status</li><li>Optional per-site rules</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">This data never leaves your device and is deleted when the extension is removed.</p>
      </>
    )},
    { title: "3. How Cookie Yeti Works", content: (
      <p className="text-muted-foreground leading-relaxed">Cookie Yeti detects cookie consent banners on web pages and automatically applies your locally stored preferences. All processing occurs entirely on your device.</p>
    )},
    { title: "4. Payments & Purchases", content: (
      <p className="text-muted-foreground leading-relaxed">All purchases are processed by official app marketplaces. Bestly LLC does not store or receive payment credentials. Only anonymous confirmation of purchase status is received.</p>
    )},
    { title: "5. Third-Party Access", content: (
      <p className="text-muted-foreground leading-relaxed">Bestly LLC does not share any data with third parties. Cookie Yeti does not embed third-party scripts or connect to external servers for tracking or analytics.</p>
    )},
    { title: "6. Data Retention & Deletion", content: (
      <p className="text-muted-foreground leading-relaxed">All data remains local and is deleted upon uninstall. Users can manually clear data at any time.</p>
    )},
    { title: "7. Children's Privacy", content: (
      <p className="text-muted-foreground leading-relaxed">Cookie Yeti is not intended for children under 13. No data is knowingly collected from children.</p>
    )},
    { title: "8. User Rights & Controls", content: (
      <p className="text-muted-foreground leading-relaxed">Users may disable, remove, or clear Cookie Yeti data at any time.</p>
    )},
    { title: "9. Security Practices", content: (
      <p className="text-muted-foreground leading-relaxed">We use secure browser storage, minimal permissions, and no external data transmission.</p>
    )},
    { title: "10. Policy Changes", content: (
      <p className="text-muted-foreground leading-relaxed">We may update this policy periodically and will reflect changes on this page.</p>
    )},
    { title: "11. Contact Information", content: (
      <p className="text-muted-foreground leading-relaxed">
        Bestly LLC<br />
        Email: <a href="mailto:support@bestly.tech" className="text-foreground hover:underline">support@bestly.tech</a><br />
        Website: <a href="https://bestly.tech" className="text-foreground hover:underline">https://bestly.tech</a>
      </p>
    )},
  ];

  return (
    <>
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        <AnimatedSection>
          <header className="mb-12">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              Privacy Policy – Cookie Yeti by Bestly LLC
            </h1>
            <div className="mt-6 text-sm text-muted-foreground space-y-1">
              <p>Effective Date: {today}</p>
              <p>Last Updated: {today}</p>
            </div>
          </header>
        </AnimatedSection>

        <div className="prose prose-neutral max-w-none">
          <AnimatedSection delay={80}>
            <p className="text-muted-foreground leading-relaxed mb-12">
              Bestly LLC ("Bestly," "we," "our," or "us") operates the Cookie Yeti browser extension and related services (collectively, the "Service"). Your privacy is extremely important to us. This Privacy Policy explains what data is collected, how it is used, and how it is protected when you use Cookie Yeti.
            </p>
          </AnimatedSection>

          {sections.map((section, index) => (
            <AnimatedSection key={section.title} delay={Math.min((index + 2) * 60, 300)}>
              <section className="mb-12">
                <h2 className="text-2xl font-semibold text-foreground mb-4">{section.title}</h2>
                {section.content}
              </section>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </>
  );
}

import { useEffect } from "react";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function CookieYetiPrivacy() {
  useEffect(() => {
    document.title = "Cookie Yeti Privacy Policy | Bestly LLC";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", "Bestly LLC Privacy Policy for Cookie Yeti. No personal data, no browsing history, no data selling. Anonymous analytics only, and we share only a site's domain to improve the product.");
    }
  }, []);

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const sections = [
    { title: "1. Personal Data We Do NOT Collect", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Cookie Yeti does its work on your device. We never collect, transmit, store, sell, or share any of the following:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Your browsing history</li><li>The specific pages you visit, or full URLs (paths, query strings, or anything after the domain)</li>
          <li>Cookies from the websites you visit</li>
          <li>Personally identifiable information</li><li>Names, emails, addresses, phone numbers</li>
          <li>IP addresses</li><li>Device identifiers</li><li>Authentication credentials</li>
          <li>Precise location data</li><li>Financial or payment data</li>
          <li>Health, biometric, or sensitive personal data</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">
          Cookie Yeti contains no advertising SDKs and no third-party trackers. The only information that ever leaves your device is the anonymous, non-personal data described in the next two sections.
        </p>
      </>
    )},
    { title: "2. Anonymous Product Analytics", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          To understand whether the extension is working and where it can improve, Cookie Yeti collects anonymous product analytics — for example, that it ran, whether it handled a cookie banner successfully, and basic feature usage counts.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Each install is tied only to a random identifier that we generate. It is not linked to your name, email, account, or any other personal information.</li>
          <li>Analytics never include your browsing history, the pages you were on, or the content of any page.</li>
          <li>We use this data only to measure reliability and improve the product. We never sell it.</li>
        </ul>
      </>
    )},
    { title: "3. Community Learning (Domain Only)", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Some cookie walls are trickier than others. When Cookie Yeti runs into one, it can share a small note with our community learning system so the extension gets better at handling that site for everyone.
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>We share only the <strong>domain</strong> of the site (for example, <code>example.com</code>) — never the full URL, never the specific page you were on, and never the path or query string.</li>
          <li>We never attach personal data, and this is not linked to you.</li>
          <li><strong>Raw page content is not uploaded by default.</strong> Cookie Yeti does not send us the HTML or text of the pages you visit.</li>
        </ul>
      </>
    )},
    { title: "4. Information Stored Locally on Your Device", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">Cookie Yeti stores the following locally using secure browser storage:</p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Cookie consent preferences</li><li>Daily usage counters (if applicable)</li>
          <li>Lifetime unlock status</li><li>Optional per-site rules</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">This data stays on your device and is deleted when the extension is removed.</p>
      </>
    )},
    { title: "5. How Cookie Yeti Works", content: (
      <p className="text-muted-foreground leading-relaxed">Cookie Yeti detects cookie consent banners on web pages and automatically applies your locally stored preferences. This processing happens on your device. Raw page content is not uploaded by default — the only data that leaves your device is the anonymous analytics and domain-only community learning described above.</p>
    )},
    { title: "6. Payments & Purchases", content: (
      <p className="text-muted-foreground leading-relaxed">All purchases are processed by official app marketplaces. Bestly LLC does not store or receive payment credentials. Only anonymous confirmation of purchase status is received.</p>
    )},
    { title: "7. Third-Party Access", content: (
      <p className="text-muted-foreground leading-relaxed">Bestly LLC does not sell your data or share it with third-party advertisers or trackers. Cookie Yeti embeds no third-party analytics or advertising SDKs. The anonymous analytics and domain-only community learning described above are sent only to Bestly's own systems to operate and improve the Service.</p>
    )},
    { title: "8. Data Retention & Deletion", content: (
      <p className="text-muted-foreground leading-relaxed">Your local settings remain on your device and are deleted upon uninstall, and you can clear them manually at any time. Anonymous analytics and community-learning records are tied only to a random identifier, not to you, and are retained in aggregate to operate and improve the Service.</p>
    )},
    { title: "9. Children's Privacy", content: (
      <p className="text-muted-foreground leading-relaxed">Cookie Yeti is not intended for children under 13. No data is knowingly collected from children.</p>
    )},
    { title: "10. User Rights & Controls", content: (
      <p className="text-muted-foreground leading-relaxed">Users may disable, remove, or clear Cookie Yeti data at any time.</p>
    )},
    { title: "11. Security Practices", content: (
      <p className="text-muted-foreground leading-relaxed">We use secure browser storage, minimal permissions, and transmit only the anonymous, non-personal data described in this policy.</p>
    )},
    { title: "12. Policy Changes", content: (
      <p className="text-muted-foreground leading-relaxed">We may update this policy periodically and will reflect changes on this page.</p>
    )},
    { title: "13. Contact Information", content: (
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

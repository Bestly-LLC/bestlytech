import { AnimatedSection } from "@/components/AnimatedSection";
import { SEOHead } from "@/components/SEOHead";

export default function CookieYetiPrivacy() {

  const effectiveDate = "October 1, 2026";
  const lastUpdated = "October 26, 2026";

  const sections = [
    { title: "1. Data Cookie Yeti Collects", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Cookie Yeti closes cookie pop-ups on the websites you visit and picks the most private option for you. This policy applies to the Chrome extension and the Safari extension for Mac, iPhone and iPad. The extension collects:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li><strong className="text-foreground">Website domain and address (origin only).</strong> When Cookie Yeti handles, misses or gets stuck on a cookie banner, it sends the site's domain (for example "example.com") and origin. It never sends the full page address, page path, search terms or page content outside the banner.</li>
          <li><strong className="text-foreground">Cookie banner details.</strong> The CSS selector of the banner button, the action taken (accept, reject, necessary, save or close), the consent platform's name, and, when a banner is missed or you tap "Report", up to 5,000 characters of the banner's own HTML so we can teach Cookie Yeti to handle it.</li>
          <li><strong className="text-foreground">Page-guard reports.</strong> If Cookie Yeti notices it scrolled a page or kept reopening something on a site, it sends the domain, a short reason (for example "scroll_jump"), the extension version and the browser type (Chrome or Safari).</li>
          <li><strong className="text-foreground">Anonymous usage analytics.</strong> A random install ID created on your device and simple events such as "installed", "banner handled today" or "upgrade started", with the extension version and platform. No email, web address, domain or IP address is stored with these events. You can turn this off in the extension's settings.</li>
          <li><strong className="text-foreground">Email address (Pro only).</strong> If you buy Cookie Yeti Pro or activate it on another device, we collect your email address to send an activation code and confirm your subscription. Payment card details go directly to Stripe; we never see or store them.</li>
          <li><strong className="text-foreground">Cookies on your device.</strong> The extension reads the names of cookies on the sites you visit, only on your device, to remove known tracking cookies. Cookie names and values are never sent to us.</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">
          Cookie Yeti does not collect your name, browsing history, full web addresses, page content (other than the cookie banner itself), passwords, form entries, location, or financial information, and it does not track you across websites. It contains no advertising SDKs and no third-party trackers.
        </p>
      </>
    )},
    { title: "2. How We Use and Handle This Data", content: (
      <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
        <li>Domains, selectors and banner HTML are used only to recognize and close cookie banners for all Cookie Yeti users, and to switch off a banner rule that misbehaves.</li>
        <li>Page-guard reports are used only to stop Cookie Yeti acting on a site where it causes problems. When several reports arrive for the same site, Cookie Yeti leaves that site alone for everyone for a period, then tries again.</li>
        <li>Anonymous analytics are used only to count installs and usage and to find bugs.</li>
        <li>Your email is used only to send activation codes, confirm Pro access and answer your support requests. We do not send marketing email to it unless you ask us to.</li>
        <li>Banner HTML may be processed by an AI service (OpenAI) to write a new banner rule. Only the banner snippet is sent, never your identity.</li>
        <li>We never sell this data, never use it for advertising, and never use it to build a profile of you.</li>
      </ul>
    )},
    { title: "3. How and Where We Store It, and for How Long", content: (
      <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
        <li>Data sent by the extension is stored in our database hosted by Supabase in the United States. It is encrypted in transit (HTTPS/TLS) and at rest, and only Bestly LLC staff who run Cookie Yeti can access it.</li>
        <li>Your settings, your own learned banner rules, your Pro status and sites Cookie Yeti has paused are stored only in your browser's extension storage on your device. Removing the extension deletes them.</li>
        <li>Page-guard reports are deleted after 90 days. Banner rules and banner reports are kept while they help Cookie Yeti work and are deleted when a rule is retired. Anonymous analytics events are kept for up to 24 months. Your email is kept while you have Pro access and deleted on request after that.</li>
      </ul>
    )},
    { title: "4. Who We Share It With", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We do not sell, rent or trade Cookie Yeti data. We share it only with the service providers that run Cookie Yeti for us, under contracts that limit them to that purpose:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground mb-4">
          <li><strong className="text-foreground">Supabase</strong> — database and server hosting for all of the data above. <a href="https://supabase.com/privacy" className="text-foreground hover:underline" target="_blank" rel="noopener noreferrer">Supabase Privacy Policy</a>.</li>
          <li><strong className="text-foreground">Stripe</strong> — payment processing for Cookie Yeti Pro bought on our website (your email and payment details).</li>
          <li><strong className="text-foreground">Resend</strong> — sending activation-code emails (your email address).</li>
          <li><strong className="text-foreground">OpenAI</strong> — writing new banner rules from cookie banner HTML snippets (no identity or email is sent).</li>
          <li><strong className="text-foreground">Apple / Google</strong> — purchase confirmation when you buy through their app marketplaces.</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          Banner rules (domain, selector and action) are shared with other Cookie Yeti users so their extension can close the same banners. We may also disclose data if required by law.
        </p>
      </>
    )},
    { title: "5. Information Stored Locally on Your Device", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">Cookie Yeti stores the following locally using secure browser storage:</p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Cookie consent preferences</li><li>Daily usage counters (if applicable)</li>
          <li>Lifetime unlock status</li><li>Optional per-site rules</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">This data stays on your device and is deleted when the extension is removed.</p>
      </>
    )},
    { title: "6. How Cookie Yeti Works", content: (
      <p className="text-muted-foreground leading-relaxed">Cookie Yeti detects cookie consent banners on web pages and automatically applies your locally stored preferences. This processing happens on your device. The only data that leaves your device is what section 1 describes.</p>
    )},
    { title: "7. Payments & Purchases", content: (
      <p className="text-muted-foreground leading-relaxed">Purchases are processed by Apple (App Store), by Google, or by Stripe when you buy on our website. Bestly LLC does not store or receive your card details; Apple, Google and Stripe handle them. If you buy on our website, Stripe also gives us your email address so we can send your activation code and confirm your subscription.</p>
    )},
    { title: "8. Children's Privacy", content: (
      <p className="text-muted-foreground leading-relaxed">Cookie Yeti is not intended for children under 13. No data is knowingly collected from children.</p>
    )},
    { title: "9. Your Choices and Rights", content: (
      <p className="text-muted-foreground leading-relaxed">You can turn off anonymous analytics in the extension's settings, pause Cookie Yeti on any site, or remove the extension at any time. To see or delete data tied to your email or install ID, email <a href="mailto:privacy@bestly.tech" className="text-foreground hover:underline">privacy@bestly.tech</a> or <a href="mailto:support@bestly.tech" className="text-foreground hover:underline">support@bestly.tech</a>.</p>
    )},
    { title: "10. Security Practices", content: (
      <p className="text-muted-foreground leading-relaxed">We use secure browser storage and minimal permissions. Data sent from the extension to Bestly's servers travels over HTTPS (TLS) and is encrypted at rest. Only Bestly LLC staff who run Cookie Yeti can access it.</p>
    )},
    { title: "11. Policy Changes", content: (
      <p className="text-muted-foreground leading-relaxed">We may update this policy periodically and will reflect changes on this page.</p>
    )},
    { title: "12. Contact Information", content: (
      <p className="text-muted-foreground leading-relaxed">
        Bestly LLC<br />
        Email: <a href="mailto:support@bestly.tech" className="text-foreground hover:underline">support@bestly.tech</a><br />
        Website: <a href="https://bestly.tech" className="text-foreground hover:underline">https://bestly.tech</a>
      </p>
    )},
  ];

  return (
    <>
      <SEOHead
        title="Cookie Yeti Privacy Policy | Bestly LLC"
        description="Bestly LLC Privacy Policy for Cookie Yeti. What the extension collects (site domains, cookie banner details, anonymous analytics, and email for Pro), who we share it with, and how long we keep it. We never sell it."
        path="/cookie-yeti/privacy"
      />
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        <AnimatedSection>
          <header className="mb-12">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              Privacy Policy – Cookie Yeti by Bestly LLC
            </h1>
            <div className="mt-6 text-sm text-muted-foreground space-y-1">
              <p>Effective Date: {effectiveDate}</p>
              <p>Last Updated: {lastUpdated}</p>
            </div>
          </header>
        </AnimatedSection>

        <AnimatedSection delay={40}>
          <div className="mb-12 rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Data type</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Collected?</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">How used</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Shared with</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Retained</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="px-4 py-3 text-muted-foreground">Browsing history / full URLs / page content</td>
                  <td className="px-4 py-3 font-medium text-green-600">No</td>
                  <td className="px-4 py-3 text-muted-foreground">—</td>
                  <td className="px-4 py-3 text-muted-foreground">—</td>
                  <td className="px-4 py-3 text-muted-foreground">—</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-muted-foreground">Site domain and origin; cookie banner details (up to 5,000 characters of banner HTML)</td>
                  <td className="px-4 py-3 font-medium text-foreground">Yes</td>
                  <td className="px-4 py-3 text-muted-foreground">Recognize and close banners for all users</td>
                  <td className="px-4 py-3 text-muted-foreground">Supabase; OpenAI (banner snippet only, to write rules)</td>
                  <td className="px-4 py-3 text-muted-foreground">Kept while the rule is useful</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-muted-foreground">Page-guard reports</td>
                  <td className="px-4 py-3 font-medium text-foreground">Yes</td>
                  <td className="px-4 py-3 text-muted-foreground">Stop Cookie Yeti acting on sites where it causes problems</td>
                  <td className="px-4 py-3 text-muted-foreground">Supabase</td>
                  <td className="px-4 py-3 text-muted-foreground">Deleted after 90 days</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-muted-foreground">Anonymous product analytics (random install ID)</td>
                  <td className="px-4 py-3 font-medium text-foreground">Yes</td>
                  <td className="px-4 py-3 text-muted-foreground">Count installs and usage, find bugs</td>
                  <td className="px-4 py-3 text-muted-foreground">Supabase</td>
                  <td className="px-4 py-3 text-muted-foreground">Up to 24 months</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-muted-foreground">Email address (Pro only)</td>
                  <td className="px-4 py-3 font-medium text-foreground">Yes</td>
                  <td className="px-4 py-3 text-muted-foreground">Activation codes, Pro access, support</td>
                  <td className="px-4 py-3 text-muted-foreground">Supabase; Stripe; Resend</td>
                  <td className="px-4 py-3 text-muted-foreground">While you have Pro; deleted on request</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-muted-foreground">Name, passwords, form entries, location, card details</td>
                  <td className="px-4 py-3 font-medium text-green-600">No</td>
                  <td className="px-4 py-3 text-muted-foreground">—</td>
                  <td className="px-4 py-3 text-muted-foreground">—</td>
                  <td className="px-4 py-3 text-muted-foreground">—</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-muted-foreground">Local preferences (device only)</td>
                  <td className="px-4 py-3 font-medium text-foreground">Yes</td>
                  <td className="px-4 py-3 text-muted-foreground">Store your settings on-device</td>
                  <td className="px-4 py-3 text-muted-foreground">Never leaves your device</td>
                  <td className="px-4 py-3 text-muted-foreground">Deleted on uninstall</td>
                </tr>
              </tbody>
            </table>
          </div>
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

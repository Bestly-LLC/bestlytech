import { Link } from "react-router-dom";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function PrivacyPolicy() {
  const lastUpdated = "September 24, 2026";

  const sections = [
    { id: "1", title: "1. Introduction", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Bestly LLC ("Bestly," "we," "us," or "our") is committed to protecting your privacy. This 
          Privacy Policy explains how we collect, use, disclose, and safeguard your information when 
          you use our websites, mobile applications, browser extensions, devices, physical products, 
          and related services (collectively, the "Services").
        </p>
        <p className="text-muted-foreground leading-relaxed mb-4">
          This Master Privacy Policy applies to all Bestly LLC properties and products unless a 
          specific product has its own privacy policy that supplements or modifies these terms. 
          In case of conflict between this policy and a product-specific policy, the product-specific 
          policy will govern for that particular product.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          By using our Services, you agree to the collection and use of information in accordance 
          with this policy. If you do not agree with the terms of this policy, please do not access 
          or use our Services.
        </p>
      </>
    )},
    { id: "2", title: "2. Data Controller", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Bestly LLC is the data controller responsible for your personal information. Our contact 
          information is:
        </p>
        <div className="bg-secondary/30 p-4 rounded-lg text-muted-foreground">
          <p><strong className="text-foreground">Bestly LLC</strong></p>
          <p>Los Angeles, CA, United States</p>
          <p>Email: <a href="mailto:privacy@bestly.tech" className="text-foreground underline">privacy@bestly.tech</a></p>
        </div>
      </>
    )},
    { id: "3", title: "3. Information We Collect", content: (
      <>
        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">3.1 Information You Provide</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We may collect information you voluntarily provide when using our Services, including:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li><strong className="text-foreground">Account Information:</strong> Name, email address, and password when you create an account.</li>
          <li><strong className="text-foreground">Contact Information:</strong> Name, email address, and message content when you contact us.</li>
          <li><strong className="text-foreground">Transaction Information:</strong> Billing address, payment method details (processed by third-party payment processors), and purchase history.</li>
          <li><strong className="text-foreground">User Content:</strong> Any content you create, upload, or share through our Services.</li>
          <li><strong className="text-foreground">Communications:</strong> Records of your communications with us, including support requests.</li>
        </ul>
        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">3.2 Information Collected Automatically</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">
          When you use our Services, we may automatically collect certain information, including:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li><strong className="text-foreground">Device Information:</strong> Device type, operating system, unique device identifiers, and browser type.</li>
          <li><strong className="text-foreground">Usage Information:</strong> Features used, actions taken, time and duration of use.</li>
          <li><strong className="text-foreground">Log Data:</strong> IP address, access times, pages viewed, and referring URL.</li>
        </ul>
        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">3.3 Information from Physical Products and Devices</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">
          If you use our physical products or devices with companion applications, we may collect:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2">
          <li>Device status and performance data</li>
          <li>Usage patterns and preferences</li>
          <li>Sensor data (only if explicitly disclosed and consented to)</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">
          We design our products to process data on-device whenever possible, minimizing the data 
          transmitted to our servers.
        </p>
      </>
    )},
    { id: "4", title: "4. Data Minimization Principle", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We adhere to the principle of data minimization. This means we:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2">
          <li>Only collect data that is necessary for the specific purpose disclosed</li>
          <li>Do not collect data "just in case" it might be useful later</li>
          <li>Regularly review our data collection practices to ensure necessity</li>
          <li>Delete data when it is no longer needed for its original purpose</li>
          <li>Process data on your device whenever technically feasible</li>
        </ul>
      </>
    )},
    { id: "5", title: "5. How We Use Your Information", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We use the information we collect for the following purposes:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2">
          <li><strong className="text-foreground">Provide Services:</strong> To operate, maintain, and improve our Services.</li>
          <li><strong className="text-foreground">Process Transactions:</strong> To process payments and fulfill orders.</li>
          <li><strong className="text-foreground">Communicate:</strong> To respond to inquiries, send service updates, and provide customer support.</li>
          <li><strong className="text-foreground">Security:</strong> To detect, prevent, and address fraud, abuse, and security issues.</li>
          <li><strong className="text-foreground">Legal Compliance:</strong> To comply with applicable laws and legal obligations.</li>
          <li><strong className="text-foreground">Analytics:</strong> To understand how users interact with our Services (using anonymized or aggregated data when possible).</li>
        </ul>
      </>
    )},
    { id: "6", title: "6. No Sale of Personal Data", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          <strong className="text-foreground">We do not sell your personal information.</strong> This is 
          a core principle of our business. We do not sell, rent, or trade your personal information 
          to third parties for their marketing purposes or any other purpose.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          Under the California Consumer Privacy Act (CCPA), "sale" includes sharing personal 
          information for monetary or other valuable consideration. We confirm that we do not 
          engage in such practices.
        </p>
      </>
    )},
    { id: "7", title: "7. Cross-App Tracking", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We do not track users across different applications or websites owned by other companies 
          without explicit user consent. If any of our products require such tracking for 
          functionality (rare), we will:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2">
          <li>Clearly disclose this in the product-specific privacy policy</li>
          <li>Obtain explicit opt-in consent before enabling such features</li>
          <li>Provide easy-to-use controls to disable tracking</li>
        </ul>
      </>
    )},
    { id: "8", title: "8. Information Sharing and Disclosure", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We may share your information only in the following circumstances:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2">
          <li><strong className="text-foreground">Service Providers:</strong> With vendors who perform services on our behalf (e.g., payment processing, email delivery), bound by confidentiality agreements.</li>
          <li><strong className="text-foreground">Legal Requirements:</strong> When required by law, court order, or governmental authority.</li>
          <li><strong className="text-foreground">Protection of Rights:</strong> To protect the rights, property, or safety of Bestly LLC, our users, or others.</li>
          <li><strong className="text-foreground">Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets, with appropriate notice to users.</li>
          <li><strong className="text-foreground">With Your Consent:</strong> When you have given us explicit consent to share your information.</li>
        </ul>
      </>
    )},
    { id: "9", title: "9. Cookies and Local Storage", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Our websites and applications may use cookies and local storage technologies. We use:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li><strong className="text-foreground">Essential Cookies:</strong> Required for basic functionality (e.g., session management, security).</li>
          <li><strong className="text-foreground">Preference Cookies:</strong> To remember your settings and preferences.</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          We do not use advertising or tracking cookies. You can control cookies through your 
          browser settings, though disabling essential cookies may affect functionality.
        </p>
      </>
    )},
    { id: "10", title: "10. Data Security", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We implement appropriate technical and organizational measures to protect your personal 
          information, including:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2">
          <li>Encryption of data in transit (TLS/SSL) and at rest</li>
          <li>Access controls and authentication requirements</li>
          <li>Regular security assessments and updates</li>
          <li>Employee training on data protection</li>
          <li>Incident response procedures</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mt-4">
          However, no method of transmission over the Internet or electronic storage is 100% secure. 
          While we strive to protect your information, we cannot guarantee absolute security.
        </p>
      </>
    )},
    { id: "11", title: "11. Your Rights", content: (
      <>
        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">11.1 Rights for All Users</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Regardless of your location, you have the right to:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li><strong className="text-foreground">Access:</strong> Request a copy of the personal information we hold about you.</li>
          <li><strong className="text-foreground">Correction:</strong> Request correction of inaccurate personal information.</li>
          <li><strong className="text-foreground">Deletion:</strong> Request deletion of your personal information.</li>
          <li><strong className="text-foreground">Data Portability:</strong> Receive your data in a structured, commonly used format.</li>
          <li><strong className="text-foreground">Opt-Out:</strong> Opt out of certain uses of your information.</li>
        </ul>
        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">11.2 GDPR Rights (European Economic Area)</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">
          If you are located in the European Economic Area (EEA), you also have the right to:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Object to processing based on legitimate interests</li>
          <li>Restrict processing in certain circumstances</li>
          <li>Withdraw consent at any time (where processing is based on consent)</li>
          <li>Lodge a complaint with a supervisory authority</li>
        </ul>
        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">11.3 CCPA Rights (California Residents)</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">
          If you are a California resident, you have additional rights under the California 
          Consumer Privacy Act (CCPA):
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Right to know what personal information is collected, used, shared, or sold</li>
          <li>Right to delete personal information held by businesses</li>
          <li>Right to opt-out of the sale of personal information (note: we do not sell personal information)</li>
          <li>Right to non-discrimination for exercising your CCPA rights</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          To exercise any of these rights, please contact us at{" "}
          <a href="mailto:privacy@bestly.tech" className="text-foreground underline">privacy@bestly.tech</a>. 
          We will respond to your request within the timeframe required by applicable law.
        </p>
      </>
    )},
    { id: "12", title: "12. Data Retention", content: (
      <p className="text-muted-foreground leading-relaxed">
        We retain your personal information only for as long as necessary to fulfill the purposes 
        for which it was collected, including to satisfy legal, accounting, or reporting requirements. 
        When we no longer need your personal information, we will securely delete or anonymize it.
      </p>
    )},
    { id: "13", title: "13. International Data Transfers", content: (
      <p className="text-muted-foreground leading-relaxed">
        Your information may be transferred to and processed in the United States, where our 
        servers are located. If you are accessing our Services from outside the United States, 
        please be aware that your information may be transferred to, stored, and processed in 
        a country with different data protection laws than your country of residence. We implement 
        appropriate safeguards for any such transfers.
      </p>
    )},
    { id: "14", title: "14. Children's Privacy", content: (
      <p className="text-muted-foreground leading-relaxed">
        Our Services are not intended for children under the age of 13 (or 16 in the EEA). 
        We do not knowingly collect personal information from children. If we learn that we 
        have collected personal information from a child, we will take steps to delete that 
        information promptly. If you believe we may have collected information from a child, 
        please contact us at{" "}
        <a href="mailto:privacy@bestly.tech" className="text-foreground underline">privacy@bestly.tech</a>.
      </p>
    )},
    { id: "15", title: "15. Cookie Yeti Browser Extension (Chrome and Safari)", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Cookie Yeti closes cookie pop-ups on the websites you visit and picks the most private option for you.
          This section explains exactly what data the extension collects, how we handle it, where and how long
          we store it, and who we share it with. It applies to the Chrome extension and the Safari extension
          for Mac, iPhone and iPad.
        </p>

        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">15.1 Data the extension collects</h3>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li><strong className="text-foreground">Website domain and address (origin only).</strong> When Cookie Yeti handles, misses or gets stuck on a cookie banner, it sends the site's domain (for example "example.com") and origin. It never sends the full page address, page path, search terms or page content outside the banner.</li>
          <li><strong className="text-foreground">Cookie banner details.</strong> The CSS selector of the banner button, the action taken (accept, reject, necessary, save or close), the consent platform's name, and, when a banner is missed or you tap "Report", up to 5,000 characters of the banner's own HTML so we can teach Cookie Yeti to handle it.</li>
          <li><strong className="text-foreground">Page-guard reports.</strong> If Cookie Yeti notices it scrolled a page or kept reopening something on a site, it sends the domain, a short reason (for example "scroll_jump"), the extension version and the browser type (Chrome or Safari).</li>
          <li><strong className="text-foreground">Anonymous usage analytics.</strong> A random install ID created on your device and simple events such as "installed", "banner handled today" or "upgrade started", with the extension version and platform. No email, web address, domain or IP address is stored with these events. You can turn this off in the extension's settings.</li>
          <li><strong className="text-foreground">Email address (Pro only).</strong> If you buy Cookie Yeti Pro or activate it on another device, we collect your email address to send an activation code and confirm your subscription. Payment card details go directly to Stripe; we never see or store them.</li>
          <li><strong className="text-foreground">Cookies on your device.</strong> The extension reads the names of cookies on the sites you visit, only on your device, to remove known tracking cookies. Cookie names and values are never sent to us.</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Cookie Yeti does not collect your name, browsing history, full web addresses, page content (other than the
          cookie banner itself), passwords, form entries, location, or financial information, and it does not track
          you across websites.
        </p>

        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">15.2 How we use and handle this data</h3>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Domains, selectors and banner HTML are used only to recognize and close cookie banners for all Cookie Yeti users, and to switch off a banner rule that misbehaves.</li>
          <li>Page-guard reports are used only to stop Cookie Yeti acting on a site where it causes problems. When several reports arrive for the same site, Cookie Yeti leaves that site alone for everyone for a period, then tries again.</li>
          <li>Anonymous analytics are used only to count installs and usage and to find bugs.</li>
          <li>Your email is used only to send activation codes, confirm Pro access and answer your support requests. We do not send marketing email to it unless you ask us to.</li>
          <li>Banner HTML may be processed by an AI service to write a new banner rule. Only the banner snippet is sent, never your identity.</li>
          <li>We never sell this data, never use it for advertising, and never use it to build a profile of you.</li>
        </ul>

        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">15.3 How and where we store it, and for how long</h3>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Data sent by the extension is stored in our database hosted by Supabase in the United States. It is encrypted in transit (HTTPS/TLS) and at rest, and only Bestly LLC staff who run Cookie Yeti can access it.</li>
          <li>Your settings, your own learned banner rules, your Pro status and sites Cookie Yeti has paused are stored only in your browser's extension storage on your device. Removing the extension deletes them.</li>
          <li>Page-guard reports are deleted after 90 days. Banner rules and banner reports are kept while they help Cookie Yeti work and are deleted when a rule is retired. Anonymous analytics events are kept for up to 24 months. Your email is kept while you have Pro access and deleted on request after that.</li>
        </ul>

        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">15.4 Who we share it with</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We do not sell, rent or trade Cookie Yeti data. We share it only with the service providers that run
          Cookie Yeti for us, under contracts that limit them to that purpose:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li><strong className="text-foreground">Supabase</strong> — database and server hosting for all of the data above.</li>
          <li><strong className="text-foreground">Stripe</strong> — payment processing for Cookie Yeti Pro (your email and payment details).</li>
          <li><strong className="text-foreground">Resend</strong> — sending activation-code emails (your email address).</li>
          <li><strong className="text-foreground">OpenAI</strong> — writing new banner rules from cookie banner HTML snippets (no identity or email is sent).</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Banner rules (domain, selector and action) are shared with other Cookie Yeti users so their extension can
          close the same banners. We may also disclose data if required by law.
        </p>

        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">15.5 Your choices</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">
          You can turn off anonymous analytics in the extension's settings, pause Cookie Yeti on any site, or remove the
          extension at any time. To see or delete data tied to your email or install ID, email{" "}
          <a href="mailto:privacy@bestly.tech" className="text-foreground underline">privacy@bestly.tech</a>. See also the{" "}
          <Link to="/cookie-yeti/privacy" className="text-foreground underline">Cookie Yeti Privacy Policy</Link>.
        </p>
      </>
    )},
    { id: "16", title: "16. Changes to This Policy", content: (
      <p className="text-muted-foreground leading-relaxed">
        We may update this Privacy Policy from time to time. We will notify you of any material 
        changes by posting the new Privacy Policy on this page and updating the "Last Updated" 
        date. For significant changes, we may provide additional notice (such as an email 
        notification). We encourage you to review this Privacy Policy periodically.
      </p>
    )},
    { id: "17", title: "17. Contact Us", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          If you have any questions about this Privacy Policy or our data practices, please 
          contact us:
        </p>
        <div className="bg-secondary/30 p-4 rounded-lg text-muted-foreground">
          <p><strong className="text-foreground">Bestly LLC</strong></p>
          <p>Los Angeles, CA, United States</p>
          <p>Email: <a href="mailto:privacy@bestly.tech" className="text-foreground underline">privacy@bestly.tech</a></p>
        </div>
      </>
    )},
  ];

  return (
    <>
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        {/* Page Header */}
        <AnimatedSection>
          <div className="mb-12">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Privacy Policy
            </h1>
            <p className="mt-4 text-muted-foreground">
              Last Updated: {lastUpdated}
            </p>
          </div>
        </AnimatedSection>

        {/* Content */}
        <div className="prose prose-neutral dark:prose-invert max-w-none">
          {sections.map((section, index) => (
            <AnimatedSection key={section.id} delay={Math.min(index * 60, 300)}>
              <section className="mb-12">
                <h2 className="text-2xl font-semibold text-foreground mb-4">{section.title}</h2>
                {section.content}
              </section>
            </AnimatedSection>
          ))}
        </div>

        {/* Navigation */}
        <AnimatedSection>
          <div className="border-t border-border pt-8 mt-12">
            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              <Link
                to="/terms-of-service"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                View Terms of Service →
              </Link>
              <Link
                to="/contact"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Contact Us →
              </Link>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </>
  );
}

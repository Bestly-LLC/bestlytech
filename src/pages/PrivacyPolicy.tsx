import { Link } from "react-router-dom";

export default function PrivacyPolicy() {
  const lastUpdated = "December 4, 2024";

  return (
    <>
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        {/* Page Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="mt-4 text-muted-foreground">
            Last Updated: {lastUpdated}
          </p>
        </div>

        {/* Content */}
        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">1. Introduction</h2>
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
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">2. Data Controller</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Bestly LLC is the data controller responsible for your personal information. Our contact 
              information is:
            </p>
            <div className="bg-secondary/30 p-4 rounded-lg text-muted-foreground">
              <p><strong className="text-foreground">Bestly LLC</strong></p>
              <p>Los Angeles, CA, United States</p>
              <p>Email: <a href="mailto:privacy@bestly.tech" className="text-foreground underline">privacy@bestly.tech</a></p>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">3. Information We Collect</h2>
            
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
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">4. Data Minimization Principle</h2>
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
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">5. How We Use Your Information</h2>
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
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">6. No Sale of Personal Data</h2>
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
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">7. Cross-App Tracking</h2>
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
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">8. Information Sharing and Disclosure</h2>
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
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">9. Cookies and Local Storage</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Our websites and applications may use cookies and local storage technologies. We use:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li><strong className="text-foreground">Essential Cookies:</strong> Required for basic functionality (e.g., session management, security).</li>
              <li><strong className="text-foreground">Preference Cookies:</strong> To remember your settings and preferences.</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mb-4">
              We do not use advertising or tracking cookies. You can control cookies through your 
              browser settings, though disabling essential cookies may affect functionality.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">10. Data Security</h2>
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
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">11. Your Rights</h2>
            
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
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">12. Data Retention</h2>
            <p className="text-muted-foreground leading-relaxed">
              We retain your personal information only for as long as necessary to fulfill the purposes 
              for which it was collected, including to satisfy legal, accounting, or reporting requirements. 
              When we no longer need your personal information, we will securely delete or anonymize it.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">13. International Data Transfers</h2>
            <p className="text-muted-foreground leading-relaxed">
              Your information may be transferred to and processed in the United States, where our 
              servers are located. If you are accessing our Services from outside the United States, 
              please be aware that your information may be transferred to, stored, and processed in 
              a country with different data protection laws than your country of residence. We implement 
              appropriate safeguards for any such transfers.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">14. Children's Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              Our Services are not intended for children under the age of 13 (or 16 in the EEA). 
              We do not knowingly collect personal information from children. If we learn that we 
              have collected personal information from a child, we will take steps to delete that 
              information promptly. If you believe we may have collected information from a child, 
              please contact us at{" "}
              <a href="mailto:privacy@bestly.tech" className="text-foreground underline">privacy@bestly.tech</a>.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">15. Cookie Yeti Extension – Community Pattern Sharing</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              The Cookie Yeti browser extension includes an optional community pattern sharing feature. 
              When enabled, the extension shares anonymized cookie banner detection patterns with our 
              community database to improve cookie consent detection for all users.
            </p>
            <h3 className="text-xl font-medium text-foreground mb-3 mt-6">Data Shared</h3>
            <p className="text-muted-foreground leading-relaxed mb-4">
              The only data shared through this feature includes:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li><strong className="text-foreground">Website domain names</strong> (e.g., "example.com")</li>
              <li><strong className="text-foreground">CSS selectors</strong> used to identify cookie consent banners</li>
              <li><strong className="text-foreground">Action types</strong> (accept, reject, necessary, save, or close)</li>
              <li><strong className="text-foreground">CMP fingerprints</strong> (consent management platform identifiers)</li>
            </ul>
            <h3 className="text-xl font-medium text-foreground mb-3 mt-6">Data NOT Collected</h3>
            <p className="text-muted-foreground leading-relaxed mb-4">
              This feature does <strong className="text-foreground">not</strong> collect any of the following:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li>Personal information of any kind</li>
              <li>Browsing history or page content</li>
              <li>IP addresses or geolocation data</li>
              <li>Cookies or cookie values from websites</li>
              <li>User identifiers, accounts, or device fingerprints</li>
            </ul>
            <h3 className="text-xl font-medium text-foreground mb-3 mt-6">Opt-In & Control</h3>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Community pattern sharing is entirely <strong className="text-foreground">opt-in</strong> and 
              can be disabled at any time in the Cookie Yeti extension settings. Shared pattern data is 
              stored securely and used solely to improve cookie banner detection accuracy for all Cookie 
              Yeti users.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              For Cookie Yeti's complete privacy policy, see the{" "}
              <Link to="/cookie-yeti/privacy" className="text-foreground underline">Cookie Yeti Privacy Policy</Link>.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">16. Changes to This Policy</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of any material 
              changes by posting the new Privacy Policy on this page and updating the "Last Updated" 
              date. For significant changes, we may provide additional notice (such as an email 
              notification). We encourage you to review this Privacy Policy periodically.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">17. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              If you have any questions about this Privacy Policy or our data practices, please 
              contact us:
            </p>
            <div className="bg-secondary/30 p-4 rounded-lg text-muted-foreground">
              <p><strong className="text-foreground">Bestly LLC</strong></p>
              <p>Los Angeles, CA, United States</p>
              <p>Email: <a href="mailto:privacy@bestly.tech" className="text-foreground underline">privacy@bestly.tech</a></p>
            </div>
          </section>
        </div>

        {/* Navigation */}
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
      </div>
    </>
  );
}

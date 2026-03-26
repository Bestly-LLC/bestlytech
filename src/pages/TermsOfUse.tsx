import { Link } from "react-router-dom";
import { AnimatedSection } from "@/components/AnimatedSection";
import { SEOHead } from "@/components/SEOHead";

export default function TermsOfUse() {
  const lastUpdated = "March 25, 2026";

  const sections = [
    { id: "1", title: "1. Acceptance of Terms", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          These Terms of Use ("Terms") constitute a legally binding agreement between you ("User," "you," or "your") and Bestly LLC ("Bestly," "we," "us," or "our"), a limited liability company organized under the laws of the State of California, United States, with its principal place of business in Los Angeles, California.
        </p>
        <p className="text-muted-foreground leading-relaxed mb-4">
          By downloading, installing, accessing, or using any of our mobile applications, browser extensions, websites, or related services (collectively, the "Services"), you acknowledge that you have read, understood, and agree to be bound by these Terms and our <Link to="/privacy-policy" className="text-foreground underline">Privacy Policy</Link>.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          If you do not agree to these Terms, you must not access or use our Services. We reserve the right to modify these Terms at any time. Your continued use of the Services after any modification constitutes acceptance of the updated Terms.
        </p>
      </>
    )},
    { id: "2", title: "2. Description of Services", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Bestly LLC develops and operates a portfolio of software applications, browser extensions, and related digital services. Our current products include, but are not limited to:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li><strong className="text-foreground">Cookie Yeti:</strong> A privacy-focused browser extension and mobile application that automatically manages cookie consent banners based on your preferences. Available on the Apple App Store (Safari extension for iOS and macOS) and the Chrome Web Store.</li>
          <li><strong className="text-foreground">InventoryProof:</strong> An inventory management and documentation application designed for e-commerce sellers and small businesses.</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Certain features within our applications are available through auto-renewable subscriptions and one-time purchases processed through the Apple App Store, Google Play Store, Chrome Web Store, or directly through our website via Stripe.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          We reserve the right to modify, suspend, or discontinue any part of the Services at any time, with or without notice. We shall not be liable to you or any third party for any modification, suspension, or discontinuation of the Services.
        </p>
      </>
    )},
    { id: "3", title: "3. User Accounts", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Some features of our Services may require you to provide an email address or create an account. You agree to:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Provide accurate, current, and complete information during registration or activation</li>
          <li>Maintain and promptly update your information to keep it accurate and complete</li>
          <li>Maintain the security of your account credentials and activation codes</li>
          <li>Accept responsibility for all activities that occur under your account</li>
          <li>Notify us immediately of any unauthorized use of your account</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          We reserve the right to suspend or terminate accounts that violate these Terms or that we reasonably believe are being used fraudulently.
        </p>
      </>
    )},
    { id: "4", title: "4. Subscription Terms & Auto-Renewal", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Our applications offer the following subscription and purchase options:
        </p>
        <div className="bg-secondary/30 p-4 rounded-lg mb-4">
          <ul className="text-muted-foreground space-y-2">
            <li><strong className="text-foreground">Monthly Subscription:</strong> $0.99/month — auto-renewable</li>
            <li><strong className="text-foreground">Yearly Subscription:</strong> $7.99/year — auto-renewable</li>
            <li><strong className="text-foreground">Lifetime Access:</strong> $149.99 — one-time, non-consumable purchase</li>
          </ul>
        </div>

        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">4.1 Apple App Store Subscriptions</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">
          For subscriptions purchased through the Apple App Store, the following terms apply in accordance with Apple's requirements:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Payment is charged to your Apple ID account at confirmation of purchase.</li>
          <li>Subscriptions automatically renew unless auto-renew is turned off at least 24 hours before the end of the current period.</li>
          <li>Your account will be charged for renewal within 24 hours prior to the end of the current period at the rate of the selected plan.</li>
          <li>You can manage and cancel your subscriptions by going to your Apple ID account settings on your device after purchase.</li>
          <li>Any unused portion of a free trial period, if offered, will be forfeited when you purchase a subscription.</li>
        </ul>

        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">4.2 Web & Chrome Extension Subscriptions</h3>
        <p className="text-muted-foreground leading-relaxed mb-4">
          For subscriptions purchased through our website or the Chrome Web Store, payments are processed by Stripe. The following terms apply:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Subscriptions automatically renew at the end of each billing period unless canceled before the renewal date.</li>
          <li>You may cancel your subscription at any time through your account settings or by contacting us at <a href="mailto:support@bestly.tech" className="text-foreground underline">support@bestly.tech</a>.</li>
          <li>Cancellation takes effect at the end of the current billing period. You will retain access until then.</li>
        </ul>

        <h3 className="text-xl font-medium text-foreground mb-3 mt-6">4.3 Refunds</h3>
        <p className="text-muted-foreground leading-relaxed">
          For Apple App Store purchases, refund requests are handled by Apple in accordance with their refund policies. For web purchases processed through Stripe, please contact us at <a href="mailto:support@bestly.tech" className="text-foreground underline">support@bestly.tech</a> within 14 days of purchase for a refund. Lifetime purchases are non-refundable after 30 days.
        </p>
      </>
    )},
    { id: "5", title: "5. Intellectual Property", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          All content, features, functionality, software, code, designs, logos, trademarks, service marks, and trade names associated with our Services (collectively, "Bestly IP") are owned by Bestly LLC or its licensors and are protected by United States and international intellectual property laws.
        </p>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable, revocable license to access and use the Services for your personal, non-commercial use. This license does not include the right to:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Modify, reproduce, distribute, or create derivative works based on the Services</li>
          <li>Reverse engineer, decompile, or disassemble any part of the Services</li>
          <li>Remove, alter, or obscure any proprietary notices or labels</li>
          <li>Use the Services for any commercial purpose without our prior written consent</li>
          <li>Use any data mining, robots, or similar data gathering methods on the Services</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          The Cookie Yeti name, logo, and yeti character are trademarks of Bestly LLC. All other trademarks not owned by Bestly LLC that appear in the Services are the property of their respective owners.
        </p>
      </>
    )},
    { id: "6", title: "6. User Conduct", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          You agree not to use the Services to:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Violate any applicable federal, state, local, or international law or regulation</li>
          <li>Infringe upon the rights of others, including intellectual property rights</li>
          <li>Transmit any malicious code, viruses, or harmful software</li>
          <li>Attempt to gain unauthorized access to any part of the Services, other accounts, or computer systems</li>
          <li>Interfere with or disrupt the integrity or performance of the Services</li>
          <li>Collect or harvest any information from the Services without authorization</li>
          <li>Use the Services to engage in any form of fraud, abuse, or harassment</li>
          <li>Circumvent, disable, or otherwise interfere with security-related features of the Services</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          Violation of these conduct rules may result in immediate termination of your access to the Services without notice or refund.
        </p>
      </>
    )},
    { id: "7", title: "7. Community Pattern Data", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Cookie Yeti includes an optional community pattern sharing feature. By opting in, you agree that any cookie banner detection patterns you contribute (consisting solely of website domain names and CSS selectors) become part of our shared community database and may be used to improve the Service for all users.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          You retain no proprietary rights over contributed pattern data. We reserve the right to modify, remove, or use contributed patterns at our sole discretion to maintain the quality and accuracy of the community database.
        </p>
      </>
    )},
    { id: "8", title: "8. Disclaimer of Warranties", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
        </p>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Without limiting the foregoing, Bestly LLC does not warrant that:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>The Services will be uninterrupted, timely, secure, or error-free</li>
          <li>The results obtained from use of the Services will be accurate or reliable</li>
          <li>Cookie Yeti will successfully detect and manage all cookie consent banners on all websites</li>
          <li>The Services will meet your specific requirements</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          You acknowledge that cookie consent banner implementations vary across websites and are subject to change without notice, which may affect the functionality of Cookie Yeti.
        </p>
      </>
    )},
    { id: "9", title: "9. Limitation of Liability", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL BESTLY LLC, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION, LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Your access to, use of, or inability to access or use the Services</li>
          <li>Any conduct or content of any third party on the Services</li>
          <li>Any content obtained from the Services</li>
          <li>Unauthorized access, use, or alteration of your transmissions or content</li>
          <li>Failure of Cookie Yeti to detect, manage, or properly handle any cookie consent banner</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS EXCEED THE AMOUNT YOU HAVE PAID US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR ONE HUNDRED DOLLARS ($100), WHICHEVER IS GREATER.
        </p>
      </>
    )},
    { id: "10", title: "10. Indemnification", content: (
      <p className="text-muted-foreground leading-relaxed">
        You agree to defend, indemnify, and hold harmless Bestly LLC and its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, obligations, losses, liabilities, costs, or expenses (including reasonable attorneys' fees) arising from: (a) your use of the Services; (b) your violation of these Terms; (c) your violation of any third-party right, including any intellectual property or privacy right; or (d) any claim that your use of the Services caused damage to a third party.
      </p>
    )},
    { id: "11", title: "11. Termination", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          We may terminate or suspend your access to the Services immediately, without prior notice or liability, for any reason, including without limitation if you breach these Terms.
        </p>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Upon termination:
        </p>
        <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
          <li>Your license to use the Services will immediately cease</li>
          <li>You must uninstall and destroy all copies of our applications</li>
          <li>Any provisions of these Terms that by their nature should survive termination will survive, including ownership provisions, warranty disclaimers, indemnity, and limitations of liability</li>
        </ul>
        <p className="text-muted-foreground leading-relaxed">
          You may terminate your use of the Services at any time by uninstalling our applications and ceasing all use. For active subscriptions, please cancel through your Apple ID account settings, Chrome Web Store, or by contacting us before your next billing cycle.
        </p>
      </>
    )},
    { id: "12", title: "12. Governing Law & Dispute Resolution", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          These Terms shall be governed by and construed in accordance with the laws of the State of California, United States, without regard to its conflict of law provisions.
        </p>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Any dispute arising out of or relating to these Terms or the Services shall first be attempted to be resolved through good-faith negotiation. If the dispute cannot be resolved through negotiation within thirty (30) days, either party may submit the dispute to binding arbitration in Los Angeles County, California, in accordance with the rules of the American Arbitration Association.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          You agree that any dispute resolution proceedings will be conducted only on an individual basis and not in a class, consolidated, or representative action. You waive any right to participate in a class action lawsuit or class-wide arbitration against Bestly LLC.
        </p>
      </>
    )},
    { id: "13", title: "13. Severability", content: (
      <p className="text-muted-foreground leading-relaxed">
        If any provision of these Terms is held to be unenforceable or invalid, such provision will be modified to the minimum extent necessary to make it enforceable, and the remaining provisions will continue in full force and effect.
      </p>
    )},
    { id: "14", title: "14. Entire Agreement", content: (
      <p className="text-muted-foreground leading-relaxed">
        These Terms, together with our <Link to="/privacy-policy" className="text-foreground underline">Privacy Policy</Link> and any product-specific terms, constitute the entire agreement between you and Bestly LLC regarding the use of the Services and supersede all prior agreements, understandings, and communications, whether written or oral.
      </p>
    )},
    { id: "15", title: "15. Contact Information", content: (
      <>
        <p className="text-muted-foreground leading-relaxed mb-4">
          If you have any questions about these Terms, please contact us:
        </p>
        <div className="bg-secondary/30 p-4 rounded-lg text-muted-foreground">
          <p><strong className="text-foreground">Bestly LLC</strong></p>
          <p>Los Angeles, CA, United States</p>
          <p>Email: <a href="mailto:privacy@bestly.tech" className="text-foreground underline">privacy@bestly.tech</a></p>
          <p>Website: <a href="https://bestly.tech" className="text-foreground underline">https://bestly.tech</a></p>
        </div>
      </>
    )},
  ];

  return (
    <>
      <SEOHead
        title="Terms of Use"
        description="Terms of Use and End User License Agreement for Bestly LLC products including Cookie Yeti and InventoryProof."
        path="/terms-of-use"
      />
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        <AnimatedSection>
          <div className="mb-12">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Terms of Use
            </h1>
            <p className="mt-2 text-lg text-muted-foreground">
              End User License Agreement (EULA)
            </p>
            <p className="mt-4 text-muted-foreground">
              Last Updated: {lastUpdated}
            </p>
          </div>
        </AnimatedSection>

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

        <AnimatedSection>
          <div className="border-t border-border pt-8 mt-12">
            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              <Link
                to="/privacy-policy"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                View Privacy Policy →
              </Link>
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

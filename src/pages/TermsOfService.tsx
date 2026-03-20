import { Link } from "react-router-dom";
import { Link } from "react-router-dom";

export default function TermsOfService() {
  const lastUpdated = "December 4, 2024";

  return (
    <>
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        {/* Page Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Terms of Service
          </h1>
          <p className="mt-4 text-muted-foreground">
            Last Updated: {lastUpdated}
          </p>
        </div>

        {/* Content */}
        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">1. Agreement to Terms</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              These Terms of Service ("Terms") constitute a legally binding agreement between you 
              ("User," "you," or "your") and Bestly LLC ("Bestly," "we," "us," or "our") governing 
              your access to and use of our websites, mobile applications, browser extensions, 
              physical products, devices, and related services (collectively, the "Services").
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              By accessing or using our Services, you agree to be bound by these Terms. If you do 
              not agree to these Terms, you may not access or use our Services.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              These Master Terms of Service apply to all Bestly LLC products and services unless a 
              specific product has its own terms that supplement or modify these Terms. In case of 
              conflict, product-specific terms will govern for that particular product.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">2. Eligibility</h2>
            <p className="text-muted-foreground leading-relaxed">
              You must be at least 13 years old (or 16 in the European Economic Area) to use our 
              Services. By using our Services, you represent and warrant that you meet this age 
              requirement. If you are using our Services on behalf of an organization, you represent 
              and warrant that you have authority to bind that organization to these Terms.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">3. Account Registration</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Some of our Services may require you to create an account. When creating an account, 
              you agree to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Provide accurate, current, and complete information</li>
              <li>Maintain and promptly update your account information</li>
              <li>Maintain the security of your account credentials</li>
              <li>Accept responsibility for all activities that occur under your account</li>
              <li>Notify us immediately of any unauthorized access or use of your account</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">4. Software License</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Subject to your compliance with these Terms, Bestly LLC grants you a limited, 
              non-exclusive, non-transferable, revocable license to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li>Access and use our web-based Services for your personal, non-commercial use</li>
              <li>Download and install our mobile applications on devices you own or control</li>
              <li>Install our browser extensions on browsers you use</li>
              <li>Use any companion software provided with our physical products</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed">
              This license does not include the right to: (a) modify, copy, or create derivative 
              works; (b) reverse engineer, decompile, or disassemble our software; (c) rent, lease, 
              loan, sell, or sublicense; (d) remove or alter any proprietary notices; or (e) use 
              the Services in any way that violates applicable laws.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">5. Physical Products</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              For physical products sold or distributed by Bestly LLC:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li><strong className="text-foreground">Product Use:</strong> You agree to use our physical products only for their intended purpose and in accordance with any provided instructions.</li>
              <li><strong className="text-foreground">Safety:</strong> You are responsible for using products safely and keeping them away from children when appropriate.</li>
              <li><strong className="text-foreground">Warranty:</strong> Physical products are provided with the warranty stated at the time of purchase, if any.</li>
              <li><strong className="text-foreground">Companion Apps:</strong> If a physical product includes a companion application, your use of that application is also governed by these Terms and any product-specific terms.</li>
            </ul>
            
            <h3 className="text-xl font-medium text-foreground mb-3 mt-6">5.1 Wellness Products Disclaimer</h3>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Certain Bestly LLC products may be wellness-adjacent or cosmetic in nature. For these products:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Our products are not intended to diagnose, treat, cure, or prevent any disease</li>
              <li>Our products are not medical devices unless explicitly stated and approved</li>
              <li>Consult with a healthcare professional before using any wellness product if you have health concerns</li>
              <li>Results may vary between individuals</li>
              <li>Discontinue use if you experience any adverse reactions</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">6. Prohibited Uses</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              You agree not to use our Services to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Violate any applicable law, regulation, or third-party rights</li>
              <li>Engage in fraudulent, deceptive, or misleading activities</li>
              <li>Distribute malware, viruses, or other harmful code</li>
              <li>Attempt to gain unauthorized access to our systems or other users' accounts</li>
              <li>Interfere with or disrupt the integrity or performance of our Services</li>
              <li>Scrape, crawl, or use automated means to access our Services without permission</li>
              <li>Use our Services for any commercial purpose without our written consent</li>
              <li>Impersonate any person or entity or misrepresent your affiliation</li>
              <li>Harass, abuse, or harm another person or entity</li>
              <li>Collect or store personal data about other users without their consent</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">7. Intellectual Property</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              All content, features, and functionality of our Services—including but not limited to 
              text, graphics, logos, icons, images, audio, video, software, and the compilation 
              thereof—are the exclusive property of Bestly LLC or its licensors and are protected 
              by United States and international copyright, trademark, patent, trade secret, and 
              other intellectual property laws.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              The Bestly name, logo, and all related names, logos, product and service names, 
              designs, and slogans are trademarks of Bestly LLC. You may not use such marks without 
              our prior written permission.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">8. User Content</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Our Services may allow you to create, upload, or share content ("User Content"). 
              You retain ownership of your User Content, but you grant Bestly LLC a worldwide, 
              royalty-free, non-exclusive license to use, reproduce, modify, and display your 
              User Content solely for the purpose of providing and improving our Services.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              You represent and warrant that you own or have the necessary rights to your User 
              Content and that your User Content does not violate any third-party rights or 
              applicable laws.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">9. Third-Party Services</h2>
            <p className="text-muted-foreground leading-relaxed">
              Our Services may contain links to third-party websites, services, or content that 
              are not owned or controlled by Bestly LLC. We have no control over and assume no 
              responsibility for the content, privacy policies, or practices of any third-party 
              services. Your use of third-party services is at your own risk and subject to the 
              terms and policies of those services.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">10. Payments and Refunds</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              For paid Services or products:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li>All prices are in U.S. dollars unless otherwise stated</li>
              <li>Payment is due at the time of purchase</li>
              <li>We use third-party payment processors; their terms apply to payment transactions</li>
              <li>You are responsible for any applicable taxes</li>
            </ul>
            <div className="bg-secondary/30 p-4 rounded-lg text-muted-foreground">
              <p className="font-medium text-foreground mb-2">eCommerce Notice</p>
              <p>
                Detailed refund and return policies will become active upon the launch of our 
                eCommerce operations. Current policies will be clearly displayed at the point 
                of purchase for any products available for sale.
              </p>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">11. Disclaimer of Warranties</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              YOUR USE OF OUR SERVICES IS AT YOUR SOLE RISK. THE SERVICES ARE PROVIDED ON AN 
              "AS IS" AND "AS AVAILABLE" BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS 
              OR IMPLIED.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              TO THE FULLEST EXTENT PERMITTED BY LAW, BESTLY LLC DISCLAIMS ALL WARRANTIES, 
              EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, 
              FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              WE DO NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE, 
              THAT DEFECTS WILL BE CORRECTED, OR THAT OUR SERVICES OR SERVERS ARE FREE OF VIRUSES 
              OR OTHER HARMFUL COMPONENTS.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">12. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL BESTLY LLC, 
              ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, 
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED 
              TO LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING OUT OF 
              OR IN CONNECTION WITH:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li>Your access to or use of (or inability to access or use) the Services</li>
              <li>Any conduct or content of any third party on the Services</li>
              <li>Any content obtained from the Services</li>
              <li>Unauthorized access, use, or alteration of your transmissions or content</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed">
              IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR 
              RELATING TO THESE TERMS OR THE SERVICES EXCEED THE AMOUNT YOU PAID TO US IN THE 
              TWELVE (12) MONTHS PRECEDING THE CLAIM, OR ONE HUNDRED DOLLARS ($100), WHICHEVER 
              IS GREATER.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">13. Indemnification</h2>
            <p className="text-muted-foreground leading-relaxed">
              You agree to defend, indemnify, and hold harmless Bestly LLC and its officers, 
              directors, employees, agents, and affiliates from and against any claims, liabilities, 
              damages, losses, and expenses (including reasonable attorneys' fees) arising out of 
              or in any way connected with: (a) your access to or use of the Services; (b) your 
              violation of these Terms; (c) your violation of any third-party right, including 
              intellectual property rights; or (d) your User Content.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">14. Governing Law</h2>
            <p className="text-muted-foreground leading-relaxed">
              These Terms and any dispute arising out of or related to these Terms or the Services 
              shall be governed by and construed in accordance with the laws of the State of 
              California, United States, without regard to its conflict of law provisions.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">15. Dispute Resolution and Arbitration</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              <strong className="text-foreground">Informal Resolution:</strong> Before filing any formal 
              dispute, you agree to contact us at{" "}
              <a href="mailto:support@bestly.tech" className="text-foreground underline">support@bestly.tech</a>{" "}
              to attempt to resolve the dispute informally.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              <strong className="text-foreground">Binding Arbitration:</strong> If we cannot resolve a 
              dispute informally within 30 days, either party may elect to resolve the dispute 
              through binding arbitration administered by JAMS in Los Angeles County, California, 
              under its Streamlined Arbitration Rules.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-4">
              <strong className="text-foreground">Class Action Waiver:</strong> YOU AGREE THAT ANY DISPUTE 
              RESOLUTION PROCEEDINGS WILL BE CONDUCTED ONLY ON AN INDIVIDUAL BASIS AND NOT IN A 
              CLASS, CONSOLIDATED, OR REPRESENTATIVE ACTION.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Exceptions:</strong> Either party may seek injunctive 
              or other equitable relief in any court of competent jurisdiction to prevent actual 
              or threatened infringement of intellectual property rights.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">16. Termination</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              We may terminate or suspend your access to our Services immediately, without prior 
              notice or liability, for any reason, including if you breach these Terms.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Upon termination, your right to use the Services will immediately cease. If you wish 
              to terminate your account, you may do so by contacting us or using account settings 
              where available. All provisions of these Terms that by their nature should survive 
              termination shall survive.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">17. Changes to Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              We reserve the right to modify these Terms at any time. We will notify you of any 
              material changes by posting the new Terms on this page and updating the "Last Updated" 
              date. For significant changes, we may provide additional notice. Your continued use 
              of the Services after any changes constitutes your acceptance of the new Terms.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">18. Severability</h2>
            <p className="text-muted-foreground leading-relaxed">
              If any provision of these Terms is held to be invalid, illegal, or unenforceable, 
              the remaining provisions shall continue in full force and effect.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">19. Entire Agreement</h2>
            <p className="text-muted-foreground leading-relaxed">
              These Terms, together with our Privacy Policy and any product-specific terms, 
              constitute the entire agreement between you and Bestly LLC regarding your use 
              of the Services and supersede all prior agreements and understandings.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">20. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              If you have any questions about these Terms, please contact us:
            </p>
            <div className="bg-secondary/30 p-4 rounded-lg text-muted-foreground">
              <p><strong className="text-foreground">Bestly LLC</strong></p>
              <p>Los Angeles, CA, United States</p>
              <p>Email: <a href="mailto:support@bestly.tech" className="text-foreground underline">support@bestly.tech</a></p>
            </div>
          </section>
        </div>

        {/* Navigation */}
        <div className="border-t border-border pt-8 mt-12">
          <div className="flex flex-col sm:flex-row gap-4 justify-between">
            <Link
              to="/privacy-policy"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← View Privacy Policy
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

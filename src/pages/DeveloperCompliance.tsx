import { Link } from "react-router-dom";
import { CheckCircle } from "lucide-react";

export default function DeveloperCompliance() {
  return (
    <>
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        {/* Page Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Developer & Platform Compliance
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            This page provides compliance information for app stores, browser extension stores, 
            and platform verification processes.
          </p>
        </div>

        {/* Company Information */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Legal Entity Information</h2>
          <div className="bg-card border border-border rounded-xl p-6">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Legal Entity Name</dt>
                <dd className="mt-1 text-foreground">Bestly LLC</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Entity Type</dt>
                <dd className="mt-1 text-foreground">Limited Liability Company (LLC)</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Jurisdiction</dt>
                <dd className="mt-1 text-foreground">United States</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Business Location</dt>
                <dd className="mt-1 text-foreground">Los Angeles, CA, United States</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Official Domain</dt>
                <dd className="mt-1 text-foreground">
                  <a href="https://bestly.tech" className="text-primary hover:underline">
                    bestly.tech
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">D-U-N-S Number</dt>
                <dd className="mt-1 text-foreground">Available upon request</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Authority to Sign */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Authority to Sign</h2>
          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <p className="text-muted-foreground leading-relaxed">
              Bestly LLC is a founder-led company. All developer program agreements, distribution 
              agreements, and legal documents related to app distribution are signed by authorized 
              representatives with full legal authority to bind the company to such agreements.
            </p>
          </div>
        </section>

        {/* App Distribution Compliance */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-6">App Distribution Compliance</h2>
          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-6">
              Bestly LLC commits to full compliance with the guidelines and policies of all platforms 
              where our applications are distributed, including but not limited to:
            </p>
            
            <div className="grid gap-4 sm:grid-cols-2 mb-6">
              <div className="bg-secondary/30 p-4 rounded-lg">
                <h4 className="font-medium text-foreground mb-2">Apple App Store</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• App Store Review Guidelines</li>
                  <li>• Apple Developer Program Agreement</li>
                  <li>• iOS Human Interface Guidelines</li>
                </ul>
              </div>
              
              <div className="bg-secondary/30 p-4 rounded-lg">
                <h4 className="font-medium text-foreground mb-2">Google Play Store</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Google Play Developer Program Policies</li>
                  <li>• Google Play Developer Distribution Agreement</li>
                  <li>• Material Design Guidelines</li>
                </ul>
              </div>
              
              <div className="bg-secondary/30 p-4 rounded-lg">
                <h4 className="font-medium text-foreground mb-2">Chrome Web Store</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Chrome Web Store Program Policies</li>
                  <li>• Chrome Extension Quality Guidelines</li>
                  <li>• Manifest V3 Compliance</li>
                </ul>
              </div>
              
              <div className="bg-secondary/30 p-4 rounded-lg">
                <h4 className="font-medium text-foreground mb-2">Other Platforms</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Firefox Add-ons Policies</li>
                  <li>• Safari Extensions Guidelines</li>
                  <li>• Microsoft Edge Add-ons Policies</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Data Privacy & Security */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Data Privacy & Security Posture</h2>
          <div className="space-y-4">
            {[
              {
                title: "Privacy-First Design",
                description: "All products are designed with privacy as a foundational requirement, not an afterthought."
              },
              {
                title: "Data Minimization",
                description: "We collect only the data strictly necessary for product functionality."
              },
              {
                title: "On-Device Processing",
                description: "Data processing occurs on-device whenever technically feasible."
              },
              {
                title: "No Data Sales",
                description: "Personal information is never sold to third parties."
              },
              {
                title: "Encryption Standards",
                description: "Data in transit and at rest is protected using industry-standard encryption."
              },
              {
                title: "Regular Security Audits",
                description: "Our systems undergo regular security assessments and updates."
              },
              {
                title: "Transparent AI Usage",
                description: "When AI is used, we clearly disclose its role and data handling."
              },
              {
                title: "User Control",
                description: "Users can access, modify, and delete their data at any time."
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-3">
                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-foreground">{item.title}</h4>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Physical Products & Companion Apps */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Physical Products & Companion Apps</h2>
          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              For physical products that include companion mobile applications or require software 
              integration:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Companion apps are subject to the same privacy and security standards as standalone apps</li>
              <li>Device data collection is clearly disclosed before any data transmission</li>
              <li>Users can use physical products without companion apps when possible</li>
              <li>Sensor and device data is processed locally when feasible</li>
              <li>Product-specific privacy policies detail exact data handling for each device</li>
            </ul>
          </div>
        </section>

        {/* Consumer Rights Compliance */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Consumer Rights Compliance</h2>
          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <p className="text-muted-foreground leading-relaxed mb-4">
              Bestly LLC supports and complies with consumer data protection regulations including:
            </p>
            
            <div className="grid gap-4 sm:grid-cols-2 mb-6">
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-foreground mb-2">GDPR (EU/EEA)</h4>
                <p className="text-sm text-muted-foreground">
                  General Data Protection Regulation compliance for European users, including 
                  data access, portability, deletion, and consent requirements.
                </p>
              </div>
              
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-foreground mb-2">CCPA (California)</h4>
                <p className="text-sm text-muted-foreground">
                  California Consumer Privacy Act compliance, including right to know, delete, 
                  and opt-out provisions.
                </p>
              </div>
              
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-foreground mb-2">App Tracking Transparency</h4>
                <p className="text-sm text-muted-foreground">
                  Full compliance with Apple's ATT framework. We do not engage in cross-app 
                  tracking without explicit user consent.
                </p>
              </div>
              
              <div className="border border-border rounded-lg p-4">
                <h4 className="font-medium text-foreground mb-2">COPPA</h4>
                <p className="text-sm text-muted-foreground">
                  Children's Online Privacy Protection Act compliance. Our services are not 
                  directed at children under 13.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Contact for Verification */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Platform Verification Contact</h2>
          <div className="bg-card border border-border rounded-xl p-6">
            <p className="text-muted-foreground mb-4">
              For platform verification inquiries, app review escalations, or compliance questions, 
              please contact:
            </p>
            <div className="space-y-2 text-muted-foreground">
              <p>
                <strong className="text-foreground">Email:</strong>{" "}
                <a href="mailto:support@bestly.tech" className="text-primary hover:underline">
                  support@bestly.tech
                </a>
              </p>
              <p>
                <strong className="text-foreground">Privacy Inquiries:</strong>{" "}
                <a href="mailto:privacy@bestly.tech" className="text-primary hover:underline">
                  privacy@bestly.tech
                </a>
              </p>
              <p>
                <strong className="text-foreground">Official Website:</strong>{" "}
                <a href="https://bestly.tech" className="text-primary hover:underline">
                  bestly.tech
                </a>
              </p>
            </div>
          </div>
        </section>

        {/* Legal Documents */}
        <section className="border-t border-border pt-12">
          <h2 className="text-xl font-semibold text-foreground mb-6">Related Legal Documents</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              to="/privacy-policy"
              className="block p-4 border border-border rounded-lg hover:bg-secondary/30 transition-colors"
            >
              <h3 className="font-medium text-foreground mb-1">Privacy Policy</h3>
              <p className="text-sm text-muted-foreground">
                Complete privacy policy covering all Bestly LLC services.
              </p>
            </Link>
            <Link
              to="/terms-of-service"
              className="block p-4 border border-border rounded-lg hover:bg-secondary/30 transition-colors"
            >
              <h3 className="font-medium text-foreground mb-1">Terms of Service</h3>
              <p className="text-sm text-muted-foreground">
                Terms governing the use of all Bestly LLC products.
              </p>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

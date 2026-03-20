import { useParams, Link } from "react-router-dom";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function ProductLegal() {
  const { productId } = useParams<{ productId: string }>();

  const productData = {
    name: "Product Name",
    category: "App",
    lastUpdated: "December 4, 2024",
  };

  return (
    <>
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        <AnimatedSection>
          <div className="mb-12">
            <nav className="mb-4">
              <Link to="/products" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                ← Back to Products
              </Link>
            </nav>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {productData.name} - Legal Information
            </h1>
            <p className="mt-4 text-muted-foreground">
              Product Category: {productData.category} | Last Updated: {productData.lastUpdated}
            </p>
          </div>
        </AnimatedSection>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <AnimatedSection delay={80}>
            <section className="mb-12 p-6 bg-secondary/30 rounded-xl border border-border">
              <h2 className="text-xl font-semibold text-foreground mb-2 mt-0">Relationship to Parent Policies</h2>
              <p className="text-muted-foreground mb-0">
                This product-specific legal information supplements our{" "}
                <Link to="/privacy-policy" className="text-foreground underline">Master Privacy Policy</Link>{" "}and{" "}
                <Link to="/terms-of-service" className="text-foreground underline">Master Terms of Service</Link>.
                In case of conflict, this product-specific policy governs for this product only.
              </p>
            </section>
          </AnimatedSection>

          {[
            { title: "Product Category", content: (
              <>
                <p className="text-muted-foreground leading-relaxed">This product is classified as: <strong className="text-foreground">{productData.category}</strong></p>
                <p className="text-muted-foreground leading-relaxed mt-2">[Description of what this product does and its primary purpose]</p>
              </>
            )},
            { title: "Data Handling Summary", content: (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border"><th className="text-left py-2 text-foreground">Data Type</th><th className="text-left py-2 text-foreground">Collected</th><th className="text-left py-2 text-foreground">Purpose</th></tr></thead>
                  <tbody className="text-muted-foreground">
                    {["Account Information", "Usage Data", "Device Information"].map((type) => (
                      <tr key={type} className="border-b border-border"><td className="py-2">{type}</td><td className="py-2">[Yes/No]</td><td className="py-2">[Purpose if collected]</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )},
            { title: "Where Data is Processed", content: (
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">On-Device Processing:</strong> [Yes/No - Description]</li>
                <li><strong className="text-foreground">Cloud Processing:</strong> [Yes/No - Description]</li>
                <li><strong className="text-foreground">Data Transmission:</strong> [Description of what data, if any, leaves the device]</li>
              </ul>
            )},
            { title: "AI Usage Disclosure", content: (
              <>
                <p className="text-muted-foreground leading-relaxed">[If AI is used in this product, describe:]</p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-4">
                  <li>What AI features are included</li><li>What data the AI processes</li>
                  <li>Whether AI processing happens on-device or in the cloud</li><li>How AI decisions affect the user experience</li>
                </ul>
                <p className="text-muted-foreground leading-relaxed mt-4">[Or state: "This product does not use artificial intelligence features."]</p>
              </>
            )},
            { title: "Device & Sensor Access", content: (
              <>
                <p className="text-muted-foreground leading-relaxed">[For apps that access device features or for physical products with sensors:]</p>
                <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-4">
                  <li><strong className="text-foreground">Camera:</strong> [Yes/No - Purpose]</li>
                  <li><strong className="text-foreground">Microphone:</strong> [Yes/No - Purpose]</li>
                  <li><strong className="text-foreground">Location:</strong> [Yes/No - Purpose]</li>
                  <li><strong className="text-foreground">Sensors:</strong> [List any sensors and their purpose]</li>
                </ul>
              </>
            )},
            { title: "Data Storage", content: (
              <ul className="list-disc pl-6 text-muted-foreground space-y-2">
                <li><strong className="text-foreground">Local Storage:</strong> [What is stored on device]</li>
                <li><strong className="text-foreground">Cloud Storage:</strong> [What is stored in the cloud, if any]</li>
                <li><strong className="text-foreground">Encryption:</strong> [Encryption methods used]</li>
                <li><strong className="text-foreground">Retention Period:</strong> [How long data is kept]</li>
              </ul>
            )},
            { title: "Third-Party Services", content: (
              <p className="text-muted-foreground leading-relaxed">[List any third-party services this product integrates with and their purpose]</p>
            )},
            { title: "Product Support", content: (
              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-muted-foreground">For support with this product, please contact:</p>
                <p className="text-muted-foreground mt-2">
                  <strong className="text-foreground">Email:</strong>{" "}
                  <a href="mailto:support@bestly.tech" className="text-foreground underline">support@bestly.tech</a>
                </p>
                <p className="text-muted-foreground mt-1">
                  <strong className="text-foreground">Subject Line:</strong> [Product Name] Support
                </p>
              </div>
            )},
          ].map((section, index) => (
            <AnimatedSection key={section.title} delay={Math.min((index + 2) * 80, 400)}>
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
              <Link to="/products" className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back to Products</Link>
              <div className="flex gap-4">
                <Link to="/privacy-policy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Master Privacy Policy</Link>
                <Link to="/terms-of-service" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Master Terms of Service</Link>
              </div>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </>
  );
}

import { SEOHead } from "@/components/SEOHead";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Mail, HelpCircle, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "How do I set up Cookie Yeti on Safari for iPhone or iPad?",
    answer:
      "Go to Settings → Safari → Extensions → toggle Cookie Yeti on. Then open Safari and tap the puzzle piece icon to grant permissions.",
  },
  {
    question: "How do I set up Cookie Yeti on Safari for Mac?",
    answer:
      "Go to Safari → Settings → Extensions → check the box next to Cookie Yeti. Click \"Always Allow on Every Website\" when prompted.",
  },
  {
    question: "How do I change my cookie policy?",
    answer:
      "Open the Cookie Yeti extension popup and choose Strict, Balanced, or Permissive under \"Cookie Policy.\"",
  },
  {
    question: "How do I restore a purchase I already made?",
    answer:
      "Open the Cookie Yeti app and tap \"Restore Purchases.\" Your purchase will be re-applied automatically.",
  },
  {
    question: "What data does Cookie Yeti collect?",
    answer:
      "None. Cookie Yeti processes everything on your device. No browsing history, no personal data, no tracking. Your preferences never leave your device.",
  },
  {
    question: "How do I report a banner Cookie Yeti missed?",
    answer:
      "Open the Cookie Yeti extension popup and tap Report a missed banner. This helps us improve detection for future updates.",
  },
];

const CookieYetiSupport = () => {
  return (
    <Layout>
      <SEOHead
        title="Cookie Yeti Support | Bestly LLC"
        description="Get help with Cookie Yeti. Find answers to frequently asked questions or contact our support team."
      />

      <div className="min-h-screen bg-background">
        {/* Hero */}
        <section className="relative py-20 sm:py-28">
          <div className="mx-auto max-w-4xl px-6 lg:px-8 text-center">
            <AnimatedSection>
              <div className="inline-flex items-center gap-2 mb-6">
                <Snowflake className="h-8 w-8 text-primary" />
                <span className="text-lg font-semibold text-foreground">
                  Cookie Yeti
                </span>
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-4">
                Support
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Need help? Browse common questions below or reach out to our team directly.
              </p>
            </AnimatedSection>
          </div>
        </section>

        {/* Contact */}
        <section className="py-12">
          <div className="mx-auto max-w-3xl px-6 lg:px-8">
            <AnimatedSection>
              <div className="rounded-2xl border border-border bg-card p-8 text-center">
                <Mail className="h-10 w-10 text-primary mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Email Support
                </h2>
                <p className="text-muted-foreground mb-6">
                  Our team typically responds within 24 hours.
                </p>
                <Button asChild size="lg">
                  <a
                    href="mailto:support@bestly.tech?subject=Cookie%20Yeti%20Support"
                  >
                    Contact Support
                  </a>
                </Button>
              </div>
            </AnimatedSection>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-3xl px-6 lg:px-8">
            <AnimatedSection>
              <div className="flex items-center gap-3 mb-8">
                <HelpCircle className="h-6 w-6 text-primary" />
                <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
                  Frequently Asked Questions
                </h2>
              </div>

              <Accordion type="single" collapsible className="space-y-3">
                {faqs.map((faq, index) => (
                  <AccordionItem
                    key={index}
                    value={`faq-${index}`}
                    className="rounded-xl border border-border bg-card px-6"
                  >
                    <AccordionTrigger className="text-left text-foreground hover:no-underline py-5">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground pb-5">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </AnimatedSection>
          </div>
        </section>
      </div>
    </Layout>
  );
};

export default CookieYetiSupport;

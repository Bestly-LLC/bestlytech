import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { XCircle, ArrowLeft } from "lucide-react";

// CY-01: Cancelled/abandoned checkout landing. No charge was made; we just
// bring the user back to the pricing page.
export default function CookieYetiCancel() {
  return (
    <>
      <SEOHead
        title="Checkout cancelled - Cookie Yeti | Bestly LLC"
        description="Your Cookie Yeti checkout was cancelled. No charge was made - you can try again anytime."
      />
      <section className="min-h-[70vh] flex items-center justify-center bg-gradient-to-b from-secondary/40 to-background">
        <div className="mx-auto max-w-xl px-6 py-20 text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted border border-border mb-6">
            <XCircle className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Checkout cancelled
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            No problem - no charge was made. You can try again whenever you're ready,
            or stick with the free tier.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild>
              <Link to="/cookie-yeti">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to pricing
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/support">Ask a question first</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

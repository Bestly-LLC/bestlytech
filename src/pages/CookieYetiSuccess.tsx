import { Link, useSearchParams } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowLeft, Mail } from "lucide-react";

// CY-01: Post-checkout landing page. Stripe redirects here after a successful
// subscription/one-time payment. We don't mint app licenses client-side - that
// happens in the Stripe webhook handler server-side - so this page is purely
// UX confirmation.
export default function CookieYetiSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");

  return (
    <>
      <SEOHead
        title="Thanks for subscribing - Cookie Yeti | Bestly LLC"
        description="Your Cookie Yeti subscription is confirmed. Check your email for your receipt and activation details."
      />
      <section className="min-h-[70vh] flex items-center justify-center bg-gradient-to-b from-secondary/40 to-background">
        <div className="mx-auto max-w-xl px-6 py-20 text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20 mb-6">
            <CheckCircle2 className="h-8 w-8 text-green-500" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            You're all set!
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Thanks for subscribing to Cookie Yeti. Stripe just emailed you a receipt,
            and your activation details will arrive shortly after.
          </p>
          <div className="mt-6 rounded-lg border border-border bg-card p-4 text-left text-sm text-muted-foreground">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-medium text-foreground">What happens next</p>
                <p className="mt-1">
                  Once Cookie Yeti is approved on the App Store and Chrome Web Store, we'll
                  send your activation code and install instructions to the email you used at checkout.
                </p>
                {sessionId && (
                  <p className="mt-3 text-xs font-mono text-muted-foreground/70 break-all">
                    Reference: {sessionId}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild>
              <Link to="/cookie-yeti">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to Cookie Yeti
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/support">Need help? Contact support</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

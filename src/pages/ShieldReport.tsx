import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { GlowCard } from "@/components/ui/GlowCard";
import { GradientText } from "@/components/ui/GradientText";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Shield,
  ShieldQuestion,
} from "lucide-react";

const SUPABASE_URL = "https://rcqfqhguwpmaarseifqg.supabase.co";
const FN = `${SUPABASE_URL}/functions/v1/shield-report-url`;
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcWZxaGd1d3BtYWFyc2VpZnFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTc1OTUsImV4cCI6MjA5MDkzMzU5NX0.MHwsTd3CmaTViv3HoFRbeF1t6hmlf5W-p_4eHFBQP9k";

export default function ShieldReport() {
  const { toast } = useToast();
  const [params] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Pre-fill URL from query string (clients can deep-link from a "this site is blocked" page)
  const [form, setForm] = useState({
    url: params.get("url") || "",
    reason: "",
    reporter_email: "",
    reporter_org: params.get("org") || "",
    honeypot: "",
  });

  function input(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.honeypot) return;
    if (!form.url.trim()) {
      toast({ title: "URL required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(FN, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          url: form.url.trim(),
          reason: form.reason.trim() || undefined,
          reporter_email: form.reporter_email.trim() || undefined,
          reporter_org: form.reporter_org.trim() || undefined,
          deal_token: params.get("token") || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || "submit failed");
      setSuccess(true);
    } catch (err: any) {
      toast({
        title: "Couldn't submit",
        description: err.message || "Try again, or email jared@bestly.tech.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <>
        <SEOHead title="Report received" description="" />
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 mb-5">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <h1 className="text-3xl font-semibold mb-3">Got it.</h1>
          <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
            We'll review the URL within one business day. If it should be allowed for your
            deployment, we'll roll it into the next Shield update.
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => { setSuccess(false); setForm({ url: "", reason: "", reporter_email: "", reporter_org: "", honeypot: "" }); }} variant="outline">
              Report another URL
            </Button>
            <Button asChild variant="ghost">
              <Link to="/">Back to bestly.tech →</Link>
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <SEOHead
        title="Report a blocked URL — Shield"
        description="Tell Bestly Shield about a URL you think it's wrongly blocking."
      />

      <div className="relative">
        <div className="mx-auto max-w-2xl px-6 py-12 lg:py-20">
          <AnimatedSection>
            <Badge variant="outline" className="mb-4 border-primary/30 text-primary inline-flex gap-1.5 items-center">
              <Shield className="h-3 w-3" />
              Shield review
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Hit a blocked URL you think{" "}
              <GradientText>should be allowed?</GradientText>
            </h1>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              Drop the URL below. We'll review and, if it's a false positive, roll the fix into the
              next Shield update — usually within a business day.
            </p>
          </AnimatedSection>

          <AnimatedSection delay={80}>
            <GlowCard className="mt-8">
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Honeypot */}
                <div className="absolute -left-[9999px]" aria-hidden>
                  <Label htmlFor="honeypot">Leave this empty</Label>
                  <Input
                    id="honeypot"
                    name="honeypot"
                    value={form.honeypot}
                    onChange={input}
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <Label htmlFor="url">URL or domain *</Label>
                  <Input
                    id="url"
                    name="url"
                    value={form.url}
                    onChange={input}
                    placeholder="https://example.com/blocked-page"
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <Label htmlFor="reason">Why should this be allowed?</Label>
                  <Textarea
                    id="reason"
                    name="reason"
                    value={form.reason}
                    onChange={input}
                    placeholder="Optional. e.g. 'It's our billing portal' or 'It's the docs we use daily.'"
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="reporter_org">Your company / deployment</Label>
                    <Input
                      id="reporter_org"
                      name="reporter_org"
                      value={form.reporter_org}
                      onChange={input}
                      placeholder="e.g. Acme Co"
                    />
                  </div>
                  <div>
                    <Label htmlFor="reporter_email">Your email (optional)</Label>
                    <Input
                      id="reporter_email"
                      name="reporter_email"
                      type="email"
                      value={form.reporter_email}
                      onChange={input}
                      placeholder="So we can confirm when it's allowed"
                    />
                  </div>
                </div>

                <Button type="submit" size="lg" disabled={submitting} className="gap-2 w-full sm:w-auto">
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      Submit for review
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </GlowCard>
          </AnimatedSection>

          <AnimatedSection delay={140}>
            <div className="mt-8 rounded-xl border border-border bg-secondary/20 p-5 flex gap-3 items-start">
              <ShieldQuestion className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground leading-relaxed">
                <strong className="text-foreground font-medium">What Shield is.</strong> Bestly's
                DNS-level filter that blocks ads, trackers, malware, and phishing across every
                device on your network. Sometimes it's too aggressive and blocks something
                legitimate. This form is how you tell us.
              </div>
            </div>
          </AnimatedSection>
        </div>
      </div>
    </>
  );
}

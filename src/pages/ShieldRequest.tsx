import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GlowCard } from "@/components/ui/GlowCard";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

const SUPABASE_URL = "https://rcqfqhguwpmaarseifqg.supabase.co";
const FN = `${SUPABASE_URL}/functions/v1/cloud-shield-request`;
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcWZxaGd1d3BtYWFyc2VpZnFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTc1OTUsImV4cCI6MjA5MDkzMzU5NX0.MHwsTd3CmaTViv3HoFRbeF1t6hmlf5W-p_4eHFBQP9k";

type RecentRequest = {
  id: string;
  requested_url: string;
  status: "pending" | "approved" | "rejected" | "duplicate";
  created_at: string;
};

function fmtAge(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const STATUS_META: Record<RecentRequest["status"], { label: string; icon: any; cls: string }> = {
  pending: { label: "Reviewing", icon: Clock, cls: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10" },
  approved: { label: "Allowlisted", icon: CheckCircle2, cls: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" },
  rejected: { label: "Kept blocked", icon: XCircle, cls: "border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/10" },
  duplicate: { label: "Already requested", icon: CheckCircle2, cls: "border-muted-foreground/30 text-muted-foreground bg-muted/30" },
};

export default function ShieldRequest() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [companyName, setCompanyName] = useState<string>("");
  const [recent, setRecent] = useState<RecentRequest[]>([]);
  const [submitted, setSubmitted] = useState<{ url: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    requested_url: "",
    requester_name: "",
    requester_email: "",
    reason: "",
  });

  useEffect(() => {
    if (!token) {
      setLoadState("notfound");
      return;
    }
    const ctrl = new AbortController();
    fetch(`${FN}?token=${encodeURIComponent(token)}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      signal: ctrl.signal,
    })
      .then(async (r) => {
        if (r.status === 404) {
          setLoadState("notfound");
          return;
        }
        if (!r.ok) {
          setLoadState("error");
          return;
        }
        const data = await r.json();
        if (!data.ok) {
          setLoadState(data.error?.includes("not found") ? "notfound" : "error");
          return;
        }
        setCompanyName(data.deal?.company_name ?? "");
        setRecent(data.recent ?? []);
        setLoadState("ready");
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        console.error(e);
        setLoadState("error");
      });
    return () => ctrl.abort();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!form.requested_url.trim()) {
      toast({ title: "Enter a URL", variant: "destructive" });
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
          token,
          requested_url: form.requested_url,
          requester_name: form.requester_name || undefined,
          requester_email: form.requester_email || undefined,
          reason: form.reason || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || "submission failed");
      setSubmitted({ url: form.requested_url });
      // Refresh the recent-list
      try {
        const r2 = await fetch(`${FN}?token=${encodeURIComponent(token)}`, {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        });
        const d2 = await r2.json();
        if (d2.ok) setRecent(d2.recent ?? []);
      } catch {}
    } catch (err: any) {
      toast({
        title: "Couldn't submit",
        description: err.message || "Try again, or ask your IT lead.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (loadState === "loading") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground mx-auto" />
      </div>
    );
  }
  if (loadState === "notfound") {
    return (
      <>
        <SEOHead title="Link not valid" description="" />
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <CircleAlert className="h-10 w-10 text-amber-500 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold mb-3">This link isn't valid.</h1>
          <p className="text-muted-foreground mb-2">
            Your IT team can give you the right one — it's the URL on your block page.
          </p>
        </div>
      </>
    );
  }
  if (loadState === "error") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <CircleAlert className="h-10 w-10 text-destructive mx-auto mb-4" />
        <h1 className="text-2xl font-semibold mb-3">Something went sideways.</h1>
        <p className="text-muted-foreground">Try refreshing.</p>
      </div>
    );
  }

  return (
    <>
      <SEOHead
        title={`Request a site review — ${companyName || "Bestly Cloud"}`}
        description="Ask your IT team to review whether a blocked URL should be allowed."
      />
      <div className="relative">
        <div className="mx-auto max-w-3xl px-6 py-10 lg:py-16">
          <AnimatedSection>
            <div className="inline-flex items-center gap-2 mb-4">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <Badge variant="outline" className="border-primary/30 text-primary">
                Shield request — {companyName || "Bestly Cloud"}
              </Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Hit a block you don't think should be blocked?
            </h1>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-xl">
              Tell us what site, and what you were trying to do. Your IT team reviews these — usually
              same business day. Submitting doesn't unblock it instantly; it just gets it on the
              queue.
            </p>
          </AnimatedSection>

          {submitted ? (
            <AnimatedSection delay={60}>
              <div className="mt-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
                <h2 className="text-xl font-semibold mb-2">Got it.</h2>
                <p className="text-muted-foreground mb-4">
                  We logged your request for{" "}
                  <code className="text-foreground font-mono text-sm">{submitted.url}</code>. Your
                  IT team will review it.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <Button onClick={() => { setSubmitted(null); setForm({ requested_url: "", requester_name: form.requester_name, requester_email: form.requester_email, reason: "" }); }} variant="outline">
                    Submit another
                  </Button>
                  <Button asChild variant="ghost">
                    <Link to="/">Back to home</Link>
                  </Button>
                </div>
              </div>
            </AnimatedSection>
          ) : (
            <AnimatedSection delay={60}>
              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <GlowCard>
                  <div>
                    <Label htmlFor="url">Blocked URL or domain *</Label>
                    <Input
                      id="url"
                      value={form.requested_url}
                      onChange={(e) => setForm({ ...form, requested_url: e.target.value })}
                      placeholder="example.com — or paste the full URL"
                      required
                    />
                    <p className="text-xs text-muted-foreground mt-1.5">
                      A bare domain works (we strip <code>www.</code> automatically). If only one
                      page is blocked, paste the full URL.
                    </p>
                  </div>

                  <div className="mt-4">
                    <Label htmlFor="reason">Why do you need it?</Label>
                    <Textarea
                      id="reason"
                      value={form.reason}
                      onChange={(e) => setForm({ ...form, reason: e.target.value })}
                      placeholder="e.g. Vendor portal for Q3 procurement. Or: my team uses it for design research."
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                    <div>
                      <Label htmlFor="who">Your name</Label>
                      <Input
                        id="who"
                        value={form.requester_name}
                        onChange={(e) => setForm({ ...form, requester_name: e.target.value })}
                        placeholder="optional"
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={form.requester_email}
                        onChange={(e) => setForm({ ...form, requester_email: e.target.value })}
                        placeholder="so we can tell you when it's done"
                      />
                    </div>
                  </div>
                </GlowCard>

                <div className="flex justify-end">
                  <Button type="submit" size="lg" disabled={submitting} className="gap-2">
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Submitting…
                      </>
                    ) : (
                      <>
                        Submit
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </AnimatedSection>
          )}

          {/* Recent requests so users see the queue isn't a black hole */}
          {recent.length > 0 && (
            <AnimatedSection delay={120}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mt-12 mb-3">
                Recent requests at {companyName}
              </h2>
              <ul className="space-y-2">
                {recent.map((r) => {
                  const meta = STATUS_META[r.status];
                  const Icon = meta.icon;
                  return (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-2.5"
                    >
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${meta.cls}`}
                      >
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </span>
                      <span className="text-sm font-mono text-foreground truncate flex-1 min-w-0">
                        {r.requested_url}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {fmtAge(r.created_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </AnimatedSection>
          )}
        </div>
      </div>
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GlowCard } from "@/components/ui/GlowCard";
import { GradientText } from "@/components/ui/GradientText";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Save,
} from "lucide-react";

const APPS: { slug: string; label: string; vendors: string }[] = [
  { slug: "drive", label: "Drive", vendors: "Google Drive · Dropbox · OneDrive" },
  { slug: "video-chat", label: "Video & Chat", vendors: "Zoom · Slack · Teams" },
  { slug: "mail", label: "Mail", vendors: "Gmail · Outlook" },
  { slug: "docs", label: "Docs", vendors: "Google Docs · Office 365" },
  { slug: "calendar", label: "Calendar", vendors: "Google Cal · Outlook" },
  { slug: "ai", label: "AI / Intelligence", vendors: "ChatGPT · Copilot · Claude" },
  { slug: "shield", label: "DNS Shield", vendors: "Filtering · DNS security" },
  { slug: "vpn", label: "VPN", vendors: "Corporate VPN" },
  { slug: "backup", label: "Backup", vendors: "Backblaze · Veeam · Druva" },
  { slug: "projects", label: "Projects", vendors: "Asana · Trello · Monday · Linear" },
  { slug: "forms", label: "Forms", vendors: "Google Forms · Typeform" },
  { slug: "passwords", label: "Passwords", vendors: "1Password · LastPass · Bitwarden" },
  { slug: "sign", label: "E-sign", vendors: "DocuSign · Adobe Sign" },
];

const SPEND_BANDS = [
  { value: "<25k", label: "Under $25K / yr" },
  { value: "25-75k", label: "$25K – $75K / yr" },
  { value: "75-150k", label: "$75K – $150K / yr" },
  { value: "150-300k", label: "$150K – $300K / yr" },
  { value: "300k+", label: "$300K+ / yr" },
  { value: "unsure", label: "Not sure" },
];

const COMPLIANCE_FRAMEWORKS: { slug: string; label: string }[] = [
  { slug: "hipaa", label: "HIPAA" },
  { slug: "soc2", label: "SOC 2" },
  { slug: "gdpr", label: "GDPR" },
  { slug: "ccpa", label: "CCPA" },
  { slug: "none", label: "None of the above" },
  { slug: "unsure", label: "Not sure yet" },
];

const YN_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

const SUPABASE_URL = "https://rcqfqhguwpmaarseifqg.supabase.co";
const FN = `${SUPABASE_URL}/functions/v1/cloud-brief`;
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcWZxaGd1d3BtYWFyc2VpZnFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTc1OTUsImV4cCI6MjA5MDkzMzU5NX0.MHwsTd3CmaTViv3HoFRbeF1t6hmlf5W-p_4eHFBQP9k";

type Brief = {
  id: string;
  lead_id: string;
  submitted_at: string | null;
  current_apps: string[];
  annual_saas_spend_band: string | null;
  compliance_frameworks: string[];
  office_city: string | null;
  office_state: string | null;
  office_country: string | null;
  has_static_ip: string | null;
  has_it_lead: string | null;
  domain_owned: string | null;
  preferred_subdomain: string | null;
  biggest_unknown: string | null;
};

type Lead = {
  contact_name: string;
  company_name: string;
  user_count_band: string;
};

export default function Brief() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lead, setLead] = useState<Lead | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Auto-save debouncer
  const pendingPatch = useRef<Record<string, unknown>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);

  // ─── Load ──────────────────────────────────────────────
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
        setBrief(data.brief);
        setLead(data.lead);
        setSubmitted(!!data.brief.submitted_at);
        setLoadState("ready");
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        console.error(e);
        setLoadState("error");
      });
    return () => ctrl.abort();
  }, [token]);

  // ─── Auto-save ─────────────────────────────────────────
  const flushSave = useCallback(async () => {
    if (!token) return;
    if (inflight.current) return;
    if (Object.keys(pendingPatch.current).length === 0) return;
    inflight.current = true;
    const payload = { token, ...pendingPatch.current };
    pendingPatch.current = {};
    setSaveErr(null);
    try {
      const r = await fetch(FN, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.ok === false) {
        setSaveErr(data.error || "save failed");
      } else {
        setSavedAt(new Date());
      }
    } catch (e: any) {
      setSaveErr(e?.message || "save failed");
    } finally {
      inflight.current = false;
      // If more changes accumulated mid-flight, flush again
      if (Object.keys(pendingPatch.current).length > 0) {
        scheduleSave();
      }
    }
  }, [token]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 700);
  }, [flushSave]);

  function patch(name: keyof Brief, value: unknown) {
    setBrief((prev) => (prev ? ({ ...prev, [name]: value } as Brief) : prev));
    pendingPatch.current[name as string] = value;
    scheduleSave();
  }

  function toggleApp(slug: string, on: boolean) {
    if (!brief) return;
    const next = on
      ? Array.from(new Set([...(brief.current_apps || []), slug]))
      : (brief.current_apps || []).filter((s) => s !== slug);
    patch("current_apps", next);
  }

  function toggleCompliance(slug: string, on: boolean) {
    if (!brief) return;
    const next = on
      ? Array.from(new Set([...(brief.compliance_frameworks || []), slug]))
      : (brief.compliance_frameworks || []).filter((s) => s !== slug);
    patch("compliance_frameworks", next);
  }

  // ─── Submit ────────────────────────────────────────────
  async function handleSubmit() {
    if (!token) return;
    setSubmitting(true);
    // First flush pending changes
    if (Object.keys(pendingPatch.current).length > 0) {
      await flushSave();
    }
    try {
      const r = await fetch(FN, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ token }),
      });
      const data = await r.json();
      if (!r.ok || data.ok === false) throw new Error(data.error || "could not submit");
      setSubmitted(true);
      toast({
        title: "Brief submitted.",
        description: "Jared will walk into your call already prepped.",
      });
    } catch (e: any) {
      toast({
        title: "Couldn't submit",
        description: e.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  // Save on tab close / blur (best-effort)
  useEffect(() => {
    const onLeave = () => {
      if (Object.keys(pendingPatch.current).length > 0) flushSave();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [flushSave]);

  // ─── Render branches ───────────────────────────────────

  if (loadState === "loading") {
    return (
      <>
        <SEOHead title="Loading your brief…" description="" />
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground mx-auto" />
        </div>
      </>
    );
  }

  if (loadState === "notfound") {
    return (
      <>
        <SEOHead title="Brief not found" description="" />
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <CircleAlert className="h-10 w-10 text-amber-500 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold mb-3">This brief link isn't valid.</h1>
          <p className="text-muted-foreground mb-6">
            The link may have expired or been mistyped. If you came from a discovery email, try
            clicking the most recent one.
          </p>
          <Button asChild variant="outline">
            <Link to="/get-started">Start a fresh discovery →</Link>
          </Button>
        </div>
      </>
    );
  }

  if (loadState === "error" || !brief || !lead) {
    return (
      <>
        <SEOHead title="Couldn't load brief" description="" />
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <CircleAlert className="h-10 w-10 text-destructive mx-auto mb-4" />
          <h1 className="text-2xl font-semibold mb-3">Something went sideways.</h1>
          <p className="text-muted-foreground mb-6">
            We couldn't load your brief. Try refreshing — if it keeps failing, email{" "}
            <a className="underline" href="mailto:jared@bestly.tech">
              jared@bestly.tech
            </a>
            .
          </p>
        </div>
      </>
    );
  }

  if (submitted) {
    return (
      <>
        <SEOHead
          title="Brief received"
          description="Your pre-call brief is in. Jared will be in touch."
        />
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 mb-5">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <h1 className="text-3xl font-semibold mb-3">Brief submitted.</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Thanks, {lead.contact_name.split(" ")[0]}. Jared will walk into your call already prepped
            with this. Expect a confirmation email shortly.
          </p>
          <Button asChild variant="outline">
            <Link to="/in-house-cloud">Back to In-House Cloud →</Link>
          </Button>
        </div>
      </>
    );
  }

  // ─── Form ─────────────────────────────────────────────
  return (
    <>
      <SEOHead
        title={`Pre-call brief — ${lead.company_name}`}
        description="A few quick questions before your discovery call."
      />
      <div className="relative">
        <div className="mx-auto max-w-3xl px-6 py-10 lg:py-14">
          <AnimatedSection>
            <Badge variant="outline" className="mb-3 border-primary/30 text-primary">
              Pre-call brief — {lead.company_name}
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              A 5-minute prep so we{" "}
              <GradientText>walk in ready</GradientText>.
            </h1>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              Hey {lead.contact_name.split(" ")[0]}. Pick what applies — every field is optional,
              and your answers save automatically. Bail anytime; come back via the same link.
            </p>
          </AnimatedSection>

          {/* Save indicator */}
          <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            {saveErr ? (
              <>
                <CircleAlert className="h-3.5 w-3.5 text-amber-500" />
                <span>Save error: {saveErr}</span>
              </>
            ) : savedAt ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span>
                  Saved at{" "}
                  {savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                <span>Auto-saves as you type</span>
              </>
            )}
          </div>

          <div className="mt-8 space-y-6">
            {/* ─── Q1: Current stack ─── */}
            <AnimatedSection delay={60}>
              <GlowCard>
                <h2 className="text-lg font-semibold mb-1">What's in your stack today?</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  Check anything you currently pay for. We'll line each one up against what you'd
                  replace.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {APPS.map((app) => {
                    const checked = (brief.current_apps || []).includes(app.slug);
                    return (
                      <label
                        key={app.slug}
                        className="flex items-start gap-3 p-3 rounded-xl border border-border bg-background hover:bg-secondary/30 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleApp(app.slug, !!v)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{app.label}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {app.vendors}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </GlowCard>
            </AnimatedSection>

            {/* ─── Q2: Annual spend ─── */}
            <AnimatedSection delay={80}>
              <GlowCard>
                <h2 className="text-lg font-semibold mb-1">Roughly, what do you spend per year?</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Across the apps above. We use this to scope your savings — it's never shared.
                </p>
                <Select
                  value={brief.annual_saas_spend_band ?? ""}
                  onValueChange={(v) => patch("annual_saas_spend_band", v || null)}
                >
                  <SelectTrigger className="max-w-md">
                    <SelectValue placeholder="Pick a range" />
                  </SelectTrigger>
                  <SelectContent>
                    {SPEND_BANDS.map((b) => (
                      <SelectItem key={b.value} value={b.value}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </GlowCard>
            </AnimatedSection>

            {/* ─── Q3: Compliance ─── */}
            <AnimatedSection delay={100}>
              <GlowCard>
                <h2 className="text-lg font-semibold mb-1">Compliance you need to align with?</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Multi-select. Drives how we configure backups, encryption, and audit logging.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {COMPLIANCE_FRAMEWORKS.map((c) => {
                    const checked = (brief.compliance_frameworks || []).includes(c.slug);
                    return (
                      <label
                        key={c.slug}
                        className="flex items-center gap-2 p-2.5 rounded-xl border border-border bg-background hover:bg-secondary/30 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleCompliance(c.slug, !!v)}
                        />
                        <span className="text-sm">{c.label}</span>
                      </label>
                    );
                  })}
                </div>
              </GlowCard>
            </AnimatedSection>

            {/* ─── Q4: Network/location ─── */}
            <AnimatedSection delay={120}>
              <GlowCard>
                <h2 className="text-lg font-semibold mb-1">Where will the box live?</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Helps us catch network blockers (no static IP, carrier-grade NAT) before the
                  call.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <div>
                    <Label htmlFor="city">Office city</Label>
                    <Input
                      id="city"
                      value={brief.office_city ?? ""}
                      onChange={(e) => patch("office_city", e.target.value)}
                      placeholder="Los Angeles"
                    />
                  </div>
                  <div>
                    <Label htmlFor="state">State / region</Label>
                    <Input
                      id="state"
                      value={brief.office_state ?? ""}
                      onChange={(e) => patch("office_state", e.target.value)}
                      placeholder="CA"
                    />
                  </div>
                  <div>
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      value={brief.office_country ?? ""}
                      onChange={(e) => patch("office_country", e.target.value)}
                      placeholder="US"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label>Static IP available?</Label>
                    <Select
                      value={brief.has_static_ip ?? ""}
                      onValueChange={(v) => patch("has_static_ip", v || null)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick" />
                      </SelectTrigger>
                      <SelectContent>
                        {YN_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>You have an IT lead?</Label>
                    <Select
                      value={brief.has_it_lead ?? ""}
                      onValueChange={(v) => patch("has_it_lead", v || null)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick" />
                      </SelectTrigger>
                      <SelectContent>
                        {YN_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>You own a domain?</Label>
                    <Select
                      value={brief.domain_owned ?? ""}
                      onValueChange={(v) => patch("domain_owned", v || null)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick" />
                      </SelectTrigger>
                      <SelectContent>
                        {YN_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="mt-3">
                  <Label htmlFor="subdomain">Preferred subdomain (optional)</Label>
                  <Input
                    id="subdomain"
                    value={brief.preferred_subdomain ?? ""}
                    onChange={(e) => patch("preferred_subdomain", e.target.value)}
                    placeholder="cloud.yourcompany.com"
                  />
                </div>
              </GlowCard>
            </AnimatedSection>

            {/* ─── Q5: Open-ended ─── */}
            <AnimatedSection delay={140}>
              <GlowCard>
                <h2 className="text-lg font-semibold mb-1">
                  What's the biggest unknown for you?
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Migration risk? Compliance question? Day-1 onboarding logistics? Tell us
                  whatever's on your mind — we'll tackle it on the call.
                </p>
                <Textarea
                  value={brief.biggest_unknown ?? ""}
                  onChange={(e) => patch("biggest_unknown", e.target.value)}
                  placeholder="Optional. Even a sentence helps."
                  rows={4}
                />
              </GlowCard>
            </AnimatedSection>

            {/* ─── Submit ─── */}
            <AnimatedSection delay={160}>
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-between rounded-xl border border-border bg-secondary/20 p-5">
                <p className="text-sm text-muted-foreground">
                  Done? Hit submit. You can also bail and come back later — your answers are saved.
                </p>
                <Button onClick={handleSubmit} disabled={submitting} size="lg" className="gap-2">
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      Submit brief
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </div>
    </>
  );
}

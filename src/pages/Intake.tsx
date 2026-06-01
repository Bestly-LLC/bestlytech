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
import { LiveCelebration } from "@/components/cloud/LiveCelebration";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Lock,
  Save,
  Wifi,
  Palette,
  Users,
  ArrowDownToLine,
  ShieldCheck,
} from "lucide-react";

const SUPABASE_URL = "https://rcqfqhguwpmaarseifqg.supabase.co";
const FN = `${SUPABASE_URL}/functions/v1/cloud-intake`;
const UPLOAD_FN = `${SUPABASE_URL}/functions/v1/cloud-brand-upload`;
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcWZxaGd1d3BtYWFyc2VpZnFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTc1OTUsImV4cCI6MjA5MDkzMzU5NX0.MHwsTd3CmaTViv3HoFRbeF1t6hmlf5W-p_4eHFBQP9k";

type Deal = {
  id: string;
  lead_id: string;
  company_name: string;
  primary_contact_name: string;
  primary_contact_email: string;
  target_user_count: number | null;
  current_stage?: number;
  intake_data: Record<string, any>;
  intake_submitted_at: string | null;
  provisioning_data?: Record<string, any> | null;
  install_data?: Record<string, any> | null;
  live_data?: Record<string, any> | null;
  go_live_at?: string | null;
};

type StageKey = "network" | "branding" | "users" | "migration" | "policy";

const STAGES: {
  key: StageKey;
  num: string;
  label: string;
  description: string;
  icon: any;
  available: boolean;
}[] = [
  { key: "network",   num: "5a", label: "Network",   description: "Where the box lives, how it gets internet, who maintains it.",  icon: Wifi,             available: true  },
  { key: "branding",  num: "5b", label: "Branding",  description: "Logo, colors, subdomain, system mail address.",                 icon: Palette,          available: true  },
  { key: "users",     num: "5c", label: "Users",     description: "Roster of people, roles, groups. CSV upload.",                  icon: Users,            available: true  },
  { key: "migration", num: "5d", label: "Migration", description: "What to pull from your existing Google / Microsoft / Slack stack.", icon: ArrowDownToLine, available: true  },
  { key: "policy",    num: "5e", label: "Policy",    description: "2FA, VPN, DNS filtering, backup, retention.",                  icon: ShieldCheck,      available: true  },
];

const NETWORK_FIELDS = {
  shipping_address: "",
  shipping_city: "",
  shipping_state: "",
  shipping_zip: "",
  shipping_country: "US",
  isp_name: "",
  has_static_ip: "" as "" | "yes" | "no" | "unsure",
  static_ip_value: "",
  router_make_model: "",
  box_location: "",
  bandwidth_down_mbps: "",
  bandwidth_up_mbps: "",
  vlans_in_use: "",
  it_lead_name: "",
  it_lead_email: "",
  it_lead_phone: "",
  network_notes: "",
};

type NetworkData = typeof NETWORK_FIELDS;

const BRANDING_FIELDS = {
  subdomain: "",
  system_mail: "",
  primary_color: "#0a0a0a",
  accent_color: "#c84d2b",
  logo_url: "",
  icon_url: "",
  mark_url: "",
  branding_notes: "",
};
type BrandingData = typeof BRANDING_FIELDS;

type IntakeUser = {
  name: string;
  email: string;
  role: "admin" | "member";
  group: string;
};

type MigrationSource = {
  slug: string;
  scope: "" | "everything" | "recent_12mo" | "recent_90d" | "specific";
  data_volume_gb_per_user: string;
  decommission_after_days: string;
  source_notes: string;
};

type MigrationData = {
  selected_sources: string[];
  per_source: Record<string, MigrationSource>;
  fallback_window_days: string;
  freeze_writes_at_cutover: "" | "yes" | "no" | "unsure";
  migration_notes: string;
};

const MIGRATION_DEFAULT: MigrationData = {
  selected_sources: [],
  per_source: {},
  fallback_window_days: "60",
  freeze_writes_at_cutover: "",
  migration_notes: "",
};

const SOURCE_CATALOG = [
  { slug: "google-workspace", label: "Google Workspace", note: "Drive, Gmail, Docs, Calendar, Contacts" },
  { slug: "microsoft-365",    label: "Microsoft 365",    note: "OneDrive, Outlook, Office, Calendar, Teams chat" },
  { slug: "slack",            label: "Slack",            note: "Chat history (export-only without Plus plan)" },
  { slug: "teams-chat",       label: "Microsoft Teams chat", note: "Chat history via Graph API" },
  { slug: "dropbox",          label: "Dropbox",          note: "Files + shared folders" },
  { slug: "box",              label: "Box",              note: "Files + shared folders" },
  { slug: "asana",            label: "Asana",            note: "Projects + tasks" },
  { slug: "trello",           label: "Trello",           note: "Boards + cards" },
  { slug: "monday",           label: "Monday.com",       note: "Boards" },
  { slug: "linear",           label: "Linear",           note: "Issues + cycles" },
  { slug: "1password",        label: "1Password",        note: "Vaults — export, then re-import to local Vaultwarden" },
  { slug: "lastpass",         label: "LastPass",         note: "Vaults — same flow as 1Password" },
  { slug: "docusign",         label: "DocuSign",         note: "Templates + completed envelopes" },
];

const POLICY_FIELDS = {
  twofa_enforcement: "" as "" | "required" | "optional" | "off",
  vpn_scope: "" as "" | "all_users" | "admins_only" | "none",
  dns_filter_categories: [] as string[],
  backup_destination: "" as "" | "own_backblaze" | "bestly_managed" | "both",
  backblaze_bucket_name: "",
  retention_months: "" as "" | "12" | "24" | "36" | "60" | "indefinite",
  policy_notes: "",
};
type PolicyData = typeof POLICY_FIELDS;

const DNS_CATEGORIES = [
  { slug: "ads", label: "Ads & trackers" },
  { slug: "malware", label: "Malware & phishing" },
  { slug: "adult", label: "Adult content" },
  { slug: "gambling", label: "Gambling" },
  { slug: "social-media", label: "Social media (work hours)" },
  { slug: "streaming", label: "Streaming (work hours)" },
  { slug: "crypto-mining", label: "Crypto mining" },
];

const YN_OPTS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

export default function Intake() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [deal, setDeal] = useState<Deal | null>(null);
  const [activeStage, setActiveStage] = useState<StageKey>("network");

  // Stage-specific state
  const [network, setNetwork] = useState<NetworkData>(NETWORK_FIELDS);
  const [branding, setBranding] = useState<BrandingData>(BRANDING_FIELDS);
  const [uploading, setUploading] = useState<"logo" | "icon" | "mark" | null>(null);
  const [users, setUsers] = useState<IntakeUser[]>([]);
  const [policy, setPolicy] = useState<PolicyData>(POLICY_FIELDS);
  const [migration, setMigration] = useState<MigrationData>(MIGRATION_DEFAULT);

  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Auto-save plumbing
  const pendingPatch = useRef<{ stage: StageKey; data: Record<string, unknown> } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);

  // ─── Load ───────────────────────────────────────────
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
        const d: Deal = data.deal;
        setDeal(d);
        // Hydrate stage states from saved jsonb
        if (d.intake_data?.network) {
          setNetwork({ ...NETWORK_FIELDS, ...d.intake_data.network });
        }
        if (d.intake_data?.branding) {
          setBranding({ ...BRANDING_FIELDS, ...d.intake_data.branding });
        }
        if (Array.isArray(d.intake_data?.users?.list)) {
          setUsers(d.intake_data.users.list as IntakeUser[]);
        }
        if (d.intake_data?.policy) {
          setPolicy({ ...POLICY_FIELDS, ...d.intake_data.policy });
        }
        if (d.intake_data?.migration) {
          setMigration({ ...MIGRATION_DEFAULT, ...d.intake_data.migration });
        }
        setLoadState("ready");
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        console.error(e);
        setLoadState("error");
      });
    return () => ctrl.abort();
  }, [token]);

  // ─── Auto-save ──────────────────────────────────────
  const flushSave = useCallback(async () => {
    if (!token) return;
    if (inflight.current) return;
    if (!pendingPatch.current) return;
    inflight.current = true;
    const payload = { token, ...pendingPatch.current };
    pendingPatch.current = null;
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
      if (pendingPatch.current) scheduleSave();
    }
  }, [token]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 700);
  }, [flushSave]);

  function patchNetwork<K extends keyof NetworkData>(field: K, value: NetworkData[K]) {
    const next = { ...network, [field]: value };
    setNetwork(next);
    pendingPatch.current = { stage: "network", data: next };
    scheduleSave();
  }

  function patchBranding<K extends keyof BrandingData>(field: K, value: BrandingData[K]) {
    const next = { ...branding, [field]: value };
    setBranding(next);
    pendingPatch.current = { stage: "branding", data: next };
    scheduleSave();
  }

  function commitUsers(next: IntakeUser[]) {
    setUsers(next);
    pendingPatch.current = { stage: "users", data: { list: next } };
    scheduleSave();
  }

  function patchPolicy<K extends keyof PolicyData>(field: K, value: PolicyData[K]) {
    const next = { ...policy, [field]: value };
    setPolicy(next);
    pendingPatch.current = { stage: "policy", data: next };
    scheduleSave();
  }

  function commitMigration(next: MigrationData) {
    setMigration(next);
    pendingPatch.current = { stage: "migration", data: next };
    scheduleSave();
  }

  function patchMigration<K extends keyof MigrationData>(field: K, value: MigrationData[K]) {
    const next = { ...migration, [field]: value };
    setMigration(next);
    pendingPatch.current = { stage: "migration", data: next };
    scheduleSave();
  }

  function toggleMigrationSource(slug: string, on: boolean) {
    const sel = on
      ? Array.from(new Set([...(migration.selected_sources || []), slug]))
      : (migration.selected_sources || []).filter((s) => s !== slug);
    const per_source = { ...(migration.per_source || {}) };
    if (on && !per_source[slug]) {
      per_source[slug] = {
        slug,
        scope: "",
        data_volume_gb_per_user: "",
        decommission_after_days: "60",
        source_notes: "",
      };
    }
    const next = { ...migration, selected_sources: sel, per_source };
    setMigration(next);
    pendingPatch.current = { stage: "migration", data: next };
    scheduleSave();
  }

  function patchMigrationSource(slug: string, field: keyof MigrationSource, value: string) {
    const cur = migration.per_source[slug] || {
      slug,
      scope: "" as MigrationSource["scope"],
      data_volume_gb_per_user: "",
      decommission_after_days: "60",
      source_notes: "",
    };
    const updated: MigrationSource =
      field === "scope"
        ? { ...cur, scope: value as MigrationSource["scope"] }
        : { ...cur, [field]: value };
    const next = {
      ...migration,
      per_source: { ...migration.per_source, [slug]: updated },
    };
    setMigration(next);
    pendingPatch.current = { stage: "migration", data: next };
    scheduleSave();
  }

  async function uploadAsset(assetType: "logo" | "icon" | "mark", file: File) {
    if (!token) return;
    setUploading(assetType);
    try {
      const fd = new FormData();
      fd.append("token", token);
      fd.append("asset_type", assetType);
      fd.append("file", file);
      const r = await fetch(UPLOAD_FN, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        body: fd,
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || "upload failed");
      // Append a cache-bust so the new image actually shows up after re-upload
      const fresh = `${data.url}?t=${Date.now()}`;
      if (assetType === "logo") patchBranding("logo_url", fresh);
      if (assetType === "icon") patchBranding("icon_url", fresh);
      if (assetType === "mark") patchBranding("mark_url", fresh);
      toast({ title: `${assetType} uploaded` });
    } catch (e: any) {
      toast({
        title: "Upload failed",
        description: e.message || "Try a different file.",
        variant: "destructive",
      });
    } finally {
      setUploading(null);
    }
  }

  // ─── Submit ─────────────────────────────────────────
  async function handleSubmit() {
    if (!token) return;
    setSubmitting(true);
    if (pendingPatch.current) await flushSave();
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
      setDeal((d) => (d ? { ...d, intake_submitted_at: new Date().toISOString() } : d));
      toast({
        title: "Intake submitted.",
        description: "We're starting your build. Expect an update within 48 hours.",
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

  // Save on tab close
  useEffect(() => {
    const onLeave = () => {
      if (pendingPatch.current) flushSave();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [flushSave]);

  // ─── Render branches ────────────────────────────────

  if (loadState === "loading") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground mx-auto" />
      </div>
    );
  }
  if (loadState === "notfound") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <CircleAlert className="h-10 w-10 text-amber-500 mx-auto mb-4" />
        <h1 className="text-2xl font-semibold mb-3">This intake link isn't valid.</h1>
        <p className="text-muted-foreground mb-6">
          The link may have expired or been mistyped. Email{" "}
          <a className="underline" href="mailto:jared@bestly.tech">
            jared@bestly.tech
          </a>{" "}
          for a fresh one.
        </p>
      </div>
    );
  }
  if (loadState === "error" || !deal) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <CircleAlert className="h-10 w-10 text-destructive mx-auto mb-4" />
        <h1 className="text-2xl font-semibold mb-3">Couldn't load your intake.</h1>
        <p className="text-muted-foreground mb-6">
          Try refreshing — if it keeps failing, email{" "}
          <a className="underline" href="mailto:jared@bestly.tech">
            jared@bestly.tech
          </a>
          .
        </p>
      </div>
    );
  }

  const isLocked = !!deal.intake_submitted_at;

  if (isLocked) {
    return <CustomerStatusView deal={deal} />;
  }

  return (
    <>
      <SEOHead
        title={`Technical intake — ${deal.company_name}`}
        description="Wrap up the few technical details and we start your build."
      />
      <div className="relative">
        <div className="mx-auto max-w-5xl px-6 py-10 lg:py-14">
          <AnimatedSection>
            <Badge variant="outline" className="mb-3 border-primary/30 text-primary">
              Technical intake — {deal.company_name}
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              The last details we need to{" "}
              <GradientText>start your build</GradientText>.
            </h1>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-2xl">
              Hey {deal.primary_contact_name.split(" ")[0]}. Five short stages, all auto-saved.
              Tackle them in any order — you can bail and come back via the same link.
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

          {/* Stage navigation */}
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
            <aside className="lg:col-span-1">
              <nav className="space-y-1">
                {STAGES.map((s) => {
                  const Icon = s.icon;
                  const active = s.key === activeStage;
                  const stageData = deal.intake_data?.[s.key];
                  const hasContent =
                    stageData && Object.values(stageData).some((v) => v && String(v).length > 0);
                  return (
                    <button
                      key={s.key}
                      onClick={() => s.available && setActiveStage(s.key)}
                      disabled={!s.available}
                      className={`w-full text-left p-3 rounded-xl border transition-colors ${
                        active
                          ? "border-primary/50 bg-primary/5"
                          : s.available
                          ? "border-border hover:bg-secondary/30"
                          : "border-border bg-muted/20 opacity-60 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className={`mt-0.5 ${active ? "text-primary" : "text-muted-foreground"}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-muted-foreground">{s.num}</span>
                            <span className="text-sm font-medium">{s.label}</span>
                            {hasContent && (
                              <Check className="h-3 w-3 text-emerald-500 ml-auto" />
                            )}
                            {!s.available && (
                              <Lock className="h-3 w-3 text-muted-foreground ml-auto" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            {s.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </nav>

              <div className="mt-6 rounded-xl border border-border bg-secondary/20 p-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Once all stages are done, hit Submit at the bottom of this page. Stages 5b–5e
                  ship in the next update — for now, fill 5a and we'll handle the rest by email.
                </p>
              </div>
            </aside>

            <div className="lg:col-span-3 space-y-6">
              {activeStage === "network" && (
                <NetworkStage data={network} onChange={patchNetwork} />
              )}
              {activeStage === "branding" && (
                <BrandingStage
                  data={branding}
                  onChange={patchBranding}
                  onUpload={uploadAsset}
                  uploading={uploading}
                  companyName={deal.company_name}
                />
              )}
              {activeStage === "users" && (
                <UsersStage users={users} onCommit={commitUsers} />
              )}
              {activeStage === "policy" && (
                <PolicyStage data={policy} onChange={patchPolicy} />
              )}
              {activeStage === "migration" && (
                <MigrationStage data={migration} onCommit={commitMigration} />
              )}

              {/* Submit */}
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-between rounded-xl border border-border bg-secondary/20 p-5">
                <p className="text-sm text-muted-foreground">
                  Submit when you're ready — we won't start the build until you do.
                </p>
                <Button onClick={handleSubmit} disabled={submitting} size="lg" className="gap-2">
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      Submit intake
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────
// Stage 5a — Network
// ─────────────────────────────────────────────────────
function NetworkStage({
  data,
  onChange,
}: {
  data: NetworkData;
  onChange: <K extends keyof NetworkData>(field: K, value: NetworkData[K]) => void;
}) {
  return (
    <>
      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Where the box ships</h2>
        <p className="text-sm text-muted-foreground mb-4">
          We send a pre-configured server to this address. Bring-someone-home reliable address —
          a closet, IDF, or rack you control.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label htmlFor="addr">Street address</Label>
            <Input
              id="addr"
              value={data.shipping_address}
              onChange={(e) => onChange("shipping_address", e.target.value)}
              placeholder="123 Office Ln, Suite 200"
            />
          </div>
          <div>
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              value={data.shipping_city}
              onChange={(e) => onChange("shipping_city", e.target.value)}
              placeholder="Los Angeles"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={data.shipping_state}
                onChange={(e) => onChange("shipping_state", e.target.value)}
                placeholder="CA"
              />
            </div>
            <div>
              <Label htmlFor="zip">Zip</Label>
              <Input
                id="zip"
                value={data.shipping_zip}
                onChange={(e) => onChange("shipping_zip", e.target.value)}
                placeholder="90069"
              />
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Label htmlFor="loc">Where will the box live?</Label>
          <Input
            id="loc"
            value={data.box_location}
            onChange={(e) => onChange("box_location", e.target.value)}
            placeholder="Server closet · Office IDF · Half-height rack · Under reception desk"
          />
        </div>
      </GlowCard>

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">How it gets internet</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Static IP is the smoothest path. If you don't have one, we can work with dynamic DNS —
          tell us either way.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="isp">ISP</Label>
            <Input
              id="isp"
              value={data.isp_name}
              onChange={(e) => onChange("isp_name", e.target.value)}
              placeholder="Spectrum · Comcast · Sonic · etc."
            />
          </div>
          <div>
            <Label>Static IP available?</Label>
            <Select
              value={data.has_static_ip}
              onValueChange={(v) => onChange("has_static_ip", v as NetworkData["has_static_ip"])}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick" />
              </SelectTrigger>
              <SelectContent>
                {YN_OPTS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {data.has_static_ip === "yes" && (
            <div className="sm:col-span-2">
              <Label htmlFor="ipval">Static IP (optional — we can fetch this on install)</Label>
              <Input
                id="ipval"
                value={data.static_ip_value}
                onChange={(e) => onChange("static_ip_value", e.target.value)}
                placeholder="e.g. 75.223.189.112"
              />
            </div>
          )}
          <div>
            <Label htmlFor="bw_down">Download (Mbps)</Label>
            <Input
              id="bw_down"
              type="number"
              value={data.bandwidth_down_mbps}
              onChange={(e) => onChange("bandwidth_down_mbps", e.target.value)}
              placeholder="e.g. 500"
            />
          </div>
          <div>
            <Label htmlFor="bw_up">Upload (Mbps)</Label>
            <Input
              id="bw_up"
              type="number"
              value={data.bandwidth_up_mbps}
              onChange={(e) => onChange("bandwidth_up_mbps", e.target.value)}
              placeholder="e.g. 35"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="router">Router make + model</Label>
            <Input
              id="router"
              value={data.router_make_model}
              onChange={(e) => onChange("router_make_model", e.target.value)}
              placeholder="UniFi Dream Machine Pro · Eero Pro · pfSense / Netgate · etc."
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="vlans">VLANs in use (optional)</Label>
            <Input
              id="vlans"
              value={data.vlans_in_use}
              onChange={(e) => onChange("vlans_in_use", e.target.value)}
              placeholder="e.g. VLAN 10 staff, VLAN 20 guest, VLAN 30 IoT"
            />
          </div>
        </div>
      </GlowCard>

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Who's on point</h2>
        <p className="text-sm text-muted-foreground mb-4">
          The person we coordinate with on install day. Doesn't have to be a full-time IT person —
          just someone who knows the network and can be on-site or on-call.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="lead_name">Name</Label>
            <Input
              id="lead_name"
              value={data.it_lead_name}
              onChange={(e) => onChange("it_lead_name", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lead_email">Email</Label>
            <Input
              id="lead_email"
              type="email"
              value={data.it_lead_email}
              onChange={(e) => onChange("it_lead_email", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lead_phone">Phone</Label>
            <Input
              id="lead_phone"
              type="tel"
              value={data.it_lead_phone}
              onChange={(e) => onChange("it_lead_phone", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-3">
          <Label htmlFor="net_notes">Anything else we should know about your network?</Label>
          <Textarea
            id="net_notes"
            value={data.network_notes}
            onChange={(e) => onChange("network_notes", e.target.value)}
            placeholder="Optional. Existing VPN, segmentation gotchas, building's internet quirks, etc."
            rows={3}
          />
        </div>
      </GlowCard>
    </>
  );
}

// ─────────────────────────────────────────────────────
// Stage 5b — Branding
// ─────────────────────────────────────────────────────
function BrandingStage({
  data,
  onChange,
  onUpload,
  uploading,
  companyName,
}: {
  data: BrandingData;
  onChange: <K extends keyof BrandingData>(field: K, value: BrandingData[K]) => void;
  onUpload: (assetType: "logo" | "icon" | "mark", file: File) => Promise<void>;
  uploading: "logo" | "icon" | "mark" | null;
  companyName: string;
}) {
  return (
    <>
      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Domain &amp; subdomain</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Where employees will log in. Default is <code className="text-foreground">cloud.yourcompany.com</code> — pick whatever subdomain pattern fits your brand.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="subdomain">Preferred subdomain</Label>
            <Input
              id="subdomain"
              value={data.subdomain}
              onChange={(e) => onChange("subdomain", e.target.value)}
              placeholder="cloud.yourcompany.com"
            />
          </div>
          <div>
            <Label htmlFor="sysmail">System email address</Label>
            <Input
              id="sysmail"
              type="email"
              value={data.system_mail}
              onChange={(e) => onChange("system_mail", e.target.value)}
              placeholder="noreply@yourcompany.com"
            />
          </div>
        </div>
      </GlowCard>

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Brand colors</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Two colors. Primary is used for the login screen and active-state buttons; accent for highlights, links, and badges.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="primary-color">Primary</Label>
            <div className="flex gap-2 items-center">
              <input
                id="primary-color"
                type="color"
                value={data.primary_color}
                onChange={(e) => onChange("primary_color", e.target.value)}
                className="h-10 w-12 rounded-md border border-border bg-transparent cursor-pointer"
              />
              <Input
                value={data.primary_color}
                onChange={(e) => onChange("primary_color", e.target.value)}
                placeholder="#0a0a0a"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="accent-color">Accent</Label>
            <div className="flex gap-2 items-center">
              <input
                id="accent-color"
                type="color"
                value={data.accent_color}
                onChange={(e) => onChange("accent_color", e.target.value)}
                className="h-10 w-12 rounded-md border border-border bg-transparent cursor-pointer"
              />
              <Input
                value={data.accent_color}
                onChange={(e) => onChange("accent_color", e.target.value)}
                placeholder="#c84d2b"
                className="font-mono text-sm"
              />
            </div>
          </div>
        </div>
      </GlowCard>

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Logo &amp; icon</h2>
        <p className="text-sm text-muted-foreground mb-4">
          PNG, SVG, JPG, or WEBP up to 5 MB each. Logo is the full wordmark for the login screen; icon is the square 1024×1024 mark used for mobile-app and favicon.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UploadSlot
            label="Logo (full wordmark)"
            currentUrl={data.logo_url}
            uploading={uploading === "logo"}
            onPick={(f) => onUpload("logo", f)}
            previewBg="dark"
          />
          <UploadSlot
            label="Icon (square 1024×1024)"
            currentUrl={data.icon_url}
            uploading={uploading === "icon"}
            onPick={(f) => onUpload("icon", f)}
            previewBg="light"
          />
        </div>
      </GlowCard>

      {/* Live preview */}
      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Login preview</h2>
        <p className="text-sm text-muted-foreground mb-4">
          How the login screen will look on day one. Updates live as you change colors and upload assets.
        </p>
        <div
          className="rounded-2xl overflow-hidden border border-border"
          style={{
            background: `linear-gradient(135deg, ${data.primary_color} 0%, ${shade(data.primary_color, -8)} 100%)`,
          }}
        >
          <div className="px-8 py-12 flex flex-col items-center text-center min-h-[280px] justify-center">
            {data.logo_url ? (
              <img
                src={data.logo_url}
                alt="Logo preview"
                className="h-12 mb-6 object-contain"
                style={{ maxWidth: 200 }}
              />
            ) : (
              <div
                className="h-12 mb-6 px-4 flex items-center font-semibold text-xl"
                style={{ color: contrastFor(data.primary_color) }}
              >
                {companyName}
              </div>
            )}
            <div
              className="text-sm mb-4"
              style={{ color: contrastFor(data.primary_color, 0.7) }}
            >
              Sign in to your private cloud
            </div>
            <div
              className="rounded-md px-4 py-2 text-sm font-medium inline-block"
              style={{
                background: data.accent_color,
                color: contrastFor(data.accent_color),
              }}
            >
              Continue
            </div>
            <div
              className="mt-4 text-[11px]"
              style={{ color: contrastFor(data.primary_color, 0.5) }}
            >
              {data.subdomain || "cloud.yourcompany.com"}
            </div>
          </div>
        </div>
      </GlowCard>

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Anything else about your brand?</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Optional. Brand guidelines link, font preferences, things to avoid, etc.
        </p>
        <Textarea
          value={data.branding_notes}
          onChange={(e) => onChange("branding_notes", e.target.value)}
          rows={3}
          placeholder="Optional"
        />
      </GlowCard>
    </>
  );
}

function UploadSlot({
  label,
  currentUrl,
  uploading,
  onPick,
  previewBg,
}: {
  label: string;
  currentUrl: string;
  uploading: boolean;
  onPick: (f: File) => void;
  previewBg: "light" | "dark";
}) {
  const inputId = `up-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div>
      <Label className="block mb-2">{label}</Label>
      <label
        htmlFor={inputId}
        className={`block rounded-xl border-2 border-dashed border-border hover:border-primary/40 cursor-pointer transition-colors p-4 flex flex-col items-center justify-center min-h-[140px] ${
          previewBg === "dark" ? "bg-neutral-900" : "bg-neutral-50 dark:bg-neutral-800"
        }`}
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : currentUrl ? (
          <>
            <img
              src={currentUrl}
              alt={label}
              className="max-h-20 max-w-full object-contain mb-2"
            />
            <span className="text-[11px] text-muted-foreground">Click to replace</span>
          </>
        ) : (
          <>
            <Palette className={`h-6 w-6 mb-2 ${previewBg === "dark" ? "text-white/40" : "text-muted-foreground"}`} />
            <span className={`text-xs ${previewBg === "dark" ? "text-white/60" : "text-muted-foreground"}`}>
              Click to upload
            </span>
            <span className={`text-[10px] mt-0.5 ${previewBg === "dark" ? "text-white/30" : "text-muted-foreground"}`}>
              PNG / SVG / JPG / WEBP · max 5 MB
            </span>
          </>
        )}
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

// Tiny helpers for the live preview — no external color library.
function contrastFor(hex: string, alpha = 1) {
  const c = hex.replace("#", "");
  if (c.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? `rgba(10,10,10,${alpha})` : `rgba(255,255,255,${alpha})`;
}

function shade(hex: string, percent: number) {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  let r = parseInt(c.slice(0, 2), 16);
  let g = parseInt(c.slice(2, 4), 16);
  let b = parseInt(c.slice(4, 6), 16);
  const f = 1 + percent / 100;
  r = Math.max(0, Math.min(255, Math.round(r * f)));
  g = Math.max(0, Math.min(255, Math.round(g * f)));
  b = Math.max(0, Math.min(255, Math.round(b * f)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────
// Stage 5c — Users
// ─────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCsv(text: string): IntakeUser[] {
  // Tiny RFC4180-ish CSV parser. Handles quoted fields with commas,
  // escaped double-quotes, CRLF, BOM, optional header row.
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.length > 1 || cur[0]) lines.push(cur);
      cur = [];
    } else {
      field += c;
    }
  }
  if (field || cur.length) {
    cur.push(field);
    if (cur.length > 1 || cur[0]) lines.push(cur);
  }
  if (lines.length === 0) return [];

  // Detect header row by looking for "email" / "name" headers
  const header = lines[0].map((h) => h.toLowerCase().trim());
  const hasHeader = header.some((h) => h === "email" || h === "name");
  const rows = hasHeader ? lines.slice(1) : lines;
  const idx = (k: string) => header.indexOf(k);
  const nameI = hasHeader ? idx("name") : 0;
  const emailI = hasHeader ? idx("email") : 1;
  const roleI = hasHeader ? idx("role") : 2;
  const groupI = hasHeader ? Math.max(idx("group"), idx("team"), idx("department")) : 3;

  return rows
    .map((r) => {
      const role = (r[roleI] || "").toLowerCase().trim();
      return {
        name: (r[nameI] || "").trim(),
        email: (r[emailI] || "").trim().toLowerCase(),
        role: role === "admin" ? "admin" : ("member" as IntakeUser["role"]),
        group: (r[groupI] || "").trim(),
      };
    })
    .filter((u) => u.email || u.name);
}

function UsersStage({
  users,
  onCommit,
}: {
  users: IntakeUser[];
  onCommit: (next: IntakeUser[]) => void;
}) {
  const validCount = users.filter((u) => u.name.trim() && EMAIL_RE.test(u.email)).length;
  const adminCount = users.filter((u) => u.role === "admin").length;
  const dupes = (() => {
    const seen = new Set<string>();
    const set = new Set<string>();
    for (const u of users) {
      const e = u.email.toLowerCase().trim();
      if (!e) continue;
      if (seen.has(e)) set.add(e);
      seen.add(e);
    }
    return set;
  })();

  function update(i: number, field: keyof IntakeUser, value: string) {
    const next = users.slice();
    if (field === "role") {
      next[i] = { ...next[i], role: value === "admin" ? "admin" : "member" };
    } else {
      next[i] = { ...next[i], [field]: value } as IntakeUser;
    }
    onCommit(next);
  }
  function remove(i: number) {
    const next = users.slice();
    next.splice(i, 1);
    onCommit(next);
  }
  function add() {
    onCommit([...users, { name: "", email: "", role: "member", group: "" }]);
  }
  function onCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result || ""));
      if (parsed.length === 0) return;
      // Append by default; replace if user holds shift (we surface as a button below)
      const merged = [...users];
      const existingEmails = new Set(merged.map((u) => u.email.toLowerCase()));
      for (const p of parsed) {
        if (!p.email || existingEmails.has(p.email)) continue;
        merged.push(p);
        existingEmails.add(p.email);
      }
      onCommit(merged);
    };
    reader.readAsText(file);
  }
  function downloadTemplate() {
    const csv =
      "name,email,role,group\nJane Cooper,jane@yourco.com,admin,Leadership\nJohn Doe,john@yourco.com,member,Engineering\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bestly-cloud-users-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Roster</h2>
        <p className="text-sm text-muted-foreground mb-4">
          People who'll have accounts on day one. Upload a CSV (name, email,
          role, group) or add rows manually. Roles: <code className="text-foreground">admin</code> can
          manage settings; <code className="text-foreground">member</code> is everyone else. Group is freeform — we use it for
          team-level permissions.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <label htmlFor="csv-up" className="cursor-pointer">
              <ArrowDownToLine className="h-3.5 w-3.5 rotate-180" />
              Upload CSV
              <input
                id="csv-up"
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onCsv(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={downloadTemplate}>
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Download template
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={add}>
            <Users className="h-3.5 w-3.5" />
            Add row
          </Button>
        </div>

        {/* Stats strip */}
        <div className="flex flex-wrap gap-3 mb-4 text-xs">
          <span className="rounded-md bg-secondary/50 px-2.5 py-1 text-muted-foreground">
            Total: <span className="text-foreground font-medium">{users.length}</span>
          </span>
          <span className="rounded-md bg-secondary/50 px-2.5 py-1 text-muted-foreground">
            Valid: <span className="text-foreground font-medium">{validCount}</span>
          </span>
          <span className="rounded-md bg-secondary/50 px-2.5 py-1 text-muted-foreground">
            Admins: <span className="text-foreground font-medium">{adminCount}</span>
          </span>
          {dupes.size > 0 && (
            <span className="rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2.5 py-1">
              Duplicate emails: {dupes.size}
            </span>
          )}
        </div>

        {users.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Users className="h-7 w-7 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-2">
              No users yet. Upload a CSV or add rows manually to start.
            </p>
            <p className="text-xs text-muted-foreground">
              CSV columns: <code className="text-foreground">name, email, role, group</code>
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Email</th>
                  <th className="text-left px-3 py-2 font-medium w-28">Role</th>
                  <th className="text-left px-3 py-2 font-medium">Group</th>
                  <th className="w-10 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const emailValid = !u.email || EMAIL_RE.test(u.email);
                  const isDupe = dupes.has(u.email.toLowerCase());
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1">
                        <Input
                          value={u.name}
                          onChange={(e) => update(i, "name", e.target.value)}
                          placeholder="Jane Cooper"
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="email"
                          value={u.email}
                          onChange={(e) => update(i, "email", e.target.value)}
                          placeholder="jane@yourco.com"
                          className={`h-8 text-sm ${
                            !emailValid || isDupe ? "border-amber-500/60" : ""
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={u.role}
                          onValueChange={(v) => update(i, "role", v)}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={u.group}
                          onChange={(e) => update(i, "group", e.target.value)}
                          placeholder="Engineering"
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-1 py-1 text-right">
                        <button
                          onClick={() => remove(i)}
                          className="text-muted-foreground hover:text-destructive text-xs px-1"
                          aria-label="Remove row"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlowCard>
    </>
  );
}

// ─────────────────────────────────────────────────────
// Stage 5e — Policy
// ─────────────────────────────────────────────────────
function PolicyStage({
  data,
  onChange,
}: {
  data: PolicyData;
  onChange: <K extends keyof PolicyData>(field: K, value: PolicyData[K]) => void;
}) {
  function toggleCategory(slug: string, on: boolean) {
    const next = on
      ? Array.from(new Set([...(data.dns_filter_categories || []), slug]))
      : (data.dns_filter_categories || []).filter((s) => s !== slug);
    onChange("dns_filter_categories", next);
  }

  return (
    <>
      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Two-factor authentication</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Required is the safest default. Optional lets users opt in. Off only makes sense for tightly controlled networks where the box is unreachable from outside the building.
        </p>
        <Select
          value={data.twofa_enforcement}
          onValueChange={(v) => onChange("twofa_enforcement", v as PolicyData["twofa_enforcement"])}
        >
          <SelectTrigger className="max-w-md">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="required">Required for everyone</SelectItem>
            <SelectItem value="optional">Optional, opt-in</SelectItem>
            <SelectItem value="off">Off</SelectItem>
          </SelectContent>
        </Select>
      </GlowCard>

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">VPN access</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Who can reach the cloud from outside the office over WireGuard? "All users" is the most common pick — the brochure includes encrypted remote access for everyone. "Admins only" tightens the perimeter. "None" means in-office network only.
        </p>
        <Select
          value={data.vpn_scope}
          onValueChange={(v) => onChange("vpn_scope", v as PolicyData["vpn_scope"])}
        >
          <SelectTrigger className="max-w-md">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all_users">All users</SelectItem>
            <SelectItem value="admins_only">Admins only</SelectItem>
            <SelectItem value="none">None — in-office only</SelectItem>
          </SelectContent>
        </Select>
      </GlowCard>

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">DNS filter categories to block</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Network-wide blocking via Pi-hole-style upstream. We turn these on at the router level so every device gets the protection — no client install required.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {DNS_CATEGORIES.map((cat) => {
            const checked = (data.dns_filter_categories || []).includes(cat.slug);
            return (
              <label
                key={cat.slug}
                className="flex items-center gap-2 p-2.5 rounded-xl border border-border bg-background hover:bg-secondary/30 cursor-pointer transition-colors"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => toggleCategory(cat.slug, !!v)}
                />
                <span className="text-sm">{cat.label}</span>
              </label>
            );
          })}
        </div>
      </GlowCard>

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Off-site backup</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Encrypted nightly backup so a fire, theft, or hardware failure never costs you a workday. Bring your own Backblaze B2 (cheapest, ~$0.005/GB/month) or let Bestly host it as part of managed support.
        </p>
        <Select
          value={data.backup_destination}
          onValueChange={(v) =>
            onChange("backup_destination", v as PolicyData["backup_destination"])
          }
        >
          <SelectTrigger className="max-w-md">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="own_backblaze">My Backblaze account</SelectItem>
            <SelectItem value="bestly_managed">Bestly-managed (included with managed support)</SelectItem>
            <SelectItem value="both">Both — primary + secondary</SelectItem>
          </SelectContent>
        </Select>
        {data.backup_destination === "own_backblaze" || data.backup_destination === "both" ? (
          <div className="mt-3 max-w-md">
            <Label htmlFor="bb-bucket">Backblaze bucket name (optional)</Label>
            <Input
              id="bb-bucket"
              value={data.backblaze_bucket_name}
              onChange={(e) => onChange("backblaze_bucket_name", e.target.value)}
              placeholder="e.g. acme-bestly-backups"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Leave blank if you'd rather we set up the bucket on install day.
            </p>
          </div>
        ) : null}
      </GlowCard>

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Data retention</h2>
        <p className="text-sm text-muted-foreground mb-4">
          How long to keep deleted files, archived chat threads, and audit logs before purging. Compliance frameworks usually require minimums — HIPAA wants 6 years, SOX wants 7. If unsure, 60 months covers most cases.
        </p>
        <Select
          value={data.retention_months}
          onValueChange={(v) =>
            onChange("retention_months", v as PolicyData["retention_months"])
          }
        >
          <SelectTrigger className="max-w-md">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="12">12 months</SelectItem>
            <SelectItem value="24">24 months</SelectItem>
            <SelectItem value="36">36 months</SelectItem>
            <SelectItem value="60">60 months (5 years)</SelectItem>
            <SelectItem value="indefinite">Indefinite — never auto-purge</SelectItem>
          </SelectContent>
        </Select>
      </GlowCard>

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Anything else policy-wise?</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Optional. Compliance constraints, audit-log destination, third-party integrations to allow or block, etc.
        </p>
        <Textarea
          value={data.policy_notes}
          onChange={(e) => onChange("policy_notes", e.target.value)}
          rows={3}
          placeholder="Optional"
        />
      </GlowCard>
    </>
  );
}


// ─────────────────────────────────────────────────────
// Stage 5d — Migration
// ─────────────────────────────────────────────────────
function MigrationStage({
  data,
  onCommit,
}: {
  data: MigrationData;
  onCommit: (next: MigrationData) => void;
}) {
  function toggleSource(slug: string, on: boolean) {
    const selected = on
      ? Array.from(new Set([...data.selected_sources, slug]))
      : data.selected_sources.filter((s) => s !== slug);
    const per: Record<string, MigrationSource> = { ...(data.per_source || {}) };
    if (on && !per[slug]) {
      per[slug] = {
        slug,
        scope: "",
        data_volume_gb_per_user: "",
        decommission_after_days: "",
        source_notes: "",
      };
    }
    if (!on) delete per[slug];
    onCommit({ ...data, selected_sources: selected, per_source: per });
  }

  function patchSource<K extends keyof MigrationSource>(
    slug: string,
    field: K,
    value: MigrationSource[K]
  ) {
    const cur = data.per_source[slug] || {
      slug,
      scope: "",
      data_volume_gb_per_user: "",
      decommission_after_days: "",
      source_notes: "",
    };
    onCommit({
      ...data,
      per_source: { ...data.per_source, [slug]: { ...cur, [field]: value } },
    });
  }

  function patchTop<K extends keyof MigrationData>(field: K, value: MigrationData[K]) {
    onCommit({ ...data, [field]: value });
  }

  return (
    <>
      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Where are we pulling from?</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Pick everything you want migrated. We'll extract from the ones we have official APIs for and export-then-reimport the rest. You'll grant us access on a per-source basis after this — for now we're just scoping.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SOURCE_CATALOG.map((src) => {
            const checked = data.selected_sources.includes(src.slug);
            return (
              <label
                key={src.slug}
                className="flex items-start gap-3 p-3 rounded-xl border border-border bg-background hover:bg-secondary/30 cursor-pointer transition-colors"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => toggleSource(src.slug, !!v)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{src.label}</div>
                  <div className="text-xs text-muted-foreground truncate">{src.note}</div>
                </div>
              </label>
            );
          })}
        </div>
      </GlowCard>

      {/* Per-source scope cards */}
      {data.selected_sources.length > 0 && (
        <>
          {data.selected_sources.map((slug) => {
            const src = SOURCE_CATALOG.find((s) => s.slug === slug)!;
            const ps = data.per_source[slug];
            return (
              <GlowCard key={slug}>
                <h3 className="text-base font-semibold mb-1">{src.label}</h3>
                <p className="text-xs text-muted-foreground mb-4">{src.note}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Migration scope</Label>
                    <Select
                      value={ps?.scope ?? ""}
                      onValueChange={(v) =>
                        patchSource(slug, "scope", v as MigrationSource["scope"])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="everything">Everything</SelectItem>
                        <SelectItem value="recent_12mo">Last 12 months</SelectItem>
                        <SelectItem value="recent_90d">Last 90 days</SelectItem>
                        <SelectItem value="specific">Specific only — we'll list in notes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Approx GB per user</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={ps?.data_volume_gb_per_user ?? ""}
                      onChange={(e) =>
                        patchSource(slug, "data_volume_gb_per_user", e.target.value)
                      }
                      placeholder="e.g. 5"
                    />
                  </div>
                  <div>
                    <Label>Decommission source after (days)</Label>
                    <Input
                      type="number"
                      value={ps?.decommission_after_days ?? ""}
                      onChange={(e) =>
                        patchSource(slug, "decommission_after_days", e.target.value)
                      }
                      placeholder="e.g. 60"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Notes — folders to skip, special cases, etc.</Label>
                    <Textarea
                      value={ps?.source_notes ?? ""}
                      onChange={(e) => patchSource(slug, "source_notes", e.target.value)}
                      rows={2}
                      placeholder="Optional"
                    />
                  </div>
                </div>
              </GlowCard>
            );
          })}
        </>
      )}

      <GlowCard>
        <h2 className="text-lg font-semibold mb-1">Cutover policy</h2>
        <p className="text-sm text-muted-foreground mb-4">
          For most teams we recommend keeping the source live for 60 days as fallback while everyone settles in. After that, decommission per the per-source schedule above.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Default fallback window (days)</Label>
            <Input
              type="number"
              value={data.fallback_window_days}
              onChange={(e) => patchTop("fallback_window_days", e.target.value)}
              placeholder="60"
            />
          </div>
          <div>
            <Label>Freeze writes to old systems on cutover?</Label>
            <Select
              value={data.freeze_writes_at_cutover}
              onValueChange={(v) =>
                patchTop("freeze_writes_at_cutover", v as MigrationData["freeze_writes_at_cutover"])
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes — read-only on day one</SelectItem>
                <SelectItem value="no">No — keep both writable</SelectItem>
                <SelectItem value="unsure">Not sure</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3">
          <Label>Anything else about the migration?</Label>
          <Textarea
            value={data.migration_notes}
            onChange={(e) => patchTop("migration_notes", e.target.value)}
            rows={3}
            placeholder="Optional. Compliance constraints, archival requirements, eDiscovery holds, etc."
          />
        </div>
      </GlowCard>
    </>
  );
}

// ─────────────────────────────────────────────────────
// Coming-soon stub
// ─────────────────────────────────────────────────────
function ComingSoonStage({ stage }: { stage: StageKey }) {
  const meta = STAGES.find((s) => s.key === stage)!;
  const Icon = meta.icon;
  return (
    <GlowCard>
      <div className="flex flex-col items-center text-center py-10">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/40 mb-4">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold mb-2">{meta.label} — coming next</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
          We're shipping this stage in the next update. For now, focus on{" "}
          <span className="text-foreground">5a Network</span> — we'll handle {meta.label.toLowerCase()} by email
          when we get there.
        </p>
      </div>
    </GlowCard>
  );
}

// ─────────────────────────────────────────────────────
// CustomerStatusView — what the customer sees at /intake/:token
// once they've submitted. Live status of their build through
// Provisioning, Install, and Live stages.
// ─────────────────────────────────────────────────────

const PUBLIC_PROVISIONING_STEPS: { key: string; label: string }[] = [
  { key: "hardware-procured",  label: "Hardware procured" },
  { key: "os-imaged",           label: "OS imaged" },
  { key: "services-configured", label: "Services configured" },
  { key: "branding-applied",    label: "Your branding applied" },
  { key: "users-created",       label: "User accounts created" },
  { key: "migration-queued",    label: "Migration queued" },
  { key: "test-deploy-passed",  label: "Test deploy passed" },
  { key: "certs-issued",        label: "TLS certs issued" },
];

const STAGE_PUBLIC_LABEL: Record<number, string> = {
  5: "Build queued",
  6: "Building your cloud",
  7: "Shipping & install",
  8: "Live",
};

function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function CustomerStatusView({ deal }: { deal: Deal }) {
  const stage = deal.current_stage ?? 6;
  const firstName = deal.primary_contact_name.split(" ")[0];
  const provisioning = (deal.provisioning_data || {}) as Record<string, { done?: boolean }>;
  const install = (deal.install_data || {}) as {
    shipping?: { carrier?: string; tracking_number?: string; ship_date?: string; eta?: string };
    install?: { scheduled_at?: string; mode?: string };
    acceptance?: { signed_at?: string };
  };

  const stepsDone = PUBLIC_PROVISIONING_STEPS.filter((s) => provisioning[s.key]?.done).length;
  const provisioningPct = Math.round((stepsDone / PUBLIC_PROVISIONING_STEPS.length) * 100);
  // First not-yet-done step = what we're actively working on right now.
  const nextStepIdx = PUBLIC_PROVISIONING_STEPS.findIndex((s) => !provisioning[s.key]?.done);

  // Auto-refresh every 60s so the status stays current without a reload
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <SEOHead
        title={`Build status — ${deal.company_name}`}
        description="Live status of your Bestly Cloud build."
      />
      <div className="relative">
        {stage >= 8 && <LiveCelebration dealId={deal.company_name} />}
        <div className="mx-auto max-w-3xl px-6 py-10 lg:py-14">
          <AnimatedSection>
            <Badge variant="outline" className="mb-3 border-primary/30 text-primary">
              Build status — {deal.company_name}
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {stage >= 8 ? (
                <>You're <GradientText>live</GradientText>, {firstName}.</>
              ) : stage === 7 ? (
                <>Shipping &amp; install, {firstName}.</>
              ) : (
                <>We're <GradientText>building your cloud</GradientText>, {firstName}.</>
              )}
            </h1>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              Bookmark this page — it's your live read on the build. We update it as we work,
              so refresh anytime. We'll also email you at each major milestone.
            </p>
          </AnimatedSection>

          {/* Stage progress meter */}
          <AnimatedSection delay={60}>
            <div className="mt-8 rounded-xl border border-border bg-secondary/20 p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  Current stage
                </span>
                <span className="text-sm font-medium">
                  {STAGE_PUBLIC_LABEL[stage] ?? "In progress"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[6, 7, 8].map((s) => {
                  const active = s === stage;
                  const done = stage > s;
                  return (
                    <div
                      key={s}
                      className={`h-1.5 rounded-full transition-all ${
                        done ? "bg-emerald-500" : active ? "bg-primary" : "bg-border"
                      }`}
                    />
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-1.5 mt-2 text-[11px] text-muted-foreground">
                <div className={stage >= 6 ? "text-foreground" : ""}>Build</div>
                <div className={`text-center ${stage >= 7 ? "text-foreground" : ""}`}>Install</div>
                <div className={`text-right ${stage >= 8 ? "text-foreground" : ""}`}>Live</div>
              </div>
            </div>
          </AnimatedSection>

          {/* Provisioning detail (Stage 6) */}
          {stage >= 6 && stage < 8 && (
            <AnimatedSection delay={100}>
              <GlowCard className="mt-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Build progress</h2>
                  <Badge variant="outline" className="text-xs">
                    {stepsDone}/{PUBLIC_PROVISIONING_STEPS.length} · {provisioningPct}%
                  </Badge>
                </div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden mb-5">
                  <div
                    className={`h-full transition-all duration-500 ${
                      stepsDone === PUBLIC_PROVISIONING_STEPS.length ? "bg-emerald-500" : "bg-primary"
                    }`}
                    style={{ width: `${provisioningPct}%` }}
                  />
                </div>
                <ul className="space-y-1.5">
                  {PUBLIC_PROVISIONING_STEPS.map((s, i) => {
                    const done = !!provisioning[s.key]?.done;
                    const current = i === nextStepIdx;
                    return (
                      <li key={s.key} className="flex items-center gap-2.5 py-1">
                        <div
                          className={`w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center ${
                            done
                              ? "border-emerald-500 bg-emerald-500"
                              : current
                              ? "border-primary animate-pulse-glow"
                              : "border-border"
                          }`}
                        >
                          {done && <Check className="h-2.5 w-2.5 text-white" />}
                        </div>
                        <span
                          className={`text-sm ${
                            done ? "text-foreground" : current ? "text-foreground font-medium" : "text-muted-foreground"
                          }`}
                        >
                          {s.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </GlowCard>
            </AnimatedSection>
          )}

          {/* Install info (Stage 7) */}
          {(stage === 7 ||
            (stage === 6 && (install.shipping?.tracking_number || install.install?.scheduled_at))) && (
            <AnimatedSection delay={140}>
              <GlowCard className="mt-5">
                <h2 className="text-lg font-semibold mb-1">Shipping &amp; install</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Where your hardware is and when we'll get it set up.
                </p>
                <dl className="space-y-2.5 text-sm">
                  {install.shipping?.carrier && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Carrier</dt>
                      <dd className="text-foreground capitalize">{install.shipping.carrier}</dd>
                    </div>
                  )}
                  {install.shipping?.tracking_number && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Tracking</dt>
                      <dd className="text-foreground font-mono text-xs">
                        {install.shipping.tracking_number}
                      </dd>
                    </div>
                  )}
                  {install.shipping?.eta && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Expected delivery</dt>
                      <dd className="text-foreground">{fmtDateLong(install.shipping.eta)}</dd>
                    </div>
                  )}
                  {install.install?.scheduled_at && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Install scheduled</dt>
                      <dd className="text-foreground">{fmtDateLong(install.install.scheduled_at)}</dd>
                    </div>
                  )}
                  {install.install?.mode && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Install mode</dt>
                      <dd className="text-foreground capitalize">
                        {install.install.mode.replace(/-/g, " ")}
                      </dd>
                    </div>
                  )}
                </dl>
              </GlowCard>
            </AnimatedSection>
          )}

          {/* Live (Stage 8) */}
          {stage >= 8 && deal.go_live_at && (
            <AnimatedSection delay={160}>
              <GlowCard className="mt-5">
                <div className="flex items-center gap-3 mb-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                  <h2 className="text-lg font-semibold">Your cloud is live.</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Live since {fmtDateLong(deal.go_live_at)}. Your team can sign in at the
                  subdomain you chose during the intake.
                </p>
                <p className="text-sm text-muted-foreground">
                  We'll check in at 30 days, then quarterly. If anything's off before then, just reply
                  to any of our emails.
                </p>
              </GlowCard>
            </AnimatedSection>
          )}

          {/* Quiet section / contact */}
          <AnimatedSection delay={200}>
            <div className="mt-8 rounded-xl border border-dashed border-border bg-secondary/10 p-5 text-center">
              <p className="text-sm text-muted-foreground mb-2">
                Need anything? Reply to your last email from us, or write{" "}
                <a
                  href="mailto:jared@bestly.tech"
                  className="text-foreground underline underline-offset-4 hover:text-primary transition-colors"
                >
                  jared@bestly.tech
                </a>
                .
              </p>
              <p className="text-xs text-muted-foreground/70">
                This page auto-refreshes every minute. Bookmark it — same link works
                throughout your build.
              </p>
            </div>
          </AnimatedSection>
        </div>
      </div>
    </>
  );
}

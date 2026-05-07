import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { PageHeader } from "@/components/admin/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Mail,
  Phone,
  Send,
  Clock,
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  PenSquare,
  DollarSign,
  Wrench,
  ShieldCheck,
  XCircle,
  Check as CheckIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STAGE_LABELS: Record<number, string> = {
  1: "New lead",
  2: "Brief in flight",
  3: "Discovery",
  4: "SOW + deposit",
  5: "Tech intake",
  6: "Provisioning",
  7: "Install",
  8: "Live",
};

type Lead = {
  id: string;
  created_at: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  company_name: string;
  company_website: string | null;
  user_count_band: string;
  primary_pain: string | null;
  primary_pain_detail: string | null;
  urgency: string | null;
  status: string;
  notes: string | null;
};

type Brief = {
  id: string;
  access_token: string;
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

type Deal = {
  id: string;
  current_stage: number;
  stage_changed_at: string;
  target_user_count: number | null;
  support_tier: string | null;
  deployment_fee_cents: number | null;
  monthly_support_fee_cents: number | null;
  notes: string | null;
  intake_token: string | null;
  intake_data: Record<string, any> | null;
  provisioning_data: Record<string, any> | null;
  install_data: Record<string, any> | null;
  live_data: Record<string, any> | null;
  go_live_at?: string | null;
  intake_submitted_at: string | null;
  shield_request_token: string | null;
  docusign_envelope_id?: string | null; // deprecated — use signing_request_id
  signing_provider?: "libresign" | "docusign" | null;
  signing_request_id?: string | null;
  signing_document_url?: string | null;
  sow_sent_at?: string | null;
};

type ShieldRequest = {
  id: string;
  deal_id: string;
  created_at: string;
  requested_url: string;
  requester_name: string | null;
  requester_email: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "duplicate";
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_notes: string | null;
};

type Event = {
  id: string;
  created_at: string;
  event_type: string;
  event_payload: any;
  triggered_by: string | null;
};

const APP_LABEL: Record<string, string> = {
  drive: "Drive",
  "video-chat": "Video & Chat",
  mail: "Mail",
  docs: "Docs",
  calendar: "Calendar",
  ai: "AI",
  shield: "DNS Shield",
  vpn: "VPN",
  backup: "Backup",
  projects: "Projects",
  forms: "Forms",
  passwords: "Passwords",
  sign: "E-sign",
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

function fmtAbs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CloudDealDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [lead, setLead] = useState<Lead | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<string>("5000");
  const [paymentDescription, setPaymentDescription] = useState<string>(
    "Bestly In-House Cloud — deployment deposit"
  );
  const [generatingLink, setGeneratingLink] = useState(false);
  const [signingDialog, setSigningDialog] = useState(false);
  const [signingRequestId, setSigningRequestId] = useState("");
  const [savingEnvelope, setSavingEnvelope] = useState(false);
  const [sendingSign, setSendingSign] = useState(false);
  const [shieldRequests, setShieldRequests] = useState<ShieldRequest[]>([]);
  const [shieldFilter, setShieldFilter] = useState<"pending" | "all">("pending");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [lRes, bRes, dRes, eRes] = await Promise.all([
        supabase.from("cloud_leads").select("*").eq("id", id).maybeSingle(),
        supabase.from("cloud_briefs").select("*").eq("lead_id", id).maybeSingle(),
        supabase.from("cloud_deals").select("*").eq("lead_id", id).maybeSingle(),
        supabase
          .from("cloud_deal_events")
          .select("*")
          .eq("lead_id", id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      setLead(lRes.data as Lead | null);
      setBrief(bRes.data as Brief | null);
      setDeal(dRes.data as Deal | null);
      setEvents((eRes.data as Event[]) || []);
      setNotes((lRes.data as any)?.notes || "");

      // Pull shield requests if a deal exists
      if (dRes.data?.id) {
        const { data: sr } = await supabase
          .from("cloud_shield_requests")
          .select("*")
          .eq("deal_id", dRes.data.id)
          .order("created_at", { ascending: false })
          .limit(100);
        if (!cancelled) setShieldRequests((sr as ShieldRequest[]) || []);
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const stage = deal?.current_stage ?? (brief?.submitted_at ? 3 : 2);

  async function advanceStage(direction: 1 | -1) {
    if (!lead) return;
    const target = Math.min(8, Math.max(1, stage + direction));
    if (target === stage) return;

    if (deal) {
      const { error } = await supabase
        .from("cloud_deals")
        .update({ current_stage: target })
        .eq("id", deal.id);
      if (error) {
        toast({ title: "Couldn't advance", description: error.message, variant: "destructive" });
        return;
      }
      setDeal({ ...deal, current_stage: target, stage_changed_at: new Date().toISOString() });
    } else {
      // No deal yet — create one when advancing past discovery
      const { data, error } = await supabase
        .from("cloud_deals")
        .insert({
          lead_id: lead.id,
          current_stage: target,
          company_name: lead.company_name,
          primary_contact_name: lead.contact_name,
          primary_contact_email: lead.contact_email,
        })
        .select("*")
        .single();
      if (error) {
        toast({ title: "Couldn't create deal", description: error.message, variant: "destructive" });
        return;
      }
      setDeal(data as Deal);
    }
    toast({ title: `Moved to ${STAGE_LABELS[target]}` });
    // Reload events
    const { data: e } = await supabase
      .from("cloud_deal_events")
      .select("*")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setEvents((e as Event[]) || []);
  }

  async function generateIntakeLink() {
    if (!deal) {
      toast({
        title: "No deal record yet",
        description: "Advance past Stage 4 (SOW signed) first.",
        variant: "destructive",
      });
      return;
    }
    let token = deal.intake_token;
    if (!token) {
      // Generate a 48-char hex token client-side and persist
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const { error } = await supabase
        .from("cloud_deals")
        .update({ intake_token: token })
        .eq("id", deal.id);
      if (error) {
        toast({ title: "Couldn't generate", description: error.message, variant: "destructive" });
        return;
      }
      setDeal({ ...deal, intake_token: token } as Deal);
    }
    const url = `${window.location.origin}/intake/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Intake link copied",
        description: "Email it to the IT lead.",
      });
    } catch {
      toast({ title: url });
    }
  }

  async function copyBriefLink() {
    if (!brief) return;
    const url = `${window.location.origin}/brief/${brief.access_token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Brief link copied" });
    } catch {
      toast({ title: url });
    }
  }

  async function generatePaymentLink() {
    if (!deal) {
      toast({
        title: "No deal record yet",
        description: "Advance to Stage 4 first to create the deal.",
        variant: "destructive",
      });
      return;
    }
    const cents = Math.round(Number(paymentAmount) * 100);
    if (!cents || cents < 100) {
      toast({ title: "Amount invalid", variant: "destructive" });
      return;
    }
    setGeneratingLink(true);
    try {
      const { data, error } = await supabase.functions.invoke("cloud-deal-payment-link", {
        body: { deal_id: deal.id, amount_cents: cents, description: paymentDescription },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "failed");

      // Copy URL + open
      try {
        await navigator.clipboard.writeText(data.url);
      } catch {}
      window.open(data.url, "_blank");
      toast({
        title: "Payment link ready",
        description: "URL copied to clipboard and opened in a new tab.",
      });
      setPaymentDialog(false);

      // Reload events so the new "stripe_link_created" appears
      const { data: e } = await supabase
        .from("cloud_deal_events")
        .select("*")
        .eq("lead_id", lead!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      setEvents((e as Event[]) || []);
    } catch (err: any) {
      toast({
        title: "Couldn't generate link",
        description: err.message || "See console.",
        variant: "destructive",
      });
    } finally {
      setGeneratingLink(false);
    }
  }

  async function sendViaLibresign(kind: "sow" | "acceptance" | "nda") {
    if (!deal || !lead) {
      toast({
        title: "No deal record yet",
        description: "Advance to Stage 4 first.",
        variant: "destructive",
      });
      return;
    }
    setSendingSign(true);
    try {
      const { data, error } = await supabase.functions.invoke("cloud-deal-sign", {
        body: { deal_id: deal.id, template_kind: kind },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "send failed");
      toast({
        title: "Sent via Libresign",
        description: `Customer will receive the ${kind.toUpperCase()} signing link by email.`,
      });
      // Refresh deal + events
      const [dRes, eRes] = await Promise.all([
        supabase.from("cloud_deals").select("*").eq("id", deal.id).maybeSingle(),
        supabase
          .from("cloud_deal_events")
          .select("*")
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (dRes.data) setDeal(dRes.data as Deal);
      if (eRes.data) setEvents((eRes.data as Event[]) || []);
      setSigningDialog(false);
    } catch (err: any) {
      toast({
        title: "Couldn't send via Libresign",
        description:
          err?.message?.includes("503") || err?.message?.includes("not configured")
            ? "Libresign env vars not set yet. Use the paste-flow below as fallback."
            : err.message || "See console.",
        variant: "destructive",
      });
    } finally {
      setSendingSign(false);
    }
  }

  async function recordEnvelope() {
    if (!deal || !lead) {
      toast({
        title: "No deal record yet",
        description: "Advance to Stage 4 first.",
        variant: "destructive",
      });
      return;
    }
    if (!signingRequestId.trim()) {
      toast({ title: "Signing request ID required", variant: "destructive" });
      return;
    }
    setSavingEnvelope(true);
    const { error: updErr } = await supabase
      .from("cloud_deals")
      .update({
        signing_provider: "libresign",
        signing_request_id: signingRequestId.trim(),
        sow_sent_at: new Date().toISOString(),
      })
      .eq("id", deal.id);
    if (updErr) {
      setSavingEnvelope(false);
      toast({ title: "Couldn't save", description: updErr.message, variant: "destructive" });
      return;
    }
    await supabase.from("cloud_deal_events").insert({
      deal_id: deal.id,
      lead_id: lead.id,
      event_type: "sow_sent",
      event_payload: { signing_provider: "libresign", signing_request_id: signingRequestId.trim() },
      triggered_by: "admin",
    });
    toast({ title: "SOW recorded" });
    setDeal({
      ...deal,
      signing_provider: "libresign",
      signing_request_id: signingRequestId.trim(),
      sow_sent_at: new Date().toISOString(),
    } as Deal);
    setSavingEnvelope(false);
    setSigningDialog(false);
    setSigningRequestId("");
  }

  async function generateShieldToken() {
    if (!deal) {
      toast({
        title: "No deal record yet",
        description: "Advance to Stage 4+ to create the deal first.",
        variant: "destructive",
      });
      return;
    }
    let token = deal.shield_request_token;
    if (!token) {
      const bytes = new Uint8Array(20);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const { error } = await supabase
        .from("cloud_deals")
        .update({ shield_request_token: token })
        .eq("id", deal.id);
      if (error) {
        toast({ title: "Couldn't generate", description: error.message, variant: "destructive" });
        return;
      }
      setDeal({ ...deal, shield_request_token: token } as Deal);
    }
    const url = `${window.location.origin}/shield/request/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Shield request URL copied", description: "Add to pi-hole block page footer." });
    } catch {
      toast({ title: url });
    }
  }

  async function reviewShieldRequest(
    requestId: string,
    status: "approved" | "rejected" | "duplicate"
  ) {
    const { error } = await supabase
      .from("cloud_shield_requests")
      .update({
        status,
        reviewed_by: "admin",
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    if (error) {
      toast({ title: "Couldn't update", description: error.message, variant: "destructive" });
      return;
    }
    setShieldRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? { ...r, status, reviewed_at: new Date().toISOString(), reviewed_by: "admin" }
          : r
      )
    );
    toast({
      title:
        status === "approved"
          ? "Approved — push to pi-hole next"
          : status === "rejected"
          ? "Marked rejected"
          : "Marked duplicate",
    });
  }

  async function saveNotes() {
    if (!lead) return;
    setSavingNotes(true);
    const { error } = await supabase
      .from("cloud_leads")
      .update({ notes })
      .eq("id", lead.id);
    setSavingNotes(false);
    if (error) {
      toast({ title: "Couldn't save notes", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Notes saved" });
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-96" />
          <Skeleton className="h-96 lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
        <h3 className="text-base font-medium text-white/80 mb-2">Deal not found</h3>
        <Button asChild variant="outline" className="mt-2">
          <Link to="/admin/cloud">← Back to pipeline</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-3 text-white/50 hover:text-white">
          <Link to="/admin/cloud">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to pipeline
          </Link>
        </Button>
        <PageHeader
          title={lead.company_name}
          description={`${lead.user_count_band} users · created ${fmtAge(lead.created_at)}`}
          actions={
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/30 text-primary">
                Stage {stage}: {STAGE_LABELS[stage]}
              </Badge>
              <Button size="sm" variant="outline" onClick={() => advanceStage(-1)} disabled={stage <= 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="sm" onClick={() => advanceStage(1)} disabled={stage >= 8}>
                Advance
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: Contact + brief snapshot + actions */}
        <div className="space-y-4">
          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3">Contact</h3>
            <div className="space-y-2 text-sm">
              <div className="text-white font-medium">{lead.contact_name}</div>
              <div className="flex items-center gap-2 text-white/70">
                <Mail className="h-3.5 w-3.5" />
                <a href={`mailto:${lead.contact_email}`} className="hover:underline">
                  {lead.contact_email}
                </a>
              </div>
              {lead.contact_phone && (
                <div className="flex items-center gap-2 text-white/70">
                  <Phone className="h-3.5 w-3.5" />
                  <a href={`tel:${lead.contact_phone}`} className="hover:underline">
                    {lead.contact_phone}
                  </a>
                </div>
              )}
              {lead.company_website && (
                <div className="flex items-center gap-2 text-white/70">
                  <ExternalLink className="h-3.5 w-3.5" />
                  <a
                    href={lead.company_website.startsWith("http") ? lead.company_website : `https://${lead.company_website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline truncate"
                  >
                    {lead.company_website}
                  </a>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3">Lead context</h3>
            <dl className="space-y-1.5 text-sm">
              {lead.primary_pain && (
                <div className="flex justify-between">
                  <dt className="text-white/50">Primary pain</dt>
                  <dd className="text-white/90 capitalize">{lead.primary_pain.replace("-", " ")}</dd>
                </div>
              )}
              {lead.urgency && (
                <div className="flex justify-between">
                  <dt className="text-white/50">Urgency</dt>
                  <dd className="text-white/90">{lead.urgency}</dd>
                </div>
              )}
              {lead.primary_pain_detail && (
                <div className="pt-2 mt-2 border-t border-white/[0.06]">
                  <dt className="text-white/50 text-xs mb-1">Note</dt>
                  <dd className="text-white/80 text-sm leading-relaxed">{lead.primary_pain_detail}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs uppercase tracking-wider text-white/40">Quick actions</h3>
            </div>
            <div className="space-y-2">
              <Button onClick={copyBriefLink} variant="outline" size="sm" className="w-full justify-start gap-2" disabled={!brief}>
                <Copy className="h-3.5 w-3.5" />
                Copy brief link
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full justify-start gap-2" disabled={!brief}>
                <a
                  href={brief ? `mailto:${lead.contact_email}?subject=${encodeURIComponent(`Pre-call brief — ${lead.company_name}`)}&body=${encodeURIComponent(`Hi ${lead.contact_name.split(" ")[0]},\n\nBefore our discovery call, would you mind filling out this 5-minute brief? Saves us real time on the call.\n\n${window.location.origin}/brief/${brief.access_token}\n\nThanks!\nJared`)}` : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Send className="h-3.5 w-3.5" />
                  Email brief link
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full justify-start gap-2">
                <Link to={`/admin/cloud/${lead.id}/brief-pdf`}>
                  <FileText className="h-3.5 w-3.5" />
                  Generate Discovery Brief PDF
                </Link>
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={generateIntakeLink}
              >
                <Wrench className="h-3.5 w-3.5" />
                {deal?.intake_token ? "Copy intake link" : "Generate intake link"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={generateShieldToken}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {deal?.shield_request_token
                  ? "Copy Shield request URL"
                  : "Generate Shield request URL"}
              </Button>

              <Dialog open={paymentDialog} onOpenChange={setPaymentDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                    <CreditCard className="h-3.5 w-3.5" />
                    Generate Stripe payment link
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Stripe payment link</DialogTitle>
                    <DialogDescription>
                      Creates a Stripe customer (if needed), product, price, and Payment Link for{" "}
                      <span className="text-foreground">{lead.company_name}</span>. The URL is
                      copied to your clipboard and opened.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>Amount (USD)</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                        <Input
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          type="number"
                          min={1}
                          step="0.01"
                          className="pl-8"
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Description (shown to customer)</Label>
                      <Input
                        value={paymentDescription}
                        onChange={(e) => setPaymentDescription(e.target.value)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={generatePaymentLink} disabled={generatingLink}>
                      {generatingLink ? "Creating…" : "Create payment link"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={signingDialog} onOpenChange={setSigningDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2">
                    <PenSquare className="h-3.5 w-3.5" />
                    Record SOW signing request
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Send signing request</DialogTitle>
                    <DialogDescription>
                      Customer signs in <strong>Libresign on cloud.bestly.tech</strong> — the
                      product they're buying. Choose what to send, or fall back to paste-flow if
                      you sent manually from the Libresign UI.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-white/40">
                      One-click via Libresign API
                    </Label>
                    <div className="grid grid-cols-3 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendViaLibresign("sow")}
                        disabled={sendingSign}
                      >
                        Send SOW
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendViaLibresign("nda")}
                        disabled={sendingSign}
                      >
                        Send NDA
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendViaLibresign("acceptance")}
                        disabled={sendingSign}
                      >
                        Send Acceptance
                      </Button>
                    </div>
                    <p className="text-[11px] text-white/40">
                      Requires Libresign installed + LIBRESIGN_BASE / LIBRESIGN_USER /
                      LIBRESIGN_APP_TOKEN / LIBRESIGN_TEMPLATES env vars set.
                    </p>
                  </div>

                  <div className="border-t border-white/[0.06] pt-3 mt-2 space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-white/40">
                      Or paste a request ID (fallback)
                    </Label>
                    <Input
                      value={signingRequestId}
                      onChange={(e) => setSigningRequestId(e.target.value)}
                      placeholder="e.g. 9bf3a08b-8c47-4c88-9c93-5af2bb2c4d74"
                      className="font-mono text-xs"
                    />
                  </div>
                  <DialogFooter>
                    <Button onClick={recordEnvelope} disabled={savingEnvelope}>
                      {savingEnvelope ? "Saving…" : "Record envelope"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </section>

          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3">Internal notes</h3>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              className="text-sm bg-black/30 border-white/[0.08]"
              placeholder="Anything we want to remember about this deal."
            />
            <Button onClick={saveNotes} disabled={savingNotes} size="sm" className="mt-2 w-full">
              {savingNotes ? "Saving…" : "Save notes"}
            </Button>
          </section>
        </div>

        {/* RIGHT: Brief data + Timeline */}
        <div className="lg:col-span-2 space-y-4">
          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs uppercase tracking-wider text-white/40">Pre-call brief</h3>
              {brief?.submitted_at ? (
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Submitted {fmtAge(brief.submitted_at)}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500/30 text-amber-300 bg-amber-500/[0.08]">
                  <Clock className="h-3 w-3 mr-1" />
                  Awaiting
                </Badge>
              )}
            </div>
            {!brief ? (
              <p className="text-sm text-white/50">No brief shell yet (data anomaly).</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-white/50 text-xs mb-1">Current stack ({brief.current_apps.length})</dt>
                  <dd className="flex flex-wrap gap-1">
                    {brief.current_apps.length === 0 ? (
                      <span className="text-white/30">—</span>
                    ) : (
                      brief.current_apps.map((a) => (
                        <Badge key={a} variant="outline" className="border-white/10 bg-white/[0.04] text-white/80 text-[11px]">
                          {APP_LABEL[a] ?? a}
                        </Badge>
                      ))
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/50 text-xs mb-1">Annual SaaS spend</dt>
                  <dd className="text-white/90">{brief.annual_saas_spend_band ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/50 text-xs mb-1">Compliance</dt>
                  <dd className="flex flex-wrap gap-1">
                    {brief.compliance_frameworks.length === 0 ? (
                      <span className="text-white/30">—</span>
                    ) : (
                      brief.compliance_frameworks.map((c) => (
                        <Badge key={c} variant="outline" className="border-white/10 bg-white/[0.04] text-white/80 text-[11px] uppercase">
                          {c}
                        </Badge>
                      ))
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/50 text-xs mb-1">Office</dt>
                  <dd className="text-white/90">
                    {[brief.office_city, brief.office_state, brief.office_country].filter(Boolean).join(", ") || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/50 text-xs mb-1">Static IP</dt>
                  <dd className="text-white/90">{brief.has_static_ip ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/50 text-xs mb-1">IT lead</dt>
                  <dd className="text-white/90">{brief.has_it_lead ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/50 text-xs mb-1">Owns domain</dt>
                  <dd className="text-white/90">{brief.domain_owned ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/50 text-xs mb-1">Preferred subdomain</dt>
                  <dd className="text-white/90 truncate">{brief.preferred_subdomain ?? "—"}</dd>
                </div>
                {brief.biggest_unknown && (
                  <div className="md:col-span-2 pt-3 border-t border-white/[0.06]">
                    <dt className="text-white/50 text-xs mb-1">Biggest unknown</dt>
                    <dd className="text-white/85 text-sm leading-relaxed">{brief.biggest_unknown}</dd>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <h3 className="text-xs uppercase tracking-wider text-white/40">
                Shield allowlist requests
                {shieldRequests.filter((r) => r.status === "pending").length > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center rounded-full bg-amber-500/20 text-amber-300 text-[10px] px-2 py-0.5">
                    {shieldRequests.filter((r) => r.status === "pending").length} pending
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-1 text-[11px]">
                <button
                  onClick={() => setShieldFilter("pending")}
                  className={`px-2 py-1 rounded ${
                    shieldFilter === "pending"
                      ? "bg-white/[0.08] text-white/90"
                      : "text-white/40 hover:text-white/70"
                  }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setShieldFilter("all")}
                  className={`px-2 py-1 rounded ${
                    shieldFilter === "all"
                      ? "bg-white/[0.08] text-white/90"
                      : "text-white/40 hover:text-white/70"
                  }`}
                >
                  All
                </button>
              </div>
            </div>
            {shieldRequests.length === 0 ? (
              <p className="text-sm text-white/40">
                No requests yet. Generate the Shield request URL above and add it to the pi-hole block page footer.
              </p>
            ) : (
              <ul className="space-y-2">
                {(shieldFilter === "pending"
                  ? shieldRequests.filter((r) => r.status === "pending")
                  : shieldRequests
                ).map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                  >
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-mono text-white/90 truncate">
                          {r.requested_url}
                        </div>
                        <div className="text-xs text-white/50 mt-0.5">
                          {fmtAge(r.created_at)}
                          {r.requester_name ? ` · ${r.requester_name}` : ""}
                          {r.requester_email ? ` <${r.requester_email}>` : ""}
                        </div>
                      </div>
                      {r.status === "pending" ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-emerald-400 hover:bg-emerald-500/10"
                            onClick={() => reviewShieldRequest(r.id, "approved")}
                            title="Approve"
                          >
                            <CheckIcon className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-red-400 hover:bg-red-500/10"
                            onClick={() => reviewShieldRequest(r.id, "rejected")}
                            title="Reject"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Badge
                          variant="outline"
                          className={
                            r.status === "approved"
                              ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]"
                              : r.status === "rejected"
                              ? "border-red-500/30 text-red-300 bg-red-500/[0.08]"
                              : "border-white/10 text-white/60 bg-white/[0.04]"
                          }
                        >
                          {r.status}
                        </Badge>
                      )}
                    </div>
                    {r.reason && (
                      <p className="text-xs text-white/70 mt-1 leading-relaxed">{r.reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <IntakeReviewSection deal={deal} />

          <ProvisioningChecklist
            deal={deal}
            stage={stage}
            onUpdate={(next) => setDeal((p) => (p ? { ...p, ...next } as Deal : p))}
          />

          <InstallTracker
            deal={deal}
            stage={stage}
            onUpdate={(next) => setDeal((p) => (p ? { ...p, ...next } as Deal : p))}
          />

          <LiveOpsPanel
            deal={deal}
            stage={stage}
            onUpdate={(next) => setDeal((p) => (p ? { ...p, ...next } as Deal : p))}
          />

          <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3">Timeline</h3>
            {events.length === 0 ? (
              <p className="text-sm text-white/40">No events yet.</p>
            ) : (
              <ol className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/40 mt-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white/85">
                        {e.event_type.replace(/_/g, " ")}
                        {e.event_payload?.from != null && e.event_payload?.to != null && (
                          <span className="text-white/50 ml-2">
                            · {STAGE_LABELS[e.event_payload.from] ?? e.event_payload.from} → {STAGE_LABELS[e.event_payload.to] ?? e.event_payload.to}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-white/40 mt-0.5">
                        {fmtAbs(e.created_at)}
                        {e.triggered_by ? ` · ${e.triggered_by}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// IntakeReviewSection — collapsible per-stage view of the
// technical-intake data the customer submitted at /intake/:token.
// ─────────────────────────────────────────────────────

const STAGE_META: { key: string; label: string }[] = [
  { key: "network",   label: "Network" },
  { key: "branding",  label: "Branding" },
  { key: "users",     label: "Users" },
  { key: "migration", label: "Migration" },
  { key: "policy",    label: "Policy" },
];

const APP_LABEL_FULL: Record<string, string> = {
  drive: "Drive",
  "video-chat": "Video & Chat",
  mail: "Mail",
  docs: "Docs",
  calendar: "Calendar",
  ai: "AI",
  shield: "DNS Shield",
  vpn: "VPN",
  backup: "Backup",
  projects: "Projects",
  forms: "Forms",
  passwords: "Passwords",
  sign: "E-sign",
};

const SOURCE_LABEL: Record<string, string> = {
  "google-workspace": "Google Workspace",
  "microsoft-365": "Microsoft 365",
  slack: "Slack",
  "teams-chat": "Teams chat",
  dropbox: "Dropbox",
  box: "Box",
  asana: "Asana",
  trello: "Trello",
  monday: "Monday",
  linear: "Linear",
  "1password": "1Password",
  lastpass: "LastPass",
  docusign: "DocuSign",
};

function IntakeReviewSection({ deal }: { deal: Deal | null }) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    network: true,
    branding: false,
    users: false,
    migration: false,
    policy: false,
  });

  if (!deal) return null;
  const data = deal.intake_data || {};
  const submitted = !!deal.intake_submitted_at;
  const hasAnyContent = STAGE_META.some((s) => {
    const v = data[s.key];
    return v && Object.keys(v).length > 0;
  });

  if (!hasAnyContent && !deal.intake_token) return null;

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-white/40">Technical intake</h3>
        {submitted ? (
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Submitted {fmtAge(deal.intake_submitted_at!)}
          </Badge>
        ) : hasAnyContent ? (
          <Badge variant="outline" className="border-amber-500/30 text-amber-300 bg-amber-500/[0.08]">
            <Clock className="h-3 w-3 mr-1" />
            In progress
          </Badge>
        ) : (
          <Badge variant="outline" className="border-white/20 text-white/50 bg-white/[0.04]">
            Not started
          </Badge>
        )}
      </div>

      {!hasAnyContent ? (
        <p className="text-sm text-white/50">
          Intake link generated but no fields filled yet. Resend the link if it's been &gt;7 days.
        </p>
      ) : (
        <div className="space-y-2">
          {STAGE_META.map((s) => {
            const v = (data[s.key] as Record<string, any>) || null;
            const filled = v && Object.values(v).some((x) =>
              Array.isArray(x) ? x.length > 0 : x != null && String(x).length > 0
            );
            return (
              <details
                key={s.key}
                open={open[s.key]}
                onToggle={(e) =>
                  setOpen((p) => ({ ...p, [s.key]: (e.currentTarget as HTMLDetailsElement).open }))
                }
                className="rounded-lg border border-white/[0.06] bg-white/[0.02]"
              >
                <summary className="cursor-pointer flex items-center justify-between px-3 py-2 list-none">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white/85">{s.label}</span>
                    {filled ? (
                      <CheckIcon className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <span className="text-[11px] text-white/40">empty</span>
                    )}
                  </span>
                  <span className="text-[11px] text-white/30 group-open:hidden">
                    {open[s.key] ? "−" : "+"}
                  </span>
                </summary>
                <div className="px-3 pb-3 pt-1 text-sm">
                  {s.key === "network" && <NetworkSummary data={v} />}
                  {s.key === "branding" && <BrandingSummary data={v} />}
                  {s.key === "users" && <UsersSummary data={v} />}
                  {s.key === "migration" && <MigrationSummary data={v} />}
                  {s.key === "policy" && <PolicySummary data={v} />}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline gap-3 py-1">
      <dt className="text-xs text-white/40 min-w-[110px] shrink-0">{label}</dt>
      <dd className="text-sm text-white/85 break-words">{String(value)}</dd>
    </div>
  );
}

function NetworkSummary({ data }: { data: any }) {
  if (!data) return <p className="text-sm text-white/40">Empty.</p>;
  const ship = [data.shipping_address, data.shipping_city, data.shipping_state, data.shipping_zip].filter(Boolean).join(", ");
  return (
    <dl>
      <Field label="Shipping" value={ship} />
      <Field label="Box lives" value={data.box_location} />
      <Field label="ISP" value={data.isp_name} />
      <Field label="Static IP" value={data.has_static_ip} />
      {data.static_ip_value && <Field label="IP" value={data.static_ip_value} />}
      <Field label="Down/Up Mbps" value={data.bandwidth_down_mbps && `${data.bandwidth_down_mbps} / ${data.bandwidth_up_mbps || "?"}`} />
      <Field label="Router" value={data.router_make_model} />
      <Field label="VLANs" value={data.vlans_in_use} />
      <Field label="IT lead" value={[data.it_lead_name, data.it_lead_email, data.it_lead_phone].filter(Boolean).join(" · ")} />
      <Field label="Notes" value={data.network_notes} />
    </dl>
  );
}

function BrandingSummary({ data }: { data: any }) {
  if (!data) return <p className="text-sm text-white/40">Empty.</p>;
  return (
    <div className="space-y-3">
      <dl>
        <Field label="Subdomain" value={data.subdomain} />
        <Field label="System mail" value={data.system_mail} />
      </dl>
      <div className="flex flex-wrap gap-3 items-center">
        {data.primary_color && (
          <div className="flex items-center gap-1.5 text-xs text-white/70">
            <span className="inline-block w-4 h-4 rounded border border-white/20" style={{ background: data.primary_color }} />
            <span className="font-mono">{data.primary_color}</span>
            <span className="text-white/40">primary</span>
          </div>
        )}
        {data.accent_color && (
          <div className="flex items-center gap-1.5 text-xs text-white/70">
            <span className="inline-block w-4 h-4 rounded border border-white/20" style={{ background: data.accent_color }} />
            <span className="font-mono">{data.accent_color}</span>
            <span className="text-white/40">accent</span>
          </div>
        )}
      </div>
      {(data.logo_url || data.icon_url) && (
        <div className="flex flex-wrap gap-3 pt-2 border-t border-white/[0.06]">
          {data.logo_url && (
            <a href={data.logo_url} target="_blank" rel="noopener noreferrer" className="block">
              <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Logo</div>
              <img src={data.logo_url} alt="logo" className="h-12 max-w-[160px] object-contain rounded border border-white/[0.06] bg-neutral-900 p-1" />
            </a>
          )}
          {data.icon_url && (
            <a href={data.icon_url} target="_blank" rel="noopener noreferrer" className="block">
              <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Icon</div>
              <img src={data.icon_url} alt="icon" className="h-12 w-12 object-contain rounded border border-white/[0.06] bg-white p-1" />
            </a>
          )}
        </div>
      )}
      {data.branding_notes && (
        <p className="text-sm text-white/70 italic pt-2 border-t border-white/[0.06]">{data.branding_notes}</p>
      )}
    </div>
  );
}

function UsersSummary({ data }: { data: any }) {
  const list: any[] = data?.list || [];
  if (list.length === 0) return <p className="text-sm text-white/40">No users yet.</p>;
  const adminCount = list.filter((u) => u.role === "admin").length;
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2 text-xs">
        <span className="rounded-md bg-white/5 px-2 py-0.5 text-white/70">
          Total: <span className="text-white">{list.length}</span>
        </span>
        <span className="rounded-md bg-white/5 px-2 py-0.5 text-white/70">
          Admins: <span className="text-white">{adminCount}</span>
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-white/[0.06]">
        <table className="w-full text-xs">
          <thead className="bg-white/[0.04] text-white/50">
            <tr>
              <th className="text-left px-2 py-1 font-medium">Name</th>
              <th className="text-left px-2 py-1 font-medium">Email</th>
              <th className="text-left px-2 py-1 font-medium">Role</th>
              <th className="text-left px-2 py-1 font-medium">Group</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 50).map((u, i) => (
              <tr key={i} className="border-t border-white/[0.04]">
                <td className="px-2 py-1 text-white/90">{u.name}</td>
                <td className="px-2 py-1 text-white/70 font-mono">{u.email}</td>
                <td className="px-2 py-1 text-white/70 capitalize">{u.role}</td>
                <td className="px-2 py-1 text-white/70">{u.group}</td>
              </tr>
            ))}
            {list.length > 50 && (
              <tr>
                <td colSpan={4} className="px-2 py-1 text-center text-white/40 text-[11px]">
                  + {list.length - 50} more
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MigrationSummary({ data }: { data: any }) {
  if (!data) return <p className="text-sm text-white/40">Empty.</p>;
  const sources: string[] = data.selected_sources || [];
  const per = data.per_source || {};
  if (sources.length === 0)
    return (
      <p className="text-sm text-white/40">No migration sources selected yet.</p>
    );
  return (
    <div className="space-y-2">
      <dl>
        <Field label="Fallback (days)" value={data.fallback_window_days} />
        <Field label="Freeze old systems" value={data.freeze_writes_at_cutover} />
      </dl>
      <div className="space-y-1.5">
        {sources.map((s) => {
          const ps = per[s] || {};
          return (
            <div key={s} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/85">{SOURCE_LABEL[s] ?? s}</span>
                <span className="text-[11px] text-white/40">{ps.scope || "scope?"}</span>
              </div>
              {(ps.data_volume_gb_per_user || ps.decommission_after_days) && (
                <div className="text-[11px] text-white/50 mt-0.5">
                  {ps.data_volume_gb_per_user && `${ps.data_volume_gb_per_user} GB/user`}
                  {ps.data_volume_gb_per_user && ps.decommission_after_days && " · "}
                  {ps.decommission_after_days && `decommission +${ps.decommission_after_days}d`}
                </div>
              )}
              {ps.source_notes && (
                <p className="text-xs text-white/60 mt-1 italic">{ps.source_notes}</p>
              )}
            </div>
          );
        })}
      </div>
      {data.migration_notes && (
        <p className="text-sm text-white/70 italic pt-2 border-t border-white/[0.06]">{data.migration_notes}</p>
      )}
    </div>
  );
}

function PolicySummary({ data }: { data: any }) {
  if (!data) return <p className="text-sm text-white/40">Empty.</p>;
  const cats: string[] = data.dns_filter_categories || [];
  return (
    <div>
      <dl>
        <Field label="2FA" value={data.twofa_enforcement} />
        <Field label="VPN scope" value={data.vpn_scope} />
        <Field label="Backup" value={data.backup_destination} />
        {data.backblaze_bucket_name && <Field label="B2 bucket" value={data.backblaze_bucket_name} />}
        <Field label="Retention" value={data.retention_months && (data.retention_months === "indefinite" ? "indefinite" : `${data.retention_months} months`)} />
      </dl>
      {cats.length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-white/40 mb-1">DNS filter</div>
          <div className="flex flex-wrap gap-1">
            {cats.map((c) => (
              <Badge key={c} variant="outline" className="border-white/10 bg-white/[0.04] text-white/80 text-[11px]">
                {c}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {data.policy_notes && (
        <p className="text-sm text-white/70 italic pt-2 mt-2 border-t border-white/[0.06]">{data.policy_notes}</p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// ProvisioningChecklist — Stage 6 operator workflow.
// Tracks build steps from "deal hits Stage 6" through
// "ready to ship". State lives in cloud_deals.provisioning_data.
// ─────────────────────────────────────────────────────

const PROVISIONING_STEPS: { key: string; label: string; description: string }[] = [
  { key: "hardware-procured",  label: "Hardware procured",  description: "Cloud Box ordered or pulled from inventory." },
  { key: "os-imaged",           label: "OS imaged",           description: "Base OS (Debian/Proxmox) installed and patched." },
  { key: "services-configured", label: "Services configured", description: "Nextcloud, Talk, Mail, AI, DNS, VPN containers up + tuned." },
  { key: "branding-applied",    label: "Branding applied",    description: "Logo, colors, subdomain, system mail wired to client's intake." },
  { key: "users-created",       label: "Users created",       description: "Roster from Stage 5c imported, admin roles assigned." },
  { key: "migration-queued",    label: "Migration queued",    description: "Source-system pulls scheduled per Stage 5d scope." },
  { key: "test-deploy-passed",  label: "Test deploy passed",  description: "Internal smoke (login, file upload, video call, mail send) green." },
  { key: "certs-issued",        label: "Certs issued",        description: "TLS cert chain valid for client's subdomain + system mail." },
];

type StepState = {
  done?: boolean;
  completed_at?: string;
  completed_by?: string;
  notes?: string;
};

function ProvisioningChecklist({
  deal,
  stage,
  onUpdate,
}: {
  deal: Deal | null;
  stage: number;
  onUpdate: (next: Partial<Deal>) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (!deal || stage < 5) return null;

  const data: Record<string, StepState> = deal.provisioning_data || {};
  const doneCount = PROVISIONING_STEPS.filter((s) => data[s.key]?.done).length;
  const allDone = doneCount === PROVISIONING_STEPS.length;
  const pct = Math.round((doneCount / PROVISIONING_STEPS.length) * 100);

  async function setStep(key: string, patch: StepState) {
    if (!deal) return;
    setBusy(key);
    const next: Record<string, StepState> = { ...(deal.provisioning_data || {}) };
    next[key] = { ...next[key], ...patch };
    if (patch.done && !next[key].completed_at) {
      next[key].completed_at = new Date().toISOString();
      next[key].completed_by = "operator";
    }
    if (patch.done === false) {
      delete next[key].completed_at;
      delete next[key].completed_by;
    }
    const { error } = await supabase
      .from("cloud_deals")
      .update({ provisioning_data: next })
      .eq("id", deal.id);
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    onUpdate({ provisioning_data: next });
  }

  async function shipIt() {
    if (!deal) return;
    setBusy("__ship");
    const { error } = await supabase
      .from("cloud_deals")
      .update({ current_stage: 7 })
      .eq("id", deal.id);
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't advance", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Advanced to Stage 7: Install" });
    onUpdate({ current_stage: 7, stage_changed_at: new Date().toISOString() });
  }

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-white/40">Provisioning</h3>
        <Badge
          variant="outline"
          className={
            allDone
              ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]"
              : doneCount > 0
              ? "border-amber-500/30 text-amber-300 bg-amber-500/[0.08]"
              : "border-white/20 text-white/50 bg-white/[0.04]"
          }
        >
          {doneCount}/{PROVISIONING_STEPS.length} · {pct}%
        </Badge>
      </div>

      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden mb-4">
        <div
          className={`h-full transition-all duration-300 ${allDone ? "bg-emerald-500" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {PROVISIONING_STEPS.map((s) => {
          const st = data[s.key] || {};
          const checked = !!st.done;
          const busyHere = busy === s.key;
          return (
            <li
              key={s.key}
              className={`rounded-lg border px-3 py-2 ${
                checked
                  ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                  : "border-white/[0.06] bg-white/[0.02]"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <button
                  onClick={() => setStep(s.key, { done: !checked })}
                  disabled={busyHere}
                  className={`mt-0.5 w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                    checked ? "border-emerald-500 bg-emerald-500" : "border-white/30 hover:border-white/60"
                  }`}
                  aria-label={checked ? `Uncheck ${s.label}` : `Check ${s.label}`}
                >
                  {checked && <CheckIcon className="h-3 w-3 text-white" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className={`text-sm font-medium ${checked ? "text-white/70 line-through" : "text-white/90"}`}>
                      {s.label}
                    </div>
                    {st.completed_at && (
                      <span className="text-[11px] text-white/40 shrink-0">{fmtAge(st.completed_at)}</span>
                    )}
                  </div>
                  <div className="text-xs text-white/50 leading-relaxed">{s.description}</div>
                  {st.notes && (
                    <div className="text-xs text-white/60 italic mt-1 pl-2 border-l border-white/[0.06]">{st.notes}</div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {allDone && stage < 7 && (
        <div className="mt-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] flex items-center justify-between gap-3">
          <div className="text-sm text-emerald-200">
            All steps complete. Ready to ship hardware and schedule install.
          </div>
          <Button
            onClick={shipIt}
            disabled={busy === "__ship"}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shrink-0"
          >
            {busy === "__ship" ? "Working…" : "Ship it →"}
          </Button>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────
// InstallTracker — Stage 7 operator workflow.
// Three sections: Shipping, Install scheduling, Acceptance.
// State lives in cloud_deals.install_data.
// When acceptance.signed_at is set, exposes a "Mark live"
// button that advances to Stage 8.
// ─────────────────────────────────────────────────────

const CARRIERS: { value: string; label: string }[] = [
  { value: "ups", label: "UPS" },
  { value: "fedex", label: "FedEx" },
  { value: "usps", label: "USPS" },
  { value: "hand-deliver", label: "Hand-deliver (no carrier)" },
];

const INSTALL_MODES: { value: string; label: string }[] = [
  { value: "remote", label: "Remote (we drive it via screen-share)" },
  { value: "on-site", label: "On-site (Bestly travels)" },
  { value: "self-install", label: "Self-install (IT lead handles, we standby)" },
];

type ShippingState = {
  carrier?: string;
  tracking_number?: string;
  ship_date?: string;
  eta?: string;
};
type InstallScheduleState = {
  scheduled_at?: string;
  mode?: string;
  notes?: string;
};
type AcceptanceState = {
  envelope_id?: string;
  signed_at?: string;
};

function InstallTracker({
  deal,
  stage,
  onUpdate,
}: {
  deal: Deal | null;
  stage: number;
  onUpdate: (next: Partial<Deal>) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (!deal || stage < 6) return null;

  const data = (deal.install_data || {}) as {
    shipping?: ShippingState;
    install?: InstallScheduleState;
    acceptance?: AcceptanceState;
  };
  const shipping = data.shipping || {};
  const install = data.install || {};
  const acceptance = data.acceptance || {};

  const shipped = !!shipping.tracking_number || shipping.carrier === "hand-deliver";
  const scheduled = !!install.scheduled_at;
  const signed = !!acceptance.signed_at;

  async function patchSection<K extends "shipping" | "install" | "acceptance">(
    section: K,
    field: string,
    value: string
  ) {
    if (!deal) return;
    setBusy(`${section}.${field}`);
    const next = { ...(deal.install_data || {}) } as any;
    next[section] = { ...(next[section] || {}), [field]: value || undefined };
    if (section === "acceptance" && field === "envelope_id" && value && !acceptance.signed_at) {
      next.acceptance.signed_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from("cloud_deals")
      .update({ install_data: next })
      .eq("id", deal.id);
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    onUpdate({ install_data: next });
  }

  async function markLive() {
    if (!deal) return;
    setBusy("__live");
    const { error } = await supabase
      .from("cloud_deals")
      .update({ current_stage: 8, go_live_at: new Date().toISOString() })
      .eq("id", deal.id);
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't advance", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Live! Moved to Stage 8." });
    onUpdate({ current_stage: 8, stage_changed_at: new Date().toISOString() });
  }

  const trackingUrl = (() => {
    if (!shipping.tracking_number) return null;
    const t = shipping.tracking_number.trim();
    switch (shipping.carrier) {
      case "ups": return `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}`;
      case "fedex": return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(t)}`;
      case "usps": return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${encodeURIComponent(t)}`;
      default: return null;
    }
  })();

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-white/40">Install</h3>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className={shipped ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]" : "border-white/20 text-white/50 bg-white/[0.04]"}>
            {shipped ? "Shipped" : "Not shipped"}
          </Badge>
          <Badge variant="outline" className={scheduled ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]" : "border-white/20 text-white/50 bg-white/[0.04]"}>
            {scheduled ? "Scheduled" : "Not scheduled"}
          </Badge>
          <Badge variant="outline" className={signed ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]" : "border-white/20 text-white/50 bg-white/[0.04]"}>
            {signed ? "Accepted" : "Not accepted"}
          </Badge>
        </div>
      </div>

      {/* Shipping */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 mb-3">
        <div className="text-xs uppercase tracking-wider text-white/50 mb-2.5">Shipping</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-white/50">Carrier</Label>
            <Select value={shipping.carrier ?? ""} onValueChange={(v) => patchSection("shipping", "carrier", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Pick" />
              </SelectTrigger>
              <SelectContent>
                {CARRIERS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-white/50">Tracking number</Label>
            <div className="flex gap-1.5">
              <Input
                value={shipping.tracking_number ?? ""}
                onChange={(e) => patchSection("shipping", "tracking_number", e.target.value)}
                placeholder="1Z..."
                className="font-mono text-sm"
              />
              {trackingUrl && (
                <Button asChild variant="outline" size="sm">
                  <a href={trackingUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
            </div>
          </div>
          <div>
            <Label className="text-xs text-white/50">Ship date</Label>
            <Input
              type="date"
              value={shipping.ship_date ?? ""}
              onChange={(e) => patchSection("shipping", "ship_date", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs text-white/50">Expected delivery</Label>
            <Input
              type="date"
              value={shipping.eta ?? ""}
              onChange={(e) => patchSection("shipping", "eta", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Install scheduling */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 mb-3">
        <div className="text-xs uppercase tracking-wider text-white/50 mb-2.5">Install</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-white/50">Scheduled at</Label>
            <Input
              type="datetime-local"
              value={install.scheduled_at ? install.scheduled_at.slice(0, 16) : ""}
              onChange={(e) => {
                const v = e.target.value;
                patchSection("install", "scheduled_at", v ? new Date(v).toISOString() : "");
              }}
            />
          </div>
          <div>
            <Label className="text-xs text-white/50">Mode</Label>
            <Select value={install.mode ?? ""} onValueChange={(v) => patchSection("install", "mode", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Pick" />
              </SelectTrigger>
              <SelectContent>
                {INSTALL_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs text-white/50">Install notes</Label>
            <Textarea
              value={install.notes ?? ""}
              onChange={(e) => patchSection("install", "notes", e.target.value)}
              rows={2}
              placeholder="Optional. Building access, parking, key contacts on-site, etc."
            />
          </div>
        </div>
      </div>

      {/* Acceptance */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-xs uppercase tracking-wider text-white/50">Acceptance</div>
          {signed && (
            <span className="text-[11px] text-emerald-400">
              Signed {fmtAge(acceptance.signed_at!)}
            </span>
          )}
        </div>
        <div>
          <Label className="text-xs text-white/50">Libresign acceptance request ID</Label>
          <Input
            value={acceptance.envelope_id ?? ""}
            onChange={(e) => patchSection("acceptance", "envelope_id", e.target.value)}
            placeholder="Paste after the customer signs the acceptance"
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-white/40 mt-1.5">
            Send the acceptance envelope from <strong>Libresign</strong> on cloud.bestly.tech →
            paste the request ID here. Setting this stamps signed_at and unlocks Stage 8.
          </p>
        </div>
      </div>

      {signed && stage < 8 && (
        <div className="mt-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] flex items-center justify-between gap-3">
          <div className="text-sm text-emerald-200">
            Acceptance signed. Ready to mark live.
          </div>
          <Button
            onClick={markLive}
            disabled={busy === "__live"}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shrink-0"
          >
            {busy === "__live" ? "Working…" : "Mark live →"}
          </Button>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────
// LiveOpsPanel — Stage 8 post-live operations.
// 30-day check-in, quarterly reports, renewal milestones,
// churn risk + health notes. Lives in cloud_deals.live_data.
// ─────────────────────────────────────────────────────

const RISK_OPTS: { value: string; label: string; klass: string }[] = [
  { value: "low",    label: "Low",    klass: "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]" },
  { value: "medium", label: "Medium", klass: "border-amber-500/30 text-amber-300 bg-amber-500/[0.08]" },
  { value: "high",   label: "High",   klass: "border-red-500/30 text-red-300 bg-red-500/[0.08]" },
];

function daysFromNow(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
}

function fmtCountdown(days: number | null): string {
  if (days == null) return "—";
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d ago`;
}

function LiveOpsPanel({
  deal,
  stage,
  onUpdate,
}: {
  deal: Deal | null;
  stage: number;
  onUpdate: (next: Partial<Deal>) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (!deal || stage < 8) return null;

  const goLive = deal.go_live_at;
  const data = (deal.live_data || {}) as {
    thirty_day_checkin?: { done?: boolean; at?: string };
    quarterlies?: { last_at?: string };
    renewals?: { y1_done?: boolean; y2_done?: boolean; y3_done?: boolean };
    churn_risk?: string;
    health_notes?: string;
  };

  // Compute milestone targets from go_live_at
  const checkinTarget = goLive ? new Date(new Date(goLive).getTime() + 30 * 86400000).toISOString() : null;
  const checkinDone = !!data.thirty_day_checkin?.done;
  const checkinDays = daysFromNow(checkinTarget);

  const lastQuarterly = data.quarterlies?.last_at;
  const nextQuarterlyTarget = (() => {
    const base = lastQuarterly || goLive;
    if (!base) return null;
    return new Date(new Date(base).getTime() + 90 * 86400000).toISOString();
  })();
  const nextQuarterlyDays = daysFromNow(nextQuarterlyTarget);

  const renewals = data.renewals || {};
  const y1 = goLive ? new Date(new Date(goLive).getTime() + 365 * 86400000).toISOString() : null;
  const y2 = goLive ? new Date(new Date(goLive).getTime() + 365 * 2 * 86400000).toISOString() : null;
  const y3 = goLive ? new Date(new Date(goLive).getTime() + 365 * 3 * 86400000).toISOString() : null;

  async function patch(path: string[], value: any) {
    if (!deal) return;
    const key = path.join(".");
    setBusy(key);
    const next = { ...(deal.live_data || {}) } as any;
    let cursor = next;
    for (let i = 0; i < path.length - 1; i++) {
      cursor[path[i]] = { ...(cursor[path[i]] || {}) };
      cursor = cursor[path[i]];
    }
    cursor[path[path.length - 1]] = value;
    const { error } = await supabase
      .from("cloud_deals")
      .update({ live_data: next })
      .eq("id", deal.id);
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    onUpdate({ live_data: next });
  }

  function MilestoneRow({
    label,
    target,
    done,
    onToggle,
    busyKey,
  }: {
    label: string;
    target: string | null;
    done: boolean;
    onToggle: () => void;
    busyKey: string;
  }) {
    const days = daysFromNow(target);
    const overdue = !done && days != null && days < 0;
    const upcoming = !done && days != null && days >= 0 && days <= 7;
    return (
      <div
        className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
          done
            ? "border-emerald-500/20 bg-emerald-500/[0.03]"
            : overdue
            ? "border-red-500/30 bg-red-500/[0.05]"
            : upcoming
            ? "border-amber-500/30 bg-amber-500/[0.05]"
            : "border-white/[0.06] bg-white/[0.02]"
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onToggle}
            disabled={busy === busyKey}
            className={`w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
              done ? "border-emerald-500 bg-emerald-500" : "border-white/30 hover:border-white/60"
            }`}
            aria-label={done ? `Uncheck ${label}` : `Check ${label}`}
          >
            {done && <CheckIcon className="h-3 w-3 text-white" />}
          </button>
          <span className={`text-sm ${done ? "text-white/60 line-through" : "text-white/90"}`}>{label}</span>
        </div>
        <span className={`text-xs ${overdue ? "text-red-300" : upcoming ? "text-amber-300" : "text-white/40"}`}>
          {target ? new Date(target).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—"}
          {target && !done && ` · ${fmtCountdown(days)}`}
        </span>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs uppercase tracking-wider text-white/40">Live operations</h3>
        {goLive && (
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]">
            Live since {new Date(goLive).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
          </Badge>
        )}
      </div>

      {!goLive && (
        <p className="text-sm text-white/50 mb-3">
          go_live_at not set on this deal. Mark live from the Install panel to populate milestone dates.
        </p>
      )}

      {/* Milestones */}
      <div className="space-y-1.5 mb-4">
        <MilestoneRow
          label="30-day check-in"
          target={checkinTarget}
          done={checkinDone}
          busyKey="thirty_day_checkin.done"
          onToggle={() => {
            patch(
              ["thirty_day_checkin"],
              checkinDone ? {} : { done: true, at: new Date().toISOString() }
            );
          }}
        />
        <MilestoneRow
          label={
            lastQuarterly
              ? `Next quarterly report (last sent ${fmtAge(lastQuarterly)})`
              : "First quarterly report"
          }
          target={nextQuarterlyTarget}
          done={false}
          busyKey="quarterlies.last_at"
          onToggle={() => {
            patch(["quarterlies", "last_at"], new Date().toISOString());
            toast({ title: "Quarterly logged" });
          }}
        />
        <MilestoneRow
          label="Year 1 renewal"
          target={y1}
          done={!!renewals.y1_done}
          busyKey="renewals.y1_done"
          onToggle={() => patch(["renewals", "y1_done"], !renewals.y1_done)}
        />
        <MilestoneRow
          label="Year 2 renewal"
          target={y2}
          done={!!renewals.y2_done}
          busyKey="renewals.y2_done"
          onToggle={() => patch(["renewals", "y2_done"], !renewals.y2_done)}
        />
        <MilestoneRow
          label="Year 3 renewal"
          target={y3}
          done={!!renewals.y3_done}
          busyKey="renewals.y3_done"
          onToggle={() => patch(["renewals", "y3_done"], !renewals.y3_done)}
        />
      </div>

      {/* Churn risk + notes */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-white/50 mb-2">Churn risk</div>
          <div className="flex flex-wrap gap-2">
            {RISK_OPTS.map((r) => {
              const active = data.churn_risk === r.value;
              return (
                <button
                  key={r.value}
                  onClick={() => patch(["churn_risk"], active ? undefined : r.value)}
                  disabled={busy === "churn_risk"}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                    active ? r.klass : "border-white/[0.08] text-white/50 bg-white/[0.02] hover:bg-white/[0.05]"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label className="text-xs text-white/50">Health notes</Label>
          <Textarea
            value={data.health_notes ?? ""}
            onChange={(e) => patch(["health_notes"], e.target.value)}
            rows={2}
            placeholder="Optional. Recent incidents, expansion talks, contract renegotiations, etc."
            className="bg-black/30 border-white/[0.08]"
          />
        </div>
      </div>
    </section>
  );
}

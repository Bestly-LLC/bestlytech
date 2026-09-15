import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { PageHeader } from "@/components/admin/PageHeader";
import { ActionMenu, type ActionItem } from "@/components/admin/ActionMenu";
import { DeleteLeadDialog } from "@/components/admin/DeleteLeadDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  CreditCard,
  PenSquare,
  DollarSign,
  Wrench,
  ShieldCheck,
  XCircle,
  Check as CheckIcon,
  Undo2,
  Loader2,
  CopyX,
  ClipboardPaste,
  RefreshCw,
  AlertTriangle,
  Truck,
  Rocket,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

/** The primary action on the page: the task that moves the deal out of its current stage. */
const NEXT_STAGE_ACTION: Record<number, { label: string; icon: typeof ChevronRight }> = {
  1: { label: "Mark brief sent", icon: Send },
  2: { label: "Start discovery", icon: ChevronRight },
  3: { label: "Move to SOW", icon: ChevronRight },
  4: { label: "Start tech intake", icon: ChevronRight },
  5: { label: "Start provisioning", icon: Wrench },
  6: { label: "Ship it", icon: Truck },
  7: { label: "Mark live", icon: Rocket },
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
  lead_id: string;
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
  sow_signed_at?: string | null;
  deposit_paid_at?: string | null;
};

/**
 * Writes a patch to cloud_deals and resolves true only if a row actually changed.
 * Saves run one at a time; pass a function to build the patch from the latest saved deal
 * so two quick edits to the same jsonb column don't overwrite each other.
 */
type SaveDeal = (
  patch: Record<string, any> | ((current: Deal) => Record<string, any>),
  opts?: { success?: string }
) => Promise<boolean>;

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

const SIGN_KIND_LABEL: Record<"sow" | "nda" | "acceptance", string> = {
  sow: "Statement of work (SOW)",
  nda: "NDA",
  acceptance: "Install acceptance",
};

const NO_ROWS_MESSAGE =
  "No rows were changed. Your account may not have permission, or the record was removed. Refresh and try again.";

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

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * supabase.functions.invoke hides the JSON body of non-2xx responses behind a generic
 * "Edge Function returned a non-2xx status code". Pull the real `{ error }` out.
 */
async function invokeAdminFunction(name: string, body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = await ctx.clone().json();
        if (j?.error) message = String(j.error);
      } catch {
        /* keep generic message */
      }
    }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error || "The server didn't confirm the action.");
  return data;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function briefMailto(lead: Lead, brief: Brief) {
  const first = lead.contact_name.split(" ")[0];
  const url = `${window.location.origin}/brief/${brief.access_token}`;
  return `mailto:${lead.contact_email}?subject=${encodeURIComponent(`Pre-call brief — ${lead.company_name}`)}&body=${encodeURIComponent(
    `Hi ${first},\n\nBefore our discovery call, would you mind filling out this 5-minute brief? Saves us real time on the call.\n\n${url}\n\nThanks!\nJared`
  )}`;
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4" aria-label={title}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-xs uppercase tracking-wider text-white/60">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function CloudDealDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [shieldRequests, setShieldRequests] = useState<ShieldRequest[]>([]);
  const [shieldFilter, setShieldFilter] = useState<"pending" | "all">("pending");
  const [shieldBusy, setShieldBusy] = useState<string | null>(null);

  const [notes, setNotes] = useState<string>("");
  const [savedNotes, setSavedNotes] = useState<string>("");
  const [savingNotes, setSavingNotes] = useState(false);

  const [advancing, setAdvancing] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<string>("5000");
  const [paymentDescription, setPaymentDescription] = useState<string>(
    "Bestly In-House Cloud — deployment deposit"
  );
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [generatingLink, setGeneratingLink] = useState(false);

  const [signOpen, setSignOpen] = useState(false);
  const [signKind, setSignKind] = useState<"sow" | "nda" | "acceptance">("sow");
  const [sendingSign, setSendingSign] = useState(false);

  const [recordOpen, setRecordOpen] = useState(false);
  const [signingRequestId, setSigningRequestId] = useState("");
  const [savingEnvelope, setSavingEnvelope] = useState(false);

  const loadEvents = useCallback(async (leadId: string) => {
    const { data } = await supabase
      .from("cloud_deal_events")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setEvents(data as Event[]);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadError(null);
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
    const err = lRes.error || bRes.error || dRes.error;
    if (err) {
      setLoadError(err.message);
      setLoading(false);
      return;
    }
    setLead(lRes.data as Lead | null);
    setBrief(bRes.data as Brief | null);
    setDeal(dRes.data as Deal | null);
    setEvents((eRes.data as Event[]) || []);
    const n = (lRes.data as Lead | null)?.notes || "";
    setNotes(n);
    setSavedNotes(n);

    if (dRes.data?.id) {
      const { data: sr } = await supabase
        .from("cloud_shield_requests")
        .select("*")
        .eq("deal_id", dRes.data.id)
        .order("created_at", { ascending: false })
        .limit(100);
      setShieldRequests((sr as ShieldRequest[]) || []);
    } else {
      setShieldRequests([]);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const stage = deal?.current_stage ?? (brief?.submitted_at ? 3 : 2);

  const dealRef = useRef<Deal | null>(null);
  useEffect(() => {
    dealRef.current = deal;
  }, [deal]);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  const saveDeal: SaveDeal = useCallback(
    (patchOrFn, opts) => {
      const run = async (): Promise<boolean> => {
        const current = dealRef.current;
        if (!current) return false;
        const patch = typeof patchOrFn === "function" ? patchOrFn(current) : patchOrFn;
        const { data, error } = await supabase
          .from("cloud_deals")
          .update(patch as any)
          .eq("id", current.id)
          .select("*")
          .maybeSingle();
        if (error) {
          toast({ title: "Couldn't save", description: `${error.message}. Nothing changed — try again.`, variant: "destructive" });
          return false;
        }
        if (!data) {
          toast({ title: "Couldn't save", description: NO_ROWS_MESSAGE, variant: "destructive" });
          return false;
        }
        dealRef.current = data as Deal;
        setDeal(data as Deal);
        if (opts?.success) toast({ title: opts.success });
        return true;
      };
      const result = saveQueue.current.then(run, run);
      saveQueue.current = result.catch(() => undefined);
      return result;
    },
    [toast]
  );

  // ── Stage gates ─────────────────────────────────────────
  const provisioningDone = PROVISIONING_STEPS.filter((s) => (deal?.provisioning_data as any)?.[s.key]?.done).length;
  const acceptanceSigned = !!(deal?.install_data as any)?.acceptance?.signed_at;
  const gateReason =
    stage === 6 && provisioningDone < PROVISIONING_STEPS.length
      ? `${PROVISIONING_STEPS.length - provisioningDone} provisioning step${PROVISIONING_STEPS.length - provisioningDone === 1 ? "" : "s"} left before shipping.`
      : stage === 7 && !acceptanceSigned
      ? "Waiting on the signed install acceptance."
      : null;

  async function moveToStage(target: number) {
    if (!lead || target < 1 || target > 8 || target === stage) return;
    setAdvancing(true);
    try {
      if (deal) {
        const patch: Record<string, any> = { current_stage: target };
        if (target === 8 && !deal.go_live_at) patch.go_live_at = new Date().toISOString();
        const ok = await saveDeal(patch, { success: `Moved to ${STAGE_LABELS[target]}` });
        if (ok) await loadEvents(lead.id);
        return;
      }
      // No deal row yet — create it at the target stage.
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
        .maybeSingle();
      if (error || !data) {
        toast({
          title: "Couldn't create the deal",
          description: error ? `${error.message}. Try again.` : NO_ROWS_MESSAGE,
          variant: "destructive",
        });
        return;
      }
      setDeal(data as Deal);
      await supabase.from("cloud_deal_events").insert({
        deal_id: data.id,
        lead_id: lead.id,
        event_type: "deal_created",
        event_payload: { from: stage, to: target },
        triggered_by: "admin",
      });
      toast({ title: `Moved to ${STAGE_LABELS[target]}` });
      await loadEvents(lead.id);
    } finally {
      setAdvancing(false);
    }
  }

  // ── Links ───────────────────────────────────────────────
  async function copyBriefLink() {
    if (!brief) return;
    const url = `${window.location.origin}/brief/${brief.access_token}`;
    const ok = await copyText(url);
    toast(ok ? { title: "Brief link copied" } : { title: "Couldn't copy — here's the link", description: url });
  }

  function emailBrief() {
    if (!lead || !brief) return;
    window.location.href = briefMailto(lead, brief);
  }

  async function ensureToken(field: "intake_token" | "shield_request_token", bytes: number): Promise<string | null> {
    if (!deal) {
      toast({ title: "No deal yet", description: "Move this lead to SOW first to create the deal record.", variant: "destructive" });
      return null;
    }
    const existing = deal[field];
    if (existing) return existing;
    const token = randomHex(bytes);
    const ok = await saveDeal({ [field]: token });
    return ok ? token : null;
  }

  async function copyIntakeLink() {
    const token = await ensureToken("intake_token", 24);
    if (!token) return;
    const url = `${window.location.origin}/intake/${token}`;
    const ok = await copyText(url);
    toast(
      ok
        ? { title: "Intake link copied", description: "Email it to the customer's IT lead." }
        : { title: "Couldn't copy — here's the link", description: url }
    );
  }

  async function copyShieldLink() {
    const token = await ensureToken("shield_request_token", 20);
    if (!token) return;
    const url = `${window.location.origin}/shield/request/${token}`;
    const ok = await copyText(url);
    toast(
      ok
        ? { title: "Shield request link copied", description: "Add it to the block page footer on the customer's Shield." }
        : { title: "Couldn't copy — here's the link", description: url }
    );
  }

  // ── Payment ─────────────────────────────────────────────
  function openPayment() {
    setPaymentUrl(null);
    setPaymentOpen(true);
  }

  async function generatePaymentLink() {
    if (!deal || !lead) return;
    const cents = Math.round(Number(paymentAmount) * 100);
    if (!cents || cents < 100) {
      toast({ title: "Enter an amount of at least $1", variant: "destructive" });
      return;
    }
    setGeneratingLink(true);
    try {
      const data = await invokeAdminFunction("cloud-deal-payment-link", {
        deal_id: deal.id,
        amount_cents: cents,
        description: paymentDescription,
      });
      setPaymentUrl(data.url);
      const copied = await copyText(data.url);
      toast({
        title: "Payment link created",
        description: copied ? "Link copied. Send it to the customer." : "Copy the link from the dialog and send it to the customer.",
      });
      await loadEvents(lead.id);
    } catch (err: any) {
      toast({
        title: "Couldn't create payment link",
        description: `${err?.message || "Unknown error"}. No link was created.`,
        variant: "destructive",
      });
    } finally {
      setGeneratingLink(false);
    }
  }

  // ── Signing ─────────────────────────────────────────────
  function openSign(kind: "sow" | "nda" | "acceptance") {
    setSignKind(kind);
    setSignOpen(true);
  }

  async function sendForSignature() {
    if (!deal || !lead) return;
    setSendingSign(true);
    try {
      await invokeAdminFunction("cloud-deal-sign", { deal_id: deal.id, template_kind: signKind });
      toast({
        title: `${SIGN_KIND_LABEL[signKind]} sent`,
        description: `Libresign emailed the signing link to ${lead.contact_email}.`,
      });
      setSignOpen(false);
      const { data } = await supabase.from("cloud_deals").select("*").eq("id", deal.id).maybeSingle();
      if (data) setDeal(data as Deal);
      await loadEvents(lead.id);
    } catch (err: any) {
      const msg: string = err?.message || "Unknown error";
      toast({
        title: "Couldn't send for signature",
        description: /not configured|no mapping/i.test(msg)
          ? `${msg} Until then, send it from Libresign on cloud.bestly.tech and use "Record signing request".`
          : `${msg}. Nothing was sent.`,
        variant: "destructive",
      });
    } finally {
      setSendingSign(false);
    }
  }

  async function recordEnvelope() {
    if (!deal || !lead) return;
    const reqId = signingRequestId.trim();
    if (!reqId) {
      toast({ title: "Paste the Libresign request ID first", variant: "destructive" });
      return;
    }
    setSavingEnvelope(true);
    const ok = await saveDeal({
      signing_provider: "libresign",
      signing_request_id: reqId,
      sow_sent_at: new Date().toISOString(),
    });
    if (ok) {
      const { error } = await supabase.from("cloud_deal_events").insert({
        deal_id: deal.id,
        lead_id: lead.id,
        event_type: "sow_sent",
        event_payload: { signing_provider: "libresign", signing_request_id: reqId, recorded_manually: true },
        triggered_by: "admin",
      });
      toast(
        error
          ? { title: "SOW recorded", description: "The timeline entry couldn't be added, but the deal was updated." }
          : { title: "SOW recorded", description: "The deal will update when the customer signs." }
      );
      setRecordOpen(false);
      setSigningRequestId("");
      await loadEvents(lead.id);
    }
    setSavingEnvelope(false);
  }

  // ── Shield requests ─────────────────────────────────────
  async function reviewShieldRequest(requestId: string, status: "approved" | "rejected" | "duplicate") {
    setShieldBusy(requestId);
    const reviewed_at = new Date().toISOString();
    const { data, error } = await supabase
      .from("cloud_shield_requests")
      .update({ status, reviewed_by: "admin", reviewed_at })
      .eq("id", requestId)
      .select("id");
    setShieldBusy(null);
    if (error || !data?.length) {
      toast({
        title: "Couldn't update request",
        description: error ? `${error.message}. Try again.` : NO_ROWS_MESSAGE,
        variant: "destructive",
      });
      return;
    }
    setShieldRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, status, reviewed_at, reviewed_by: "admin" } : r))
    );
    toast({
      title: status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Marked duplicate",
      description: status === "approved" ? "Add the domain to the customer's Shield allowlist." : undefined,
    });
  }

  // ── Notes ───────────────────────────────────────────────
  async function saveNotes() {
    if (!lead) return;
    setSavingNotes(true);
    const { data, error } = await supabase.from("cloud_leads").update({ notes }).eq("id", lead.id).select("id");
    setSavingNotes(false);
    if (error || !data?.length) {
      toast({
        title: "Couldn't save notes",
        description: error ? `${error.message}. Your text is still here — try again.` : NO_ROWS_MESSAGE,
        variant: "destructive",
      });
      return;
    }
    setSavedNotes(notes);
    toast({ title: "Notes saved" });
  }

  // ── Render ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-9 w-40" />
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <Skeleton className="h-9 w-72" />
          <div className="flex gap-2"><Skeleton className="h-9 w-28" /><Skeleton className="h-9 w-32" /><Skeleton className="h-9 w-9" /></div>
        </div>
        <Skeleton className="h-2 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-4"><Skeleton className="h-36" /><Skeleton className="h-28" /><Skeleton className="h-40" /></div>
          <div className="lg:col-span-2 space-y-4"><Skeleton className="h-56" /><Skeleton className="h-40" /></div>
        </div>
      </div>
    );
  }

  if (loadError && !lead) {
    return (
      <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-8 text-center">
        <h2 className="text-base font-medium text-red-200 mb-2">Couldn't load this deal</h2>
        <p className="text-sm text-red-200/80 mb-4">{loadError}</p>
        <div className="flex justify-center gap-2">
          <Button asChild variant="outline"><Link to="/admin/cloud">Back to pipeline</Link></Button>
          <Button onClick={() => { setLoading(true); load(); }}><RefreshCw className="h-4 w-4" /> Retry</Button>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
        <h2 className="text-base font-medium text-white/80 mb-2">Deal not found</h2>
        <p className="text-sm text-white/60 mb-4">It may have been deleted, or the link is wrong.</p>
        <Button asChild variant="outline">
          <Link to="/admin/cloud"><ArrowLeft className="h-4 w-4" /> Back to pipeline</Link>
        </Button>
      </div>
    );
  }

  const next = stage < 8 ? NEXT_STAGE_ACTION[stage] : null;
  const NextIcon = next?.icon;
  const needsDealHint = deal ? undefined : "No deal yet";

  // Stage-specific secondary buttons (max two).
  const secondary: { label: string; icon: typeof Send; onClick?: () => void; to?: string; disabled?: boolean }[] = [];
  if (stage <= 2 && brief) secondary.push({ label: "Email brief", icon: Mail, onClick: emailBrief });
  if (stage === 3) secondary.push({ label: "Discovery brief", icon: FileText, to: `/admin/cloud/${lead.id}/brief-pdf` });
  if (stage === 4 && deal) {
    secondary.push({ label: "Send SOW", icon: PenSquare, onClick: () => openSign("sow") });
    secondary.push({ label: "Payment link", icon: CreditCard, onClick: openPayment });
  }
  if (stage === 5 && deal) secondary.push({ label: "Copy intake link", icon: Wrench, onClick: copyIntakeLink });
  if (stage === 7 && deal) secondary.push({ label: "Send acceptance", icon: PenSquare, onClick: () => openSign("acceptance") });
  const secondaryLabels = new Set(secondary.map((s) => s.label));

  const menuItems: ActionItem[] = [];
  if (brief) {
    menuItems.push({ group: "Brief", label: "Copy brief link", icon: Copy, onSelect: copyBriefLink });
    if (!secondaryLabels.has("Email brief")) menuItems.push({ group: "Brief", label: "Email brief link", icon: Mail, onSelect: emailBrief });
  }
  if (!secondaryLabels.has("Discovery brief")) {
    menuItems.push({ group: "Brief", label: "Discovery brief (PDF)", icon: FileText, onSelect: () => navigate(`/admin/cloud/${lead.id}/brief-pdf`) });
  }
  if (!secondaryLabels.has("Send SOW") && !secondaryLabels.has("Send acceptance")) {
    menuItems.push({ group: "Contract & payment", label: "Send for signature…", icon: PenSquare, disabled: !deal, hint: needsDealHint, onSelect: () => openSign(stage >= 7 ? "acceptance" : "sow") });
  }
  menuItems.push({ group: "Contract & payment", label: "Record signing request…", icon: ClipboardPaste, disabled: !deal, hint: needsDealHint, onSelect: () => setRecordOpen(true) });
  if (!secondaryLabels.has("Payment link")) {
    menuItems.push({ group: "Contract & payment", label: "Create payment link…", icon: CreditCard, disabled: !deal, hint: needsDealHint, onSelect: openPayment });
  }
  if (!secondaryLabels.has("Copy intake link")) {
    menuItems.push({ group: "Customer links", label: "Copy intake link", icon: Wrench, disabled: !deal, hint: needsDealHint, onSelect: copyIntakeLink });
  }
  menuItems.push({ group: "Customer links", label: "Copy Shield request link", icon: ShieldCheck, disabled: !deal, hint: needsDealHint, onSelect: copyShieldLink });
  if (gateReason && stage < 8) {
    menuItems.push({ group: "Stage", label: `Move to ${STAGE_LABELS[stage + 1]} anyway`, icon: ChevronRight, onSelect: () => moveToStage(stage + 1) });
  }
  if (deal && stage > 1) {
    menuItems.push({ group: "Stage", label: `Move back to ${STAGE_LABELS[stage - 1]}`, icon: Undo2, onSelect: () => moveToStage(stage - 1) });
  }

  menuItems.push({ label: "Delete lead…", icon: Trash2, destructive: true, onSelect: () => setDeleteOpen(true) });

  const pendingShield = shieldRequests.filter((r) => r.status === "pending");
  const visibleShield = shieldFilter === "pending" ? pendingShield : shieldRequests;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2 text-white/70 hover:text-white">
          <Link to="/admin/cloud">
            <ArrowLeft className="h-4 w-4" />
            Pipeline
          </Link>
        </Button>
        <PageHeader
          title={lead.company_name}
          description={`${lead.user_count_band} users · created ${fmtAge(lead.created_at)}`}
          actions={
            <>
              {secondary.map((s) => {
                const Icon = s.icon;
                return s.to ? (
                  <Button key={s.label} asChild variant="outline" size="sm">
                    <Link to={s.to}><Icon className="h-4 w-4" />{s.label}</Link>
                  </Button>
                ) : (
                  <Button key={s.label} variant="outline" size="sm" onClick={s.onClick} disabled={s.disabled}>
                    <Icon className="h-4 w-4" />
                    {s.label}
                  </Button>
                );
              })}
              {next && NextIcon && (
                <Button
                  size="sm"
                  onClick={() => moveToStage(stage + 1)}
                  disabled={advancing || !!gateReason}
                  aria-describedby={gateReason ? "stage-gate-reason" : undefined}
                  title={`Moves the deal to Stage ${stage + 1}: ${STAGE_LABELS[stage + 1]}`}
                >
                  {advancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <NextIcon className="h-4 w-4" />}
                  {next.label}
                </Button>
              )}
              <ActionMenu items={menuItems} label="More deal actions" />
            </>
          }
        />
      </div>

      {/* Stage progress */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2 text-xs">
          <span className="text-white/80">
            Stage {stage} of 8 · <span className="font-medium text-white">{STAGE_LABELS[stage]}</span>
          </span>
          {deal?.stage_changed_at && <span className="text-white/60">since {fmtAge(deal.stage_changed_at)}</span>}
        </div>
        <ol className="grid grid-cols-8 gap-1" aria-label="Deal stages">
          {Array.from({ length: 8 }).map((_, i) => (
            <li
              key={i}
              className={`h-1.5 rounded-full ${i + 1 < stage ? "bg-emerald-500/70" : i + 1 === stage ? "bg-primary" : "bg-white/[0.08]"}`}
              aria-label={`Stage ${i + 1}: ${STAGE_LABELS[i + 1]}${i + 1 < stage ? " (done)" : i + 1 === stage ? " (current)" : ""}`}
            />
          ))}
        </ol>
        {gateReason && (
          <p id="stage-gate-reason" className="mt-2 text-xs text-amber-300 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {gateReason}
          </p>
        )}
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200">
          <span>Couldn't refresh: {loadError}</span>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: Contact, context, deal status, notes */}
        <div className="space-y-4">
          <Section title="Contact">
            <div className="space-y-2 text-sm">
              <div className="text-white font-medium">{lead.contact_name}</div>
              <div className="flex items-center gap-2 text-white/70">
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <a href={`mailto:${lead.contact_email}`} className="hover:underline truncate">
                  {lead.contact_email}
                </a>
              </div>
              {lead.contact_phone && (
                <div className="flex items-center gap-2 text-white/70">
                  <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <a href={`tel:${lead.contact_phone}`} className="hover:underline">
                    {lead.contact_phone}
                  </a>
                </div>
              )}
              {lead.company_website && (
                <div className="flex items-center gap-2 text-white/70">
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
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
          </Section>

          <Section title="Lead context">
            <dl className="space-y-1.5 text-sm">
              {lead.primary_pain && (
                <div className="flex justify-between gap-3">
                  <dt className="text-white/60">Primary pain</dt>
                  <dd className="text-white/90 capitalize">{lead.primary_pain.replace("-", " ")}</dd>
                </div>
              )}
              {lead.urgency && (
                <div className="flex justify-between gap-3">
                  <dt className="text-white/60">Urgency</dt>
                  <dd className="text-white/90">{lead.urgency}</dd>
                </div>
              )}
              {lead.primary_pain_detail && (
                <div className="pt-2 mt-2 border-t border-white/[0.06]">
                  <dt className="text-white/60 text-xs mb-1">Note</dt>
                  <dd className="text-white/80 text-sm leading-relaxed">{lead.primary_pain_detail}</dd>
                </div>
              )}
              {!lead.primary_pain && !lead.urgency && !lead.primary_pain_detail && (
                <p className="text-white/60">Nothing extra shared on the lead form.</p>
              )}
            </dl>
          </Section>

          {deal && (
            <Section title="Deal status">
              <ul className="space-y-1.5 text-sm">
                {[
                  { label: "SOW sent", at: deal.sow_sent_at },
                  { label: "SOW signed", at: deal.sow_signed_at },
                  { label: "Deposit paid", at: deal.deposit_paid_at },
                  { label: "Intake submitted", at: deal.intake_submitted_at },
                  { label: "Live", at: deal.go_live_at },
                ].map((m) => (
                  <li key={m.label} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-white/80">
                      {m.at ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-label="Done" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-white/40" aria-label="Not yet" />
                      )}
                      {m.label}
                    </span>
                    <span className="text-xs text-white/60">{m.at ? fmtAge(m.at) : "Not yet"}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title="Internal notes"
            aside={notes !== savedNotes ? <span className="text-xs text-amber-300">Unsaved</span> : undefined}
          >
            <Label htmlFor="deal-notes" className="sr-only">Internal notes</Label>
            <Textarea
              id="deal-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              className="text-sm bg-black/30 border-white/[0.08]"
              placeholder="Anything we want to remember about this deal."
            />
            <Button
              onClick={saveNotes}
              disabled={savingNotes || notes === savedNotes}
              size="sm"
              variant="outline"
              className="mt-2 w-full"
            >
              {savingNotes ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save notes"}
            </Button>
          </Section>
        </div>

        {/* RIGHT: Brief data, stage panels, timeline */}
        <div className="lg:col-span-2 space-y-4">
          <Section
            title="Pre-call brief"
            aside={
              brief?.submitted_at ? (
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]">
                  <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden />
                  Submitted {fmtAge(brief.submitted_at)}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500/30 text-amber-300 bg-amber-500/[0.08]">
                  <Clock className="h-3 w-3 mr-1" aria-hidden />
                  Awaiting answers
                </Badge>
              )
            }
          >
            {!brief ? (
              <p className="text-sm text-white/60">No brief record exists for this lead, so there's no brief link to send.</p>
            ) : !brief.submitted_at && brief.current_apps.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-white/60">The customer hasn't started the brief yet.</p>
                <Button size="sm" variant="outline" onClick={copyBriefLink}>
                  <Copy className="h-4 w-4" /> Copy brief link
                </Button>
              </div>
            ) : (
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-white/60 text-xs mb-1">Current stack ({brief.current_apps.length})</dt>
                  <dd className="flex flex-wrap gap-1">
                    {brief.current_apps.length === 0 ? (
                      <span className="text-white/60">—</span>
                    ) : (
                      brief.current_apps.map((a) => (
                        <Badge key={a} variant="outline" className="border-white/10 bg-white/[0.04] text-white/80 text-xs">
                          {APP_LABEL[a] ?? a}
                        </Badge>
                      ))
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/60 text-xs mb-1">Annual SaaS spend</dt>
                  <dd className="text-white/90">{brief.annual_saas_spend_band ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/60 text-xs mb-1">Compliance</dt>
                  <dd className="flex flex-wrap gap-1">
                    {brief.compliance_frameworks.length === 0 ? (
                      <span className="text-white/60">—</span>
                    ) : (
                      brief.compliance_frameworks.map((c) => (
                        <Badge key={c} variant="outline" className="border-white/10 bg-white/[0.04] text-white/80 text-xs uppercase">
                          {c}
                        </Badge>
                      ))
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/60 text-xs mb-1">Office</dt>
                  <dd className="text-white/90">
                    {[brief.office_city, brief.office_state, brief.office_country].filter(Boolean).join(", ") || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-white/60 text-xs mb-1">Static IP</dt>
                  <dd className="text-white/90">{brief.has_static_ip ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/60 text-xs mb-1">IT lead</dt>
                  <dd className="text-white/90">{brief.has_it_lead ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/60 text-xs mb-1">Owns domain</dt>
                  <dd className="text-white/90">{brief.domain_owned ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-white/60 text-xs mb-1">Preferred subdomain</dt>
                  <dd className="text-white/90 truncate">{brief.preferred_subdomain ?? "—"}</dd>
                </div>
                {brief.biggest_unknown && (
                  <div className="md:col-span-2 pt-3 border-t border-white/[0.06]">
                    <dt className="text-white/60 text-xs mb-1">Biggest unknown</dt>
                    <dd className="text-white/85 text-sm leading-relaxed">{brief.biggest_unknown}</dd>
                  </div>
                )}
              </dl>
            )}
          </Section>

          <IntakeReviewSection deal={deal} />

          <ProvisioningChecklist deal={deal} stage={stage} saveDeal={saveDeal} />

          <InstallTracker deal={deal} stage={stage} saveDeal={saveDeal} />

          <LiveOpsPanel deal={deal} stage={stage} saveDeal={saveDeal} />

          {deal && (
            <Section
              title="Shield allowlist requests"
              aside={
                <div className="flex items-center gap-2">
                  {pendingShield.length > 0 && (
                    <span className="inline-flex items-center rounded-full bg-amber-500/20 text-amber-200 text-xs px-2 py-0.5">
                      {pendingShield.length} pending
                    </span>
                  )}
                  {shieldRequests.length > 0 && (
                    <div role="group" aria-label="Filter requests" className="flex items-center rounded-md border border-white/[0.08] p-0.5 text-xs">
                      {(["pending", "all"] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          aria-pressed={shieldFilter === f}
                          onClick={() => setShieldFilter(f)}
                          className={`h-7 px-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            shieldFilter === f ? "bg-white/[0.1] text-white" : "text-white/60 hover:text-white/80"
                          }`}
                        >
                          {f === "pending" ? "Pending" : "All"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              }
            >
              {shieldRequests.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-white/60">
                    No requests yet. Add the Shield request link to the customer's block page so their team can ask for sites to be unblocked.
                  </p>
                  <Button size="sm" variant="outline" onClick={copyShieldLink}>
                    <Copy className="h-4 w-4" /> Copy request link
                  </Button>
                </div>
              ) : visibleShield.length === 0 ? (
                <p className="text-sm text-white/60">
                  Nothing pending.{" "}
                  <button type="button" className="underline hover:text-white" onClick={() => setShieldFilter("all")}>
                    Show all {shieldRequests.length}
                  </button>
                </p>
              ) : (
                <ul className="space-y-2">
                  {visibleShield.map((r) => (
                    <li key={r.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono text-white/90 break-all">{r.requested_url}</div>
                          <div className="text-xs text-white/60 mt-0.5">
                            {fmtAge(r.created_at)}
                            {r.requester_name ? ` · ${r.requester_name}` : ""}
                            {r.requester_email ? ` <${r.requester_email}>` : ""}
                          </div>
                        </div>
                        {r.status === "pending" ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10"
                              disabled={shieldBusy === r.id}
                              onClick={() => reviewShieldRequest(r.id, "approved")}
                            >
                              {shieldBusy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
                              Approve
                            </Button>
                            <ActionMenu
                              label={`More actions for ${r.requested_url}`}
                              items={[
                                { label: "Mark duplicate", icon: CopyX, onSelect: () => reviewShieldRequest(r.id, "duplicate") },
                                { label: "Reject", icon: XCircle, onSelect: () => reviewShieldRequest(r.id, "rejected") },
                              ]}
                            />
                          </div>
                        ) : (
                          <Badge
                            variant="outline"
                            className={
                              r.status === "approved"
                                ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]"
                                : r.status === "rejected"
                                ? "border-red-500/30 text-red-300 bg-red-500/[0.08]"
                                : "border-white/10 text-white/70 bg-white/[0.04]"
                            }
                          >
                            {r.status === "approved" ? "Approved" : r.status === "rejected" ? "Rejected" : "Duplicate"}
                          </Badge>
                        )}
                      </div>
                      {r.reason && <p className="text-xs text-white/70 mt-1 leading-relaxed">{r.reason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section title="Timeline">
            {events.length === 0 ? (
              <p className="text-sm text-white/60">No activity yet. Stage changes, links and signatures will show up here.</p>
            ) : (
              <ol className="space-y-3">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/40 mt-2 shrink-0" aria-hidden />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white/85">
                        {e.event_type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}
                        {e.event_payload?.from != null && e.event_payload?.to != null && (
                          <span className="text-white/60 ml-2">
                            · {STAGE_LABELS[e.event_payload.from] ?? e.event_payload.from} → {STAGE_LABELS[e.event_payload.to] ?? e.event_payload.to}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-white/60 mt-0.5">
                        {fmtAbs(e.created_at)}
                        {e.triggered_by ? ` · ${e.triggered_by}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>

      {/* Payment link dialog */}
      <Dialog open={paymentOpen} onOpenChange={(o) => { if (!generatingLink) setPaymentOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{paymentUrl ? "Payment link ready" : "Create payment link"}</DialogTitle>
            <DialogDescription>
              {paymentUrl ? (
                <>Send this Stripe link to {lead.contact_name}. When they pay, the deal moves forward automatically.</>
              ) : (
                <>
                  Creates a Stripe payment link for <span className="text-foreground">{lead.company_name}</span>. Nothing is
                  sent to the customer until you share the link.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {paymentUrl ? (
            <div className="space-y-3">
              <Input readOnly value={paymentUrl} aria-label="Payment link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" asChild>
                  <a href={paymentUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /> Open</a>
                </Button>
                <Button
                  onClick={async () => {
                    const ok = await copyText(paymentUrl);
                    toast(ok ? { title: "Link copied" } : { title: "Couldn't copy", description: "Select the link and copy it manually.", variant: "destructive" });
                  }}
                >
                  <Copy className="h-4 w-4" /> Copy link
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                generatePaymentLink();
              }}
            >
              <div>
                <Label htmlFor="pay-amount">Amount (USD)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" aria-hidden />
                  <Input
                    id="pay-amount"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    type="number"
                    min={1}
                    step="0.01"
                    className="pl-8"
                    required
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="pay-desc">Description (shown to customer)</Label>
                <Input id="pay-desc" value={paymentDescription} onChange={(e) => setPaymentDescription(e.target.value)} />
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)} disabled={generatingLink}>Cancel</Button>
                <Button type="submit" disabled={generatingLink}>
                  {generatingLink ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : "Create link"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Send for signature dialog */}
      <Dialog open={signOpen} onOpenChange={(o) => { if (!sendingSign) setSignOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send for signature</DialogTitle>
            <DialogDescription>
              Libresign on cloud.bestly.tech emails a signing link to{" "}
              <span className="text-foreground">{lead.contact_email}</span>. The deal updates when they sign.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="sign-kind">Document</Label>
            <Select value={signKind} onValueChange={(v) => setSignKind(v as typeof signKind)}>
              <SelectTrigger id="sign-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(SIGN_KIND_LABEL) as (keyof typeof SIGN_KIND_LABEL)[]).map((k) => (
                  <SelectItem key={k} value={k}>{SIGN_KIND_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setSignOpen(false)} disabled={sendingSign}>Cancel</Button>
            <Button onClick={sendForSignature} disabled={sendingSign}>
              {sendingSign ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <><Send className="h-4 w-4" /> Send</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record manual signing request dialog */}
      <Dialog open={recordOpen} onOpenChange={(o) => { if (!savingEnvelope) setRecordOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record signing request</DialogTitle>
            <DialogDescription>
              Sent the SOW yourself from Libresign? Paste its request ID so the deal tracks it and updates when the customer signs.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              recordEnvelope();
            }}
          >
            <div>
              <Label htmlFor="sign-req-id">Libresign request ID</Label>
              <Input
                id="sign-req-id"
                value={signingRequestId}
                onChange={(e) => setSigningRequestId(e.target.value)}
                placeholder="e.g. 9bf3a08b-8c47-4c88-9c93-5af2bb2c4d74"
                className="font-mono text-xs"
                required
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => setRecordOpen(false)} disabled={savingEnvelope}>Cancel</Button>
              <Button type="submit" disabled={savingEnvelope || !signingRequestId.trim()}>
                {savingEnvelope ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Record SOW sent"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <DeleteLeadDialog
        lead={deleteOpen ? { id: lead.id, company_name: lead.company_name, hasDeal: !!deal } : null}
        onOpenChange={setDeleteOpen}
        onDeleted={() => navigate("/admin/cloud")}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────
// DraftField — text input that saves on blur (or Enter) instead of
// writing to the database on every keystroke.
// ─────────────────────────────────────────────────────

function DraftField({
  id,
  value,
  onCommit,
  multiline,
  type = "text",
  placeholder,
  className,
  rows,
}: {
  id: string;
  value: string;
  onCommit: (v: string) => Promise<boolean>;
  multiline?: boolean;
  type?: string;
  placeholder?: string;
  className?: string;
  rows?: number;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  async function commit() {
    focused.current = false;
    if (draft === value) return;
    setSaving(true);
    const ok = await onCommit(draft);
    setSaving(false);
    if (!ok) setDraft(value);
  }

  const common = {
    id,
    value: draft,
    placeholder,
    disabled: saving,
    "aria-busy": saving || undefined,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: commit,
  };

  return (
    <div className="relative">
      {multiline ? (
        <Textarea {...common} rows={rows ?? 2} className={className} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <Input
          {...common}
          type={type}
          className={className}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      )}
      {saving && (
        <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-white/60" aria-label="Saving" />
      )}
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
        <h2 className="text-xs uppercase tracking-wider text-white/60">Technical intake</h2>
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
          <Badge variant="outline" className="border-white/20 text-white/60 bg-white/[0.04]">
            Not started
          </Badge>
        )}
      </div>

      {!hasAnyContent ? (
        <p className="text-sm text-white/60">
          Intake link created but nothing filled in yet. If it's been more than a week, copy the intake link from More and resend it.
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
                <summary className="cursor-pointer flex items-center justify-between px-3 py-2.5 list-none rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white/85">{s.label}</span>
                    {filled ? (
                      <CheckIcon className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <span className="text-xs text-white/60">empty</span>
                    )}
                  </span>
                  <span className="text-xs text-white/60" aria-hidden>
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
      <dt className="text-xs text-white/60 min-w-[6.875rem] shrink-0">{label}</dt>
      <dd className="text-sm text-white/85 break-words">{String(value)}</dd>
    </div>
  );
}

function NetworkSummary({ data }: { data: any }) {
  if (!data) return <p className="text-sm text-white/60">Empty.</p>;
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
  if (!data) return <p className="text-sm text-white/60">Empty.</p>;
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
            <span className="text-white/60">primary</span>
          </div>
        )}
        {data.accent_color && (
          <div className="flex items-center gap-1.5 text-xs text-white/70">
            <span className="inline-block w-4 h-4 rounded border border-white/20" style={{ background: data.accent_color }} />
            <span className="font-mono">{data.accent_color}</span>
            <span className="text-white/60">accent</span>
          </div>
        )}
      </div>
      {(data.logo_url || data.icon_url) && (
        <div className="flex flex-wrap gap-3 pt-2 border-t border-white/[0.06]">
          {data.logo_url && (
            <a href={data.logo_url} target="_blank" rel="noopener noreferrer" className="block">
              <div className="text-xs uppercase tracking-wider text-white/60 mb-1">Logo</div>
              <img src={data.logo_url} alt="logo" className="h-12 max-w-[10rem] object-contain rounded border border-white/[0.06] bg-neutral-900 p-1" />
            </a>
          )}
          {data.icon_url && (
            <a href={data.icon_url} target="_blank" rel="noopener noreferrer" className="block">
              <div className="text-xs uppercase tracking-wider text-white/60 mb-1">Icon</div>
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
  if (list.length === 0) return <p className="text-sm text-white/60">No users yet.</p>;
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
          <thead className="bg-white/[0.04] text-white/60">
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
                <td colSpan={4} className="px-2 py-1 text-center text-white/60 text-[0.6875rem]">
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
  if (!data) return <p className="text-sm text-white/60">Empty.</p>;
  const sources: string[] = data.selected_sources || [];
  const per = data.per_source || {};
  if (sources.length === 0)
    return (
      <p className="text-sm text-white/60">No migration sources selected yet.</p>
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
                <span className="text-xs text-white/60">{ps.scope || "scope?"}</span>
              </div>
              {(ps.data_volume_gb_per_user || ps.decommission_after_days) && (
                <div className="text-[0.6875rem] text-white/60 mt-0.5">
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
  if (!data) return <p className="text-sm text-white/60">Empty.</p>;
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
          <div className="text-xs text-white/60 mb-1">DNS filter</div>
          <div className="flex flex-wrap gap-1">
            {cats.map((c) => (
              <Badge key={c} variant="outline" className="border-white/10 bg-white/[0.04] text-white/80 text-[0.6875rem]">
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
// The "Ship it" action is the page's primary button once all steps are done.
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
  saveDeal,
}: {
  deal: Deal | null;
  stage: number;
  saveDeal: SaveDeal;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!deal || stage < 5) return null;

  const data: Record<string, StepState> = deal.provisioning_data || {};
  const doneCount = PROVISIONING_STEPS.filter((s) => data[s.key]?.done).length;
  const allDone = doneCount === PROVISIONING_STEPS.length;
  const pct = Math.round((doneCount / PROVISIONING_STEPS.length) * 100);

  async function setStep(key: string, done: boolean) {
    if (!deal) return;
    setBusy(key);
    await saveDeal((current) => {
      const next: Record<string, StepState> = { ...(current.provisioning_data || {}) };
      next[key] = { ...next[key], done };
      if (done) {
        next[key].completed_at = new Date().toISOString();
        next[key].completed_by = "operator";
      } else {
        delete next[key].completed_at;
        delete next[key].completed_by;
      }
      return { provisioning_data: next };
    });
    setBusy(null);
  }

  return (
    <Section
      title="Provisioning"
      aside={
        <Badge
          variant="outline"
          className={
            allDone
              ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]"
              : doneCount > 0
              ? "border-amber-500/30 text-amber-300 bg-amber-500/[0.08]"
              : "border-white/20 text-white/70 bg-white/[0.04]"
          }
        >
          {doneCount} of {PROVISIONING_STEPS.length} done
        </Badge>
      }
    >
      <div
        className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden mb-4"
        role="progressbar"
        aria-label="Provisioning progress"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full transition-all duration-300 ${allDone ? "bg-emerald-500" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {PROVISIONING_STEPS.map((s) => {
          const st = data[s.key] || {};
          const checked = !!st.done;
          const inputId = `prov-${s.key}`;
          return (
            <li key={s.key}>
              <label
                htmlFor={inputId}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                  checked
                    ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                    : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                {busy === s.key ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-white/60" aria-label="Saving" />
                ) : (
                  <Checkbox
                    id={inputId}
                    checked={checked}
                    disabled={busy !== null}
                    onCheckedChange={(v) => setStep(s.key, v === true)}
                    className="mt-0.5"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-medium ${checked ? "text-white/70 line-through" : "text-white/90"}`}>
                      {s.label}
                    </span>
                    {st.completed_at && (
                      <span className="text-xs text-white/60 shrink-0">{fmtAge(st.completed_at)}</span>
                    )}
                  </div>
                  <div className="text-xs text-white/60 leading-relaxed">{s.description}</div>
                  {st.notes && (
                    <div className="text-xs text-white/70 italic mt-1 pl-2 border-l border-white/[0.1]">{st.notes}</div>
                  )}
                </div>
              </label>
            </li>
          );
        })}
      </ol>

      {allDone && stage === 6 && (
        <p className="mt-4 flex items-center gap-2 text-sm text-emerald-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
          All steps complete. Use <span className="font-medium">Ship it</span> at the top of the page to move to Install.
        </p>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────
// InstallTracker — Stage 7 operator workflow.
// Three sections: Shipping, Install scheduling, Acceptance.
// State lives in cloud_deals.install_data. acceptance.signed_at is set by the
// Libresign webhook, or manually here; it unlocks "Mark live" in the header.
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

/** ISO timestamp -> value for <input type="datetime-local"> in the viewer's timezone. */
function toLocalDateTimeInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function StatusPill({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <Badge
      variant="outline"
      className={ok ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]" : "border-white/20 text-white/70 bg-white/[0.04]"}
    >
      {ok ? <CheckIcon className="h-3 w-3 mr-1" aria-hidden /> : <Clock className="h-3 w-3 mr-1" aria-hidden />}
      {ok ? yes : no}
    </Badge>
  );
}

function InstallTracker({
  deal,
  stage,
  saveDeal,
}: {
  deal: Deal | null;
  stage: number;
  saveDeal: SaveDeal;
}) {
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

  async function patchSection(section: "shipping" | "install" | "acceptance", field: string, value: string | undefined) {
    if (!deal) return false;
    return saveDeal((current) => {
      const next = { ...(current.install_data || {}) } as any;
      next[section] = { ...(next[section] || {}), [field]: value || undefined };
      return { install_data: next };
    });
  }

  async function withBusy(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    await fn();
    setBusy(null);
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

  const fieldClass = "bg-black/30 border-white/[0.08]";

  return (
    <Section
      title="Install"
      aside={
        <div className="flex flex-wrap gap-1">
          <StatusPill ok={shipped} yes="Shipped" no="Not shipped" />
          <StatusPill ok={scheduled} yes="Scheduled" no="Not scheduled" />
          <StatusPill ok={signed} yes="Accepted" no="Not accepted" />
        </div>
      }
    >
      <p className="text-xs text-white/60 mb-3">Fields save when you leave them.</p>

      {/* Shipping */}
      <fieldset className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 mb-3">
        <legend className="px-1 text-xs uppercase tracking-wider text-white/60">Shipping</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ship-carrier" className="text-xs text-white/60">Carrier</Label>
            <Select
              value={shipping.carrier ?? ""}
              onValueChange={(v) => withBusy("carrier", () => patchSection("shipping", "carrier", v))}
              disabled={busy === "carrier"}
            >
              <SelectTrigger id="ship-carrier" className={fieldClass}>
                <SelectValue placeholder="Choose a carrier" />
              </SelectTrigger>
              <SelectContent>
                {CARRIERS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="ship-tracking" className="text-xs text-white/60">Tracking number</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <DraftField
                  id="ship-tracking"
                  value={shipping.tracking_number ?? ""}
                  onCommit={(v) => patchSection("shipping", "tracking_number", v.trim())}
                  placeholder="1Z..."
                  className={`font-mono text-sm ${fieldClass}`}
                />
              </div>
              {trackingUrl && (
                <Button asChild variant="outline" size="icon" className="h-10 w-10 shrink-0">
                  <a href={trackingUrl} target="_blank" rel="noopener noreferrer" aria-label="Track shipment" title="Track shipment">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </div>
          <div>
            <Label htmlFor="ship-date" className="text-xs text-white/60">Ship date</Label>
            <DraftField
              id="ship-date"
              type="date"
              value={shipping.ship_date ?? ""}
              onCommit={(v) => patchSection("shipping", "ship_date", v)}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="ship-eta" className="text-xs text-white/60">Expected delivery</Label>
            <DraftField
              id="ship-eta"
              type="date"
              value={shipping.eta ?? ""}
              onCommit={(v) => patchSection("shipping", "eta", v)}
              className={fieldClass}
            />
          </div>
        </div>
      </fieldset>

      {/* Install scheduling */}
      <fieldset className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 mb-3">
        <legend className="px-1 text-xs uppercase tracking-wider text-white/60">Install</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="install-at" className="text-xs text-white/60">Scheduled for</Label>
            <DraftField
              id="install-at"
              type="datetime-local"
              value={toLocalDateTimeInput(install.scheduled_at)}
              onCommit={(v) => patchSection("install", "scheduled_at", v ? new Date(v).toISOString() : "")}
              className={fieldClass}
            />
          </div>
          <div>
            <Label htmlFor="install-mode" className="text-xs text-white/60">Mode</Label>
            <Select
              value={install.mode ?? ""}
              onValueChange={(v) => withBusy("mode", () => patchSection("install", "mode", v))}
              disabled={busy === "mode"}
            >
              <SelectTrigger id="install-mode" className={fieldClass}>
                <SelectValue placeholder="Choose a mode" />
              </SelectTrigger>
              <SelectContent>
                {INSTALL_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="install-notes" className="text-xs text-white/60">Install notes</Label>
            <DraftField
              id="install-notes"
              multiline
              rows={2}
              value={install.notes ?? ""}
              onCommit={(v) => patchSection("install", "notes", v)}
              placeholder="Optional. Building access, parking, key contacts on-site, etc."
              className={fieldClass}
            />
          </div>
        </div>
      </fieldset>

      {/* Acceptance */}
      <fieldset className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <legend className="px-1 text-xs uppercase tracking-wider text-white/60">Acceptance</legend>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 sm:items-end">
          <div>
            <Label htmlFor="accept-id" className="text-xs text-white/60">Libresign acceptance request ID</Label>
            <DraftField
              id="accept-id"
              value={acceptance.envelope_id ?? ""}
              onCommit={(v) => patchSection("acceptance", "envelope_id", v.trim())}
              placeholder="Filled automatically when sent from this page"
              className={`font-mono text-xs ${fieldClass}`}
            />
          </div>
          {signed ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Signed {fmtAge(acceptance.signed_at!)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === "signed"}
                onClick={() => withBusy("signed", () => patchSection("acceptance", "signed_at", undefined))}
              >
                {busy === "signed" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                Undo
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-10"
              disabled={busy === "signed"}
              onClick={() => withBusy("signed", () => patchSection("acceptance", "signed_at", new Date().toISOString()))}
            >
              {busy === "signed" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
              Mark as signed
            </Button>
          )}
        </div>
        <p className="text-xs text-white/60 mt-2">
          Signing through Libresign marks this automatically. Use "Mark as signed" only if the customer signed another way.
          {signed && stage === 7 ? " Acceptance is in — use Mark live at the top of the page." : ""}
        </p>
      </fieldset>
    </Section>
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
  return `${Math.abs(days)}d overdue`;
}

function MilestoneRow({
  id,
  label,
  target,
  done,
  busy,
  onToggle,
}: {
  id: string;
  label: string;
  target: string | null;
  done: boolean;
  busy: boolean;
  onToggle: (done: boolean) => void;
}) {
  const days = daysFromNow(target);
  const overdue = !done && days != null && days < 0;
  const upcoming = !done && days != null && days >= 0 && days <= 7;
  return (
    <label
      htmlFor={id}
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${
        done
          ? "border-emerald-500/20 bg-emerald-500/[0.03]"
          : overdue
          ? "border-red-500/30 bg-red-500/[0.05]"
          : upcoming
          ? "border-amber-500/30 bg-amber-500/[0.05]"
          : "border-white/[0.06] bg-white/[0.02]"
      }`}
    >
      <span className="flex items-center gap-3 min-w-0">
        {busy ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/60" aria-label="Saving" />
        ) : (
          <Checkbox id={id} checked={done} onCheckedChange={(v) => onToggle(v === true)} />
        )}
        <span className={`text-sm ${done ? "text-white/60 line-through" : "text-white/90"}`}>{label}</span>
      </span>
      <span className={`text-xs shrink-0 ${overdue ? "text-red-300" : upcoming ? "text-amber-300" : "text-white/60"}`}>
        {target ? new Date(target).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—"}
        {target && !done && ` · ${fmtCountdown(days)}`}
      </span>
    </label>
  );
}

function LiveOpsPanel({
  deal,
  stage,
  saveDeal,
}: {
  deal: Deal | null;
  stage: number;
  saveDeal: SaveDeal;
}) {
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

  const plusDays = (base: string | null | undefined, n: number) =>
    base ? new Date(new Date(base).getTime() + n * 86400000).toISOString() : null;

  const checkinTarget = plusDays(goLive, 30);
  const checkinDone = !!data.thirty_day_checkin?.done;
  const lastQuarterly = data.quarterlies?.last_at;
  const nextQuarterlyTarget = plusDays(lastQuarterly || goLive, 90);
  const nextQuarterlyDays = daysFromNow(nextQuarterlyTarget);
  const renewals = data.renewals || {};

  async function patch(path: string[], value: any, success?: string) {
    if (!deal) return false;
    const key = path.join(".");
    setBusy(key);
    const ok = await saveDeal((current) => {
      const next = { ...(current.live_data || {}) } as any;
      let cursor = next;
      for (let i = 0; i < path.length - 1; i++) {
        cursor[path[i]] = { ...(cursor[path[i]] || {}) };
        cursor = cursor[path[i]];
      }
      if (value === undefined) delete cursor[path[path.length - 1]];
      else cursor[path[path.length - 1]] = value;
      return { live_data: next };
    }, { success });
    setBusy(null);
    return ok;
  }

  return (
    <Section
      title="Live operations"
      aside={
        goLive ? (
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-300 bg-emerald-500/[0.08]">
            Live since {new Date(goLive).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
          </Badge>
        ) : undefined
      }
    >
      {!goLive && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2">
          <p className="text-sm text-amber-200">No go-live date on this deal, so milestone dates can't be calculated.</p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy === "go_live_at"}
            onClick={async () => {
              setBusy("go_live_at");
              await saveDeal({ go_live_at: new Date().toISOString() }, { success: "Go-live date set to today" });
              setBusy(null);
            }}
          >
            Set go-live to today
          </Button>
        </div>
      )}

      <div className="space-y-1.5 mb-4">
        <MilestoneRow
          id="ms-checkin"
          label="30-day check-in"
          target={checkinTarget}
          done={checkinDone}
          busy={busy === "thirty_day_checkin"}
          onToggle={(done) => patch(["thirty_day_checkin"], done ? { done: true, at: new Date().toISOString() } : {})}
        />

        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
            nextQuarterlyDays != null && nextQuarterlyDays < 0
              ? "border-red-500/30 bg-red-500/[0.05]"
              : nextQuarterlyDays != null && nextQuarterlyDays <= 7
              ? "border-amber-500/30 bg-amber-500/[0.05]"
              : "border-white/[0.06] bg-white/[0.02]"
          }`}
        >
          <div className="min-w-0">
            <div className="text-sm text-white/90">Quarterly report</div>
            <div className="text-xs text-white/60">
              {lastQuarterly ? `Last sent ${fmtAge(lastQuarterly)}` : "None sent yet"}
              {nextQuarterlyTarget &&
                ` · next due ${new Date(nextQuarterlyTarget).toLocaleDateString([], { month: "short", day: "numeric" })} (${fmtCountdown(nextQuarterlyDays)})`}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy === "quarterlies.last_at"}
            onClick={() => patch(["quarterlies", "last_at"], new Date().toISOString(), "Quarterly report logged")}
          >
            {busy === "quarterlies.last_at" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
            Log report sent
          </Button>
        </div>

        {([1, 2, 3] as const).map((y) => {
          const key = `y${y}_done` as "y1_done" | "y2_done" | "y3_done";
          return (
            <MilestoneRow
              key={key}
              id={`ms-${key}`}
              label={`Year ${y} renewal`}
              target={plusDays(goLive, 365 * y)}
              done={!!renewals[key]}
              busy={busy === `renewals.${key}`}
              onToggle={(done) => patch(["renewals", key], done)}
            />
          );
        })}
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-3">
        <div>
          <div id="churn-risk-label" className="text-xs uppercase tracking-wider text-white/60 mb-2">Churn risk</div>
          <div role="group" aria-labelledby="churn-risk-label" className="flex flex-wrap gap-2">
            {RISK_OPTS.map((r) => {
              const active = data.churn_risk === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => patch(["churn_risk"], active ? undefined : r.value)}
                  disabled={busy === "churn_risk"}
                  className={`h-9 px-3 text-xs rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                    active ? r.klass : "border-white/[0.1] text-white/70 bg-white/[0.02] hover:bg-white/[0.05]"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label htmlFor="health-notes" className="text-xs text-white/60">Health notes</Label>
          <DraftField
            id="health-notes"
            multiline
            rows={2}
            value={data.health_notes ?? ""}
            onCommit={(v) => patch(["health_notes"], v || undefined)}
            placeholder="Optional. Recent incidents, expansion talks, contract renegotiations, etc. Saves when you leave the field."
            className="bg-black/30 border-white/[0.08]"
          />
        </div>
      </div>
    </Section>
  );
}

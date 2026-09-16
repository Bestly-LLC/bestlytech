import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronDown, Copy, Download, ExternalLink, FileText,
  Loader2, Maximize2, Minimize2, Play, RefreshCw, Trash2,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { EmptyState } from "@/components/admin/EmptyState";
import { cn } from "@/lib/utils";

const STATUSES = ["Draft", "Submitted", "In Review", "Issues Flagged", "Approved", "Archived"];
const COMPACT_KEY = "admin.submissionDetail.compact";

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return phone;
}

function CopyField({ label, value, masked }: { label: string; value: string | null | undefined; masked?: boolean }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const hasValue = !!value && value !== "—";
  const handleCopy = async () => {
    if (!hasValue) return;
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Couldn't copy", description: "Your browser blocked clipboard access. Select the text instead.", variant: "destructive" });
    }
  };
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-1.5 group">
      <span className="text-sm text-white/60 w-36 sm:w-48 shrink-0">{label}</span>
      <span className="text-sm text-white flex items-center gap-1.5 min-w-0">
        <span className="break-words">{masked && hasValue ? `•••${value!.slice(-4)}` : value || "—"}</span>
        {hasValue && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCopy}
                aria-label={`Copy ${label}`}
                className="h-9 w-9 -my-2 inline-flex items-center justify-center rounded-lg text-white/55 hover:text-white hover:bg-white/5 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{copied ? "Copied" : `Copy ${label.toLowerCase()}`}</TooltipContent>
          </Tooltip>
        )}
      </span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-1.5">
      <span className="text-sm text-white/60 w-36 sm:w-48 shrink-0">{label}</span>
      <span className="text-sm text-white break-words">{value || "—"}</span>
    </div>
  );
}

function Section({
  title, defaultOpen, compact, children, badge,
}: { title: string; defaultOpen?: boolean; compact?: boolean; children: React.ReactNode; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-full flex items-center justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              compact ? "px-4 py-2.5" : "px-5 py-4",
            )}
          >
            <span className="flex items-center gap-2">
              <span className={cn("font-semibold text-white", compact ? "text-sm" : "text-[0.9375rem]")}>{title}</span>
              {badge}
            </span>
            <ChevronDown className={cn("h-4 w-4 text-white/55 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className={cn("border-t border-white/[0.06]", compact ? "px-4 py-3 text-xs" : "px-5 py-4")}>{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function SubSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-white/55 mb-2">{label}</p>
      {children}
    </div>
  );
}

function getSelectedPlatforms(intake: any): string[] {
  if (intake.selected_platforms && intake.selected_platforms.length > 0) return intake.selected_platforms;
  return [intake.platform || "Amazon"];
}

function formatAddress(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(", ") || "—";
}

export default function AdminSubmissionDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [intake, setIntake] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [validations, setValidations] = useState<any[]>([]);
  const [guidance, setGuidance] = useState<any[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [compact, setCompact] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COMPACT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState<null | "status" | "notes" | "validate" | "delete" | "download">(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    const [intakeRes, docsRes, valRes] = await Promise.all([
      supabase.from("seller_intakes").select("*").eq("id", id).maybeSingle(),
      supabase.from("intake_documents").select("*").eq("intake_id", id),
      supabase.from("intake_validations").select("*").eq("intake_id", id).order("created_at"),
    ]);
    const err = intakeRes.error ?? docsRes.error ?? valRes.error;
    setLoadError(err ? err.message : null);
    if (!intakeRes.error) {
      const i = intakeRes.data;
      setIntake(i);
      if (i) {
        setNotes(i.admin_notes || "");
        const { data: g } = await supabase
          .from("setup_guidance")
          .select("*")
          .in("platform", getSelectedPlatforms(i))
          .order("display_order");
        setGuidance(g || []);
      }
    }
    if (!docsRes.error) setDocs(docsRes.data || []);
    if (!valRes.error) setValidations(valRes.data || []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleCompact = () => {
    setCompact((c) => {
      try {
        localStorage.setItem(COMPACT_KEY, c ? "0" : "1");
      } catch {
        /* per-viewer convenience only */
      }
      return !c;
    });
  };

  /** Writes a partial update and confirms the row really changed (RLS can match 0 rows silently). */
  const writeIntake = async (patch: { status?: string; admin_notes?: string }) => {
    const { data, error } = await supabase.from("seller_intakes").update(patch).eq("id", id!).select("id, status, admin_notes, updated_at");
    if (error || !data?.length) {
      return { ok: false as const, message: error?.message ?? "No rows were changed. Your account may not have edit permission." };
    }
    return { ok: true as const, row: data[0] };
  };

  const changeStatus = async (next: string) => {
    if (!intake || next === intake.status) return;
    const previous = intake.status;
    setIntake({ ...intake, status: next });
    setBusy("status");
    const res = await writeIntake({ status: next });
    setBusy(null);
    if (!res.ok) {
      setIntake((cur: any) => (cur ? { ...cur, status: previous } : cur));
      toast({ title: "Status not changed", description: res.message, variant: "destructive" });
      return;
    }
    setIntake((cur: any) => (cur ? { ...cur, ...res.row } : cur));
    toast({ title: `Status set to “${next}”` });
  };

  const saveNotes = async () => {
    setBusy("notes");
    const res = await writeIntake({ admin_notes: notes });
    setBusy(null);
    if (!res.ok) {
      toast({ title: "Notes not saved", description: res.message, variant: "destructive" });
      return;
    }
    setIntake((cur: any) => (cur ? { ...cur, ...res.row } : cur));
    toast({ title: "Notes saved" });
  };

  const handleDelete = async () => {
    // Documents and validations cascade via FK; `.select` confirms the row was really removed.
    setBusy("delete");
    // Remove the uploaded ID scans from storage first; the FK cascade only removes the document rows.
    const { data: docRows, error: docErr } = await supabase.from("intake_documents").select("file_path").eq("intake_id", id!);
    const paths = (docRows ?? []).map((d) => d.file_path).filter(Boolean);
    if (docErr || paths.length) {
      const fileErr = docErr ?? (await supabase.storage.from("intake-documents").remove(paths)).error;
      if (fileErr) {
        setBusy(null);
        toast({ title: "Couldn't delete", description: `The uploaded documents couldn't be removed, so nothing was deleted. ${fileErr.message}`, variant: "destructive" });
        setShowDeleteConfirm(false);
        return;
      }
    }
    const { data, error } = await supabase.from("seller_intakes").delete().eq("id", id!).select("id");
    setBusy(null);
    if (error || !data?.length) {
      toast({
        title: "Couldn't delete",
        description: error?.message ?? "Nothing was removed. Your account may not have delete permission.",
        variant: "destructive",
      });
      setShowDeleteConfirm(false);
      return;
    }
    toast({ title: "Submission deleted" });
    setShowDeleteConfirm(false);
    navigate("/admin/submissions");
  };

  const runValidation = async () => {
    setBusy("validate");
    const { data, error } = await supabase.functions.invoke("validate-intake", { body: { intake_id: id } });
    setBusy(null);
    if (error || !data?.success) {
      let detail = error?.message ?? "The validator did not return a result.";
      try {
        const body = await (error as any)?.context?.json?.();
        if (body?.error) detail = body.error;
      } catch {
        /* keep generic message */
      }
      toast({ title: "Validation failed to run", description: `${detail} Try again in a moment.`, variant: "destructive" });
      return;
    }
    toast({
      title: data.total === 0 ? "Validation passed" : "Validation complete",
      description:
        data.total === 0
          ? "No issues found."
          : `${data.errors} error${data.errors === 1 ? "" : "s"}, ${data.warnings} warning${data.warnings === 1 ? "" : "s"}.`,
    });
    loadData();
  };

  const resolveValidation = async (vid: string) => {
    setResolvingId(vid);
    const { data, error } = await supabase
      .from("intake_validations")
      .update({ resolved: true, resolved_notes: "Resolved by admin" })
      .eq("id", vid)
      .select("id, resolved, resolved_notes");
    setResolvingId(null);
    if (error || !data?.length) {
      toast({ title: "Couldn't mark resolved", description: error?.message ?? "No rows were changed.", variant: "destructive" });
      return;
    }
    setValidations((prev) => prev.map((v) => (v.id === vid ? { ...v, ...data[0] } : v)));
    toast({ title: "Marked resolved" });
  };

  const openDoc = async (doc: any) => {
    // Open the tab synchronously so the popup blocker sees a user gesture, then point it at the signed URL.
    const win = window.open("", "_blank");
    const { data, error } = await supabase.storage.from("intake-documents").createSignedUrl(doc.file_path, 3600);
    if (error || !data?.signedUrl) {
      win?.close();
      toast({ title: `Couldn't open ${doc.file_name}`, description: error?.message ?? "No link was returned.", variant: "destructive" });
      return;
    }
    if (win) {
      win.opener = null;
      win.location.href = data.signedUrl;
    } else {
      window.location.assign(data.signedUrl);
    }
  };

  const downloadAllDocs = async () => {
    setBusy("download");
    const { data, error } = await supabase.storage
      .from("intake-documents")
      .createSignedUrls(docs.map((d) => d.file_path), 3600, { download: true });
    setBusy(null);
    const urls = (data ?? []).filter((d) => d.signedUrl && !d.error);
    if (error || urls.length === 0) {
      toast({ title: "Couldn't prepare downloads", description: error?.message ?? "No download links were returned.", variant: "destructive" });
      return;
    }
    // Attachment links download in place, so no popups are needed.
    urls.forEach((u, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = u.signedUrl;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 400);
    });
    toast({
      title: `Downloading ${urls.length} file${urls.length === 1 ? "" : "s"}`,
      description: urls.length < docs.length ? `${docs.length - urls.length} file(s) could not be found in storage.` : "Your browser may ask to allow multiple downloads.",
    });
  };

  if (loading) {
    return (
      <div className="space-y-4 max-w-4xl" aria-busy="true">
        <Skeleton className="h-9 w-24 bg-white/[0.05]" />
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <Skeleton className="h-8 w-64 bg-white/[0.05]" />
            <Skeleton className="h-5 w-40 mt-2 bg-white/[0.05]" />
          </div>
          <Skeleton className="h-9 w-72 bg-white/[0.05]" />
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14 rounded-2xl bg-white/[0.03]" />
        ))}
      </div>
    );
  }

  if (!intake) {
    return (
      <div className="max-w-4xl space-y-4">
        {loadError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-300" aria-hidden />
            <p className="text-sm text-red-200 flex-1">Couldn't load this submission: {loadError}</p>
            <Button size="sm" variant="outline" className="h-9 border-red-400/30 text-red-100" onClick={() => loadData()}>Retry</Button>
          </div>
        ) : (
          <EmptyState
            icon={FileText}
            title="Submission not found"
            description="It may have been deleted, or the link is wrong."
            action={<Button asChild variant="outline" size="sm" className="h-9 border-white/10"><Link to="/admin/submissions">Back to submissions</Link></Button>}
          />
        )}
      </div>
    );
  }

  const platforms = getSelectedPlatforms(intake);
  const hasAmazon = platforms.includes("Amazon");
  const hasShopify = platforms.includes("Shopify");
  const hasTikTok = platforms.includes("TikTok");
  const openValidations = validations.filter((v) => !v.resolved);
  const notesDirty = notes !== (intake.admin_notes || "");

  return (
    <div className="space-y-4 max-w-4xl">
      <Button asChild variant="ghost" size="sm" className="h-9 -ml-2 text-white/70 hover:text-white hover:bg-white/5">
        <Link to="/admin/submissions"><ArrowLeft className="h-4 w-4 mr-1" aria-hidden /> Submissions</Link>
      </Button>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden />
          <p className="text-sm text-amber-100 flex-1">Some details didn't refresh: {loadError}</p>
          <Button size="sm" variant="outline" className="h-9 border-amber-400/30 text-amber-100" onClick={() => loadData()}>Retry</Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-normal text-white leading-tight break-words">
            {intake.business_legal_name || "Unnamed submission"}
          </h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {platforms.map((p: string) => (
              <Badge key={p} variant="outline" className="text-xs border-white/10 text-white/70">{p}</Badge>
            ))}
            <span className="text-xs text-white/55">Updated {formatDate(intake.updated_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Select value={intake.status} onValueChange={changeStatus} disabled={busy === "status"}>
              <SelectTrigger className="w-44 h-9" aria-label="Submission status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            {busy === "status" && <Loader2 className="absolute right-9 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-white/60" aria-label="Saving status" />}
          </div>
          <Button onClick={runValidation} size="sm" className="h-9" disabled={busy === "validate"}>
            {busy === "validate" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <Play className="h-4 w-4 mr-1.5" aria-hidden />}
            {busy === "validate" ? "Validating…" : "Run validation"}
          </Button>
          <ActionMenu
            label="More submission actions"
            items={[
              ...(docs.length > 0
                ? [{ label: `Download all documents (${docs.length})`, icon: Download, group: "Documents", onSelect: downloadAllDocs, disabled: busy === "download" }]
                : []),
              { label: compact ? "Comfortable view" : "Compact view", icon: compact ? Maximize2 : Minimize2, group: "View", onSelect: toggleCompact },
              { label: "Reload", icon: RefreshCw, group: "View", onSelect: () => loadData() },
              { label: "Delete submission…", icon: Trash2, destructive: true, onSelect: () => setShowDeleteConfirm(true) },
            ]}
          />
        </div>
      </div>

      <Section title="Client contact" defaultOpen compact={compact}>
        <CopyField label="Name" value={intake.client_name} />
        <CopyField label="Email" value={intake.client_email} />
        <CopyField label="Phone" value={intake.client_phone ? formatPhone(intake.client_phone) : null} />
        <Field label="Preferred contact" value={intake.preferred_contact_method} />
        <Field label="Timezone" value={intake.client_timezone} />
      </Section>

      <Section title="Business information" compact={compact}>
        <CopyField label="Legal name" value={intake.business_legal_name} />
        <Field label="Business type" value={intake.business_type} />
        <Field label="State of registration" value={intake.state_of_registration} />
        <CopyField label="EIN" value={intake.ein} />
        <CopyField label="Business phone" value={intake.business_phone ? formatPhone(intake.business_phone) : null} />
        <CopyField label="Business email" value={intake.business_email} />
        <Field label="Business website" value={intake.business_website} />
        <Field label="Years in business" value={intake.years_in_business} />
        <Field label="Registered agent" value={intake.registered_agent_service} />
        <CopyField label="Agent address" value={formatAddress(intake.registered_agent_address, intake.registered_agent_city, intake.registered_agent_state, intake.registered_agent_zip)} />
        {intake.addresses_differ && (
          <CopyField label="Operating address" value={formatAddress(intake.operating_address, intake.operating_city, intake.operating_state, intake.operating_zip)} />
        )}
      </Section>

      <Section title="Owner / contact" compact={compact}>
        <CopyField label="Full name" value={[intake.contact_first_name, intake.contact_middle_name, intake.contact_last_name].filter(Boolean).join(" ")} />
        <Field label="Title / role" value={intake.owner_title} />
        <Field label="Ownership" value={intake.ownership_percentage ? `${intake.ownership_percentage}%` : null} />
        <Field label="Date of birth" value={formatDate(intake.date_of_birth)} />
        <Field label="Citizenship" value={intake.citizenship_country} />
        <Field label="Birth country" value={intake.birth_country} />
        <CopyField label="SSN / ITIN" value={intake.ssn_itin} masked />
        <Field label="Tax residency" value={intake.tax_residency} />
        <Field label="ID type" value={intake.id_type} />
        <CopyField label="ID number" value={intake.id_number} masked />
        <Field label="ID expiry" value={formatDate(intake.id_expiry_date)} />
        <CopyField label="Residential address" value={formatAddress(intake.residential_address, intake.residential_city, intake.residential_state, intake.residential_zip)} />
        <CopyField label="Phone" value={intake.phone_number ? formatPhone(intake.phone_number) : null} />
        <SubSection label="Authorization">
          <Field label="Set up by rep" value={intake.setup_by_representative ? "Yes" : "No"} />
          {intake.setup_by_representative && (
            <>
              <CopyField label="Rep name" value={intake.rep_name} />
              <Field label="Relationship" value={intake.rep_relationship} />
            </>
          )}
        </SubSection>
      </Section>

      <Section title="Bank & payment" compact={compact}>
        <SubSection label="Primary bank account">
          <CopyField label="Bank name" value={intake.bank_name} />
          <CopyField label="Account holder" value={intake.account_holder_name} />
          <CopyField label="Account last 4" value={intake.account_number_last4} />
          <CopyField label="Routing last 4" value={intake.routing_number_last4} />
          <Field label="Account type" value={intake.account_type} />
          <Field label="US bank" value={intake.is_us_bank === false ? "No (international)" : "Yes"} />
          {intake.is_us_bank === false && (
            <>
              <CopyField label="IBAN" value={intake.iban} />
              <CopyField label="SWIFT / BIC" value={intake.swift_bic} />
              <Field label="Bank country" value={intake.bank_country} />
            </>
          )}
          <CopyField label="Bank email" value={intake.bank_email} />
        </SubSection>

        {intake.same_bank_all_platforms === false && (
          <>
            {hasShopify && (
              <SubSection label="Shopify bank account">
                <CopyField label="Bank name" value={intake.shopify_bank_name} />
                <CopyField label="Account holder" value={intake.shopify_account_holder} />
                <CopyField label="Account last 4" value={intake.shopify_account_last4} />
                <CopyField label="Routing last 4" value={intake.shopify_routing_last4} />
                <Field label="Account type" value={intake.shopify_account_type} />
              </SubSection>
            )}
            {hasTikTok && (
              <SubSection label="TikTok bank account">
                <CopyField label="Bank name" value={intake.tiktok_bank_name} />
                <CopyField label="Account holder" value={intake.tiktok_account_holder} />
                <CopyField label="Account last 4" value={intake.tiktok_account_last4} />
                <CopyField label="Routing last 4" value={intake.tiktok_routing_last4} />
                <Field label="Account type" value={intake.tiktok_account_type} />
                <CopyField label="Bank email" value={intake.tiktok_bank_email} />
              </SubSection>
            )}
          </>
        )}

        <SubSection label="Payment card">
          <CopyField label="Card holder" value={intake.card_holder_name} />
          <Field label="Card last 4" value={intake.credit_card_last4} />
          <Field label="Card expiry" value={intake.credit_card_expiry} />
        </SubSection>
      </Section>

      <Section title="Brand & accounts" compact={compact}>
        <Field label="Owns brand" value={intake.owns_brand ? "Yes" : "No"} />
        <CopyField label="Brand name" value={intake.brand_name} />
        <Field label="Has trademark" value={intake.has_trademark ? "Yes" : "No"} />
        <CopyField label="Trademark #" value={intake.trademark_number} />
        <Field label="Brand Registry" value={intake.brand_registry_enrolled ? "Enrolled" : "No"} />
        <Field label="Diversity certs" value={intake.has_diversity_certs ? "Yes" : "No"} />
        <Field label="Description" value={intake.product_description} />

        {hasAmazon && (
          <SubSection label="Amazon">
            <Field label="Existing account" value={intake.has_existing_amazon_account ? "Yes" : "No"} />
            <CopyField label="Store name" value={intake.amazon_store_name} />
            <CopyField label="Email" value={intake.amazon_email} />
            <CopyField label="Phone" value={intake.amazon_phone ? formatPhone(intake.amazon_phone) : null} />
            <Field label="Seller plan" value={intake.seller_plan} />
            <Field label="Target marketplace" value={intake.target_amazon_marketplace} />
            <Field label="Product category" value={intake.product_category} />
            <Field label="# products" value={intake.number_of_products} />
            <Field label="Fulfillment" value={intake.fulfillment_method} />
            <Field label="FBA warehousing" value={intake.plan_fba_warehousing ? "Yes" : "No"} />
            <Field label="Has UPCs" value={intake.has_upcs ? "Yes" : "No"} />
            <Field label="Existing listings" value={intake.has_existing_amazon_listings ? "Yes" : "No"} />
          </SubSection>
        )}

        {hasShopify && (
          <SubSection label="Shopify">
            <Field label="Existing account" value={intake.has_existing_shopify_account ? "Yes" : "No"} />
            <CopyField label="Store name" value={intake.shopify_store_name} />
            <CopyField label="Email" value={intake.shopify_email} />
            <CopyField label="Phone" value={intake.shopify_phone ? formatPhone(intake.shopify_phone) : null} />
            <Field label="Plan" value={intake.shopify_plan} />
            <CopyField label="Domain" value={intake.shopify_domain} />
            <Field label="Has domain" value={intake.shopify_has_domain ? "Yes" : "No"} />
            <CopyField label="Preferred domain" value={intake.shopify_preferred_domain} />
            <Field label="Has logo" value={intake.shopify_has_logo ? "Yes" : "No"} />
            <Field label="Theme style" value={intake.shopify_theme_style} />
            <Field label="Shipping method" value={intake.shipping_method} />
            <Field label="Payment gateway" value={intake.shopify_payment_gateway} />
            <Field label="Product description" value={intake.shopify_product_description} />
          </SubSection>
        )}

        {hasTikTok && (
          <SubSection label="TikTok">
            <Field label="Existing account" value={intake.has_existing_tiktok_account ? "Yes" : "No"} />
            <CopyField label="Shop name" value={intake.tiktok_shop_name} />
            <CopyField label="Email" value={intake.tiktok_email} />
            <CopyField label="Phone" value={intake.tiktok_phone ? formatPhone(intake.tiktok_phone) : null} />
            <CopyField label="Handle" value={intake.tiktok_handle} />
            <Field label="Category" value={intake.tiktok_category} />
            <Field label="Fulfillment" value={intake.tiktok_fulfillment} />
            <Field label="Creator account" value={intake.has_tiktok_creator ? "Yes" : "No"} />
            <Field label="Existing content" value={intake.tiktok_has_existing_content ? "Yes" : "No"} />
            <Field label="Followers" value={intake.tiktok_follower_count} />
            <Field label="Price range" value={intake.tiktok_price_range} />
            <Field label="Product description" value={intake.tiktok_product_description} />
            <CopyField label="Warehouse address" value={formatAddress(intake.tiktok_warehouse_address, intake.tiktok_warehouse_city, intake.tiktok_warehouse_state, intake.tiktok_warehouse_zip)} />
          </SubSection>
        )}
      </Section>

      <Section
        title="Documents"
        compact={compact}
        badge={<Badge variant="outline" className="text-xs border-white/10 text-white/70 tabular-nums">{docs.length}</Badge>}
      >
        {docs.length === 0 ? (
          <p className="text-sm text-white/60">No documents uploaded yet.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-2 p-2 pl-3 rounded-xl border border-white/[0.06]">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{doc.file_name}</p>
                  <p className="text-xs text-white/55">
                    {doc.document_type}{doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(0)} KB` : ""}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-white/70 hover:text-white hover:bg-white/5"
                      aria-label={`Open ${doc.file_name}`}
                      onClick={() => openDoc(doc)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open in new tab</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {intake.special_instructions && (
        <Section title="Special instructions" defaultOpen compact={compact}>
          <p className="text-sm text-white whitespace-pre-wrap">{intake.special_instructions}</p>
        </Section>
      )}

      <Section
        title="Validation"
        compact={compact}
        defaultOpen={openValidations.length > 0}
        badge={
          openValidations.length > 0 ? (
            <Badge variant="outline" className="text-xs border-amber-400/30 text-amber-300 tabular-nums">{openValidations.length} open</Badge>
          ) : undefined
        }
      >
        {validations.length === 0 ? (
          <p className="text-sm text-white/60">No issues recorded. Use “Run validation” to check this submission.</p>
        ) : (
          <ul className="space-y-2">
            {validations.map((v) => (
              <li key={v.id} className={cn("p-3 rounded-xl border border-white/[0.06]", v.resolved && "opacity-60")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Badge
                      variant="outline"
                      className={cn(
                        "mb-1 text-xs capitalize",
                        v.severity === "error" ? "border-red-400/30 text-red-300" : "border-amber-400/30 text-amber-300",
                      )}
                    >
                      {v.severity === "error" ? <AlertTriangle className="h-3 w-3 mr-1" aria-hidden /> : null}
                      {v.severity}
                    </Badge>
                    <p className="text-sm text-white">{v.message}</p>
                    <p className="text-xs text-white/55">Field: {v.field_name}</p>
                    {v.resolved && (
                      <p className="text-xs text-emerald-300/90 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" aria-hidden /> {v.resolved_notes || "Resolved"}
                      </p>
                    )}
                  </div>
                  {!v.resolved && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 border-white/10"
                      disabled={resolvingId === v.id}
                      onClick={() => resolveValidation(v.id)}
                    >
                      {resolvingId === v.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Mark resolved"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Operator guide" compact={compact}>
        {guidance.length === 0 ? (
          <p className="text-sm text-white/60">
            No guidance for {platforms.join(", ")} yet. Add entries in <Link to="/admin/guide" className="underline underline-offset-2 text-white">Setup Guide</Link>.
          </p>
        ) : (
          <div className="space-y-3">
            {guidance.map((g) => (
              <div key={g.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs border-white/10 text-white/70">{g.platform}</Badge>
                  <p className="text-sm font-medium text-white">{g.field_name}</p>
                </div>
                <p className="text-sm text-white/70">{g.guidance_text}</p>
                {g.answer_recommendation && (
                  <p className="text-sm mt-1 text-white/80"><span className="font-medium text-white">Recommended:</span> {g.answer_recommendation}</p>
                )}
                {g.reason && <p className="text-xs text-white/55 mt-1">Why: {g.reason}</p>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Admin notes" defaultOpen compact={compact}>
        <label htmlFor="admin-notes" className="sr-only">Admin notes</label>
        <Textarea
          id="admin-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes about this submission"
          rows={4}
        />
        <div className="flex items-center justify-end gap-3 mt-2">
          {notesDirty && <span className="text-xs text-white/55">Unsaved changes</span>}
          <Button onClick={saveNotes} size="sm" className="h-9" disabled={!notesDirty || busy === "notes"}>
            {busy === "notes" ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> Saving…</> : "Save notes"}
          </Button>
        </div>
      </Section>

      <AlertDialog open={showDeleteConfirm} onOpenChange={(o) => { if (busy !== "delete") setShowDeleteConfirm(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this submission?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “{intake.business_legal_name || "Unnamed"}” with its documents and validation results.
              This can't be undone. To keep a record, set the status to Archived instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "delete"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy === "delete"}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
            >
              {busy === "delete" ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> Deleting…</> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

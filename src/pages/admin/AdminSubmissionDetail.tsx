import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ChevronDown, Copy, Download, Play, Check, Minimize2, Maximize2 } from "lucide-react";

const STATUSES = ["Draft", "Submitted", "In Review", "Issues Flagged", "Approved"];

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
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
  const display = value || "—";
  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-1.5 group">
      <span className="text-sm font-medium text-muted-foreground w-36 sm:w-48 shrink-0">{label}</span>
      <span className="text-sm text-foreground flex items-center gap-1.5">
        {masked && value ? `***${value.slice(-4)}` : display}
        {value && (
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted"
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
          </button>
        )}
      </span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-1.5">
      <span className="text-sm font-medium text-muted-foreground w-36 sm:w-48 shrink-0">{label}</span>
      <span className="text-sm text-foreground">{value || "—"}</span>
    </div>
  );
}

function Section({ title, defaultOpen, compact, children }: { title: string; defaultOpen?: boolean; compact?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className={`cursor-pointer hover:bg-muted/50 transition-colors ${compact ? "py-2 px-3" : ""}`}>
            <div className="flex items-center justify-between">
              <CardTitle className={compact ? "text-sm" : "text-base"}>{title}</CardTitle>
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className={`pt-0 ${compact ? "px-3 pb-3 text-xs" : ""}`}>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function SubSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
      {children}
    </div>
  );
}

function getSelectedPlatforms(intake: any): string[] {
  if (intake.selected_platforms && intake.selected_platforms.length > 0) {
    return intake.selected_platforms;
  }
  return [intake.platform || "Amazon"];
}

function formatAddress(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(", ") || "—";
}

export default function AdminSubmissionDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [intake, setIntake] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [validations, setValidations] = useState<any[]>([]);
  const [guidance, setGuidance] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (id) loadData();
  }, [id]);

  const loadData = async () => {
    const [{ data: i }, { data: d }, { data: v }] = await Promise.all([
      supabase.from("seller_intakes").select("*").eq("id", id!).single(),
      supabase.from("intake_documents").select("*").eq("intake_id", id!),
      supabase.from("intake_validations").select("*").eq("intake_id", id!).order("created_at"),
    ]);
    if (i) {
      setIntake(i);
      setStatus(i.status);
      setNotes(i.admin_notes || "");
      const platforms = getSelectedPlatforms(i);
      const { data: g } = await supabase
        .from("setup_guidance")
        .select("*")
        .in("platform", platforms)
        .order("display_order");
      setGuidance(g || []);
    }
    setDocs(d || []);
    setValidations(v || []);
    setLoading(false);
  };

  const saveStatus = async () => {
    await supabase.from("seller_intakes").update({ status, admin_notes: notes }).eq("id", id!);
    toast({ title: "Saved", description: "Status and notes updated." });
    loadData();
  };

  const runValidation = async () => {
    try {
      const { error } = await supabase.functions.invoke("validate-intake", { body: { intake_id: id } });
      if (error) throw error;
      toast({ title: "Validation Complete" });
      loadData();
    } catch {
      toast({ title: "Validation Error", variant: "destructive" });
    }
  };

  const resolveValidation = async (vid: string, resolvedNotes: string) => {
    await supabase.from("intake_validations").update({ resolved: true, resolved_notes: resolvedNotes }).eq("id", vid);
    loadData();
  };

  const downloadAllDocs = async () => {
    for (const doc of docs) {
      const { data } = await supabase.storage.from("intake-documents").createSignedUrl(doc.file_path, 3600);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!intake) {
    return <div className="text-center py-20 text-muted-foreground">Submission not found.</div>;
  }

  const platforms = getSelectedPlatforms(intake);
  const hasAmazon = platforms.includes("Amazon");
  const hasShopify = platforms.includes("Shopify");
  const hasTikTok = platforms.includes("TikTok");

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <Link to="/admin/submissions">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Compact</span>
          <Switch checked={compact} onCheckedChange={setCompact} />
          {compact ? <Minimize2 className="h-3 w-3 text-muted-foreground" /> : <Maximize2 className="h-3 w-3 text-muted-foreground" />}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{intake.business_legal_name || "Unnamed Submission"}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-muted-foreground text-sm">Platforms:</span>
            {platforms.map((p: string) => (
              <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={saveStatus} size="sm">Save</Button>
          <Button onClick={runValidation} variant="outline" size="sm">
            <Play className="h-3 w-3 mr-1" /> Validate
          </Button>
        </div>
      </div>

      <Section title="Client Contact" defaultOpen compact={compact}>
        <CopyField label="Name" value={intake.client_name} />
        <CopyField label="Email" value={intake.client_email} />
        <CopyField label="Phone" value={formatPhone(intake.client_phone)} />
        <Field label="Preferred Contact" value={intake.preferred_contact_method} />
        <Field label="Timezone" value={intake.client_timezone} />
      </Section>

      <Section title="Business Information" compact={compact}>
        <CopyField label="Legal Name" value={intake.business_legal_name} />
        <Field label="Business Type" value={intake.business_type} />
        <Field label="State of Registration" value={intake.state_of_registration} />
        <CopyField label="EIN" value={intake.ein} />
        <CopyField label="Business Phone" value={formatPhone(intake.business_phone)} />
        <CopyField label="Business Email" value={intake.business_email} />
        <Field label="Business Website" value={intake.business_website} />
        <Field label="Years in Business" value={intake.years_in_business} />
        <Field label="Registered Agent" value={intake.registered_agent_service} />
        <CopyField label="Agent Address" value={formatAddress(intake.registered_agent_address, intake.registered_agent_city, intake.registered_agent_state, intake.registered_agent_zip)} />
        {intake.addresses_differ && (
          <CopyField label="Operating Address" value={formatAddress(intake.operating_address, intake.operating_city, intake.operating_state, intake.operating_zip)} />
        )}
      </Section>

      <Section title="Owner / Contact Info" compact={compact}>
        <CopyField label="Full Name" value={[intake.contact_first_name, intake.contact_middle_name, intake.contact_last_name].filter(Boolean).join(" ")} />
        <Field label="Title/Role" value={intake.owner_title} />
        <Field label="Ownership %" value={intake.ownership_percentage ? `${intake.ownership_percentage}%` : null} />
        <Field label="Date of Birth" value={formatDate(intake.date_of_birth)} />
        <Field label="Citizenship" value={intake.citizenship_country} />
        <Field label="Birth Country" value={intake.birth_country} />
        <CopyField label="SSN/ITIN" value={intake.ssn_itin} masked />
        <Field label="Tax Residency" value={intake.tax_residency} />
        <Field label="ID Type" value={intake.id_type} />
        <CopyField label="ID Number" value={intake.id_number} masked />
        <Field label="ID Expiry" value={formatDate(intake.id_expiry_date)} />
        <CopyField label="Residential Address" value={formatAddress(intake.residential_address, intake.residential_city, intake.residential_state, intake.residential_zip)} />
        <CopyField label="Phone" value={formatPhone(intake.phone_number)} />
        <SubSection label="Authorization">
          <Field label="Setup by Rep" value={intake.setup_by_representative ? "Yes" : "No"} />
          {intake.setup_by_representative && (
            <>
              <CopyField label="Rep Name" value={intake.rep_name} />
              <Field label="Relationship" value={intake.rep_relationship} />
            </>
          )}
        </SubSection>
      </Section>

      <Section title="Bank &amp; Payment" compact={compact}>
        <SubSection label="Primary Bank Account">
          <CopyField label="Bank Name" value={intake.bank_name} />
          <CopyField label="Account Holder" value={intake.account_holder_name} />
          <CopyField label="Account Last 4" value={intake.account_number_last4} />
          <CopyField label="Routing Last 4" value={intake.routing_number_last4} />
          <Field label="Account Type" value={intake.account_type} />
          <Field label="US Bank" value={intake.is_us_bank === false ? "No (International)" : "Yes"} />
          {intake.is_us_bank === false && (
            <>
              <CopyField label="IBAN" value={intake.iban} />
              <CopyField label="SWIFT/BIC" value={intake.swift_bic} />
              <Field label="Bank Country" value={intake.bank_country} />
            </>
          )}
          <CopyField label="Bank Email" value={intake.bank_email} />
        </SubSection>

        {intake.same_bank_all_platforms === false && (
          <>
            {hasShopify && (
              <SubSection label="Shopify Bank Account">
                <CopyField label="Bank Name" value={intake.shopify_bank_name} />
                <CopyField label="Account Holder" value={intake.shopify_account_holder} />
                <CopyField label="Account Last 4" value={intake.shopify_account_last4} />
                <CopyField label="Routing Last 4" value={intake.shopify_routing_last4} />
                <Field label="Account Type" value={intake.shopify_account_type} />
              </SubSection>
            )}
            {hasTikTok && (
              <SubSection label="TikTok Bank Account">
                <CopyField label="Bank Name" value={intake.tiktok_bank_name} />
                <CopyField label="Account Holder" value={intake.tiktok_account_holder} />
                <CopyField label="Account Last 4" value={intake.tiktok_account_last4} />
                <CopyField label="Routing Last 4" value={intake.tiktok_routing_last4} />
                <Field label="Account Type" value={intake.tiktok_account_type} />
                <CopyField label="Bank Email" value={intake.tiktok_bank_email} />
              </SubSection>
            )}
          </>
        )}

        <SubSection label="Payment Card">
          <CopyField label="Card Holder" value={intake.card_holder_name} />
          <Field label="Card Last 4" value={intake.credit_card_last4} />
          <Field label="Card Expiry" value={intake.credit_card_expiry} />
        </SubSection>
      </Section>

      <Section title="Brand &amp; Accounts" compact={compact}>
        <Field label="Owns Brand" value={intake.owns_brand ? "Yes" : "No"} />
        <CopyField label="Brand Name" value={intake.brand_name} />
        <Field label="Has Trademark" value={intake.has_trademark ? "Yes" : "No"} />
        <CopyField label="Trademark #" value={intake.trademark_number} />
        <Field label="Brand Registry" value={intake.brand_registry_enrolled ? "Enrolled" : "No"} />
        <Field label="Has Diversity Certs" value={intake.has_diversity_certs ? "Yes" : "No"} />
        <Field label="Description" value={intake.product_description} />

        {hasAmazon && (
          <SubSection label="Amazon">
            <Field label="Existing Account" value={intake.has_existing_amazon_account ? "Yes" : "No"} />
            <CopyField label="Store Name" value={intake.amazon_store_name} />
            <CopyField label="Email" value={intake.amazon_email} />
            <CopyField label="Phone" value={formatPhone(intake.amazon_phone)} />
            <Field label="Seller Plan" value={intake.seller_plan} />
            <Field label="Target Marketplace" value={intake.target_amazon_marketplace} />
            <Field label="Product Category" value={intake.product_category} />
            <Field label="# Products" value={intake.number_of_products} />
            <Field label="Fulfillment" value={intake.fulfillment_method} />
            <Field label="FBA Warehousing" value={intake.plan_fba_warehousing ? "Yes" : "No"} />
            <Field label="Has UPCs" value={intake.has_upcs ? "Yes" : "No"} />
            <Field label="Existing Listings" value={intake.has_existing_amazon_listings ? "Yes" : "No"} />
          </SubSection>
        )}

        {hasShopify && (
          <SubSection label="Shopify">
            <Field label="Existing Account" value={intake.has_existing_shopify_account ? "Yes" : "No"} />
            <CopyField label="Store Name" value={intake.shopify_store_name} />
            <CopyField label="Email" value={intake.shopify_email} />
            <CopyField label="Phone" value={formatPhone(intake.shopify_phone)} />
            <Field label="Plan" value={intake.shopify_plan} />
            <CopyField label="Domain" value={intake.shopify_domain} />
            <Field label="Has Domain" value={intake.shopify_has_domain ? "Yes" : "No"} />
            <CopyField label="Preferred Domain" value={intake.shopify_preferred_domain} />
            <Field label="Has Logo" value={intake.shopify_has_logo ? "Yes" : "No"} />
            <Field label="Theme Style" value={intake.shopify_theme_style} />
            <Field label="Shipping Method" value={intake.shipping_method} />
            <Field label="Payment Gateway" value={intake.shopify_payment_gateway} />
            <Field label="Product Description" value={intake.shopify_product_description} />
          </SubSection>
        )}

        {hasTikTok && (
          <SubSection label="TikTok">
            <Field label="Existing Account" value={intake.has_existing_tiktok_account ? "Yes" : "No"} />
            <CopyField label="Shop Name" value={intake.tiktok_shop_name} />
            <CopyField label="Email" value={intake.tiktok_email} />
            <CopyField label="Phone" value={formatPhone(intake.tiktok_phone)} />
            <CopyField label="Handle" value={intake.tiktok_handle} />
            <Field label="Category" value={intake.tiktok_category} />
            <Field label="Fulfillment" value={intake.tiktok_fulfillment} />
            <Field label="Has Creator Account" value={intake.has_tiktok_creator ? "Yes" : "No"} />
            <Field label="Existing Content" value={intake.tiktok_has_existing_content ? "Yes" : "No"} />
            <Field label="Followers" value={intake.tiktok_follower_count} />
            <Field label="Price Range" value={intake.tiktok_price_range} />
            <Field label="Product Description" value={intake.tiktok_product_description} />
            <CopyField label="Warehouse Address" value={formatAddress(intake.tiktok_warehouse_address, intake.tiktok_warehouse_city, intake.tiktok_warehouse_state, intake.tiktok_warehouse_zip)} />
          </SubSection>
        )}
      </Section>

      <Section title={`Documents (${docs.length})`} compact={compact}>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents uploaded.</p>
        ) : (
          <>
            {docs.length > 1 && (
              <Button variant="outline" size="sm" className="mb-3" onClick={downloadAllDocs}>
                <Download className="h-3 w-3 mr-1" /> Download All ({docs.length})
              </Button>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {docs.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-2 rounded-md border">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{doc.file_name}</p>
                    <p className="text-xs text-muted-foreground">{doc.document_type} {doc.file_size ? `\u00b7 ${(doc.file_size / 1024).toFixed(0)}KB` : ""}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const { data } = await supabase.storage.from("intake-documents").createSignedUrl(doc.file_path, 3600);
                      if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                    }}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {intake.special_instructions && (
        <Section title="Special Instructions" defaultOpen compact={compact}>
          <p className="text-sm text-foreground whitespace-pre-wrap">{intake.special_instructions}</p>
        </Section>
      )}

      <Section title={`Validation Warnings (${validations.filter((v) => !v.resolved).length})`} compact={compact}>
        {validations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No validation issues.</p>
        ) : (
          <div className="space-y-2">
            {validations.map((v) => (
              <div key={v.id} className={`p-3 rounded-md border ${v.resolved ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <Badge variant={v.severity === "error" ? "destructive" : "secondary"} className="mb-1">
                      {v.severity}
                    </Badge>
                    <p className="text-sm text-foreground">{v.message}</p>
                    <p className="text-xs text-muted-foreground">Field: {v.field_name}</p>
                  </div>
                  {!v.resolved && (
                    <Button size="sm" variant="outline" onClick={() => resolveValidation(v.id, "Resolved by admin")}>
                      Resolve
                    </Button>
                  )}
                </div>
                {v.resolved && <p className="text-xs text-muted-foreground mt-1">&#x2713; {v.resolved_notes}</p>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Operator Guide" compact={compact}>
        {guidance.length === 0 ? (
          <p className="text-sm text-muted-foreground">No guidance entries.</p>
        ) : (
          <div className="space-y-3">
            {guidance.map((g) => (
              <div key={g.id} className="p-3 rounded-md bg-muted/50 border">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px]">{g.platform}</Badge>
                  <p className="text-sm font-medium text-foreground">{g.field_name}</p>
                </div>
                <p className="text-sm text-muted-foreground">{g.guidance_text}</p>
                {g.answer_recommendation && (
                  <p className="text-sm mt-1"><span className="font-medium">Recommended:</span> {g.answer_recommendation}</p>
                )}
                {g.reason && <p className="text-xs text-muted-foreground mt-1">Why: {g.reason}</p>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Admin Notes" defaultOpen compact={compact}>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes about this submission..."
          rows={4}
        />
        <Button onClick={saveStatus} size="sm" className="mt-2">Save Notes</Button>
      </Section>
    </div>
  );
}

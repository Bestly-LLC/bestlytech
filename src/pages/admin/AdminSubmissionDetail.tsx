import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ChevronDown, Copy, Download, Play } from "lucide-react";

const STATUSES = ["Draft", "Submitted", "In Review", "Issues Flagged", "Approved"];

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 py-1.5">
      <span className="text-sm font-medium text-muted-foreground w-48 shrink-0">{label}</span>
      <span className="text-sm text-foreground">{value || "—"}</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  return (
    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigator.clipboard.writeText(text)}>
      <Copy className="h-3 w-3" />
    </Button>
  );
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{title}</CardTitle>
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
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

  useEffect(() => {
    if (id) loadData();
  }, [id]);

  const loadData = async () => {
    const [{ data: i }, { data: d }, { data: v }, { data: g }] = await Promise.all([
      supabase.from("seller_intakes").select("*").eq("id", id!).single(),
      supabase.from("intake_documents").select("*").eq("intake_id", id!),
      supabase.from("intake_validations").select("*").eq("intake_id", id!).order("created_at"),
      supabase.from("setup_guidance").select("*").eq("platform", "Amazon").order("display_order"),
    ]);
    if (i) {
      setIntake(i);
      setStatus(i.status);
      setNotes(i.admin_notes || "");
    }
    setDocs(d || []);
    setValidations(v || []);
    setGuidance(g || []);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!intake) {
    return (
      <div className="text-center py-20 text-muted-foreground">Submission not found.</div>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-4 max-w-4xl">
        <div className="flex items-center gap-3">
          <Link to="/admin/submissions">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{intake.business_legal_name || "Unnamed Submission"}</h1>
            <p className="text-muted-foreground text-sm">ID: {intake.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
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

        <Section title="Client Contact" defaultOpen>
          <Field label="Name" value={intake.client_name} />
          <div className="flex items-center gap-1">
            <Field label="Email" value={intake.client_email} />
            {intake.client_email && <CopyButton text={intake.client_email} />}
          </div>
          <div className="flex items-center gap-1">
            <Field label="Phone" value={intake.client_phone} />
            {intake.client_phone && <CopyButton text={intake.client_phone} />}
          </div>
          <Field label="Preferred Contact" value={intake.preferred_contact_method} />
          <Field label="Timezone" value={intake.client_timezone} />
        </Section>

        <Section title="Business Information">
          <Field label="Legal Name" value={intake.business_legal_name} />
          <Field label="Business Type" value={intake.business_type} />
          <Field label="State of Registration" value={intake.state_of_registration} />
          <Field label="EIN" value={intake.ein} />
          <Field label="Registered Agent" value={intake.registered_agent_service} />
          <Field label="Agent Address" value={`${intake.registered_agent_address || ""} ${intake.registered_agent_city || ""} ${intake.registered_agent_state || ""} ${intake.registered_agent_zip || ""}`.trim() || "—"} />
          {intake.addresses_differ && (
            <Field label="Operating Address" value={`${intake.operating_address || ""} ${intake.operating_city || ""} ${intake.operating_state || ""} ${intake.operating_zip || ""}`.trim()} />
          )}
        </Section>

        <Section title="Owner / Contact Info">
          <Field label="Full Name" value={`${intake.contact_first_name || ""} ${intake.contact_middle_name || ""} ${intake.contact_last_name || ""}`.trim()} />
          <Field label="Date of Birth" value={intake.date_of_birth} />
          <Field label="Citizenship" value={intake.citizenship_country} />
          <Field label="Birth Country" value={intake.birth_country} />
          <Field label="SSN/ITIN" value={intake.ssn_itin ? `***-**-${intake.ssn_itin}` : "—"} />
          <Field label="Tax Residency" value={intake.tax_residency} />
          <Field label="ID Type" value={intake.id_type} />
          <Field label="ID Number" value={intake.id_number ? `***${intake.id_number.slice(-4)}` : "—"} />
          <Field label="ID Expiry" value={intake.id_expiry_date} />
          <Field label="Residential Address" value={`${intake.residential_address || ""} ${intake.residential_city || ""} ${intake.residential_state || ""} ${intake.residential_zip || ""}`.trim()} />
          <Field label="Phone" value={intake.phone_number} />
        </Section>

        <Section title="Bank & Payment">
          <Field label="Bank Name" value={intake.bank_name} />
          <Field label="Account Holder" value={intake.account_holder_name} />
          <Field label="Account Last 4" value={intake.account_number_last4} />
          <Field label="Routing Last 4" value={intake.routing_number_last4} />
          <Field label="Account Type" value={intake.account_type} />
          <Field label="Card Last 4" value={intake.credit_card_last4} />
          <Field label="Card Expiry" value={intake.credit_card_expiry} />
        </Section>

        <Section title="Brand & Product">
          <Field label="Owns Brand" value={intake.owns_brand ? "Yes" : "No"} />
          <Field label="Brand Name" value={intake.brand_name} />
          <Field label="Store Name" value={intake.amazon_store_name} />
          <Field label="Has Trademark" value={intake.has_trademark ? "Yes" : "No"} />
          <Field label="Trademark #" value={intake.trademark_number} />
          <Field label="Product Category" value={intake.product_category} />
          <Field label="# Products" value={intake.number_of_products} />
          <Field label="Fulfillment" value={intake.fulfillment_method} />
          <Field label="Has UPCs" value={intake.has_upcs ? "Yes" : "No"} />
          <Field label="Has Diversity Certs" value={intake.has_diversity_certs ? "Yes" : "No"} />
          <Field label="Description" value={intake.product_description} />
        </Section>

        <Section title="Authorization">
          <Field label="Setup by Rep" value={intake.setup_by_representative ? "Yes" : "No"} />
          {intake.setup_by_representative && (
            <>
              <Field label="Rep Name" value={intake.rep_name} />
              <Field label="Relationship" value={intake.rep_relationship} />
            </>
          )}
        </Section>

        <Section title="Account Details">
          <Field label="Amazon Email" value={intake.amazon_email} />
          <Field label="Amazon Phone" value={intake.amazon_phone} />
          <Field label="Seller Plan" value={intake.seller_plan} />
        </Section>

        <Section title={`Documents (${docs.length})`}>
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded.</p>
          ) : (
            <div className="space-y-2">
              {docs.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-2 rounded-md border">
                  <div>
                    <p className="text-sm font-medium text-foreground">{doc.file_name}</p>
                    <p className="text-xs text-muted-foreground">{doc.document_type} · {doc.file_size ? `${(doc.file_size / 1024).toFixed(0)}KB` : ""}</p>
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
          )}
        </Section>

        <Section title={`Validation Warnings (${validations.filter((v) => !v.resolved).length})`}>
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
                  {v.resolved && <p className="text-xs text-muted-foreground mt-1">✓ {v.resolved_notes}</p>}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Operator Guide">
          {guidance.length === 0 ? (
            <p className="text-sm text-muted-foreground">No guidance entries.</p>
          ) : (
            <div className="space-y-3">
              {guidance.map((g) => (
                <div key={g.id} className="p-3 rounded-md bg-muted/50 border">
                  <p className="text-sm font-medium text-foreground">{g.field_name}</p>
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

        <Section title="Admin Notes" defaultOpen>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes about this submission..."
            rows={4}
          />
          <Button onClick={saveStatus} size="sm" className="mt-2">Save Notes</Button>
        </Section>
      </div>
    </AdminLayout>
  );
}

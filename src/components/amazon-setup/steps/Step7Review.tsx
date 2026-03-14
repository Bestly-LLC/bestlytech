import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Edit, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { DOCUMENT_TYPE_LABELS, US_STATES, COUNTRIES } from '../constants';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const Step7Review = () => {
  const { formData, setCurrentStep, goBack, formId, uploadedDocs, saveNow, setStatus, isPlatformSelected } = useIntakeForm();
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const getStateName = (code: string) => US_STATES.find(s => s.value === code)?.label || code;
  const getCountryName = (code: string) => COUNTRIES.find(c => c.value === code)?.label || code;

  const requiredDocs = ['BusinessRegistration', 'BusinessAddressProof', 'IDFront', 'PersonalAddressProof'];
  if (formData.id_type === 'Drivers License') requiredDocs.push('IDBack');
  if (formData.setup_by_representative) requiredDocs.push('RepID', 'AuthorizationLetter');
  const missingDocs = requiredDocs.filter(d => !uploadedDocs.some(ud => ud.document_type === d));

  const platformNames = formData.selected_platforms.join(', ') || formData.platform;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await saveNow();
      await (supabase as any).from('seller_intakes').update({ status: 'Submitted' }).eq('id', formId);
      setStatus('Submitted');
      setSubmitted(true);
      setShowConfirm(false);
    } catch (e) {
      toast({ title: 'Submission failed', description: 'Please try again', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 mx-auto text-green-500" />
          <h2 className="text-2xl font-bold">Application Submitted!</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            We'll review your information and get started on your {platformNames} setup. You'll hear from us within 1-2 business days.
          </p>
          <p className="text-sm text-muted-foreground">
            If we need anything else, we'll reach out via {formData.preferred_contact_method.toLowerCase()}.
          </p>
        </CardContent>
      </Card>
    );
  }

  const Section = ({ title, step, children }: { title: string; step: number; children: React.ReactNode }) => (
    <Collapsible defaultOpen>
      <div className="border border-border rounded-lg">
        <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-muted/50">
          <span className="font-medium text-sm">{title}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setCurrentStep(step); }}>
              <Edit className="w-3.5 h-3.5 mr-1" /> Edit
            </Button>
            <ChevronDown className="w-4 h-4" />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );

  const Field = ({ label, value }: { label: string; value?: string }) => (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value || '—'}</span>
    </>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review Your Information</CardTitle>
        <CardDescription>Please review all the information below before submitting. Click "Edit" on any section to make changes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {missingDocs.length > 0 && (
          <Alert variant="destructive" className="bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">Missing required documents:</p>
              {missingDocs.map(d => (
                <p key={d} className="text-sm">• {DOCUMENT_TYPE_LABELS[d]}</p>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {/* Shared Sections */}
        <Section title="Client Contact Info" step={0}>
          <Field label="Name" value={formData.client_name} />
          <Field label="Email" value={formData.client_email} />
          <Field label="Phone" value={formData.client_phone} />
          <Field label="Preferred Contact" value={formData.preferred_contact_method} />
          <Field label="Platforms" value={platformNames} />
        </Section>

        <Section title="Business Information" step={1}>
          <Field label="Legal Name" value={formData.business_legal_name} />
          <Field label="Business Type" value={formData.business_type} />
          <Field label="State" value={getStateName(formData.state_of_registration)} />
          <Field label="EIN" value={formData.ein} />
          <Field label="Agent Service" value={formData.registered_agent_service} />
          <Field label="Registered Address" value={`${formData.registered_agent_address}, ${formData.registered_agent_city}, ${getStateName(formData.registered_agent_state)} ${formData.registered_agent_zip}`} />
        </Section>

        <Section title="Owner Information" step={2}>
          <Field label="Name" value={`${formData.contact_first_name} ${formData.contact_middle_name} ${formData.contact_last_name}`.trim()} />
          <Field label="Citizenship" value={getCountryName(formData.citizenship_country)} />
          <Field label="Date of Birth" value={formData.date_of_birth} />
          <Field label="Tax Residency" value={formData.tax_residency} />
          <Field label="SSN/ITIN" value={formData.ssn_itin ? 'Provided' : 'Not provided'} />
          <Field label="ID Type" value={formData.id_type} />
          <Field label="ID Expiry" value={formData.id_expiry_date} />
          <Field label="Phone" value={formData.phone_number} />
          <Field label="Address" value={`${formData.residential_address}, ${formData.residential_city}, ${getStateName(formData.residential_state)} ${formData.residential_zip}`} />
        </Section>

        <Section title="Bank & Payment Details" step={3}>
          <Field label="Bank" value={formData.bank_name} />
          <Field label="Account Holder" value={formData.account_holder_name} />
          <Field label="Account" value={formData.account_number_last4 ? `••••${formData.account_number_last4}` : '—'} />
          <Field label="Routing" value={formData.routing_number_last4 ? `••••${formData.routing_number_last4}` : '—'} />
          <Field label="Type" value={formData.account_type} />
          <Field label="Card" value={formData.credit_card_last4 ? `••••${formData.credit_card_last4}` : '—'} />
          <Field label="Card Expiry" value={formData.credit_card_expiry} />
        </Section>

        {/* Platform-Specific Brand Sections */}
        {isPlatformSelected('Amazon') && (
          <Section title="Amazon — Brand & Products" step={4}>
            <Field label="Store Name" value={formData.amazon_store_name || formData.business_legal_name} />
            <Field label="Has UPCs" value={formData.has_upcs ? 'Yes' : 'No'} />
            <Field label="Diversity Certs" value={formData.has_diversity_certs ? 'Yes' : 'No'} />
            <Field label="Owns Brand" value={formData.owns_brand ? 'Yes' : 'No'} />
            {formData.owns_brand && <Field label="Brand Name" value={formData.brand_name} />}
            {formData.has_trademark && <Field label="Trademark #" value={formData.trademark_number} />}
            <Field label="Category" value={formData.product_category} />
            <Field label="# Products" value={formData.number_of_products} />
            <Field label="Fulfillment" value={formData.fulfillment_method} />
          </Section>
        )}

        {isPlatformSelected('Shopify') && (
          <Section title="Shopify — Store Details" step={4}>
            <Field label="Store Name" value={formData.shopify_store_name} />
            <Field label="Existing Store" value={formData.has_existing_shopify ? formData.existing_shopify_url || 'Yes' : 'No'} />
            <Field label="Plan" value={formData.shopify_plan} />
            <Field label="Domain" value={formData.shopify_domain} />
            <Field label="Shipping" value={formData.shipping_method} />
          </Section>
        )}

        {isPlatformSelected('TikTok') && (
          <Section title="TikTok Shop — Details" step={4}>
            <Field label="Shop Name" value={formData.tiktok_shop_name} />
            <Field label="Handle" value={formData.tiktok_handle} />
            <Field label="Creator Account" value={formData.has_tiktok_creator ? 'Yes' : 'No'} />
            <Field label="Category" value={formData.tiktok_category} />
            <Field label="Fulfillment" value={formData.tiktok_fulfillment} />
          </Section>
        )}

        <Section title="Authorization" step={5}>
          <Field label="Setup by" value={formData.setup_by_representative ? 'Representative' : 'Business Owner'} />
          {formData.setup_by_representative && (
            <>
              <Field label="Rep Name" value={formData.rep_name} />
              <Field label="Relationship" value={formData.rep_relationship} />
            </>
          )}
        </Section>

        {/* Platform-Specific Account Sections */}
        <Section title="Account Details" step={6}>
          {isPlatformSelected('Amazon') && (
            <>
              <span className="col-span-2 text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Amazon</span>
              <Field label="Email" value={formData.amazon_email} />
              <Field label="Phone" value={formData.amazon_phone} />
              <Field label="Plan" value={formData.seller_plan} />
            </>
          )}
          {isPlatformSelected('Shopify') && (
            <>
              <span className="col-span-2 text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">Shopify</span>
              <Field label="Email" value={formData.shopify_email} />
              <Field label="Plan" value={formData.shopify_plan} />
            </>
          )}
          {isPlatformSelected('TikTok') && (
            <>
              <span className="col-span-2 text-xs font-medium text-muted-foreground uppercase tracking-wide pt-1">TikTok</span>
              <Field label="Email" value={formData.tiktok_email} />
              <Field label="Phone" value={formData.tiktok_phone} />
              <Field label="Handle" value={formData.tiktok_handle} />
            </>
          )}
        </Section>

        <div className="border border-border rounded-lg p-4">
          <h3 className="font-medium text-sm mb-3">Documents ({uploadedDocs.length})</h3>
          {uploadedDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
          ) : (
            <div className="space-y-2">
              {uploadedDocs.map(doc => (
                <div key={doc.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}</Badge>
                    <span className="truncate max-w-[200px]">{doc.file_name}</span>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={goBack}>← Back</Button>
        <Button onClick={() => setShowConfirm(true)} disabled={missingDocs.length > 0}>
          Submit Application
        </Button>
      </CardFooter>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ready to submit?</DialogTitle>
            <DialogDescription>
              Once submitted, our team will review your information and begin setup for {platformNames}. You'll be notified of any issues or when setup is complete.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting...' : 'Confirm & Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

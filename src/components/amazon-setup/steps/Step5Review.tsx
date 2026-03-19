import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Edit, CheckCircle2, AlertTriangle, Save, X } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { DOCUMENT_TYPE_LABELS, US_STATES, COUNTRIES, formatPhone, formatDate } from '../constants';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const Step5Review = () => {
  const { formData, updateField, goBack, formId, uploadedDocs, saveNow, setStatus, isPlatformSelected } = useIntakeForm();
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const getStateName = (code: string) => US_STATES.find(s => s.value === code)?.label || code;
  const getCountryName = (code: string) => COUNTRIES.find(c => c.value === code)?.label || code;

  const requiredDocs: string[] = ['IDFront', 'BusinessRegistration', 'BusinessAddressProof', 'PersonalAddressProof'];
  if (formData.id_type === 'Drivers License' || formData.id_type === 'State ID') requiredDocs.push('IDBack');
  if (formData.setup_by_representative) requiredDocs.push('RepID', 'AuthorizationLetter');
  const missingDocs = requiredDocs.filter(d => !uploadedDocs.some(ud => ud.document_type === d));

  const platformNames = formData.selected_platforms.join(', ') || formData.platform;

  const startEdit = (sectionId: string) => setEditingSection(sectionId);
  const cancelEdit = () => { setEditingSection(null); setEditValues({}); };
  const saveEdit = () => { setEditingSection(null); setEditValues({}); };

  const handleSubmit = async () => {
    if (!formData.consent_authorized) {
      toast({ title: 'Authorization required', description: 'Please check the consent box before submitting.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      await saveNow();
      await (supabase as any).from('seller_intakes').update({ status: 'Submitted' }).eq('id', formId);
      setStatus('Submitted');
      setSubmitted(true);
      setShowConfirm(false);

      try {
        const smsMessage = `New intake submitted by ${formData.client_name || formData.contact_first_name + ' ' + formData.contact_last_name} \u2014 ${platformNames} \u2014 ID: ${formId?.slice(0, 8)}`;
        await supabase.functions.invoke('notify-sms', { body: { message: smsMessage } });
      } catch (smsErr) {
        console.error('SMS notification failed:', smsErr);
      }

      // Customer confirmation email
      try {
        await supabase.functions.invoke('notify-sms', {
          body: {
            message: `customer_confirmation`,
            customer_email: formData.client_email,
            customer_name: formData.client_name || `${formData.contact_first_name} ${formData.contact_last_name}`,
            platforms: platformNames,
            business_name: formData.business_legal_name,
            form_id: formId,
          },
        });
      } catch (e) {
        console.error('Customer confirmation failed:', e);
      }
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
            A confirmation email has been sent to <strong>{formData.client_email}</strong>. If we need anything else, we'll reach out via {formData.preferred_contact_method.toLowerCase()}.
          </p>
        </CardContent>
      </Card>
    );
  }

  const Section = ({ title, sectionId, children }: { title: string; sectionId: string; children: React.ReactNode }) => (
    <Collapsible defaultOpen>
      <div className="border border-border rounded-lg">
        <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-muted/50">
          <span className="font-medium text-sm">{title}</span>
          <div className="flex items-center gap-2">
            {editingSection === sectionId ? (
              <>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); saveEdit(); }}>
                  <Save className="w-3.5 h-3.5 mr-1" /> Save
                </Button>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); cancelEdit(); }}>
                  <X className="w-3.5 h-3.5 mr-1" /> Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); startEdit(sectionId); }}>
                <Edit className="w-3.5 h-3.5 mr-1" /> Edit
              </Button>
            )}
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

  const Field = ({ label, value, field }: { label: string; value?: string; field?: keyof typeof formData }) => {
    if (editingSection && field) {
      return (
        <>
          <span className="text-muted-foreground">{label}</span>
          <Input
            value={(formData as any)[field] || ''}
            onChange={e => updateField(field as any, e.target.value)}
            className="h-7 text-sm"
          />
        </>
      );
    }
    return (
      <>
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value || '\u2014'}</span>
      </>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review Your Information</CardTitle>
        <CardDescription>Please review all the information below before submitting. Click "Edit" on any section to make changes inline.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {missingDocs.length > 0 && (
          <Alert className="bg-amber-500/10 border-amber-500/30 sticky top-0 z-10">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription>
              <p className="font-medium text-amber-800">Missing required documents:</p>
              {missingDocs.map(d => (
                <p key={d} className="text-sm text-amber-700">&bull; {DOCUMENT_TYPE_LABELS[d]}</p>
              ))}
            </AlertDescription>
          </Alert>
        )}

        <Section title="Client Contact Info" sectionId="contact">
          <Field label="Name" value={formData.client_name} field={editingSection === 'contact' ? 'client_name' : undefined} />
          <Field label="Email" value={formData.client_email} field={editingSection === 'contact' ? 'client_email' : undefined} />
          <Field label="Phone" value={formatPhone(formData.client_phone)} field={editingSection === 'contact' ? 'client_phone' : undefined} />
          <Field label="Preferred Contact" value={formData.preferred_contact_method} />
          <Field label="Platforms" value={platformNames} />
        </Section>

        <Section title="Business Information" sectionId="business">
          <Field label="Legal Name" value={formData.business_legal_name} field={editingSection === 'business' ? 'business_legal_name' : undefined} />
          <Field label="Business Type" value={formData.business_type} />
          <Field label="State" value={getStateName(formData.state_of_registration)} />
          <Field label="EIN" value={formData.ein} />
          {formData.business_phone && <Field label="Business Phone" value={formatPhone(formData.business_phone)} />}
          {formData.business_email && <Field label="Business Email" value={formData.business_email} />}
          {formData.business_website && <Field label="Website" value={formData.business_website} />}
          {formData.years_in_business && <Field label="Years in Business" value={formData.years_in_business} />}
          {isPlatformSelected('Amazon') && (
            <>
              <Field label="Agent Service" value={formData.registered_agent_service} />
              <Field label="Registered Address" value={`${formData.registered_agent_address}, ${formData.registered_agent_city}, ${getStateName(formData.registered_agent_state)} ${formData.registered_agent_zip}`} />
            </>
          )}
        </Section>

        <Section title="Owner Information" sectionId="owner">
          <Field label="Name" value={`${formData.contact_first_name} ${formData.contact_middle_name} ${formData.contact_last_name}`.trim()} />
          {formData.owner_title && <Field label="Title" value={formData.owner_title} />}
          {formData.ownership_percentage && <Field label="Ownership" value={`${formData.ownership_percentage}%`} />}
          <Field label="Citizenship" value={getCountryName(formData.citizenship_country)} />
          <Field label="Date of Birth" value={formatDate(formData.date_of_birth)} />
          <Field label="Tax Residency" value={formData.tax_residency} />
          <Field label="SSN/ITIN" value={formData.ssn_itin ? 'Provided' : 'Not provided'} />
          <Field label="ID Type" value={formData.id_type} />
          <Field label="ID Expiry" value={formatDate(formData.id_expiry_date)} />
          <Field label="Phone" value={formatPhone(formData.phone_number)} />
          <Field label="Address" value={`${formData.residential_address}, ${formData.residential_city}, ${getStateName(formData.residential_state)} ${formData.residential_zip}`} />
          {/* Authorization */}
          <Field label="Setup by" value={formData.setup_by_representative ? 'Representative' : 'Business Owner'} />
          {formData.setup_by_representative && (
            <>
              <Field label="Rep Name" value={formData.rep_name} />
              <Field label="Relationship" value={formData.rep_relationship} />
            </>
          )}
        </Section>

        <Section title="Bank & Payment Details" sectionId="bank">
          <Field label="Bank" value={formData.bank_name} />
          <Field label="Account Holder" value={formData.account_holder_name} />
          <Field label="Account" value={formData.account_number_last4 ? `\u2022\u2022\u2022\u2022${formData.account_number_last4}` : '\u2014'} />
          <Field label="Routing" value={formData.routing_number_last4 ? `\u2022\u2022\u2022\u2022${formData.routing_number_last4}` : '\u2014'} />
          <Field label="Type" value={formData.account_type} />
          {formData.card_holder_name && <Field label="Card Holder" value={formData.card_holder_name} />}
          <Field label="Card" value={formData.credit_card_last4 ? `\u2022\u2022\u2022\u2022${formData.credit_card_last4}` : '\u2014'} />
          <Field label="Card Expiry" value={formData.credit_card_expiry} />
        </Section>

        {/* Platform sections */}
        {isPlatformSelected('Amazon') && (
          <Section title="Amazon \u2014 Brand & Products" sectionId="amazon">
            <Field label="Store Name" value={formData.amazon_store_name || formData.business_legal_name} />
            <Field label="Email" value={formData.amazon_email} />
            <Field label="Phone" value={formatPhone(formData.amazon_phone)} />
            <Field label="Plan" value={formData.seller_plan} />
            <Field label="Marketplace" value={formData.target_amazon_marketplace} />
            <Field label="Has UPCs" value={formData.has_upcs ? 'Yes' : 'No'} />
            {formData.owns_brand && <Field label="Brand Name" value={formData.brand_name} />}
            {formData.has_trademark && <Field label="Trademark #" value={formData.trademark_number} />}
            <Field label="Category" value={formData.product_category} />
            <Field label="# Products" value={formData.number_of_products} />
            <Field label="Fulfillment" value={formData.fulfillment_method} />
          </Section>
        )}

        {isPlatformSelected('Shopify') && (
          <Section title="Shopify \u2014 Store Details" sectionId="shopify">
            <Field label="Store Name" value={formData.shopify_store_name} />
            <Field label="Email" value={formData.shopify_email} />
            {formData.shopify_phone && <Field label="Phone" value={formatPhone(formData.shopify_phone)} />}
            <Field label="Plan" value={formData.shopify_plan} />
            <Field label="Domain" value={formData.shopify_domain || formData.shopify_preferred_domain || '\u2014'} />
            {formData.shopify_theme_style && <Field label="Theme Style" value={formData.shopify_theme_style} />}
            <Field label="Shipping" value={formData.shipping_method} />
            {formData.shopify_payment_gateway && <Field label="Payment Gateway" value={formData.shopify_payment_gateway} />}
          </Section>
        )}

        {isPlatformSelected('TikTok') && (
          <Section title="TikTok Shop \u2014 Details" sectionId="tiktok">
            <Field label="Shop Name" value={formData.tiktok_shop_name} />
            <Field label="Email" value={formData.tiktok_email} />
            <Field label="Phone" value={formatPhone(formData.tiktok_phone)} />
            <Field label="Handle" value={formData.tiktok_handle} />
            <Field label="Creator Account" value={formData.has_tiktok_creator ? 'Yes' : 'No'} />
            <Field label="Category" value={formData.tiktok_category} />
            <Field label="Fulfillment" value={formData.tiktok_fulfillment} />
            {formData.tiktok_price_range && <Field label="Price Range" value={formData.tiktok_price_range} />}
            {formData.tiktok_warehouse_address && (
              <Field label="Warehouse" value={`${formData.tiktok_warehouse_address}, ${formData.tiktok_warehouse_city}, ${formData.tiktok_warehouse_state} ${formData.tiktok_warehouse_zip}`} />
            )}
          </Section>
        )}

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

        {/* Special Instructions */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Notes / Special Instructions</label>
          <Textarea
            value={formData.special_instructions}
            onChange={e => updateField('special_instructions', e.target.value)}
            placeholder="Anything we should know? E.g., 'I have a trademark pending,' 'I need help choosing a Shopify theme,' etc."
            rows={3}
          />
        </div>

        {/* Consent checkbox */}
        <label className="flex items-start gap-3 p-4 border border-border rounded-lg cursor-pointer">
          <Checkbox
            checked={formData.consent_authorized}
            onCheckedChange={v => updateField('consent_authorized', !!v)}
            className="mt-0.5"
          />
          <span className="text-sm">
            I authorize Bestly LLC to create and manage marketplace seller accounts on my behalf using the information provided in this form. I confirm that all information is accurate and that I am authorized to provide it.
          </span>
        </label>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={goBack}>&larr; Back</Button>
        <Button onClick={() => setShowConfirm(true)} disabled={missingDocs.length > 0 || !formData.consent_authorized}>
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

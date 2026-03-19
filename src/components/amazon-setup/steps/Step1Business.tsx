import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Info } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { useGuidance } from '@/contexts/GuidanceContext';
import { US_STATES, BUSINESS_TYPES, REGISTERED_AGENT_SERVICES, autoFormatEin, autoFormatPhone } from '../constants';
import { GuidedLabel } from '../GuidedLabel';
import { IntakeField } from '../IntakeField';
import { DocumentUpload } from '../DocumentUpload';

export const Step1Business = () => {
  const { formData, updateField, goNext, goBack, uploadedDocs, isPlatformSelected } = useIntakeForm();
  const { getGuidance } = useGuidance();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [otherAgent, setOtherAgent] = useState('');

  const hasAmazon = isPlatformSelected('Amazon');
  const isSoleProp = formData.business_type === 'Sole Proprietor';
  const onlyNonAmazon = !hasAmazon && (isPlatformSelected('Shopify') || isPlatformSelected('TikTok'));

  const validateEin = (v: string) => /^\d{2}-\d{7}$/.test(v);
  const hasDoc = (type: string) => uploadedDocs.some(d => d.document_type === type);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.business_legal_name.trim()) e.business_legal_name = 'Required';
    if (!formData.business_type) e.business_type = 'Required';
    if (!formData.state_of_registration) e.state_of_registration = 'Required';
    // EIN: required for Amazon, optional for sole proprietors on Shopify/TikTok only
    if (hasAmazon) {
      if (!formData.ein.trim()) e.ein = 'Required';
      else if (!validateEin(formData.ein)) e.ein = 'Format: XX-XXXXXXX';
    } else if (!isSoleProp && formData.ein.trim() && !validateEin(formData.ein)) {
      e.ein = 'Format: XX-XXXXXXX';
    }
    // Registered agent only required for Amazon
    if (hasAmazon) {
      if (!formData.registered_agent_service) e.registered_agent_service = 'Required';
      if (!formData.registered_agent_address.trim()) e.registered_agent_address = 'Required';
      if (!formData.registered_agent_city.trim()) e.registered_agent_city = 'Required';
      if (!formData.registered_agent_state) e.registered_agent_state = 'Required';
      if (!formData.registered_agent_zip.trim()) e.registered_agent_zip = 'Required';
      else if (!/^\d{5}$/.test(formData.registered_agent_zip)) e.registered_agent_zip = '5 digits';
    }
    if (formData.addresses_differ) {
      if (!formData.operating_address.trim()) e.operating_address = 'Required';
      if (!formData.operating_city.trim()) e.operating_city = 'Required';
      if (!formData.operating_state) e.operating_state = 'Required';
      if (!formData.operating_zip.trim()) e.operating_zip = 'Required';
    }
    if (!hasDoc('BusinessRegistration')) e.BusinessRegistration = 'Registration document is required';
    if (!hasDoc('BusinessAddressProof')) e.BusinessAddressProof = 'Proof of business address is required';
    if (formData.business_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.business_email)) e.business_email = 'Invalid email';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const showStateMismatch = hasAmazon && formData.registered_agent_state &&
    formData.state_of_registration &&
    formData.registered_agent_state !== formData.state_of_registration;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business Information</CardTitle>
        <CardDescription>Enter your business details exactly as they appear on your state registration documents.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <IntakeField name="business_legal_name" label="Business Legal Name" value={formData.business_legal_name} onChange={updateField} error={errors.business_legal_name} getGuidance={getGuidance} />

        <div>
          <GuidedLabel label="Business Type" fieldName="business_type" required getGuidance={getGuidance} />
          <Select value={formData.business_type} onValueChange={v => updateField('business_type', v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              {BUSINESS_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          {errors.business_type && <p className="text-xs text-destructive mt-1">{errors.business_type}</p>}
        </div>

        <div>
          <GuidedLabel label="State of Registration" fieldName="state_of_registration" required getGuidance={getGuidance} />
          <Select value={formData.state_of_registration} onValueChange={v => updateField('state_of_registration', v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Select state" /></SelectTrigger>
            <SelectContent>
              {US_STATES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {errors.state_of_registration && <p className="text-xs text-destructive mt-1">{errors.state_of_registration}</p>}
        </div>

        <div>
          <GuidedLabel label="EIN" fieldName="ein" required={hasAmazon} getGuidance={getGuidance} />
          <Input
            value={formData.ein}
            onChange={e => updateField('ein', autoFormatEin(e.target.value))}
            placeholder="XX-XXXXXXX"
            className="mt-1"
          />
          {isSoleProp && onlyNonAmazon && (
            <p className="text-xs text-muted-foreground mt-1">If you don't have an EIN, your SSN/ITIN from the next step will be used instead.</p>
          )}
          {errors.ein && <p className="text-xs text-destructive mt-1">{errors.ein}</p>}
        </div>

        {/* Business contact fields */}
        <div className="space-y-3 pt-4 border-t border-border">
          <h3 className="font-medium text-sm">Business Contact</h3>
          <div>
            <label className="text-sm font-medium">Business Phone</label>
            <Input value={formData.business_phone} onChange={e => updateField('business_phone', autoFormatPhone(e.target.value))} placeholder="(XXX) XXX-XXXX" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Business Email</label>
            <p className="text-xs text-muted-foreground">Email for the seller account (may differ from your personal contact email)</p>
            <Input type="email" value={formData.business_email} onChange={e => updateField('business_email', e.target.value)} className="mt-1" />
            {errors.business_email && <p className="text-xs text-destructive mt-1">{errors.business_email}</p>}
          </div>
          <div>
            <label className="text-sm font-medium">Business Website / Online Presence</label>
            <Input value={formData.business_website} onChange={e => updateField('business_website', e.target.value)} placeholder="https://yourbusiness.com" className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Years in Business</label>
            <Select value={formData.years_in_business} onValueChange={v => updateField('years_in_business', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Less than 1">Less than 1 year</SelectItem>
                <SelectItem value="1-2">1-2 years</SelectItem>
                <SelectItem value="3-5">3-5 years</SelectItem>
                <SelectItem value="5+">5+ years</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Registered Agent - Amazon only */}
        {hasAmazon && (
          <>
            <div className="space-y-3 pt-4 border-t border-border">
              <h3 className="font-medium text-sm">
                {formData.selected_platforms.length > 1 ? 'Amazon-Specific: ' : ''}Registered Agent
              </h3>

              <div>
                <GuidedLabel label="Registered Agent Service" fieldName="registered_agent_service" required getGuidance={getGuidance} />
                <Select value={formData.registered_agent_service} onValueChange={v => {
                  updateField('registered_agent_service', v === 'Other' ? otherAgent : v);
                  if (v !== 'Other') setOtherAgent('');
                }}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select service" /></SelectTrigger>
                  <SelectContent>
                    {REGISTERED_AGENT_SERVICES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                {formData.registered_agent_service === 'Other' && (
                  <Input className="mt-2" placeholder="Enter service name" value={otherAgent}
                    onChange={e => { setOtherAgent(e.target.value); updateField('registered_agent_service', e.target.value); }} />
                )}
                {errors.registered_agent_service && <p className="text-xs text-destructive mt-1">{errors.registered_agent_service}</p>}
              </div>

              <h3 className="font-medium text-sm">Registered Agent Address (from your state filing)</h3>
              <IntakeField name="registered_agent_address" label="Street Address" value={formData.registered_agent_address} onChange={updateField} error={errors.registered_agent_address} getGuidance={getGuidance} />
              <div className="grid grid-cols-2 gap-3">
                <IntakeField name="registered_agent_city" label="City" value={formData.registered_agent_city} onChange={updateField} error={errors.registered_agent_city} getGuidance={getGuidance} />
                <div>
                  <GuidedLabel label="State" fieldName="registered_agent_state" required getGuidance={getGuidance} />
                  <Select value={formData.registered_agent_state} onValueChange={v => updateField('registered_agent_state', v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="State" /></SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {errors.registered_agent_state && <p className="text-xs text-destructive mt-1">{errors.registered_agent_state}</p>}
                </div>
              </div>
              <IntakeField name="registered_agent_zip" label="ZIP Code" placeholder="XXXXX" value={formData.registered_agent_zip} onChange={updateField} error={errors.registered_agent_zip} getGuidance={getGuidance} />
            </div>

            <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>IMPORTANT:</strong> This address must match your Certificate of Formation or Articles of Organization EXACTLY. If you used a registered agent service (like ZenBusiness or LegalZoom), their office address is your registered address &mdash; not your home or business office. This is the #1 reason Amazon rejects applications.
              </AlertDescription>
            </Alert>

            {showStateMismatch && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Your registered agent is in a different state than where the business is registered. This is normal if you used a service like ZenBusiness (often in Delaware).
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        <label className="flex items-center gap-2 cursor-pointer pt-2">
          <Checkbox checked={formData.addresses_differ} onCheckedChange={v => updateField('addresses_differ', !!v)} />
          <span className="text-sm">My operating/business address is different from my registered agent address</span>
        </label>

        {formData.addresses_differ && (
          <div className="space-y-3 pl-4 border-l-2 border-border">
            <h3 className="font-medium text-sm">Operating Address</h3>
            <IntakeField name="operating_address" label="Street Address" value={formData.operating_address} onChange={updateField} error={errors.operating_address} getGuidance={getGuidance} />
            <div className="grid grid-cols-2 gap-3">
              <IntakeField name="operating_city" label="City" value={formData.operating_city} onChange={updateField} error={errors.operating_city} getGuidance={getGuidance} />
              <div>
                <GuidedLabel label="State" fieldName="operating_state" required getGuidance={getGuidance} />
                <Select value={formData.operating_state} onValueChange={v => updateField('operating_state', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="State" /></SelectTrigger>
                  <SelectContent>
                    {US_STATES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <IntakeField name="operating_zip" label="ZIP Code" placeholder="XXXXX" value={formData.operating_zip} onChange={updateField} error={errors.operating_zip} getGuidance={getGuidance} />
          </div>
        )}

        <div className="space-y-4 pt-4 border-t border-border">
          <h3 className="font-medium text-sm">Document Uploads</h3>
          <DocumentUpload
            documentType="BusinessRegistration"
            label="Registration Document"
            description={hasAmazon
              ? "Upload your Certificate of Formation, Articles of Organization, or equivalent state filing document. Do NOT upload your IRS EIN letter here \u2014 Amazon does not accept it as a registration document."
              : "Upload your Certificate of Formation, Articles of Organization, or equivalent state filing document."
            }
            required
          />
          {errors.BusinessRegistration && <p className="text-xs text-destructive">{errors.BusinessRegistration}</p>}
          <DocumentUpload
            documentType="BusinessAddressProof"
            label="Proof of Business Address"
            description="Document showing your business name and address \u2014 bank statement, utility bill, or government correspondence dated within the last 180 days."
            required
          />
          {errors.BusinessAddressProof && <p className="text-xs text-destructive">{errors.BusinessAddressProof}</p>}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={goBack}>&larr; Back</Button>
        <Button onClick={() => validate() && goNext()}>Continue &rarr;</Button>
      </CardFooter>
    </Card>
  );
};

import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { useGuidance } from '@/contexts/GuidanceContext';
import { US_STATES, COUNTRIES, OWNER_TITLES, autoFormatPhone } from '../constants';
import { GuidedLabel } from '../GuidedLabel';
import { IntakeField } from '../IntakeField';
import { DocumentUpload } from '../DocumentUpload';

export const Step2Owner = () => {
  const { formData, updateField, goNext, goBack, uploadedDocs, isPlatformSelected } = useIntakeForm();
  const { getGuidance } = useGuidance();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const hasTikTok = isPlatformSelected('TikTok');
  const hasDoc = (type: string) => uploadedDocs.some(d => d.document_type === type);
  const platformNames = formData.selected_platforms.join(', ') || 'marketplace';

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.contact_first_name.trim()) e.contact_first_name = 'Required';
    if (!formData.contact_last_name.trim()) e.contact_last_name = 'Required';
    if (!formData.citizenship_country) e.citizenship_country = 'Required';
    if (!formData.birth_country) e.birth_country = 'Required';
    if (!formData.date_of_birth) e.date_of_birth = 'Required';
    else {
      const age = (Date.now() - new Date(formData.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (age < 18) e.date_of_birth = 'Must be 18+';
    }
    if (!formData.id_type) e.id_type = 'Required';
    if (!formData.id_number.trim()) e.id_number = 'Required';
    if (!formData.id_expiry_date) e.id_expiry_date = 'Required';
    else if (new Date(formData.id_expiry_date) <= new Date()) e.id_expiry_date = 'Must be in the future';
    if (!formData.id_country_of_issue) e.id_country_of_issue = 'Required';
    if (!formData.residential_address.trim()) e.residential_address = 'Required';
    if (!formData.residential_city.trim()) e.residential_city = 'Required';
    if (!formData.residential_state) e.residential_state = 'Required';
    if (!formData.residential_zip.trim()) e.residential_zip = 'Required';
    else if (!/^\d{5}$/.test(formData.residential_zip)) e.residential_zip = '5 digits';
    if (!formData.phone_number.trim()) e.phone_number = 'Required';
    if (!hasDoc('IDFront')) e.IDFront = 'Government ID (front) is required';
    if (formData.id_type === 'Drivers License' && !hasDoc('IDBack')) e.IDBack = "ID back is required for driver's licenses";
    if (!hasDoc('PersonalAddressProof')) e.PersonalAddressProof = 'Proof of personal address is required';
    // Authorization validation
    if (formData.setup_by_representative) {
      if (!formData.rep_name.trim()) e.rep_name = 'Required';
      if (!formData.rep_relationship) e.rep_relationship = 'Required';
      if (!hasDoc('RepID')) e.RepID = 'Representative ID is required';
      if (!hasDoc('AuthorizationLetter')) e.AuthorizationLetter = 'Authorization letter is required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const idExpiresSoon = formData.id_expiry_date &&
    new Date(formData.id_expiry_date) > new Date() &&
    (new Date(formData.id_expiry_date).getTime() - Date.now()) < 180 * 24 * 60 * 60 * 1000;

  const missingSSN = formData.tax_residency === 'US Resident' && !formData.ssn_itin;

  const CountrySelect = ({ name, label: lbl }: { name: string; label: string }) => (
    <div>
      <GuidedLabel label={lbl} fieldName={name} required getGuidance={getGuidance} />
      <Select value={(formData as any)[name] as string} onValueChange={v => updateField(name as any, v)}>
        <SelectTrigger className="mt-1"><SelectValue placeholder="Select country" /></SelectTrigger>
        <SelectContent>
          {COUNTRIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {errors[name] && <p className="text-xs text-destructive mt-1">{errors[name]}</p>}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business Owner Information</CardTitle>
        <CardDescription>Enter the primary business owner's details. Names must match their government-issued ID exactly.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <IntakeField name="contact_first_name" label="First Name" value={formData.contact_first_name} onChange={updateField} error={errors.contact_first_name} getGuidance={getGuidance} />
          <IntakeField name="contact_middle_name" label="Middle Name" required={false} placeholder="If on your ID" value={formData.contact_middle_name} onChange={updateField} error={errors.contact_middle_name} getGuidance={getGuidance} />
          <IntakeField name="contact_last_name" label="Last Name" value={formData.contact_last_name} onChange={updateField} error={errors.contact_last_name} getGuidance={getGuidance} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <GuidedLabel label="Owner Title/Role" fieldName="owner_title" getGuidance={getGuidance} />
            <Select value={formData.owner_title} onValueChange={v => updateField('owner_title', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select title" /></SelectTrigger>
              <SelectContent>
                {OWNER_TITLES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Ownership Percentage</label>
            <p className="text-xs text-muted-foreground">Must be 25%+ for beneficial owner</p>
            <Input value={formData.ownership_percentage} onChange={e => updateField('ownership_percentage', e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="e.g. 100" className="mt-1" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <CountrySelect name="citizenship_country" label="Country of Citizenship" />
          <CountrySelect name="birth_country" label="Country of Birth" />
        </div>

        <IntakeField name="date_of_birth" label="Date of Birth" type="date" value={formData.date_of_birth} onChange={updateField} error={errors.date_of_birth} getGuidance={getGuidance} />

        {/* Tax Information */}
        <div className="space-y-3 pt-4 border-t border-border">
          <h3 className="font-medium text-sm">Tax Information</h3>
          <div>
            <GuidedLabel label="Tax Residency" fieldName="tax_residency" required getGuidance={getGuidance} />
            <RadioGroup value={formData.tax_residency} onValueChange={v => updateField('tax_residency', v)} className="flex gap-4 mt-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="US Resident" id="us-res" />
                <Label htmlFor="us-res">US Resident</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="Non-US Resident" id="non-us" />
                <Label htmlFor="non-us">Non-US Resident</Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <GuidedLabel label="SSN or ITIN" fieldName="ssn_itin" getGuidance={getGuidance} />
            <p className="text-xs text-muted-foreground">Required for tax reporting (W-9) on all platforms. Amazon, Shopify Payments, and TikTok Shop all require this for payouts and tax compliance. Only the last 4 digits are stored.</p>
            <Input type="password" value={formData.ssn_itin} onChange={e => updateField('ssn_itin', e.target.value)}
              placeholder="XXX-XX-XXXX" className="mt-1" />
          </div>

          {missingSSN && (
            <Alert className="bg-amber-500/5 border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-sm">
                SSN or ITIN is needed for tax forms (W-9) on all platforms. You can provide it later, but it will be required before account activation.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Government ID */}
        <div className="space-y-3 pt-4 border-t border-border">
          <h3 className="font-medium text-sm">Government-Issued ID</h3>
          <div>
            <GuidedLabel label="ID Type" fieldName="id_type" required getGuidance={getGuidance} />
            <Select value={formData.id_type} onValueChange={v => updateField('id_type', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select ID type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Passport">Passport</SelectItem>
                <SelectItem value="Drivers License">Driver's License</SelectItem>
                <SelectItem value="State ID">State ID</SelectItem>
              </SelectContent>
            </Select>
            {errors.id_type && <p className="text-xs text-destructive mt-1">{errors.id_type}</p>}
          </div>

          <IntakeField name="id_number" label="ID Number" value={formData.id_number} onChange={updateField} error={errors.id_number} getGuidance={getGuidance} />
          <IntakeField name="id_expiry_date" label="Date of Expiry" type="date" value={formData.id_expiry_date} onChange={updateField} error={errors.id_expiry_date} getGuidance={getGuidance} />
          <CountrySelect name="id_country_of_issue" label="Country of Issue" />

          {idExpiresSoon && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Your ID expires within 6 months. Consider renewing before starting the marketplace setup to avoid delays.
              </AlertDescription>
            </Alert>
          )}

          <DocumentUpload documentType="IDFront" label="ID \u2014 Front" required />
          {errors.IDFront && <p className="text-xs text-destructive">{errors.IDFront}</p>}
          {formData.id_type === 'Passport' && (
            <p className="text-xs text-muted-foreground">If using a passport, only the photo page (front) is needed.</p>
          )}
          {(formData.id_type === 'Drivers License' || formData.id_type === 'State ID') && (
            <>
              <DocumentUpload documentType="IDBack" label="ID \u2014 Back" description="Required for driver's licenses and state IDs" required />
              {errors.IDBack && <p className="text-xs text-destructive">{errors.IDBack}</p>}
            </>
          )}
        </div>

        {/* Residential Address */}
        <div className="space-y-3 pt-4 border-t border-border">
          <h3 className="font-medium text-sm">Residential Address</h3>
          {hasTikTok && (
            <p className="text-xs text-amber-600">TikTok requires a physical US address (no P.O. boxes). Must be verifiable by USPS.</p>
          )}
          <IntakeField name="residential_address" label="Street Address" value={formData.residential_address} onChange={updateField} error={errors.residential_address} getGuidance={getGuidance} />
          <div className="grid grid-cols-2 gap-3">
            <IntakeField name="residential_city" label="City" value={formData.residential_city} onChange={updateField} error={errors.residential_city} getGuidance={getGuidance} />
            <div>
              <GuidedLabel label="State" fieldName="residential_state" required getGuidance={getGuidance} />
              <Select value={formData.residential_state} onValueChange={v => updateField('residential_state', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="State" /></SelectTrigger>
                <SelectContent>
                  {US_STATES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.residential_state && <p className="text-xs text-destructive mt-1">{errors.residential_state}</p>}
            </div>
          </div>
          <IntakeField name="residential_zip" label="ZIP Code" placeholder="XXXXX" value={formData.residential_zip} onChange={updateField} error={errors.residential_zip} getGuidance={getGuidance} />
          <div>
            <GuidedLabel label="Phone Number" fieldName="phone_number" required getGuidance={getGuidance} />
            <Input value={formData.phone_number} onChange={e => updateField('phone_number', autoFormatPhone(e.target.value))} placeholder="(XXX) XXX-XXXX" className="mt-1" type="tel" />
            {errors.phone_number && <p className="text-xs text-destructive mt-1">{errors.phone_number}</p>}
          </div>

          <DocumentUpload documentType="PersonalAddressProof" label="Proof of Personal Address"
            description="Bank statement or utility bill showing the owner's name and residential address, dated within 180 days" required />
          {errors.PersonalAddressProof && <p className="text-xs text-destructive">{errors.PersonalAddressProof}</p>}
        </div>

        {/* Authorization (merged from old Step 5) */}
        <div className="space-y-4 pt-4 border-t border-border">
          <h3 className="font-medium text-sm">Account Setup Authorization</h3>
          <div className="flex items-center justify-between">
            <p className="text-sm">Are you (the person providing this information) the business owner?</p>
            <Switch checked={!formData.setup_by_representative}
              onCheckedChange={v => updateField('setup_by_representative', !v)} />
          </div>

          {!formData.setup_by_representative ? (
            <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <p className="text-sm">Great &mdash; no additional authorization documents are needed.</p>
            </div>
          ) : (
            <div className="space-y-4 pl-4 border-l-2 border-border">
              <h3 className="font-medium text-sm">Authorized Representative</h3>
              <IntakeField name="rep_name" label="Representative Full Name" value={formData.rep_name} onChange={updateField} error={errors.rep_name} getGuidance={getGuidance} />
              <div>
                <label className="text-sm font-medium">Relationship to Business <span className="text-destructive">*</span></label>
                <Select value={formData.rep_relationship} onValueChange={v => updateField('rep_relationship', v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select relationship" /></SelectTrigger>
                  <SelectContent>
                    {['Employee', 'Business Partner', 'Accountant', 'Attorney', 'Family Member', 'Other'].map(r =>
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {errors.rep_relationship && <p className="text-xs text-destructive mt-1">{errors.rep_relationship}</p>}
              </div>
              <DocumentUpload documentType="RepID" label="Representative's Government ID" required />
              {errors.RepID && <p className="text-xs text-destructive">{errors.RepID}</p>}
              <DocumentUpload documentType="AuthorizationLetter" label="Letter of Authorization" required />
              {errors.AuthorizationLetter && <p className="text-xs text-destructive">{errors.AuthorizationLetter}</p>}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  The Letter of Authorization should be signed by the business owner, stating that the representative is authorized to set up and manage {platformNames} accounts on behalf of the business. We can provide you with a template if needed.
                </AlertDescription>
              </Alert>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={goBack}>&larr; Back</Button>
        <Button onClick={() => validate() && goNext()}>Continue &rarr;</Button>
      </CardFooter>
    </Card>
  );
};

import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Info, AlertTriangle } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { useGuidance } from '@/contexts/GuidanceContext';
import { US_STATES, COUNTRIES } from '../constants';
import { GuidedLabel } from '../GuidedLabel';
import { IntakeField } from '../IntakeField';
import { DocumentUpload } from '../DocumentUpload';

export const Step2Owner = () => {
  const { formData, updateField, goNext, goBack, uploadedDocs } = useIntakeForm();
  const { getGuidance } = useGuidance();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const hasDoc = (type: string) => uploadedDocs.some(d => d.document_type === type);

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
    if (formData.id_type === 'Drivers License' && !hasDoc('IDBack')) e.IDBack = 'ID back is required for driver\'s licenses';
    if (!hasDoc('PersonalAddressProof')) e.PersonalAddressProof = 'Proof of personal address is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const idExpiresSoon = formData.id_expiry_date &&
    new Date(formData.id_expiry_date) > new Date() &&
    (new Date(formData.id_expiry_date).getTime() - Date.now()) < 180 * 24 * 60 * 60 * 1000;

  const missingSSN = formData.tax_residency === 'US Resident' && !formData.ssn_itin;

  const CountrySelect = ({ name, label }: { name: string; label: string }) => (
    <div>
      <GuidedLabel label={label} fieldName={name} required getGuidance={getGuidance} />
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
        <div className="grid grid-cols-3 gap-3">
          <IntakeField name="contact_first_name" label="First Name" value={formData.contact_first_name} onChange={updateField} error={errors.contact_first_name} getGuidance={getGuidance} />
          <IntakeField name="contact_middle_name" label="Middle Name" required={false} placeholder="If on your ID" value={formData.contact_middle_name} onChange={updateField} error={errors.contact_middle_name} getGuidance={getGuidance} />
          <IntakeField name="contact_last_name" label="Last Name" value={formData.contact_last_name} onChange={updateField} error={errors.contact_last_name} getGuidance={getGuidance} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <CountrySelect name="citizenship_country" label="Country of Citizenship" />
          <CountrySelect name="birth_country" label="Country of Birth" />
        </div>

        <IntakeField name="date_of_birth" label="Date of Birth" type="date" value={formData.date_of_birth} onChange={updateField} error={errors.date_of_birth} getGuidance={getGuidance} />

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
            <p className="text-xs text-muted-foreground">Required for tax forms (W-9). If you don't have it now, we can collect it later. Only the last 4 digits are stored.</p>
            <Input type="password" value={formData.ssn_itin} onChange={e => updateField('ssn_itin', e.target.value)}
              placeholder="XXX-XX-XXXX" className="mt-1" />
          </div>

          {missingSSN && (
            <Alert className="bg-amber-500/5 border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertDescription className="text-sm">
                SSN or ITIN is needed for the IRS W-9 tax form during Amazon setup. You can provide it later, but it will be required.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="space-y-3 pt-4 border-t border-border">
          <h3 className="font-medium text-sm">Government-Issued ID</h3>
          <div>
            <GuidedLabel label="ID Type" fieldName="id_type" required getGuidance={getGuidance} />
            <Select value={formData.id_type} onValueChange={v => updateField('id_type', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select ID type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Passport">Passport</SelectItem>
                <SelectItem value="Drivers License">Driver's License</SelectItem>
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
                Your ID expires within 6 months. Consider renewing before starting the Amazon setup to avoid delays.
              </AlertDescription>
            </Alert>
          )}

          <DocumentUpload documentType="IDFront" label="ID — Front" required />
          {errors.IDFront && <p className="text-xs text-destructive">{errors.IDFront}</p>}
          {formData.id_type === 'Drivers License' && (
            <>
              <DocumentUpload documentType="IDBack" label="ID — Back" description="Required for driver's licenses" required />
              {errors.IDBack && <p className="text-xs text-destructive">{errors.IDBack}</p>}
            </>
          )}
        </div>

        <div className="space-y-3 pt-4 border-t border-border">
          <h3 className="font-medium text-sm">Residential Address</h3>
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
          <IntakeField name="phone_number" label="Phone Number" type="tel" placeholder="(XXX) XXX-XXXX" value={formData.phone_number} onChange={updateField} error={errors.phone_number} getGuidance={getGuidance} />

          <DocumentUpload documentType="PersonalAddressProof" label="Proof of Personal Address"
            description="Bank statement or utility bill showing the owner's name and residential address, dated within 180 days" required />
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={goBack}>← Back</Button>
        <Button onClick={() => validate() && goNext()}>Continue →</Button>
      </CardFooter>
    </Card>
  );
};

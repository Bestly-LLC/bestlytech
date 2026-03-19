import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, Info } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { useGuidance } from '@/contexts/GuidanceContext';
import { GuidedLabel } from '../GuidedLabel';
import { IntakeField } from '../IntakeField';
import { DocumentUpload } from '../DocumentUpload';

export const Step5Auth = () => {
  const { formData, updateField, goNext, goBack, isPlatformSelected, uploadedDocs } = useIntakeForm();
  const { getGuidance } = useGuidance();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ownerSetup = !formData.setup_by_representative;

  const platformNames = formData.selected_platforms.join(', ') || 'marketplace';

  const validate = () => {
    const e: Record<string, string> = {};
    if (formData.setup_by_representative) {
      if (!formData.rep_name.trim()) e.rep_name = 'Required';
      if (!formData.rep_relationship) e.rep_relationship = 'Required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account Setup Authorization</CardTitle>
        <CardDescription>Tell us who will be setting up and managing these {platformNames} accounts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1">
            <GuidedLabel label="Is the business owner setting up this account themselves?" fieldName="setup_by_representative" getGuidance={getGuidance} />
          </div>
          <Switch checked={!formData.setup_by_representative}
            onCheckedChange={v => updateField('setup_by_representative', !v)} />
        </div>

        {ownerSetup ? (
          <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <p className="text-sm">Great — no additional authorization documents are needed.</p>
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
            <DocumentUpload documentType="AuthorizationLetter" label="Letter of Authorization" required />
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                The Letter of Authorization should be on company letterhead (or plain paper), signed by the business owner, stating that the representative is authorized to set up and manage {platformNames} accounts on behalf of the business. It must include the full business name and the representative's full name, and be dated within the last 180 days.
              </AlertDescription>
            </Alert>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={goBack}>← Back</Button>
        <Button onClick={() => validate() && goNext()}>Continue →</Button>
      </CardFooter>
    </Card>
  );
};
import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { TIMEZONES } from '../constants';

const CHECKLIST = [
  'Your state business registration document (Certificate of Formation, Articles of Organization, or equivalent)',
  'Your EIN (Employer Identification Number) from the IRS',
  "The business owner's government-issued photo ID (passport or driver's license — not expired)",
  'A recent bank statement (within 180 days) showing the business name and address — must be a full statement with transactions, NOT just a bank letter',
  "A recent utility bill OR bank statement showing the owner's personal residential address (within 180 days)",
  'Bank account details (account number, routing number) for receiving Amazon payments',
  "A credit or debit card for Amazon's monthly seller subscription fee ($39.99/month)",
];

export const Step0Readiness = () => {
  const { formData, updateField, goNext } = useIntakeForm();
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST.map(() => false));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toggleCheck = (i: number) => {
    setChecks(prev => prev.map((v, idx) => idx === i ? !v : v));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.client_name.trim()) e.client_name = 'Required';
    if (!formData.client_email.trim()) e.client_email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.client_email)) e.client_email = 'Invalid email';
    if (!formData.client_phone.trim()) e.client_phone = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Before You Begin</CardTitle>
        <CardDescription>
          This form collects everything we need to set up your Amazon Seller account. It takes about 15-20 minutes. Please make sure you have the following ready before starting.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          {CHECKLIST.map((item, i) => (
            <label key={i} className="flex items-start gap-3 cursor-pointer">
              <Checkbox checked={checks[i]} onCheckedChange={() => toggleCheck(i)} className="mt-0.5" />
              <span className="text-sm">{item}</span>
            </label>
          ))}
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Don't have all of these yet? No problem — you can save your progress and come back anytime. But having everything ready will make this much faster.
          </AlertDescription>
        </Alert>

        <div className="space-y-4 pt-4 border-t border-border">
          <div>
            <label className="text-sm font-medium">Which platform are you setting up?</label>
            <Select value={formData.platform} onValueChange={(v) => updateField('platform', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Amazon">Amazon</SelectItem>
                <SelectItem value="Shopify" disabled>Shopify (Coming Soon)</SelectItem>
                <SelectItem value="TikTok" disabled>TikTok Shop (Coming Soon)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <h3 className="font-medium text-base pt-2">Contact Information</h3>

          <div>
            <label className="text-sm font-medium">Your Name <span className="text-destructive">*</span></label>
            <p className="text-xs text-muted-foreground mb-1">Who should we contact about this setup?</p>
            <Input value={formData.client_name} onChange={e => updateField('client_name', e.target.value)} />
            {errors.client_name && <p className="text-xs text-destructive mt-1">{errors.client_name}</p>}
          </div>

          <div>
            <label className="text-sm font-medium">Your Email <span className="text-destructive">*</span></label>
            <Input type="email" value={formData.client_email} onChange={e => updateField('client_email', e.target.value)} />
            {errors.client_email && <p className="text-xs text-destructive mt-1">{errors.client_email}</p>}
          </div>

          <div>
            <label className="text-sm font-medium">Your Phone <span className="text-destructive">*</span></label>
            <Input type="tel" value={formData.client_phone} onChange={e => updateField('client_phone', e.target.value)} />
            {errors.client_phone && <p className="text-xs text-destructive mt-1">{errors.client_phone}</p>}
          </div>

          <div>
            <label className="text-sm font-medium">Preferred Contact Method</label>
            <Select value={formData.preferred_contact_method} onValueChange={(v) => updateField('preferred_contact_method', v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Email">Email</SelectItem>
                <SelectItem value="Phone">Phone</SelectItem>
                <SelectItem value="Text">Text</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Your Timezone</label>
            <Select value={formData.client_timezone} onValueChange={(v) => updateField('client_timezone', v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select timezone" /></SelectTrigger>
              <SelectContent>
                {TIMEZONES.map(tz => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={() => validate() && goNext()}>Get Started →</Button>
      </CardFooter>
    </Card>
  );
};

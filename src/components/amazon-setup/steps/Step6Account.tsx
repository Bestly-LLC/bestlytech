import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useIntakeForm } from '@/contexts/IntakeFormContext';

export const Step6Account = () => {
  const { formData, updateField, goNext, goBack } = useIntakeForm();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.amazon_email.trim()) e.amazon_email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.amazon_email)) e.amazon_email = 'Invalid email';
    if (!formData.amazon_phone.trim()) e.amazon_phone = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Amazon Account Details</CardTitle>
        <CardDescription>These details will be used to create and configure the Amazon Seller Central account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium">Amazon Account Email <span className="text-destructive">*</span></label>
          <p className="text-xs text-muted-foreground">This email will be the login for the Amazon Seller account. Use a dedicated business email if possible — it cannot be an email already associated with another Amazon seller account.</p>
          <Input type="email" value={formData.amazon_email} onChange={e => updateField('amazon_email', e.target.value)} className="mt-1" />
          {errors.amazon_email && <p className="text-xs text-destructive mt-1">{errors.amazon_email}</p>}
        </div>

        <div>
          <label className="text-sm font-medium">Amazon Account Phone <span className="text-destructive">*</span></label>
          <p className="text-xs text-muted-foreground">Amazon will send verification codes to this number during setup.</p>
          <Input type="tel" value={formData.amazon_phone} onChange={e => updateField('amazon_phone', e.target.value)} className="mt-1" />
          {errors.amazon_phone && <p className="text-xs text-destructive mt-1">{errors.amazon_phone}</p>}
        </div>

        <div>
          <label className="text-sm font-medium">Seller Plan</label>
          <RadioGroup value={formData.seller_plan} onValueChange={v => updateField('seller_plan', v)} className="mt-2 space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-primary/5">
              <RadioGroupItem value="Professional" id="pro" className="mt-0.5" />
              <div>
                <Label htmlFor="pro" className="font-medium">Professional — $39.99/month</Label>
                <p className="text-xs text-muted-foreground mt-1">Recommended for serious sellers. No per-item fees, access to advanced selling tools, reports, and advertising.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg border border-border">
              <RadioGroupItem value="Individual" id="ind" className="mt-0.5" />
              <div>
                <Label htmlFor="ind" className="font-medium">Individual — $0.99 per item sold</Label>
                <p className="text-xs text-muted-foreground mt-1">Best for sellers with fewer than 40 items/month. Limited access to tools and reports.</p>
              </div>
            </div>
          </RadioGroup>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={goBack}>← Back</Button>
        <Button onClick={() => validate() && goNext()}>Continue →</Button>
      </CardFooter>
    </Card>
  );
};

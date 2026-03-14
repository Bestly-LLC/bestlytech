import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, AlertTriangle } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';

export const Step3Bank = () => {
  const { formData, updateField, goNext, goBack } = useIntakeForm();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fullAccount, setFullAccount] = useState('');
  const [fullRouting, setFullRouting] = useState('');
  const [accountFocused, setAccountFocused] = useState(false);
  const [routingFocused, setRoutingFocused] = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.bank_name.trim()) e.bank_name = 'Required';
    if (!formData.account_holder_name.trim()) e.account_holder_name = 'Required';
    if (!fullAccount && !formData.account_number_last4) e.account_number = 'Required';
    if (!fullRouting && !formData.routing_number_last4) e.routing_number = 'Required';
    else if (fullRouting && fullRouting.length !== 9) e.routing_number = 'Must be 9 digits';
    if (!formData.credit_card_last4.trim()) e.credit_card_last4 = 'Required';
    else if (!/^\d{4}$/.test(formData.credit_card_last4)) e.credit_card_last4 = 'Must be 4 digits';
    if (!formData.credit_card_expiry) e.credit_card_expiry = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleAccountBlur = () => {
    setAccountFocused(false);
    if (fullAccount.length >= 4) {
      updateField('account_number_last4', fullAccount.slice(-4));
    }
  };

  const handleRoutingBlur = () => {
    setRoutingFocused(false);
    if (fullRouting.length >= 4) {
      updateField('routing_number_last4', fullRouting.slice(-4));
    }
  };

  const accountDisplay = accountFocused ? fullAccount :
    formData.account_number_last4 ? `••••${formData.account_number_last4}` : '';
  const routingDisplay = routingFocused ? fullRouting :
    formData.routing_number_last4 ? `••••${formData.routing_number_last4}` : '';

  // Name match warning
  const holderName = formData.account_holder_name.toLowerCase().trim();
  const ownerName = `${formData.contact_first_name} ${formData.contact_last_name}`.toLowerCase().trim();
  const bizName = formData.business_legal_name.toLowerCase().trim();
  const nameMatch = !holderName || holderName === ownerName || holderName === bizName ||
    bizName.includes(holderName) || holderName.includes(bizName);

  // Generate expiry options
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => String(currentYear + i));

  const [expiryMonth, setExpiryMonth] = useState(formData.credit_card_expiry?.split('/')[0] || '');
  const [expiryYear, setExpiryYear] = useState(formData.credit_card_expiry?.split('/')[1] || '');

  const updateExpiry = (month: string, year: string) => {
    if (month && year) {
      updateField('credit_card_expiry', `${month}/${year.slice(-2)}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bank Account & Payment Details</CardTitle>
        <CardDescription>This information is used to set up your Amazon seller payment deposit and subscription.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-primary/5 border-primary/20">
          <Shield className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm">
            🔒 Your financial information is handled securely. We only store the last 4 digits of account and routing numbers.
          </AlertDescription>
        </Alert>

        <div>
          <label className="text-sm font-medium">Bank Name <span className="text-destructive">*</span></label>
          <Input value={formData.bank_name} onChange={e => updateField('bank_name', e.target.value)} className="mt-1" />
          {errors.bank_name && <p className="text-xs text-destructive mt-1">{errors.bank_name}</p>}
        </div>

        <div>
          <label className="text-sm font-medium">Account Holder Name <span className="text-destructive">*</span></label>
          <p className="text-xs text-muted-foreground">Must match the name on the bank account</p>
          <Input value={formData.account_holder_name} onChange={e => updateField('account_holder_name', e.target.value)} className="mt-1" />
          {errors.account_holder_name && <p className="text-xs text-destructive mt-1">{errors.account_holder_name}</p>}
        </div>

        {!nameMatch && (
          <Alert className="bg-amber-500/5 border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-sm">
              The bank account holder name doesn't match the business owner name or business name. Amazon may flag this — make sure the account is in the correct name.
            </AlertDescription>
          </Alert>
        )}

        <div>
          <label className="text-sm font-medium">Account Number <span className="text-destructive">*</span></label>
          <Input
            type={accountFocused ? 'text' : 'text'}
            value={accountFocused ? fullAccount : accountDisplay}
            onChange={e => setFullAccount(e.target.value.replace(/\D/g, ''))}
            onFocus={() => setAccountFocused(true)}
            onBlur={handleAccountBlur}
            className="mt-1 font-mono"
          />
          {errors.account_number && <p className="text-xs text-destructive mt-1">{errors.account_number}</p>}
        </div>

        <div>
          <label className="text-sm font-medium">Routing Number <span className="text-destructive">*</span></label>
          <Input
            value={routingFocused ? fullRouting : routingDisplay}
            onChange={e => setFullRouting(e.target.value.replace(/\D/g, '').slice(0, 9))}
            onFocus={() => setRoutingFocused(true)}
            onBlur={handleRoutingBlur}
            placeholder="9 digits"
            className="mt-1 font-mono"
          />
          {errors.routing_number && <p className="text-xs text-destructive mt-1">{errors.routing_number}</p>}
        </div>

        <div>
          <label className="text-sm font-medium">Account Type <span className="text-destructive">*</span></label>
          <Select value={formData.account_type} onValueChange={v => updateField('account_type', v)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Checking">Checking</SelectItem>
              <SelectItem value="Savings">Savings</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3 pt-4 border-t border-border">
          <h3 className="font-medium text-sm">Payment Card for Seller Fees</h3>
          <p className="text-xs text-muted-foreground">Amazon charges $39.99/month for the Professional seller plan. We only store the last 4 digits for reference.</p>

          <div>
            <label className="text-sm font-medium">Card Last 4 Digits <span className="text-destructive">*</span></label>
            <Input value={formData.credit_card_last4}
              onChange={e => updateField('credit_card_last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="XXXX" maxLength={4} className="mt-1 font-mono w-32" />
            {errors.credit_card_last4 && <p className="text-xs text-destructive mt-1">{errors.credit_card_last4}</p>}
          </div>

          <div className="flex gap-3">
            <div>
              <label className="text-sm font-medium">Expiry Month <span className="text-destructive">*</span></label>
              <Select value={expiryMonth} onValueChange={v => { setExpiryMonth(v); updateExpiry(v, expiryYear); }}>
                <SelectTrigger className="mt-1 w-24"><SelectValue placeholder="MM" /></SelectTrigger>
                <SelectContent>
                  {months.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Expiry Year <span className="text-destructive">*</span></label>
              <Select value={expiryYear} onValueChange={v => { setExpiryYear(v); updateExpiry(expiryMonth, v); }}>
                <SelectTrigger className="mt-1 w-28"><SelectValue placeholder="YYYY" /></SelectTrigger>
                <SelectContent>
                  {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {errors.credit_card_expiry && <p className="text-xs text-destructive mt-1">{errors.credit_card_expiry}</p>}
          <p className="text-xs text-muted-foreground">You'll enter the full card number during Amazon setup.</p>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={goBack}>← Back</Button>
        <Button onClick={() => validate() && goNext()}>Continue →</Button>
      </CardFooter>
    </Card>
  );
};

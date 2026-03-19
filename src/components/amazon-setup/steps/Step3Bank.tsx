import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, AlertTriangle, Info } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { useGuidance } from '@/contexts/GuidanceContext';
import { GuidedLabel } from '../GuidedLabel';
import { IntakeField } from '../IntakeField';

export const Step3Bank = () => {
  const { formData, updateField, goNext, goBack, isPlatformSelected } = useIntakeForm();
  const { getGuidance } = useGuidance();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fullAccount, setFullAccount] = useState('');
  const [fullRouting, setFullRouting] = useState('');
  const [accountFocused, setAccountFocused] = useState(false);
  const [routingFocused, setRoutingFocused] = useState(false);

  const hasTikTok = isPlatformSelected('TikTok');
  const hasAmazon = isPlatformSelected('Amazon');
  const hasShopify = isPlatformSelected('Shopify');
  const tiktokOnly = hasTikTok && !hasAmazon && !hasShopify;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!formData.bank_name.trim()) e.bank_name = 'Required';
    if (!formData.account_holder_name.trim()) e.account_holder_name = 'Required';
    if (formData.is_us_bank) {
      if (!fullAccount && !formData.account_number_last4) e.account_number = 'Required';
      if (!fullRouting && !formData.routing_number_last4) e.routing_number = 'Required';
      else if (fullRouting && fullRouting.length !== 9) e.routing_number = 'Must be 9 digits';
    } else {
      if (!formData.iban.trim()) e.iban = 'Required';
      if (!formData.swift_bic.trim()) e.swift_bic = 'Required';
    }
    if (!tiktokOnly) {
      if (!formData.credit_card_last4.trim()) e.credit_card_last4 = 'Required';
      else if (!/^\d{4}$/.test(formData.credit_card_last4)) e.credit_card_last4 = 'Must be 4 digits';
      if (!formData.credit_card_expiry) e.credit_card_expiry = 'Required';
      if (!formData.card_holder_name.trim()) e.card_holder_name = 'Required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleAccountBlur = () => {
    setAccountFocused(false);
    if (fullAccount.length >= 4) updateField('account_number_last4', fullAccount.slice(-4));
  };
  const handleRoutingBlur = () => {
    setRoutingFocused(false);
    if (fullRouting.length >= 4) updateField('routing_number_last4', fullRouting.slice(-4));
  };

  const accountDisplay = accountFocused ? fullAccount : formData.account_number_last4 ? `\u2022\u2022\u2022\u2022${formData.account_number_last4}` : '';
  const routingDisplay = routingFocused ? fullRouting : formData.routing_number_last4 ? `\u2022\u2022\u2022\u2022${formData.routing_number_last4}` : '';

  const holderName = formData.account_holder_name.toLowerCase().trim();
  const ownerName = `${formData.contact_first_name} ${formData.contact_last_name}`.toLowerCase().trim();
  const bizName = formData.business_legal_name.toLowerCase().trim();
  const nameMatch = !holderName || holderName === ownerName || holderName === bizName || bizName.includes(holderName) || holderName.includes(bizName);

  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => String(currentYear + i));
  const [expiryMonth, setExpiryMonth] = useState(formData.credit_card_expiry?.split('/')[0] || '');
  const [expiryYear, setExpiryYear] = useState(formData.credit_card_expiry?.split('/')[1] || '');
  const updateExpiry = (month: string, year: string) => {
    if (month && year) updateField('credit_card_expiry', `${month}/${year.slice(-2)}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bank Account & Payment Details</CardTitle>
        <CardDescription>This information is used to set up your seller payment deposit and subscription.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-primary/5 border-primary/20">
          <Shield className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm">
            Your financial information is handled securely. We only store the last 4 digits of account and routing numbers.
          </AlertDescription>
        </Alert>

        {/* Same bank for all platforms toggle */}
        {formData.selected_platforms.length > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Use the same bank account for all platforms?</p>
            <Switch checked={formData.same_bank_all_platforms} onCheckedChange={v => updateField('same_bank_all_platforms', v)} />
          </div>
        )}

        {/* US / International toggle */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Is this a US bank account?</p>
          <Switch checked={formData.is_us_bank} onCheckedChange={v => updateField('is_us_bank', v)} />
        </div>

        <IntakeField name="bank_name" label="Bank Name" value={formData.bank_name} onChange={updateField} error={errors.bank_name} getGuidance={getGuidance} />

        <div>
          <GuidedLabel label="Account Holder Name" fieldName="account_holder_name" required getGuidance={getGuidance} />
          <p className="text-xs text-muted-foreground">Must match the name on the bank account</p>
          <Input value={formData.account_holder_name} onChange={e => updateField('account_holder_name', e.target.value)} className="mt-1" />
          {errors.account_holder_name && <p className="text-xs text-destructive mt-1">{errors.account_holder_name}</p>}
        </div>

        {!nameMatch && (
          <Alert className="bg-amber-500/5 border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-sm">
              The bank account holder name doesn't match the business owner or business name. Platforms may flag this.
            </AlertDescription>
          </Alert>
        )}

        {formData.is_us_bank ? (
          <>
            <div>
              <label className="text-sm font-medium">Account Number <span className="text-destructive">*</span></label>
              <Input
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
          </>
        ) : (
          <>
            <IntakeField name="iban" label="IBAN" value={formData.iban} onChange={updateField} error={errors.iban} getGuidance={getGuidance} />
            <IntakeField name="swift_bic" label="SWIFT/BIC Code" value={formData.swift_bic} onChange={updateField} error={errors.swift_bic} getGuidance={getGuidance} />
            <div>
              <label className="text-sm font-medium">Bank Country</label>
              <Input value={formData.bank_country} onChange={e => updateField('bank_country', e.target.value)} className="mt-1" />
            </div>
          </>
        )}

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

        {/* TikTok bank email */}
        {hasTikTok && (
          <div>
            <label className="text-sm font-medium">Email Associated with Bank Account</label>
            <p className="text-xs text-muted-foreground">TikTok requires this during bank account setup</p>
            <Input type="email" value={formData.bank_email} onChange={e => updateField('bank_email', e.target.value)} className="mt-1" />
          </div>
        )}

        {hasTikTok && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              For TikTok Shop: Individual sellers must use a personal bank account. Business sellers must use a business bank account. The account name must match your registration name.
            </AlertDescription>
          </Alert>
        )}

        {/* Payment Card section - hidden if TikTok only */}
        {tiktokOnly ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              TikTok Shop doesn't charge monthly fees &mdash; only referral fees per sale. Card info is only needed for Amazon and Shopify subscriptions.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3 pt-4 border-t border-border">
            <h3 className="font-medium text-sm">Payment Card for Seller Fees</h3>
            <p className="text-xs text-muted-foreground">We only store the last 4 digits for reference. You'll securely provide the full card number during a screen-share session with your account specialist.</p>

            <div>
              <label className="text-sm font-medium">Card Holder Name <span className="text-destructive">*</span></label>
              <Input value={formData.card_holder_name} onChange={e => updateField('card_holder_name', e.target.value)} className="mt-1" />
              {errors.card_holder_name && <p className="text-xs text-destructive mt-1">{errors.card_holder_name}</p>}
            </div>

            <div>
              <GuidedLabel label="Card Last 4 Digits" fieldName="credit_card_last4" required getGuidance={getGuidance} />
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
          </div>
        )}

        {/* Per-platform bank sections when not same */}
        {!formData.same_bank_all_platforms && formData.selected_platforms.length > 1 && (
          <div className="space-y-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground">The bank details above will be used for {formData.selected_platforms[0]}. Enter different bank details for other platforms below:</p>
            {hasShopify && formData.selected_platforms[0] !== 'Shopify' && (
              <div className="space-y-3 pl-4 border-l-2 border-border">
                <h4 className="font-medium text-sm">Bank Account for Shopify Payouts</h4>
                <IntakeField name="shopify_bank_name" label="Bank Name" value={formData.shopify_bank_name} onChange={updateField} error={undefined} getGuidance={getGuidance} />
                <IntakeField name="shopify_account_holder" label="Account Holder" value={formData.shopify_account_holder} onChange={updateField} error={undefined} getGuidance={getGuidance} />
              </div>
            )}
            {hasTikTok && formData.selected_platforms[0] !== 'TikTok' && (
              <div className="space-y-3 pl-4 border-l-2 border-border">
                <h4 className="font-medium text-sm">Bank Account for TikTok Payouts</h4>
                <IntakeField name="tiktok_bank_name" label="Bank Name" value={formData.tiktok_bank_name} onChange={updateField} error={undefined} getGuidance={getGuidance} />
                <IntakeField name="tiktok_account_holder" label="Account Holder" value={formData.tiktok_account_holder} onChange={updateField} error={undefined} getGuidance={getGuidance} />
                <div>
                  <label className="text-sm font-medium">Email for TikTok Bank</label>
                  <Input type="email" value={formData.tiktok_bank_email} onChange={e => updateField('tiktok_bank_email', e.target.value)} className="mt-1" />
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={goBack}>&larr; Back</Button>
        <Button onClick={() => validate() && goNext()}>Continue &rarr;</Button>
      </CardFooter>
    </Card>
  );
};

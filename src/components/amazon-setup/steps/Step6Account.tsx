import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart, Store, Video } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { useGuidance } from '@/contexts/GuidanceContext';
import { GuidedLabel } from '../GuidedLabel';
import { SHOPIFY_PLANS } from '../constants';

export const Step6Account = () => {
  const { formData, updateField, goNext, goBack, isPlatformSelected } = useIntakeForm();
  const { getGuidance } = useGuidance();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (isPlatformSelected('Amazon')) {
      if (!formData.amazon_email.trim()) e.amazon_email = 'Required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.amazon_email)) e.amazon_email = 'Invalid email';
      if (!formData.amazon_phone.trim()) e.amazon_phone = 'Required';
    }
    if (isPlatformSelected('Shopify')) {
      if (!formData.shopify_email.trim()) e.shopify_email = 'Required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.shopify_email)) e.shopify_email = 'Invalid email';
    }
    if (isPlatformSelected('TikTok')) {
      if (!formData.tiktok_email.trim()) e.tiktok_email = 'Required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.tiktok_email)) e.tiktok_email = 'Invalid email';
      if (!formData.tiktok_phone.trim()) e.tiktok_phone = 'Required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account Details</CardTitle>
        <CardDescription>Login credentials and plan selections for each platform you're setting up.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Amazon */}
        {isPlatformSelected('Amazon') && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-sm">Amazon Seller Central</h3>
              <Badge variant="secondary" className="text-xs">Amazon</Badge>
            </div>

            <div>
              <GuidedLabel label="Amazon Account Email" fieldName="amazon_email" required getGuidance={getGuidance} />
              <p className="text-xs text-muted-foreground">This email will be the login for the Amazon Seller account. Use a dedicated business email if possible.</p>
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
              <GuidedLabel label="Seller Plan" fieldName="seller_plan" getGuidance={getGuidance} />
              <RadioGroup value={formData.seller_plan} onValueChange={v => updateField('seller_plan', v)} className="mt-2 space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-primary/5">
                  <RadioGroupItem value="Professional" id="pro" className="mt-0.5" />
                  <div>
                    <Label htmlFor="pro" className="font-medium">Professional — $39.99/month</Label>
                    <p className="text-xs text-muted-foreground mt-1">Recommended for serious sellers. No per-item fees, access to advanced tools.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg border border-border">
                  <RadioGroupItem value="Individual" id="ind" className="mt-0.5" />
                  <div>
                    <Label htmlFor="ind" className="font-medium">Individual — $0.99 per item sold</Label>
                    <p className="text-xs text-muted-foreground mt-1">Best for fewer than 40 items/month.</p>
                  </div>
                </div>
              </RadioGroup>
            </div>
          </div>
        )}

        {/* Shopify */}
        {isPlatformSelected('Shopify') && (
          <div className={`space-y-4 ${isPlatformSelected('Amazon') ? 'pt-4 border-t border-border' : ''}`}>
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-sm">Shopify Store</h3>
              <Badge variant="secondary" className="text-xs">Shopify</Badge>
            </div>

            <div>
              <GuidedLabel label="Shopify Account Email" fieldName="shopify_email" required getGuidance={getGuidance} />
              <p className="text-xs text-muted-foreground">The email used to log in to Shopify admin.</p>
              <Input type="email" value={formData.shopify_email} onChange={e => updateField('shopify_email', e.target.value)} className="mt-1" />
              {errors.shopify_email && <p className="text-xs text-destructive mt-1">{errors.shopify_email}</p>}
            </div>

            <div>
              <GuidedLabel label="Shopify Plan" fieldName="shopify_plan" getGuidance={getGuidance} />
              <RadioGroup value={formData.shopify_plan} onValueChange={v => updateField('shopify_plan', v)} className="mt-2 space-y-2">
                {SHOPIFY_PLANS.map(plan => (
                  <div key={plan.value} className="flex items-start gap-3 p-3 rounded-lg border border-border">
                    <RadioGroupItem value={plan.value} id={`acct-shopify-${plan.value}`} className="mt-0.5" />
                    <div>
                      <Label htmlFor={`acct-shopify-${plan.value}`} className="font-medium">{plan.label}</Label>
                      <p className="text-xs text-muted-foreground">{plan.description}</p>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </div>
        )}

        {/* TikTok */}
        {isPlatformSelected('TikTok') && (
          <div className={`space-y-4 ${isPlatformSelected('Amazon') || isPlatformSelected('Shopify') ? 'pt-4 border-t border-border' : ''}`}>
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-sm">TikTok Shop</h3>
              <Badge variant="secondary" className="text-xs">TikTok</Badge>
            </div>

            <div>
              <GuidedLabel label="TikTok Shop Email" fieldName="tiktok_email" required getGuidance={getGuidance} />
              <p className="text-xs text-muted-foreground">Email for your TikTok Shop Seller Center account.</p>
              <Input type="email" value={formData.tiktok_email} onChange={e => updateField('tiktok_email', e.target.value)} className="mt-1" />
              {errors.tiktok_email && <p className="text-xs text-destructive mt-1">{errors.tiktok_email}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">TikTok Shop Phone <span className="text-destructive">*</span></label>
              <p className="text-xs text-muted-foreground">TikTok will send verification codes to this number.</p>
              <Input type="tel" value={formData.tiktok_phone} onChange={e => updateField('tiktok_phone', e.target.value)} className="mt-1" />
              {errors.tiktok_phone && <p className="text-xs text-destructive mt-1">{errors.tiktok_phone}</p>}
            </div>

            <div>
              <GuidedLabel label="TikTok Handle" fieldName="tiktok_handle" getGuidance={getGuidance} />
              <p className="text-xs text-muted-foreground">Your @username — helps link your creator and shop accounts.</p>
              <Input value={formData.tiktok_handle} onChange={e => updateField('tiktok_handle', e.target.value)}
                placeholder="@yourbrand" className="mt-1" />
            </div>
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

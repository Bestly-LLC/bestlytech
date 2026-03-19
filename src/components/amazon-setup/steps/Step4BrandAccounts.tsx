import { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Info, ShoppingCart, Store, Video } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { useGuidance } from '@/contexts/GuidanceContext';
import {
  PRODUCT_CATEGORIES, SHOPIFY_PLANS, SHIPPING_METHODS, TIKTOK_CATEGORIES, TIKTOK_FULFILLMENT,
  AMAZON_MARKETPLACES, SHOPIFY_THEME_STYLES, SHOPIFY_PAYMENT_GATEWAYS, TIKTOK_PRICE_RANGES,
  US_STATES, autoFormatPhone,
} from '../constants';
import { GuidedLabel } from '../GuidedLabel';
import { IntakeField } from '../IntakeField';
import { DocumentUpload } from '../DocumentUpload';

export const Step4BrandAccounts = () => {
  const { formData, updateField, goNext, goBack, isPlatformSelected } = useIntakeForm();
  const { getGuidance } = useGuidance();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const hasAmazon = isPlatformSelected('Amazon');
  const hasShopify = isPlatformSelected('Shopify');
  const hasTikTok = isPlatformSelected('TikTok');

  const validate = () => {
    const e: Record<string, string> = {};
    if (hasAmazon) {
      if (!formData.product_category) e.product_category = 'Required';
      if (!formData.number_of_products) e.number_of_products = 'Required';
      if (!formData.fulfillment_method) e.fulfillment_method = 'Required';
      if (!formData.amazon_email.trim()) e.amazon_email = 'Required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.amazon_email)) e.amazon_email = 'Invalid email';
      if (!formData.amazon_phone.trim()) e.amazon_phone = 'Required';
    }
    if (hasShopify) {
      if (!formData.shopify_store_name.trim()) e.shopify_store_name = 'Required';
      if (!formData.shopify_email.trim()) e.shopify_email = 'Required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.shopify_email)) e.shopify_email = 'Invalid email';
    }
    if (hasTikTok) {
      if (!formData.tiktok_shop_name.trim()) e.tiktok_shop_name = 'Required';
      if (!formData.tiktok_category) e.tiktok_category = 'Required';
      if (!formData.tiktok_email.trim()) e.tiktok_email = 'Required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.tiktok_email)) e.tiktok_email = 'Invalid email';
      if (!formData.tiktok_phone.trim()) e.tiktok_phone = 'Required';
    }
    if (formData.owns_brand && !formData.brand_name.trim()) e.brand_name = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand, Products & Account Details</CardTitle>
        <CardDescription>Tell us about your brand, products, and how you'd like your accounts set up.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            We'll create your accounts using the email addresses below. You'll receive login credentials securely after setup is complete.
          </AlertDescription>
        </Alert>

        {/* Shared Brand Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Do you own a brand for your products?</p>
            <Switch checked={formData.owns_brand} onCheckedChange={v => updateField('owns_brand', v)} />
          </div>

          {formData.owns_brand && (
            <div className="space-y-3 pl-4 border-l-2 border-border">
              <IntakeField name="brand_name" label="Brand Name" value={formData.brand_name} onChange={updateField} error={errors.brand_name} getGuidance={getGuidance} />

              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Active registered trademark?</p>
                <Switch checked={formData.has_trademark} onCheckedChange={v => updateField('has_trademark', v)} />
              </div>
              {formData.has_trademark && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">Trademark Registration Number</label>
                    <Input value={formData.trademark_number} onChange={e => updateField('trademark_number', e.target.value)} className="mt-1" />
                  </div>
                  <DocumentUpload documentType="TrademarkDoc" label="Trademark Document" />
                </div>
              )}

              {hasAmazon && (
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Enrolled in Amazon Brand Registry?</p>
                  <Switch checked={formData.brand_registry_enrolled} onCheckedChange={v => updateField('brand_registry_enrolled', v)} />
                </div>
              )}

              <DocumentUpload documentType="BrandLogo" label="Brand Logo" description="Upload your brand logo for store branding" />
            </div>
          )}
        </div>

        {/* ──── AMAZON ──── */}
        {hasAmazon && (
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-sm">Amazon Seller Central</h3>
              <Badge variant="secondary" className="text-xs">Amazon</Badge>
            </div>

            {/* Account credentials */}
            <div className="flex items-center justify-between">
              <p className="text-sm">Do you already have an Amazon Seller account?</p>
              <Switch checked={formData.has_existing_amazon_account} onCheckedChange={v => updateField('has_existing_amazon_account', v)} />
            </div>
            {formData.has_existing_amazon_account && (
              <p className="text-xs text-muted-foreground pl-1">You'll need to share access rather than having a new account created.</p>
            )}

            <IntakeField name="amazon_email" label="Amazon Account Email" type="email" value={formData.amazon_email} onChange={updateField} error={errors.amazon_email} getGuidance={getGuidance} />
            <div>
              <GuidedLabel label="Amazon Account Phone" fieldName="amazon_phone" required getGuidance={getGuidance} />
              <Input value={formData.amazon_phone} onChange={e => updateField('amazon_phone', autoFormatPhone(e.target.value))} placeholder="(XXX) XXX-XXXX" className="mt-1" type="tel" />
              {errors.amazon_phone && <p className="text-xs text-destructive mt-1">{errors.amazon_phone}</p>}
            </div>

            <div>
              <GuidedLabel label="Seller Plan" fieldName="seller_plan" getGuidance={getGuidance} />
              <RadioGroup value={formData.seller_plan} onValueChange={v => updateField('seller_plan', v)} className="mt-2 space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-primary/5">
                  <RadioGroupItem value="Professional" id="pro" className="mt-0.5" />
                  <div>
                    <Label htmlFor="pro" className="font-medium">Professional &mdash; $39.99/month</Label>
                    <p className="text-xs text-muted-foreground mt-1">Recommended for serious sellers.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg border border-border">
                  <RadioGroupItem value="Individual" id="ind" className="mt-0.5" />
                  <div>
                    <Label htmlFor="ind" className="font-medium">Individual &mdash; $0.99 per item sold</Label>
                    <p className="text-xs text-muted-foreground mt-1">Best for fewer than 40 items/month.</p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            {/* Amazon-specific brand/product fields */}
            <div>
              <GuidedLabel label="Amazon Store/Brand Display Name" fieldName="amazon_store_name" getGuidance={getGuidance} />
              <p className="text-xs text-muted-foreground">Name customers will see. Leave blank to use your business name.</p>
              <Input value={formData.amazon_store_name} onChange={e => updateField('amazon_store_name', e.target.value)} className="mt-1" />
            </div>

            <div>
              <GuidedLabel label="Target Amazon Marketplace" fieldName="target_amazon_marketplace" getGuidance={getGuidance} />
              <Select value={formData.target_amazon_marketplace} onValueChange={v => updateField('target_amazon_marketplace', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AMAZON_MARKETPLACES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm">Do you have existing product listings or ASINs?</p>
              <Switch checked={formData.has_existing_amazon_listings} onCheckedChange={v => updateField('has_existing_amazon_listings', v)} />
            </div>

            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1">
                <GuidedLabel label="Do you have UPCs for all your products?" fieldName="has_upcs" getGuidance={getGuidance} />
              </div>
              <Switch checked={formData.has_upcs} onCheckedChange={v => updateField('has_upcs', v)} />
            </div>
            {!formData.has_upcs && <p className="text-xs text-muted-foreground pl-1">No problem &mdash; we'll apply for a GTIN exemption.</p>}

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Diversity certifications?</p>
                <p className="text-xs text-muted-foreground">Minority, Women, Veteran, or LGBT-owned</p>
              </div>
              <Switch checked={formData.has_diversity_certs} onCheckedChange={v => updateField('has_diversity_certs', v)} />
            </div>
            {formData.has_diversity_certs && <DocumentUpload documentType="DiversityCert" label="Diversity Certification Document" />}

            <div>
              <GuidedLabel label="Product Category" fieldName="product_category" required getGuidance={getGuidance} />
              <Select value={formData.product_category} onValueChange={v => updateField('product_category', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.product_category && <p className="text-xs text-destructive mt-1">{errors.product_category}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">Number of Products to List <span className="text-destructive">*</span></label>
              <Select value={formData.number_of_products} onValueChange={v => updateField('number_of_products', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select range" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1-5">1-5</SelectItem>
                  <SelectItem value="6-20">6-20</SelectItem>
                  <SelectItem value="21-50">21-50</SelectItem>
                  <SelectItem value="50+">50+</SelectItem>
                </SelectContent>
              </Select>
              {errors.number_of_products && <p className="text-xs text-destructive mt-1">{errors.number_of_products}</p>}
            </div>

            <div>
              <GuidedLabel label="Fulfillment Method" fieldName="fulfillment_method" required getGuidance={getGuidance} />
              <RadioGroup value={formData.fulfillment_method} onValueChange={v => updateField('fulfillment_method', v)} className="mt-2 space-y-2">
                <div className="flex items-center gap-2"><RadioGroupItem value="FBM" id="fbm" /><Label htmlFor="fbm">I'll ship orders myself (FBM)</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="FBA" id="fba" /><Label htmlFor="fba">Amazon will store and ship (FBA)</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="Both" id="both" /><Label htmlFor="both">Both / Not sure yet</Label></div>
              </RadioGroup>
              {errors.fulfillment_method && <p className="text-xs text-destructive mt-1">{errors.fulfillment_method}</p>}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm">Do you plan to use Amazon FBA warehousing?</p>
              <Switch checked={formData.plan_fba_warehousing} onCheckedChange={v => updateField('plan_fba_warehousing', v)} />
            </div>

            <div>
              <label className="text-sm font-medium">Brief Product Description</label>
              <Textarea value={formData.product_description} onChange={e => updateField('product_description', e.target.value)}
                placeholder="Describe what you're selling" className="mt-1" rows={3} />
            </div>
          </div>
        )}

        {/* ──── SHOPIFY ──── */}
        {hasShopify && (
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-sm">Shopify Store</h3>
              <Badge variant="secondary" className="text-xs">Shopify</Badge>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm">Do you already have a Shopify account?</p>
              <Switch checked={formData.has_existing_shopify_account} onCheckedChange={v => updateField('has_existing_shopify_account', v)} />
            </div>

            <IntakeField name="shopify_email" label="Shopify Account Email" type="email" value={formData.shopify_email} onChange={updateField} error={errors.shopify_email} getGuidance={getGuidance} />
            <div>
              <label className="text-sm font-medium">Shopify Account Phone</label>
              <Input value={formData.shopify_phone} onChange={e => updateField('shopify_phone', autoFormatPhone(e.target.value))} placeholder="(XXX) XXX-XXXX" className="mt-1" type="tel" />
            </div>

            <IntakeField name="shopify_store_name" label="Shopify Store Name" value={formData.shopify_store_name} onChange={updateField} error={errors.shopify_store_name} getGuidance={getGuidance} />

            <div className="flex items-center justify-between">
              <p className="text-sm">Do you already have a Shopify store?</p>
              <Switch checked={formData.has_existing_shopify} onCheckedChange={v => updateField('has_existing_shopify', v)} />
            </div>
            {formData.has_existing_shopify && (
              <div>
                <label className="text-sm font-medium">Existing Shopify URL</label>
                <Input value={formData.existing_shopify_url} onChange={e => updateField('existing_shopify_url', e.target.value)}
                  placeholder="https://your-store.myshopify.com" className="mt-1" />
              </div>
            )}

            <div>
              <GuidedLabel label="Shopify Plan Preference" fieldName="shopify_plan" getGuidance={getGuidance} />
              <RadioGroup value={formData.shopify_plan} onValueChange={v => updateField('shopify_plan', v)} className="mt-2 space-y-2">
                {SHOPIFY_PLANS.map(plan => (
                  <div key={plan.value} className="flex items-start gap-3 p-3 rounded-lg border border-border">
                    <RadioGroupItem value={plan.value} id={`shopify-${plan.value}`} className="mt-0.5" />
                    <div>
                      <Label htmlFor={`shopify-${plan.value}`} className="font-medium">{plan.label}</Label>
                      <p className="text-xs text-muted-foreground">{plan.description}</p>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* Domain */}
            <div className="flex items-center justify-between">
              <p className="text-sm">Do you already have a domain?</p>
              <Switch checked={formData.shopify_has_domain} onCheckedChange={v => updateField('shopify_has_domain', v)} />
            </div>
            {formData.shopify_has_domain ? (
              <IntakeField name="shopify_domain" label="Your Domain" value={formData.shopify_domain} onChange={updateField} error={{}} getGuidance={getGuidance} placeholder="yourbrand.com" />
            ) : (
              <div>
                <label className="text-sm font-medium">Preferred Domain Name</label>
                <p className="text-xs text-muted-foreground">We'll help you purchase and set it up</p>
                <Input value={formData.shopify_preferred_domain} onChange={e => updateField('shopify_preferred_domain', e.target.value)} placeholder="yourbrand.com" className="mt-1" />
              </div>
            )}

            {/* Theme */}
            <div>
              <label className="text-sm font-medium">Preferred Store Style/Theme</label>
              <Select value={formData.shopify_theme_style} onValueChange={v => updateField('shopify_theme_style', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select style" /></SelectTrigger>
                <SelectContent>
                  {SHOPIFY_THEME_STYLES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Logo */}
            <div className="flex items-center justify-between">
              <p className="text-sm">Do you have a logo?</p>
              <Switch checked={formData.shopify_has_logo} onCheckedChange={v => updateField('shopify_has_logo', v)} />
            </div>
            {formData.shopify_has_logo && !formData.owns_brand && (
              <DocumentUpload documentType="BrandLogo" label="Store Logo" />
            )}

            {/* Payment gateway */}
            <div>
              <label className="text-sm font-medium">Preferred Payment Gateway</label>
              <Select value={formData.shopify_payment_gateway} onValueChange={v => updateField('shopify_payment_gateway', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SHOPIFY_PAYMENT_GATEWAYS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <GuidedLabel label="Shipping Method" fieldName="shipping_method" getGuidance={getGuidance} />
              <RadioGroup value={formData.shipping_method} onValueChange={v => updateField('shipping_method', v)} className="mt-2 space-y-2">
                {SHIPPING_METHODS.map(m => (
                  <div key={m.value} className="flex items-center gap-2">
                    <RadioGroupItem value={m.value} id={`ship-${m.value}`} />
                    <Label htmlFor={`ship-${m.value}`}>{m.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div>
              <label className="text-sm font-medium">Brief Product Description</label>
              <Textarea value={formData.shopify_product_description} onChange={e => updateField('shopify_product_description', e.target.value)}
                placeholder="Describe what you're selling on Shopify" className="mt-1" rows={3} />
            </div>
          </div>
        )}

        {/* ──── TIKTOK ──── */}
        {hasTikTok && (
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-sm">TikTok Shop</h3>
              <Badge variant="secondary" className="text-xs">TikTok</Badge>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm">Do you already have a TikTok Shop account?</p>
              <Switch checked={formData.has_existing_tiktok_account} onCheckedChange={v => updateField('has_existing_tiktok_account', v)} />
            </div>

            <IntakeField name="tiktok_email" label="TikTok Shop Email" type="email" value={formData.tiktok_email} onChange={updateField} error={errors.tiktok_email} getGuidance={getGuidance} />
            <div>
              <GuidedLabel label="TikTok Shop Phone" fieldName="tiktok_phone" required getGuidance={getGuidance} />
              <Input value={formData.tiktok_phone} onChange={e => updateField('tiktok_phone', autoFormatPhone(e.target.value))} placeholder="(XXX) XXX-XXXX" className="mt-1" type="tel" />
              {errors.tiktok_phone && <p className="text-xs text-destructive mt-1">{errors.tiktok_phone}</p>}
            </div>

            <IntakeField name="tiktok_shop_name" label="TikTok Shop Name" value={formData.tiktok_shop_name} onChange={updateField} error={errors.tiktok_shop_name} getGuidance={getGuidance} />

            <div>
              <GuidedLabel label="TikTok Handle" fieldName="tiktok_handle" getGuidance={getGuidance} />
              <p className="text-xs text-muted-foreground">Your @username on TikTok (if you have one).</p>
              <Input value={formData.tiktok_handle} onChange={e => updateField('tiktok_handle', e.target.value)} placeholder="@yourbrand" className="mt-1" />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm">Do you have a TikTok Creator account?</p>
              <Switch checked={formData.has_tiktok_creator} onCheckedChange={v => updateField('has_tiktok_creator', v)} />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm">Do you have existing TikTok content/followers?</p>
              <Switch checked={formData.tiktok_has_existing_content} onCheckedChange={v => updateField('tiktok_has_existing_content', v)} />
            </div>
            {formData.tiktok_has_existing_content && (
              <div>
                <label className="text-sm font-medium">Approximately how many followers?</label>
                <Input value={formData.tiktok_follower_count} onChange={e => updateField('tiktok_follower_count', e.target.value)} placeholder="e.g. 5000" className="mt-1" />
              </div>
            )}

            <div>
              <GuidedLabel label="Product Category" fieldName="tiktok_category" required getGuidance={getGuidance} />
              <Select value={formData.tiktok_category} onValueChange={v => updateField('tiktok_category', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {TIKTOK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.tiktok_category && <p className="text-xs text-destructive mt-1">{errors.tiktok_category}</p>}
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Some product categories on TikTok require additional documentation (beauty, electronics, jewelry, etc.). We'll let you know if yours needs extra verification.
              </AlertDescription>
            </Alert>

            <div>
              <label className="text-sm font-medium">Product Price Range</label>
              <Select value={formData.tiktok_price_range} onValueChange={v => updateField('tiktok_price_range', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select range" /></SelectTrigger>
                <SelectContent>
                  {TIKTOK_PRICE_RANGES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <GuidedLabel label="Fulfillment Method" fieldName="tiktok_fulfillment" getGuidance={getGuidance} />
              <RadioGroup value={formData.tiktok_fulfillment} onValueChange={v => updateField('tiktok_fulfillment', v)} className="mt-2 space-y-2">
                {TIKTOK_FULFILLMENT.map(m => (
                  <div key={m.value} className="flex items-center gap-2">
                    <RadioGroupItem value={m.value} id={`tt-${m.value}`} />
                    <Label htmlFor={`tt-${m.value}`}>{m.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* Warehouse/Return Address */}
            <div className="space-y-3 pl-4 border-l-2 border-border">
              <h4 className="font-medium text-sm">Warehouse/Return Address</h4>
              <p className="text-xs text-muted-foreground">Must be a physical address (no P.O. boxes). Must be verifiable by USPS.</p>
              <IntakeField name="tiktok_warehouse_address" label="Street Address" value={formData.tiktok_warehouse_address} onChange={updateField} error={{}} getGuidance={getGuidance} required={false} />
              <div className="grid grid-cols-2 gap-3">
                <IntakeField name="tiktok_warehouse_city" label="City" value={formData.tiktok_warehouse_city} onChange={updateField} error={{}} getGuidance={getGuidance} required={false} />
                <div>
                  <label className="text-sm font-medium">State</label>
                  <Select value={formData.tiktok_warehouse_state} onValueChange={v => updateField('tiktok_warehouse_state', v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="State" /></SelectTrigger>
                    <SelectContent>
                      {US_STATES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <IntakeField name="tiktok_warehouse_zip" label="ZIP Code" placeholder="XXXXX" value={formData.tiktok_warehouse_zip} onChange={updateField} error={{}} getGuidance={getGuidance} required={false} />
            </div>

            <div>
              <label className="text-sm font-medium">Brief Product Description</label>
              <Textarea value={formData.tiktok_product_description} onChange={e => updateField('tiktok_product_description', e.target.value)}
                placeholder="Describe what you're selling on TikTok" className="mt-1" rows={3} />
            </div>
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

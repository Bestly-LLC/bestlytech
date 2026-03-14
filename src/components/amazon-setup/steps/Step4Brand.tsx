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
import { PRODUCT_CATEGORIES, SHOPIFY_PLANS, SHIPPING_METHODS, TIKTOK_CATEGORIES, TIKTOK_FULFILLMENT } from '../constants';
import { DocumentUpload } from '../DocumentUpload';

export const Step4Brand = () => {
  const { formData, updateField, goNext, goBack, isPlatformSelected } = useIntakeForm();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    // Amazon validations
    if (isPlatformSelected('Amazon')) {
      if (!formData.product_category) e.product_category = 'Required';
      if (!formData.number_of_products) e.number_of_products = 'Required';
      if (!formData.fulfillment_method) e.fulfillment_method = 'Required';
    }
    // Shopify validations
    if (isPlatformSelected('Shopify')) {
      if (!formData.shopify_store_name.trim()) e.shopify_store_name = 'Required';
    }
    // TikTok validations
    if (isPlatformSelected('TikTok')) {
      if (!formData.tiktok_shop_name.trim()) e.tiktok_shop_name = 'Required';
      if (!formData.tiktok_category) e.tiktok_category = 'Required';
    }
    if (formData.owns_brand && !formData.brand_name.trim()) e.brand_name = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand & Product Details</CardTitle>
        <CardDescription>Tell us about your brand and what you're selling across your selected platforms.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Shared Brand Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Do you own a brand for your products?</p>
            </div>
            <Switch checked={formData.owns_brand} onCheckedChange={v => updateField('owns_brand', v)} />
          </div>

          {formData.owns_brand && (
            <div className="space-y-3 pl-4 border-l-2 border-border">
              <div>
                <label className="text-sm font-medium">Brand Name <span className="text-destructive">*</span></label>
                <Input value={formData.brand_name} onChange={e => updateField('brand_name', e.target.value)} className="mt-1" />
                {errors.brand_name && <p className="text-xs text-destructive mt-1">{errors.brand_name}</p>}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Active registered trademark?</p>
                <Switch checked={formData.has_trademark} onCheckedChange={v => updateField('has_trademark', v)} />
              </div>

              {formData.has_trademark ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium">Trademark Registration Number</label>
                    <Input value={formData.trademark_number} onChange={e => updateField('trademark_number', e.target.value)} className="mt-1" />
                  </div>
                  <DocumentUpload documentType="TrademarkDoc" label="Trademark Document" />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">That's fine — you can register your trademark later.</p>
              )}
            </div>
          )}
        </div>

        {/* Amazon Section */}
        {isPlatformSelected('Amazon') && (
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-sm">Amazon Details</h3>
              <Badge variant="secondary" className="text-xs">Amazon</Badge>
            </div>

            <div>
              <label className="text-sm font-medium">Amazon Store/Brand Display Name</label>
              <p className="text-xs text-muted-foreground">Name customers will see on Amazon. Leave blank to use your business name.</p>
              <Input value={formData.amazon_store_name} onChange={e => updateField('amazon_store_name', e.target.value)} className="mt-1" />
              {!formData.amazon_store_name && (
                <Alert className="mt-2">
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-sm">We'll use your business legal name. You can change this later.</AlertDescription>
                </Alert>
              )}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Do you have UPCs for all your products?</p>
              <Switch checked={formData.has_upcs} onCheckedChange={v => updateField('has_upcs', v)} />
            </div>
            {!formData.has_upcs && (
              <p className="text-xs text-muted-foreground pl-1">No problem — we'll apply for a GTIN exemption during setup.</p>
            )}

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Diversity certifications?</p>
                <p className="text-xs text-muted-foreground">Minority, Women, Veteran, or LGBT-owned</p>
              </div>
              <Switch checked={formData.has_diversity_certs} onCheckedChange={v => updateField('has_diversity_certs', v)} />
            </div>
            {formData.has_diversity_certs && (
              <DocumentUpload documentType="DiversityCert" label="Diversity Certification Document" />
            )}

            <div>
              <label className="text-sm font-medium">Product Category <span className="text-destructive">*</span></label>
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
              <label className="text-sm font-medium">Fulfillment Method <span className="text-destructive">*</span></label>
              <RadioGroup value={formData.fulfillment_method} onValueChange={v => updateField('fulfillment_method', v)} className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="FBM" id="fbm" />
                  <Label htmlFor="fbm">I'll ship orders myself (FBM)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="FBA" id="fba" />
                  <Label htmlFor="fba">Amazon will store and ship (FBA)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="Both" id="both" />
                  <Label htmlFor="both">Both / Not sure yet</Label>
                </div>
              </RadioGroup>
              {errors.fulfillment_method && <p className="text-xs text-destructive mt-1">{errors.fulfillment_method}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">Brief Product Description</label>
              <Textarea value={formData.product_description} onChange={e => updateField('product_description', e.target.value)}
                placeholder="Describe what you're selling in a few sentences" className="mt-1" rows={3} />
            </div>
          </div>
        )}

        {/* Shopify Section */}
        {isPlatformSelected('Shopify') && (
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-sm">Shopify Details</h3>
              <Badge variant="secondary" className="text-xs">Shopify</Badge>
            </div>

            <div>
              <label className="text-sm font-medium">Shopify Store Name <span className="text-destructive">*</span></label>
              <p className="text-xs text-muted-foreground">The name that will appear on your Shopify store.</p>
              <Input value={formData.shopify_store_name} onChange={e => updateField('shopify_store_name', e.target.value)} className="mt-1" />
              {errors.shopify_store_name && <p className="text-xs text-destructive mt-1">{errors.shopify_store_name}</p>}
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Do you already have a Shopify store?</p>
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
              <label className="text-sm font-medium">Shopify Plan Preference</label>
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

            <div>
              <label className="text-sm font-medium">Custom Domain</label>
              <p className="text-xs text-muted-foreground">Already have a domain? Enter it here. Otherwise we'll help you set one up.</p>
              <Input value={formData.shopify_domain} onChange={e => updateField('shopify_domain', e.target.value)}
                placeholder="yourbrand.com" className="mt-1" />
            </div>

            <div>
              <label className="text-sm font-medium">Shipping Method</label>
              <RadioGroup value={formData.shipping_method} onValueChange={v => updateField('shipping_method', v)} className="mt-2 space-y-2">
                {SHIPPING_METHODS.map(m => (
                  <div key={m.value} className="flex items-center gap-2">
                    <RadioGroupItem value={m.value} id={`ship-${m.value}`} />
                    <Label htmlFor={`ship-${m.value}`}>{m.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          </div>
        )}

        {/* TikTok Section */}
        {isPlatformSelected('TikTok') && (
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4 text-primary" />
              <h3 className="font-medium text-sm">TikTok Shop Details</h3>
              <Badge variant="secondary" className="text-xs">TikTok</Badge>
            </div>

            <div>
              <label className="text-sm font-medium">TikTok Shop Name <span className="text-destructive">*</span></label>
              <Input value={formData.tiktok_shop_name} onChange={e => updateField('tiktok_shop_name', e.target.value)} className="mt-1" />
              {errors.tiktok_shop_name && <p className="text-xs text-destructive mt-1">{errors.tiktok_shop_name}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">TikTok Handle</label>
              <p className="text-xs text-muted-foreground">Your @username on TikTok (if you have one).</p>
              <Input value={formData.tiktok_handle} onChange={e => updateField('tiktok_handle', e.target.value)}
                placeholder="@yourbrand" className="mt-1" />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Do you have a TikTok Creator account?</p>
              <Switch checked={formData.has_tiktok_creator} onCheckedChange={v => updateField('has_tiktok_creator', v)} />
            </div>

            <div>
              <label className="text-sm font-medium">Product Category <span className="text-destructive">*</span></label>
              <Select value={formData.tiktok_category} onValueChange={v => updateField('tiktok_category', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {TIKTOK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.tiktok_category && <p className="text-xs text-destructive mt-1">{errors.tiktok_category}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">Fulfillment Method</label>
              <RadioGroup value={formData.tiktok_fulfillment} onValueChange={v => updateField('tiktok_fulfillment', v)} className="mt-2 space-y-2">
                {TIKTOK_FULFILLMENT.map(m => (
                  <div key={m.value} className="flex items-center gap-2">
                    <RadioGroupItem value={m.value} id={`tt-${m.value}`} />
                    <Label htmlFor={`tt-${m.value}`}>{m.label}</Label>
                  </div>
                ))}
              </RadioGroup>
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

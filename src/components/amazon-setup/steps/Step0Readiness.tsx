import { useState, useMemo } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Info, ShoppingCart, Store, Video } from 'lucide-react';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { TIMEZONES, PLATFORM_OPTIONS, READINESS_ITEMS } from '../constants';

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  Amazon: <ShoppingCart className="w-5 h-5" />,
  Shopify: <Store className="w-5 h-5" />,
  TikTok: <Video className="w-5 h-5" />,
};

export const Step0Readiness = () => {
  const { formData, updateField, goNext, isPlatformSelected, togglePlatform } = useIntakeForm();
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Build deduplicated checklist from selected platforms
  const checklist = useMemo(() => {
    const seen = new Set<string>();
    const items: { text: string; platforms: string[] }[] = [];

    for (const platform of formData.selected_platforms) {
      const platformItems = READINESS_ITEMS[platform] || [];
      for (const item of platformItems) {
        if (!seen.has(item.key)) {
          seen.add(item.key);
          items.push({ text: item.text, platforms: [platform] });
        } else {
          const existing = items.find(i => READINESS_ITEMS[platform]?.some(ri => ri.key === item.key && ri.text === item.text) || i.text === item.text);
          if (existing && !existing.platforms.includes(platform)) {
            existing.platforms.push(platform);
          }
        }
      }
    }
    return items;
  }, [formData.selected_platforms]);

  const [checks, setChecks] = useState<Record<string, boolean>>({});

  const toggleCheck = (text: string) => {
    setChecks(prev => ({ ...prev, [text]: !prev[text] }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (formData.selected_platforms.length === 0) e.platforms = 'Select at least one platform';
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
          Select the platforms you'd like to set up, then review what you'll need. This form takes about 15-20 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Platform Selection */}
        <div className="space-y-3">
          <label className="text-sm font-medium">Which platforms are you setting up? <span className="text-destructive">*</span></label>
          <div className="grid gap-3">
            {PLATFORM_OPTIONS.map(p => (
              <label
                key={p.value}
                className={`flex items-center gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  isPlatformSelected(p.value)
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/30'
                }`}
              >
                <Checkbox
                  checked={isPlatformSelected(p.value)}
                  onCheckedChange={() => togglePlatform(p.value)}
                />
                <div className="flex items-center gap-3 flex-1">
                  <span className="text-muted-foreground">{PLATFORM_ICONS[p.value]}</span>
                  <div>
                    <span className="font-medium text-sm">{p.label}</span>
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                  </div>
                </div>
              </label>
            ))}
          </div>
          {errors.platforms && <p className="text-xs text-destructive">{errors.platforms}</p>}
        </div>

        {/* Dynamic Readiness Checklist */}
        {checklist.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Documents & Information Needed</h3>
            {checklist.map((item) => (
              <label key={item.text} className="flex items-start gap-3 cursor-pointer">
                <Checkbox checked={checks[item.text] || false} onCheckedChange={() => toggleCheck(item.text)} className="mt-0.5" />
                <div className="flex-1">
                  <span className="text-sm">{item.text}</span>
                  {item.platforms.length < formData.selected_platforms.length && (
                    <div className="flex gap-1 mt-1">
                      {item.platforms.map(p => (
                        <Badge key={p} variant="secondary" className="text-[10px] px-1.5 py-0">{p}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Don't have all of these yet? No problem — you can save your progress and come back anytime.
          </AlertDescription>
        </Alert>

        {/* Contact Info */}
        <div className="space-y-4 pt-4 border-t border-border">
          <h3 className="font-medium text-base">Contact Information</h3>

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

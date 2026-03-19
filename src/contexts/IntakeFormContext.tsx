import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface IntakeFormData {
  platform: string;
  selected_platforms: string[];
  client_name: string;
  client_email: string;
  client_phone: string;
  preferred_contact_method: string;
  client_timezone: string;
  // Business
  business_legal_name: string;
  business_type: string;
  state_of_registration: string;
  ein: string;
  business_phone: string;
  business_email: string;
  business_website: string;
  years_in_business: string;
  registered_agent_service: string;
  registered_agent_address: string;
  registered_agent_city: string;
  registered_agent_state: string;
  registered_agent_zip: string;
  operating_address: string;
  operating_city: string;
  operating_state: string;
  operating_zip: string;
  addresses_differ: boolean;
  // Owner
  contact_first_name: string;
  contact_middle_name: string;
  contact_last_name: string;
  owner_title: string;
  ownership_percentage: string;
  citizenship_country: string;
  birth_country: string;
  date_of_birth: string;
  ssn_itin: string;
  tax_residency: string;
  id_type: string;
  id_number: string;
  id_expiry_date: string;
  id_country_of_issue: string;
  residential_address: string;
  residential_city: string;
  residential_state: string;
  residential_zip: string;
  phone_number: string;
  // Authorization (merged into owner step)
  setup_by_representative: boolean;
  rep_name: string;
  rep_relationship: string;
  // Bank
  bank_name: string;
  account_holder_name: string;
  account_number_last4: string;
  routing_number_last4: string;
  account_type: string;
  credit_card_last4: string;
  credit_card_expiry: string;
  card_holder_name: string;
  bank_email: string;
  is_us_bank: boolean;
  iban: string;
  swift_bic: string;
  bank_country: string;
  same_bank_all_platforms: boolean;
  // Per-platform bank
  shopify_bank_name: string;
  shopify_account_holder: string;
  shopify_account_last4: string;
  shopify_routing_last4: string;
  shopify_account_type: string;
  tiktok_bank_name: string;
  tiktok_account_holder: string;
  tiktok_account_last4: string;
  tiktok_routing_last4: string;
  tiktok_account_type: string;
  tiktok_bank_email: string;
  // Brand
  has_upcs: boolean;
  has_diversity_certs: boolean;
  owns_brand: boolean;
  brand_name: string;
  has_trademark: boolean;
  trademark_number: string;
  brand_registry_enrolled: boolean;
  // Amazon
  amazon_store_name: string;
  product_category: string;
  number_of_products: string;
  fulfillment_method: string;
  product_description: string;
  amazon_email: string;
  amazon_phone: string;
  seller_plan: string;
  has_existing_amazon_account: boolean;
  has_existing_amazon_listings: boolean;
  target_amazon_marketplace: string;
  plan_fba_warehousing: boolean;
  // Shopify
  shopify_store_name: string;
  shopify_email: string;
  shopify_phone: string;
  shopify_plan: string;
  shopify_domain: string;
  shipping_method: string;
  has_existing_shopify: boolean;
  existing_shopify_url: string;
  has_existing_shopify_account: boolean;
  shopify_has_logo: boolean;
  shopify_theme_style: string;
  shopify_has_domain: boolean;
  shopify_preferred_domain: string;
  shopify_payment_gateway: string;
  shopify_product_description: string;
  // TikTok
  tiktok_shop_name: string;
  tiktok_email: string;
  tiktok_phone: string;
  tiktok_category: string;
  tiktok_fulfillment: string;
  has_tiktok_creator: boolean;
  tiktok_handle: string;
  has_existing_tiktok_account: boolean;
  tiktok_warehouse_address: string;
  tiktok_warehouse_city: string;
  tiktok_warehouse_state: string;
  tiktok_warehouse_zip: string;
  tiktok_has_existing_content: boolean;
  tiktok_follower_count: string;
  tiktok_price_range: string;
  tiktok_product_description: string;
  // Review
  special_instructions: string;
  consent_authorized: boolean;
}

export const defaultFormData: IntakeFormData = {
  platform: 'Amazon',
  selected_platforms: [],
  client_name: '', client_email: '', client_phone: '',
  preferred_contact_method: 'Email', client_timezone: '',
  business_legal_name: '', business_type: '', state_of_registration: '',
  ein: '', business_phone: '', business_email: '', business_website: '',
  years_in_business: '',
  registered_agent_service: '',
  registered_agent_address: '', registered_agent_city: '',
  registered_agent_state: '', registered_agent_zip: '',
  operating_address: '', operating_city: '', operating_state: '', operating_zip: '',
  addresses_differ: false,
  contact_first_name: '', contact_middle_name: '', contact_last_name: '',
  owner_title: '', ownership_percentage: '',
  citizenship_country: 'US', birth_country: 'US', date_of_birth: '',
  ssn_itin: '', tax_residency: 'US Resident',
  id_type: '', id_number: '', id_expiry_date: '', id_country_of_issue: 'US',
  residential_address: '', residential_city: '', residential_state: '', residential_zip: '',
  phone_number: '',
  setup_by_representative: false, rep_name: '', rep_relationship: '',
  bank_name: '', account_holder_name: '',
  account_number_last4: '', routing_number_last4: '',
  account_type: 'Checking',
  credit_card_last4: '', credit_card_expiry: '', card_holder_name: '',
  bank_email: '', is_us_bank: true, iban: '', swift_bic: '', bank_country: '',
  same_bank_all_platforms: true,
  shopify_bank_name: '', shopify_account_holder: '', shopify_account_last4: '',
  shopify_routing_last4: '', shopify_account_type: 'Checking',
  tiktok_bank_name: '', tiktok_account_holder: '', tiktok_account_last4: '',
  tiktok_routing_last4: '', tiktok_account_type: 'Checking', tiktok_bank_email: '',
  has_upcs: false, has_diversity_certs: false,
  owns_brand: false, brand_name: '',
  has_trademark: false, trademark_number: '', brand_registry_enrolled: false,
  amazon_store_name: '', product_category: '', number_of_products: '', fulfillment_method: '',
  product_description: '',
  amazon_email: '', amazon_phone: '', seller_plan: 'Professional',
  has_existing_amazon_account: false, has_existing_amazon_listings: false,
  target_amazon_marketplace: 'US', plan_fba_warehousing: false,
  shopify_store_name: '', shopify_email: '', shopify_phone: '', shopify_plan: 'Basic',
  shopify_domain: '', shipping_method: 'Self', has_existing_shopify: false, existing_shopify_url: '',
  has_existing_shopify_account: false,
  shopify_has_logo: false, shopify_theme_style: '', shopify_has_domain: false,
  shopify_preferred_domain: '', shopify_payment_gateway: 'Shopify Payments',
  shopify_product_description: '',
  tiktok_shop_name: '', tiktok_email: '', tiktok_phone: '',
  tiktok_category: '', tiktok_fulfillment: 'Self', has_tiktok_creator: false, tiktok_handle: '',
  has_existing_tiktok_account: false,
  tiktok_warehouse_address: '', tiktok_warehouse_city: '', tiktok_warehouse_state: '',
  tiktok_warehouse_zip: '',
  tiktok_has_existing_content: false, tiktok_follower_count: '', tiktok_price_range: '',
  tiktok_product_description: '',
  special_instructions: '', consent_authorized: false,
};

interface IntakeFormContextType {
  formData: IntakeFormData;
  updateField: (field: keyof IntakeFormData, value: any) => void;
  updateFields: (fields: Partial<IntakeFormData>) => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  goNext: () => void;
  goBack: () => void;
  formId: string;
  saving: boolean;
  saveNow: () => Promise<void>;
  lastSavedAt: Date | null;
  completedSteps: number[];
  markStepComplete: (step: number) => void;
  status: string;
  setStatus: (s: string) => void;
  uploadedDocs: UploadedDoc[];
  refreshDocs: () => Promise<void>;
  isPlatformSelected: (platform: string) => boolean;
  togglePlatform: (platform: string) => void;
}

export interface UploadedDoc {
  id: string;
  document_type: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
}

const IntakeFormContext = createContext<IntakeFormContextType | null>(null);

export const useIntakeForm = () => {
  const ctx = useContext(IntakeFormContext);
  if (!ctx) throw new Error('useIntakeForm must be used within IntakeFormProvider');
  return ctx;
};

export const IntakeFormProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [formData, setFormData] = useState<IntakeFormData>(defaultFormData);
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [status, setStatus] = useState('Draft');
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { toast } = useToast();
  const lastSavedRef = useRef<string>('');

  const formId = searchParams.get('id') || '';

  const isPlatformSelected = useCallback((platform: string) => {
    return formData.selected_platforms.includes(platform);
  }, [formData.selected_platforms]);

  const togglePlatform = useCallback((platform: string) => {
    setFormData(prev => {
      const platforms = prev.selected_platforms.includes(platform)
        ? prev.selected_platforms.filter(p => p !== platform)
        : [...prev.selected_platforms, platform];
      const mainPlatform = platforms.length === 1 ? platforms[0] : platforms.length > 1 ? 'Multi' : 'Amazon';
      return { ...prev, selected_platforms: platforms, platform: mainPlatform };
    });
  }, []);

  useEffect(() => {
    if (!searchParams.get('id')) {
      const newId = crypto.randomUUID();
      setSearchParams({ id: newId }, { replace: true });
    }
  }, []);

  useEffect(() => {
    const id = searchParams.get('id');
    if (!id || loaded) return;
    const load = async () => {
      const { data } = await (supabase as any).from('seller_intakes').select('*').eq('id', id).maybeSingle();
      if (data) {
        const mapped: Partial<IntakeFormData> = {};
        for (const key of Object.keys(defaultFormData)) {
          if (data[key] !== undefined && data[key] !== null) {
            (mapped as any)[key] = data[key];
          }
        }
        setFormData(prev => ({ ...prev, ...mapped }));
        setCompletedSteps(data.completed_steps || []);
        setStatus(data.status || 'Draft');
      }
      setLoaded(true);
    };
    load();
  }, [searchParams.get('id')]);

  const refreshDocs = useCallback(async () => {
    const id = searchParams.get('id');
    if (!id) return;
    const { data } = await (supabase as any).from('intake_documents').select('*').eq('intake_id', id);
    if (data) setUploadedDocs(data);
  }, [searchParams.get('id')]);

  useEffect(() => {
    if (loaded && formId) refreshDocs();
  }, [loaded, formId]);

  const updateField = useCallback((field: keyof IntakeFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const updateFields = useCallback((fields: Partial<IntakeFormData>) => {
    setFormData(prev => ({ ...prev, ...fields }));
  }, []);

  const markStepComplete = useCallback((step: number) => {
    setCompletedSteps(prev => prev.includes(step) ? prev : [...prev, step].sort());
  }, []);

  const saveNow = useCallback(async () => {
    const id = searchParams.get('id');
    if (!id) return;
    const dataStr = JSON.stringify(formData);
    if (dataStr === lastSavedRef.current) return;
    setSaving(true);
    try {
      const payload: any = { id, ...formData, completed_steps: completedSteps, status };
      await (supabase as any).from('seller_intakes').upsert(payload, { onConflict: 'id' });
      lastSavedRef.current = dataStr;
      setLastSavedAt(new Date());
    } catch (e) {
      console.error('Save failed', e);
    } finally {
      setSaving(false);
    }
  }, [formData, completedSteps, status, searchParams.get('id')]);

  useEffect(() => {
    if (!loaded || !formId) return;
    const interval = setInterval(() => { saveNow(); }, 30000);
    return () => clearInterval(interval);
  }, [saveNow, loaded, formId]);

  // 6 steps: 0-5
  const goNext = useCallback(() => {
    markStepComplete(currentStep);
    setCurrentStep(prev => Math.min(prev + 1, 5));
    saveNow();
  }, [currentStep, markStepComplete, saveNow]);

  const goBack = useCallback(() => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  }, []);

  return (
    <IntakeFormContext.Provider value={{
      formData, updateField, updateFields, currentStep, setCurrentStep,
      goNext, goBack, formId, saving, saveNow, lastSavedAt,
      completedSteps, markStepComplete,
      status, setStatus, uploadedDocs, refreshDocs, isPlatformSelected, togglePlatform,
    }}>
      {children}
    </IntakeFormContext.Provider>
  );
};

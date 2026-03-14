import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface IntakeFormData {
  platform: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  preferred_contact_method: string;
  client_timezone: string;
  business_legal_name: string;
  business_type: string;
  state_of_registration: string;
  ein: string;
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
  contact_first_name: string;
  contact_middle_name: string;
  contact_last_name: string;
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
  bank_name: string;
  account_holder_name: string;
  account_number_last4: string;
  routing_number_last4: string;
  account_type: string;
  credit_card_last4: string;
  credit_card_expiry: string;
  has_upcs: boolean;
  has_diversity_certs: boolean;
  owns_brand: boolean;
  brand_name: string;
  amazon_store_name: string;
  has_trademark: boolean;
  trademark_number: string;
  product_category: string;
  number_of_products: string;
  fulfillment_method: string;
  product_description: string;
  setup_by_representative: boolean;
  rep_name: string;
  rep_relationship: string;
  amazon_email: string;
  amazon_phone: string;
  seller_plan: string;
}

const defaultFormData: IntakeFormData = {
  platform: 'Amazon',
  client_name: '', client_email: '', client_phone: '',
  preferred_contact_method: 'Email', client_timezone: '',
  business_legal_name: '', business_type: '', state_of_registration: '',
  ein: '', registered_agent_service: '',
  registered_agent_address: '', registered_agent_city: '',
  registered_agent_state: '', registered_agent_zip: '',
  operating_address: '', operating_city: '', operating_state: '', operating_zip: '',
  addresses_differ: false,
  contact_first_name: '', contact_middle_name: '', contact_last_name: '',
  citizenship_country: 'US', birth_country: 'US', date_of_birth: '',
  ssn_itin: '', tax_residency: 'US Resident',
  id_type: '', id_number: '', id_expiry_date: '', id_country_of_issue: 'US',
  residential_address: '', residential_city: '', residential_state: '', residential_zip: '',
  phone_number: '',
  bank_name: '', account_holder_name: '',
  account_number_last4: '', routing_number_last4: '',
  account_type: 'Checking',
  credit_card_last4: '', credit_card_expiry: '',
  has_upcs: false, has_diversity_certs: false,
  owns_brand: false, brand_name: '', amazon_store_name: '',
  has_trademark: false, trademark_number: '',
  product_category: '', number_of_products: '', fulfillment_method: '',
  product_description: '',
  setup_by_representative: false, rep_name: '', rep_relationship: '',
  amazon_email: '', amazon_phone: '', seller_plan: 'Professional',
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
  completedSteps: number[];
  markStepComplete: (step: number) => void;
  status: string;
  setStatus: (s: string) => void;
  uploadedDocs: UploadedDoc[];
  refreshDocs: () => Promise<void>;
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
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [status, setStatus] = useState('Draft');
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { toast } = useToast();
  const lastSavedRef = useRef<string>('');

  const formId = searchParams.get('id') || '';

  // Initialize form ID
  useEffect(() => {
    if (!searchParams.get('id')) {
      const newId = crypto.randomUUID();
      setSearchParams({ id: newId }, { replace: true });
    }
  }, []);

  // Load existing draft
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

  // Load uploaded docs
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
      // Remove fields that aren't DB columns
      delete payload.platform; // platform is already a column
      await (supabase as any).from('seller_intakes').upsert(payload, { onConflict: 'id' });
      lastSavedRef.current = dataStr;
      toast({ title: '✓ Draft saved', duration: 2000 });
    } catch (e) {
      console.error('Save failed', e);
    } finally {
      setSaving(false);
    }
  }, [formData, completedSteps, status, searchParams.get('id')]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!loaded || !formId) return;
    const interval = setInterval(() => { saveNow(); }, 30000);
    return () => clearInterval(interval);
  }, [saveNow, loaded, formId]);

  const goNext = useCallback(() => {
    markStepComplete(currentStep);
    setCurrentStep(prev => Math.min(prev + 1, 7));
    saveNow();
  }, [currentStep, markStepComplete, saveNow]);

  const goBack = useCallback(() => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  }, []);

  return (
    <IntakeFormContext.Provider value={{
      formData, updateField, updateFields, currentStep, setCurrentStep,
      goNext, goBack, formId, saving, saveNow, completedSteps, markStepComplete,
      status, setStatus, uploadedDocs, refreshDocs,
    }}>
      {children}
    </IntakeFormContext.Provider>
  );
};

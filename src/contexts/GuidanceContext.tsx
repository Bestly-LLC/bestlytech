import { createContext, useContext, ReactNode } from 'react';
import { useSetupGuidance } from '@/hooks/useSetupGuidance';
import { useIntakeForm } from '@/contexts/IntakeFormContext';

interface GuidanceContextType {
  getGuidance: (fieldName: string) => { guidance_text: string; answer_recommendation: string | null; reason: string | null } | undefined;
  loading: boolean;
}

const GuidanceContext = createContext<GuidanceContextType>({
  getGuidance: () => undefined,
  loading: true,
});

export const useGuidance = () => useContext(GuidanceContext);

export const GuidanceProvider = ({ children }: { children: ReactNode }) => {
  const { formData } = useIntakeForm();
  const platforms = formData.selected_platforms?.length > 0 ? formData.selected_platforms : ['Amazon'];
  const { getGuidance, loading } = useSetupGuidance(platforms);

  return (
    <GuidanceContext.Provider value={{ getGuidance, loading }}>
      {children}
    </GuidanceContext.Provider>
  );
};

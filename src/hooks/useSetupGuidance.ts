import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface GuidanceEntry {
  id: string;
  platform: string;
  section: string;
  field_name: string;
  guidance_text: string;
  answer_recommendation: string | null;
  reason: string | null;
  display_order: number;
}

export function useSetupGuidance(platforms: string[]) {
  const [guidance, setGuidance] = useState<Map<string, GuidanceEntry>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (platforms.length === 0) {
      setLoading(false);
      return;
    }

    const load = async () => {
      const { data } = await supabase
        .from('setup_guidance')
        .select('*')
        .in('platform', [...platforms, 'Shared'])
        .order('display_order');

      const map = new Map<string, GuidanceEntry>();
      (data || []).forEach((entry) => {
        // Key by field_name for quick lookup; platform-specific overrides shared
        const key = entry.field_name;
        if (!map.has(key) || entry.platform !== 'Shared') {
          map.set(key, entry);
        }
      });
      setGuidance(map);
      setLoading(false);
    };

    load();
  }, [platforms.join(',')]);

  const getGuidance = (fieldName: string): GuidanceEntry | undefined => {
    return guidance.get(fieldName);
  };

  return { guidance, getGuidance, loading };
}

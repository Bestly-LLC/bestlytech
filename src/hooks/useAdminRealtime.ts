import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type TableName = "seller_intakes" | "subscriptions" | "granted_access";

interface RealtimeConfig {
  tables: TableName[];
  onNewRecord?: (table: TableName, payload: any) => void;
}

const LABELS: Record<TableName, string> = {
  seller_intakes: "New seller intake submitted",
  subscriptions: "New subscription received",
  granted_access: "New access granted",
};

export function useAdminRealtime({ tables, onNewRecord }: RealtimeConfig) {
  const { toast } = useToast();
  const mountedRef = useRef(true);
  const tablesKeyRef = useRef(tables.join(","));

  useEffect(() => {
    mountedRef.current = true;
    const key = tables.join(",");
    tablesKeyRef.current = key;

    const channel = supabase.channel(`admin-realtime-${key}`);

    tables.forEach((table) => {
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table },
        (payload) => {
          if (!mountedRef.current) return;
          toast({
            title: LABELS[table],
            description: getDescription(table, payload.new),
          });
          onNewRecord?.(table, payload.new);
        }
      );
    });

    channel.subscribe();

    return () => {
      mountedRef.current = false;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(",")]);
}

function getDescription(table: TableName, record: any): string {
  switch (table) {
    case "seller_intakes":
      return record.client_name || record.business_legal_name || "Unknown client";
    case "subscriptions":
      return `${record.email} — ${record.plan}`;
    case "granted_access":
      return record.email;
    default:
      return "";
  }
}

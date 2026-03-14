export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      contact_submissions: {
        Row: {
          category: string | null
          created_at: string | null
          email: string
          id: string
          message: string
          name: string
          status: string | null
          subject: string
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          email: string
          id?: string
          message: string
          name: string
          status?: string | null
          subject: string
        }
        Update: {
          category?: string | null
          created_at?: string | null
          email?: string
          id?: string
          message?: string
          name?: string
          status?: string | null
          subject?: string
        }
        Relationships: []
      }
      cookie_patterns: {
        Row: {
          action_type: string
          cmp_fingerprint: string
          confidence: number
          created_at: string
          domain: string
          id: string
          last_seen: string | null
          report_count: number
          selector: string
          source: string
          success_count: number
          updated_at: string
        }
        Insert: {
          action_type: string
          cmp_fingerprint?: string
          confidence?: number
          created_at?: string
          domain: string
          id?: string
          last_seen?: string | null
          report_count?: number
          selector: string
          source?: string
          success_count?: number
          updated_at?: string
        }
        Update: {
          action_type?: string
          cmp_fingerprint?: string
          confidence?: number
          created_at?: string
          domain?: string
          id?: string
          last_seen?: string | null
          report_count?: number
          selector?: string
          source?: string
          success_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          device_token: string
          id: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_token: string
          id?: string
          platform?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_token?: string
          id?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      granted_access: {
        Row: {
          created_at: string | null
          email: string
          granted_by: string | null
          id: string
          reason: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          granted_by?: string | null
          id?: string
          reason?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      hire_requests: {
        Row: {
          budget_range: string | null
          company: string | null
          created_at: string | null
          description: string
          email: string
          id: string
          name: string
          project_type: string
          referral_source: string | null
          status: string | null
          timeline: string | null
        }
        Insert: {
          budget_range?: string | null
          company?: string | null
          created_at?: string | null
          description: string
          email: string
          id?: string
          name: string
          project_type: string
          referral_source?: string | null
          status?: string | null
          timeline?: string | null
        }
        Update: {
          budget_range?: string | null
          company?: string | null
          created_at?: string | null
          description?: string
          email?: string
          id?: string
          name?: string
          project_type?: string
          referral_source?: string | null
          status?: string | null
          timeline?: string | null
        }
        Relationships: []
      }
      intake_documents: {
        Row: {
          document_type: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          intake_id: string
          mime_type: string | null
          uploaded_at: string | null
        }
        Insert: {
          document_type: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          intake_id: string
          mime_type?: string | null
          uploaded_at?: string | null
        }
        Update: {
          document_type?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          intake_id?: string
          mime_type?: string | null
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_documents_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "seller_intakes"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_validations: {
        Row: {
          created_at: string | null
          field_name: string
          id: string
          intake_id: string
          message: string
          resolved: boolean | null
          resolved_notes: string | null
          severity: string
        }
        Insert: {
          created_at?: string | null
          field_name: string
          id?: string
          intake_id: string
          message: string
          resolved?: boolean | null
          resolved_notes?: string | null
          severity: string
        }
        Update: {
          created_at?: string | null
          field_name?: string
          id?: string
          intake_id?: string
          message?: string
          resolved?: boolean | null
          resolved_notes?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_validations_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "seller_intakes"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_intakes: {
        Row: {
          account_holder_name: string | null
          account_number_last4: string | null
          account_type: string | null
          addresses_differ: boolean | null
          admin_notes: string | null
          amazon_email: string | null
          amazon_phone: string | null
          amazon_store_name: string | null
          bank_name: string | null
          birth_country: string | null
          brand_name: string | null
          business_legal_name: string | null
          business_type: string | null
          citizenship_country: string | null
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          client_timezone: string | null
          completed_steps: number[] | null
          contact_first_name: string | null
          contact_last_name: string | null
          contact_middle_name: string | null
          created_at: string | null
          credit_card_expiry: string | null
          credit_card_last4: string | null
          date_of_birth: string | null
          ein: string | null
          fulfillment_method: string | null
          has_diversity_certs: boolean | null
          has_trademark: boolean | null
          has_upcs: boolean | null
          id: string
          id_country_of_issue: string | null
          id_expiry_date: string | null
          id_number: string | null
          id_type: string | null
          number_of_products: string | null
          operating_address: string | null
          operating_city: string | null
          operating_state: string | null
          operating_zip: string | null
          owns_brand: boolean | null
          phone_number: string | null
          platform: string
          preferred_contact_method: string | null
          product_category: string | null
          product_description: string | null
          registered_agent_address: string | null
          registered_agent_city: string | null
          registered_agent_service: string | null
          registered_agent_state: string | null
          registered_agent_zip: string | null
          rep_name: string | null
          rep_relationship: string | null
          residential_address: string | null
          residential_city: string | null
          residential_state: string | null
          residential_zip: string | null
          routing_number_last4: string | null
          seller_plan: string | null
          setup_by_representative: boolean | null
          ssn_itin: string | null
          state_of_registration: string | null
          status: string
          tax_residency: string | null
          trademark_number: string | null
          updated_at: string | null
        }
        Insert: {
          account_holder_name?: string | null
          account_number_last4?: string | null
          account_type?: string | null
          addresses_differ?: boolean | null
          admin_notes?: string | null
          amazon_email?: string | null
          amazon_phone?: string | null
          amazon_store_name?: string | null
          bank_name?: string | null
          birth_country?: string | null
          brand_name?: string | null
          business_legal_name?: string | null
          business_type?: string | null
          citizenship_country?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          client_timezone?: string | null
          completed_steps?: number[] | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          contact_middle_name?: string | null
          created_at?: string | null
          credit_card_expiry?: string | null
          credit_card_last4?: string | null
          date_of_birth?: string | null
          ein?: string | null
          fulfillment_method?: string | null
          has_diversity_certs?: boolean | null
          has_trademark?: boolean | null
          has_upcs?: boolean | null
          id?: string
          id_country_of_issue?: string | null
          id_expiry_date?: string | null
          id_number?: string | null
          id_type?: string | null
          number_of_products?: string | null
          operating_address?: string | null
          operating_city?: string | null
          operating_state?: string | null
          operating_zip?: string | null
          owns_brand?: boolean | null
          phone_number?: string | null
          platform?: string
          preferred_contact_method?: string | null
          product_category?: string | null
          product_description?: string | null
          registered_agent_address?: string | null
          registered_agent_city?: string | null
          registered_agent_service?: string | null
          registered_agent_state?: string | null
          registered_agent_zip?: string | null
          rep_name?: string | null
          rep_relationship?: string | null
          residential_address?: string | null
          residential_city?: string | null
          residential_state?: string | null
          residential_zip?: string | null
          routing_number_last4?: string | null
          seller_plan?: string | null
          setup_by_representative?: boolean | null
          ssn_itin?: string | null
          state_of_registration?: string | null
          status?: string
          tax_residency?: string | null
          trademark_number?: string | null
          updated_at?: string | null
        }
        Update: {
          account_holder_name?: string | null
          account_number_last4?: string | null
          account_type?: string | null
          addresses_differ?: boolean | null
          admin_notes?: string | null
          amazon_email?: string | null
          amazon_phone?: string | null
          amazon_store_name?: string | null
          bank_name?: string | null
          birth_country?: string | null
          brand_name?: string | null
          business_legal_name?: string | null
          business_type?: string | null
          citizenship_country?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          client_timezone?: string | null
          completed_steps?: number[] | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          contact_middle_name?: string | null
          created_at?: string | null
          credit_card_expiry?: string | null
          credit_card_last4?: string | null
          date_of_birth?: string | null
          ein?: string | null
          fulfillment_method?: string | null
          has_diversity_certs?: boolean | null
          has_trademark?: boolean | null
          has_upcs?: boolean | null
          id?: string
          id_country_of_issue?: string | null
          id_expiry_date?: string | null
          id_number?: string | null
          id_type?: string | null
          number_of_products?: string | null
          operating_address?: string | null
          operating_city?: string | null
          operating_state?: string | null
          operating_zip?: string | null
          owns_brand?: boolean | null
          phone_number?: string | null
          platform?: string
          preferred_contact_method?: string | null
          product_category?: string | null
          product_description?: string | null
          registered_agent_address?: string | null
          registered_agent_city?: string | null
          registered_agent_service?: string | null
          registered_agent_state?: string | null
          registered_agent_zip?: string | null
          rep_name?: string | null
          rep_relationship?: string | null
          residential_address?: string | null
          residential_city?: string | null
          residential_state?: string | null
          residential_zip?: string | null
          routing_number_last4?: string | null
          seller_plan?: string | null
          setup_by_representative?: boolean | null
          ssn_itin?: string | null
          state_of_registration?: string | null
          status?: string
          tax_residency?: string | null
          trademark_number?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      setup_guidance: {
        Row: {
          answer_recommendation: string | null
          display_order: number
          field_name: string
          guidance_text: string
          id: string
          platform: string
          reason: string | null
          section: string
        }
        Insert: {
          answer_recommendation?: string | null
          display_order?: number
          field_name: string
          guidance_text: string
          id?: string
          platform: string
          reason?: string | null
          section: string
        }
        Update: {
          answer_recommendation?: string | null
          display_order?: number
          field_name?: string
          guidance_text?: string
          id?: string
          platform?: string
          reason?: string | null
          section?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string | null
          current_period_end: string | null
          email: string
          id: string
          plan: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_period_end?: string | null
          email: string
          id?: string
          plan: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_period_end?: string | null
          email?: string
          id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      waitlist_subscribers: {
        Row: {
          confirmed: boolean | null
          created_at: string | null
          email: string
          id: string
          products: string[] | null
          source: string | null
          updated_at: string | null
        }
        Insert: {
          confirmed?: boolean | null
          created_at?: string | null
          email: string
          id?: string
          products?: string[] | null
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          confirmed?: boolean | null
          created_at?: string | null
          email?: string
          id?: string
          products?: string[] | null
          source?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      record_pattern_success: {
        Args: { _action_type: string; _domain: string; _selector: string }
        Returns: undefined
      }
      upsert_pattern: {
        Args: {
          _action_type: string
          _cmp_fingerprint?: string
          _domain: string
          _selector: string
          _source?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

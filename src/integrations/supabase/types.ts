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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activation_code_attempts: {
        Row: {
          action: string
          count: number
          email: string
          id: number
          locked_until: string | null
          updated_at: string
          window_start: string
        }
        Insert: {
          action: string
          count?: number
          email: string
          id?: never
          locked_until?: string | null
          updated_at?: string
          window_start?: string
        }
        Update: {
          action?: string
          count?: number
          email?: string
          id?: never
          locked_until?: string | null
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      activation_codes: {
        Row: {
          activated_at: string | null
          active: boolean | null
          code: string
          created_at: string | null
          email: string
          expires_at: string
          id: string
          ip_address: string | null
          last_verified: string | null
          platform: string | null
        }
        Insert: {
          activated_at?: string | null
          active?: boolean | null
          code: string
          created_at?: string | null
          email: string
          expires_at: string
          id?: string
          ip_address?: string | null
          last_verified?: string | null
          platform?: string | null
        }
        Update: {
          activated_at?: string | null
          active?: boolean | null
          code?: string
          created_at?: string | null
          email?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          last_verified?: string | null
          platform?: string | null
        }
        Relationships: []
      }
      admin_activity_log: {
        Row: {
          created_at: string
          description: string
          event_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          created_at?: string
          description: string
          event_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          created_at?: string
          description?: string
          event_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      ai_generation_log: {
        Row: {
          action_type: string | null
          ai_model: string | null
          completion_tokens: number | null
          confidence: number | null
          created_at: string
          domain: string
          error_message: string | null
          html_source: string | null
          id: number
          prompt_tokens: number | null
          selector_generated: string | null
          status: string
        }
        Insert: {
          action_type?: string | null
          ai_model?: string | null
          completion_tokens?: number | null
          confidence?: number | null
          created_at?: string
          domain: string
          error_message?: string | null
          html_source?: string | null
          id?: never
          prompt_tokens?: number | null
          selector_generated?: string | null
          status: string
        }
        Update: {
          action_type?: string | null
          ai_model?: string | null
          completion_tokens?: number | null
          confidence?: number | null
          created_at?: string
          domain?: string
          error_message?: string | null
          html_source?: string | null
          id?: never
          prompt_tokens?: number | null
          selector_generated?: string | null
          status?: string
        }
        Relationships: []
      }
      cloud_briefs: {
        Row: {
          access_token: string
          annual_saas_spend_band: string | null
          biggest_unknown: string | null
          compliance_frameworks: Json
          created_at: string
          current_apps: Json
          domain_owned: string | null
          has_it_lead: string | null
          has_static_ip: string | null
          id: string
          lead_id: string
          office_city: string | null
          office_country: string | null
          office_state: string | null
          preferred_subdomain: string | null
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string
          annual_saas_spend_band?: string | null
          biggest_unknown?: string | null
          compliance_frameworks?: Json
          created_at?: string
          current_apps?: Json
          domain_owned?: string | null
          has_it_lead?: string | null
          has_static_ip?: string | null
          id?: string
          lead_id: string
          office_city?: string | null
          office_country?: string | null
          office_state?: string | null
          preferred_subdomain?: string | null
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          annual_saas_spend_band?: string | null
          biggest_unknown?: string | null
          compliance_frameworks?: Json
          created_at?: string
          current_apps?: Json
          domain_owned?: string | null
          has_it_lead?: string | null
          has_static_ip?: string | null
          id?: string
          lead_id?: string
          office_city?: string | null
          office_country?: string | null
          office_state?: string | null
          preferred_subdomain?: string | null
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_briefs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "cloud_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_briefs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_cloud_lead_funnel"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_deal_events: {
        Row: {
          created_at: string
          deal_id: string | null
          event_payload: Json | null
          event_type: string
          id: string
          lead_id: string | null
          triggered_by: string | null
        }
        Insert: {
          created_at?: string
          deal_id?: string | null
          event_payload?: Json | null
          event_type: string
          id?: string
          lead_id?: string | null
          triggered_by?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string | null
          event_payload?: Json | null
          event_type?: string
          id?: string
          lead_id?: string | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cloud_deal_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "cloud_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_deal_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_cloud_lead_funnel"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "cloud_deal_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "cloud_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_deal_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_cloud_lead_funnel"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_deals: {
        Row: {
          assigned_to: string | null
          cal_event_uuid: string | null
          company_name: string
          created_at: string
          current_stage: number
          deployment_fee_cents: number | null
          deposit_paid_at: string | null
          discovery_call_at: string | null
          docusign_envelope_id: string | null
          go_live_at: string | null
          id: string
          install_data: Json
          install_scheduled_at: string | null
          intake_data: Json
          intake_submitted_at: string | null
          intake_token: string | null
          lead_id: string
          live_data: Json
          monthly_support_fee_cents: number | null
          notes: string | null
          primary_contact_email: string
          primary_contact_name: string
          provisioning_data: Json
          shield_request_token: string | null
          signing_document_url: string | null
          signing_provider: string
          signing_request_id: string | null
          sow_sent_at: string | null
          sow_signed_at: string | null
          stage_changed_at: string
          stripe_customer_id: string | null
          support_tier: string | null
          target_user_count: number | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          cal_event_uuid?: string | null
          company_name: string
          created_at?: string
          current_stage?: number
          deployment_fee_cents?: number | null
          deposit_paid_at?: string | null
          discovery_call_at?: string | null
          docusign_envelope_id?: string | null
          go_live_at?: string | null
          id?: string
          install_data?: Json
          install_scheduled_at?: string | null
          intake_data?: Json
          intake_submitted_at?: string | null
          intake_token?: string | null
          lead_id: string
          live_data?: Json
          monthly_support_fee_cents?: number | null
          notes?: string | null
          primary_contact_email: string
          primary_contact_name: string
          provisioning_data?: Json
          shield_request_token?: string | null
          signing_document_url?: string | null
          signing_provider?: string
          signing_request_id?: string | null
          sow_sent_at?: string | null
          sow_signed_at?: string | null
          stage_changed_at?: string
          stripe_customer_id?: string | null
          support_tier?: string | null
          target_user_count?: number | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          cal_event_uuid?: string | null
          company_name?: string
          created_at?: string
          current_stage?: number
          deployment_fee_cents?: number | null
          deposit_paid_at?: string | null
          discovery_call_at?: string | null
          docusign_envelope_id?: string | null
          go_live_at?: string | null
          id?: string
          install_data?: Json
          install_scheduled_at?: string | null
          intake_data?: Json
          intake_submitted_at?: string | null
          intake_token?: string | null
          lead_id?: string
          live_data?: Json
          monthly_support_fee_cents?: number | null
          notes?: string | null
          primary_contact_email?: string
          primary_contact_name?: string
          provisioning_data?: Json
          shield_request_token?: string | null
          signing_document_url?: string | null
          signing_provider?: string
          signing_request_id?: string | null
          sow_sent_at?: string | null
          sow_signed_at?: string | null
          stage_changed_at?: string
          stripe_customer_id?: string | null
          support_tier?: string | null
          target_user_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloud_deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "cloud_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_cloud_lead_funnel"
            referencedColumns: ["id"]
          },
        ]
      }
      cloud_leads: {
        Row: {
          company_name: string
          company_website: string | null
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string
          id: string
          ip_address: unknown
          notes: string | null
          primary_pain: string | null
          primary_pain_detail: string | null
          referrer: string | null
          source: string | null
          status: string
          updated_at: string
          urgency: string | null
          user_agent: string | null
          user_count_band: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          company_name: string
          company_website?: string | null
          contact_email: string
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          notes?: string | null
          primary_pain?: string | null
          primary_pain_detail?: string | null
          referrer?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          urgency?: string | null
          user_agent?: string | null
          user_count_band: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          company_name?: string
          company_website?: string | null
          contact_email?: string
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          notes?: string | null
          primary_pain?: string | null
          primary_pain_detail?: string | null
          referrer?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          urgency?: string | null
          user_agent?: string | null
          user_count_band?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      cloud_shield_requests: {
        Row: {
          created_at: string
          deal_id: string
          decision_notes: string | null
          id: string
          ip_address: unknown
          reason: string | null
          requested_url: string
          requester_email: string | null
          requester_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          decision_notes?: string | null
          id?: string
          ip_address?: unknown
          reason?: string | null
          requested_url: string
          requester_email?: string | null
          requester_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          decision_notes?: string | null
          id?: string
          ip_address?: unknown
          reason?: string | null
          requested_url?: string
          requester_email?: string | null
          requester_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cloud_shield_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "cloud_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_shield_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_cloud_lead_funnel"
            referencedColumns: ["deal_id"]
          },
        ]
      }
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
          is_active: boolean
          last_seen: string | null
          report_count: number
          selector: string
          source: string
          strategy: string | null
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
          is_active?: boolean
          last_seen?: string | null
          report_count?: number
          selector: string
          source?: string
          strategy?: string | null
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
          is_active?: boolean
          last_seen?: string | null
          report_count?: number
          selector?: string
          source?: string
          strategy?: string | null
          success_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      device_registrations: {
        Row: {
          device_id: string
          email: string
          first_seen: string | null
          id: string
          last_seen: string | null
          platform: string
          user_agent: string | null
        }
        Insert: {
          device_id: string
          email: string
          first_seen?: string | null
          id?: string
          last_seen?: string | null
          platform?: string
          user_agent?: string | null
        }
        Update: {
          device_id?: string
          email?: string
          first_seen?: string | null
          id?: string
          last_seen?: string | null
          platform?: string
          user_agent?: string | null
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
      dismissal_reports: {
        Row: {
          banner_html: string | null
          banner_selector: string | null
          clicked_selector: string
          created_at: string | null
          domain: string
          id: string
        }
        Insert: {
          banner_html?: string | null
          banner_selector?: string | null
          clicked_selector: string
          created_at?: string | null
          domain: string
          id?: string
        }
        Update: {
          banner_html?: string | null
          banner_selector?: string | null
          clicked_selector?: string
          created_at?: string | null
          domain?: string
          id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      external_health: {
        Row: {
          consecutive_failures: number
          created_at: string
          error_message: string | null
          http_code: number | null
          last_checked: string
          last_ok: string | null
          latency_ms: number | null
          service: string
          status: string
          url: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          error_message?: string | null
          http_code?: number | null
          last_checked?: string
          last_ok?: string | null
          latency_ms?: number | null
          service: string
          status: string
          url: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          error_message?: string | null
          http_code?: number | null
          last_checked?: string
          last_ok?: string | null
          latency_ms?: number | null
          service?: string
          status?: string
          url?: string
        }
        Relationships: []
      }
      external_health_history: {
        Row: {
          http_code: number | null
          id: number
          latency_ms: number | null
          recorded_at: string
          service: string
          status: string
        }
        Insert: {
          http_code?: number | null
          id?: number
          latency_ms?: number | null
          recorded_at?: string
          service: string
          status: string
        }
        Update: {
          http_code?: number | null
          id?: number
          latency_ms?: number | null
          recorded_at?: string
          service?: string
          status?: string
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
      home_hub_pihole_stats: {
        Row: {
          active_clients: number
          captured_at: string
          domains_on_blocklist: number
          hourly_chart: Json | null
          id: string
          percent_blocked: number
          queries_blocked: number
          query_types: Json | null
          status: string
          top_blocked: Json | null
          top_permitted: Json | null
          total_queries: number
        }
        Insert: {
          active_clients?: number
          captured_at?: string
          domains_on_blocklist?: number
          hourly_chart?: Json | null
          id?: string
          percent_blocked?: number
          queries_blocked?: number
          query_types?: Json | null
          status: string
          top_blocked?: Json | null
          top_permitted?: Json | null
          total_queries?: number
        }
        Update: {
          active_clients?: number
          captured_at?: string
          domains_on_blocklist?: number
          hourly_chart?: Json | null
          id?: string
          percent_blocked?: number
          queries_blocked?: number
          query_types?: Json | null
          status?: string
          top_blocked?: Json | null
          top_permitted?: Json | null
          total_queries?: number
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
          {
            foreignKeyName: "intake_documents_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "v_ops_intakes"
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
          {
            foreignKeyName: "intake_validations_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "v_ops_intakes"
            referencedColumns: ["id"]
          },
        ]
      }
      missed_banner_reports: {
        Row: {
          ai_attempts: number
          ai_processed_at: string | null
          banner_html: string | null
          cmp_fingerprint: string | null
          created_at: string
          domain: string
          has_working_pattern: boolean
          id: number
          last_reported: string
          page_url: string | null
          report_count: number
          resolved: boolean
          resolved_at: string | null
        }
        Insert: {
          ai_attempts?: number
          ai_processed_at?: string | null
          banner_html?: string | null
          cmp_fingerprint?: string | null
          created_at?: string
          domain: string
          has_working_pattern?: boolean
          id?: never
          last_reported?: string
          page_url?: string | null
          report_count?: number
          resolved?: boolean
          resolved_at?: string | null
        }
        Update: {
          ai_attempts?: number
          ai_processed_at?: string | null
          banner_html?: string | null
          cmp_fingerprint?: string | null
          created_at?: string
          domain?: string
          has_working_pattern?: boolean
          id?: never
          last_reported?: string
          page_url?: string | null
          report_count?: number
          resolved?: boolean
          resolved_at?: string | null
        }
        Relationships: []
      }
      passkey_credentials: {
        Row: {
          counter: number
          created_at: string
          credential_id: string
          device_name: string | null
          device_type: string | null
          id: string
          last_used: string | null
          public_key: string
          transports: string[] | null
          user_id: string
        }
        Insert: {
          counter?: number
          created_at?: string
          credential_id: string
          device_name?: string | null
          device_type?: string | null
          id?: string
          last_used?: string | null
          public_key: string
          transports?: string[] | null
          user_id: string
        }
        Update: {
          counter?: number
          created_at?: string
          credential_id?: string
          device_name?: string | null
          device_type?: string | null
          id?: string
          last_used?: string | null
          public_key?: string
          transports?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      pattern_fix_log: {
        Row: {
          action_taken: string
          created_at: string
          domain: string
          error_message: string | null
          id: number
          issue_type: string
          selector: string
          success: boolean
        }
        Insert: {
          action_taken: string
          created_at?: string
          domain: string
          error_message?: string | null
          id?: never
          issue_type: string
          selector: string
          success?: boolean
        }
        Update: {
          action_taken?: string
          created_at?: string
          domain?: string
          error_message?: string | null
          id?: never
          issue_type?: string
          selector?: string
          success?: boolean
        }
        Relationships: []
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
          bank_country: string | null
          bank_email: string | null
          bank_name: string | null
          birth_country: string | null
          brand_name: string | null
          brand_registry_enrolled: boolean | null
          business_email: string | null
          business_legal_name: string | null
          business_phone: string | null
          business_type: string | null
          business_website: string | null
          card_holder_name: string | null
          citizenship_country: string | null
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          client_timezone: string | null
          completed_steps: number[] | null
          consent_authorized: boolean | null
          contact_first_name: string | null
          contact_last_name: string | null
          contact_middle_name: string | null
          created_at: string | null
          credit_card_expiry: string | null
          credit_card_last4: string | null
          date_of_birth: string | null
          ein: string | null
          existing_shopify_url: string | null
          fulfillment_method: string | null
          has_diversity_certs: boolean | null
          has_existing_amazon_account: boolean | null
          has_existing_amazon_listings: boolean | null
          has_existing_shopify: boolean | null
          has_existing_shopify_account: boolean | null
          has_existing_tiktok_account: boolean | null
          has_tiktok_creator: boolean | null
          has_trademark: boolean | null
          has_upcs: boolean | null
          iban: string | null
          id: string
          id_country_of_issue: string | null
          id_expiry_date: string | null
          id_number: string | null
          id_type: string | null
          is_us_bank: boolean | null
          number_of_products: string | null
          operating_address: string | null
          operating_city: string | null
          operating_state: string | null
          operating_zip: string | null
          owner_title: string | null
          ownership_percentage: string | null
          owns_brand: boolean | null
          phone_number: string | null
          plan_fba_warehousing: boolean | null
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
          requires_session_token: boolean
          residential_address: string | null
          residential_city: string | null
          residential_state: string | null
          residential_zip: string | null
          routing_number_last4: string | null
          same_bank_all_platforms: boolean | null
          selected_platforms: string[] | null
          seller_plan: string | null
          session_token: string | null
          setup_by_representative: boolean | null
          shipping_method: string | null
          shopify_account_holder: string | null
          shopify_account_last4: string | null
          shopify_account_type: string | null
          shopify_bank_name: string | null
          shopify_domain: string | null
          shopify_email: string | null
          shopify_has_domain: boolean | null
          shopify_has_logo: boolean | null
          shopify_payment_gateway: string | null
          shopify_phone: string | null
          shopify_plan: string | null
          shopify_preferred_domain: string | null
          shopify_product_description: string | null
          shopify_routing_last4: string | null
          shopify_store_name: string | null
          shopify_theme_style: string | null
          special_instructions: string | null
          ssn_itin: string | null
          state_of_registration: string | null
          status: string
          swift_bic: string | null
          target_amazon_marketplace: string | null
          tax_residency: string | null
          tiktok_account_holder: string | null
          tiktok_account_last4: string | null
          tiktok_account_type: string | null
          tiktok_bank_email: string | null
          tiktok_bank_name: string | null
          tiktok_category: string | null
          tiktok_email: string | null
          tiktok_follower_count: string | null
          tiktok_fulfillment: string | null
          tiktok_handle: string | null
          tiktok_has_existing_content: boolean | null
          tiktok_phone: string | null
          tiktok_price_range: string | null
          tiktok_product_description: string | null
          tiktok_routing_last4: string | null
          tiktok_shop_name: string | null
          tiktok_warehouse_address: string | null
          tiktok_warehouse_city: string | null
          tiktok_warehouse_state: string | null
          tiktok_warehouse_zip: string | null
          trademark_number: string | null
          updated_at: string | null
          years_in_business: string | null
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
          bank_country?: string | null
          bank_email?: string | null
          bank_name?: string | null
          birth_country?: string | null
          brand_name?: string | null
          brand_registry_enrolled?: boolean | null
          business_email?: string | null
          business_legal_name?: string | null
          business_phone?: string | null
          business_type?: string | null
          business_website?: string | null
          card_holder_name?: string | null
          citizenship_country?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          client_timezone?: string | null
          completed_steps?: number[] | null
          consent_authorized?: boolean | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          contact_middle_name?: string | null
          created_at?: string | null
          credit_card_expiry?: string | null
          credit_card_last4?: string | null
          date_of_birth?: string | null
          ein?: string | null
          existing_shopify_url?: string | null
          fulfillment_method?: string | null
          has_diversity_certs?: boolean | null
          has_existing_amazon_account?: boolean | null
          has_existing_amazon_listings?: boolean | null
          has_existing_shopify?: boolean | null
          has_existing_shopify_account?: boolean | null
          has_existing_tiktok_account?: boolean | null
          has_tiktok_creator?: boolean | null
          has_trademark?: boolean | null
          has_upcs?: boolean | null
          iban?: string | null
          id?: string
          id_country_of_issue?: string | null
          id_expiry_date?: string | null
          id_number?: string | null
          id_type?: string | null
          is_us_bank?: boolean | null
          number_of_products?: string | null
          operating_address?: string | null
          operating_city?: string | null
          operating_state?: string | null
          operating_zip?: string | null
          owner_title?: string | null
          ownership_percentage?: string | null
          owns_brand?: boolean | null
          phone_number?: string | null
          plan_fba_warehousing?: boolean | null
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
          requires_session_token?: boolean
          residential_address?: string | null
          residential_city?: string | null
          residential_state?: string | null
          residential_zip?: string | null
          routing_number_last4?: string | null
          same_bank_all_platforms?: boolean | null
          selected_platforms?: string[] | null
          seller_plan?: string | null
          session_token?: string | null
          setup_by_representative?: boolean | null
          shipping_method?: string | null
          shopify_account_holder?: string | null
          shopify_account_last4?: string | null
          shopify_account_type?: string | null
          shopify_bank_name?: string | null
          shopify_domain?: string | null
          shopify_email?: string | null
          shopify_has_domain?: boolean | null
          shopify_has_logo?: boolean | null
          shopify_payment_gateway?: string | null
          shopify_phone?: string | null
          shopify_plan?: string | null
          shopify_preferred_domain?: string | null
          shopify_product_description?: string | null
          shopify_routing_last4?: string | null
          shopify_store_name?: string | null
          shopify_theme_style?: string | null
          special_instructions?: string | null
          ssn_itin?: string | null
          state_of_registration?: string | null
          status?: string
          swift_bic?: string | null
          target_amazon_marketplace?: string | null
          tax_residency?: string | null
          tiktok_account_holder?: string | null
          tiktok_account_last4?: string | null
          tiktok_account_type?: string | null
          tiktok_bank_email?: string | null
          tiktok_bank_name?: string | null
          tiktok_category?: string | null
          tiktok_email?: string | null
          tiktok_follower_count?: string | null
          tiktok_fulfillment?: string | null
          tiktok_handle?: string | null
          tiktok_has_existing_content?: boolean | null
          tiktok_phone?: string | null
          tiktok_price_range?: string | null
          tiktok_product_description?: string | null
          tiktok_routing_last4?: string | null
          tiktok_shop_name?: string | null
          tiktok_warehouse_address?: string | null
          tiktok_warehouse_city?: string | null
          tiktok_warehouse_state?: string | null
          tiktok_warehouse_zip?: string | null
          trademark_number?: string | null
          updated_at?: string | null
          years_in_business?: string | null
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
          bank_country?: string | null
          bank_email?: string | null
          bank_name?: string | null
          birth_country?: string | null
          brand_name?: string | null
          brand_registry_enrolled?: boolean | null
          business_email?: string | null
          business_legal_name?: string | null
          business_phone?: string | null
          business_type?: string | null
          business_website?: string | null
          card_holder_name?: string | null
          citizenship_country?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          client_timezone?: string | null
          completed_steps?: number[] | null
          consent_authorized?: boolean | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          contact_middle_name?: string | null
          created_at?: string | null
          credit_card_expiry?: string | null
          credit_card_last4?: string | null
          date_of_birth?: string | null
          ein?: string | null
          existing_shopify_url?: string | null
          fulfillment_method?: string | null
          has_diversity_certs?: boolean | null
          has_existing_amazon_account?: boolean | null
          has_existing_amazon_listings?: boolean | null
          has_existing_shopify?: boolean | null
          has_existing_shopify_account?: boolean | null
          has_existing_tiktok_account?: boolean | null
          has_tiktok_creator?: boolean | null
          has_trademark?: boolean | null
          has_upcs?: boolean | null
          iban?: string | null
          id?: string
          id_country_of_issue?: string | null
          id_expiry_date?: string | null
          id_number?: string | null
          id_type?: string | null
          is_us_bank?: boolean | null
          number_of_products?: string | null
          operating_address?: string | null
          operating_city?: string | null
          operating_state?: string | null
          operating_zip?: string | null
          owner_title?: string | null
          ownership_percentage?: string | null
          owns_brand?: boolean | null
          phone_number?: string | null
          plan_fba_warehousing?: boolean | null
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
          requires_session_token?: boolean
          residential_address?: string | null
          residential_city?: string | null
          residential_state?: string | null
          residential_zip?: string | null
          routing_number_last4?: string | null
          same_bank_all_platforms?: boolean | null
          selected_platforms?: string[] | null
          seller_plan?: string | null
          session_token?: string | null
          setup_by_representative?: boolean | null
          shipping_method?: string | null
          shopify_account_holder?: string | null
          shopify_account_last4?: string | null
          shopify_account_type?: string | null
          shopify_bank_name?: string | null
          shopify_domain?: string | null
          shopify_email?: string | null
          shopify_has_domain?: boolean | null
          shopify_has_logo?: boolean | null
          shopify_payment_gateway?: string | null
          shopify_phone?: string | null
          shopify_plan?: string | null
          shopify_preferred_domain?: string | null
          shopify_product_description?: string | null
          shopify_routing_last4?: string | null
          shopify_store_name?: string | null
          shopify_theme_style?: string | null
          special_instructions?: string | null
          ssn_itin?: string | null
          state_of_registration?: string | null
          status?: string
          swift_bic?: string | null
          target_amazon_marketplace?: string | null
          tax_residency?: string | null
          tiktok_account_holder?: string | null
          tiktok_account_last4?: string | null
          tiktok_account_type?: string | null
          tiktok_bank_email?: string | null
          tiktok_bank_name?: string | null
          tiktok_category?: string | null
          tiktok_email?: string | null
          tiktok_follower_count?: string | null
          tiktok_fulfillment?: string | null
          tiktok_handle?: string | null
          tiktok_has_existing_content?: boolean | null
          tiktok_phone?: string | null
          tiktok_price_range?: string | null
          tiktok_product_description?: string | null
          tiktok_routing_last4?: string | null
          tiktok_shop_name?: string | null
          tiktok_warehouse_address?: string | null
          tiktok_warehouse_city?: string | null
          tiktok_warehouse_state?: string | null
          tiktok_warehouse_zip?: string | null
          trademark_number?: string | null
          updated_at?: string | null
          years_in_business?: string | null
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
      shield_url_reports: {
        Row: {
          created_at: string
          deal_id: string | null
          decision_note: string | null
          id: string
          ip_address: unknown
          reason: string | null
          reported_domain: string | null
          reported_url: string
          reporter_email: string | null
          reporter_org: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          deal_id?: string | null
          decision_note?: string | null
          id?: string
          ip_address?: unknown
          reason?: string | null
          reported_domain?: string | null
          reported_url: string
          reporter_email?: string | null
          reporter_org?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string | null
          decision_note?: string | null
          id?: string
          ip_address?: unknown
          reason?: string | null
          reported_domain?: string | null
          reported_url?: string
          reporter_email?: string | null
          reporter_org?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shield_url_reports_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "cloud_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shield_url_reports_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_cloud_lead_funnel"
            referencedColumns: ["deal_id"]
          },
        ]
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
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_alert_state: {
        Row: {
          down_systems: string[]
          id: number
          is_down: boolean
          last_alert_at: string | null
          last_alert_sent: string | null
          last_alerted_systems: string[]
          last_checked: string | null
          pending_match_count: number
          pending_systems: string[]
          updated_at: string
        }
        Insert: {
          down_systems?: string[]
          id?: number
          is_down?: boolean
          last_alert_at?: string | null
          last_alert_sent?: string | null
          last_alerted_systems?: string[]
          last_checked?: string | null
          pending_match_count?: number
          pending_systems?: string[]
          updated_at?: string
        }
        Update: {
          down_systems?: string[]
          id?: number
          is_down?: boolean
          last_alert_at?: string | null
          last_alert_sent?: string | null
          last_alerted_systems?: string[]
          last_checked?: string | null
          pending_match_count?: number
          pending_systems?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
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
      webauthn_challenges: {
        Row: {
          challenge: string
          created_at: string
          email: string | null
          expires_at: string
          id: string
          type: string
          user_id: string | null
        }
        Insert: {
          challenge: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          type: string
          user_id?: string | null
        }
        Update: {
          challenge?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string | null
          email: string | null
          event_type: string
          id: string
          payload: Json | null
          stripe_event_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          event_type: string
          id?: string
          payload?: Json | null
          stripe_event_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          event_type?: string
          id?: string
          payload?: Json | null
          stripe_event_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_cloud_lead_funnel: {
        Row: {
          brief_submitted_at: string | null
          company_name: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string | null
          deal_id: string | null
          deal_stage: number | null
          funnel_state: string | null
          id: string | null
          primary_pain: string | null
          stage_changed_at: string | null
          status: string | null
          urgency: string | null
          user_count_band: string | null
        }
        Relationships: []
      }
      v_cloud_pipeline: {
        Row: {
          current_stage: number | null
          deal_count: number | null
          total_deployment_value_cents: number | null
          total_monthly_value_cents: number | null
        }
        Relationships: []
      }
      v_cloud_shield_pending: {
        Row: {
          company_name: string | null
          created_at: string | null
          deal_id: string | null
          id: string | null
          lead_id: string | null
          reason: string | null
          requested_url: string | null
          requester_email: string | null
          requester_name: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cloud_deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "cloud_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_cloud_lead_funnel"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_shield_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "cloud_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cloud_shield_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_cloud_lead_funnel"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      v_cookieyeti_ai_stats: {
        Row: {
          failures: number | null
          success_rate: number | null
          successes: number | null
          total_completion_tokens: number | null
          total_generations: number | null
          total_prompt_tokens: number | null
          unique_domains_processed: number | null
        }
        Relationships: []
      }
      v_cookieyeti_missed_queue: {
        Row: {
          ai_attempts: number | null
          ai_processed_at: string | null
          cmp_fingerprint: string | null
          domain: string | null
          has_working_pattern: boolean | null
          id: number | null
          last_reported: string | null
          page_url: string | null
          priority: string | null
          report_count: number | null
          resolved: boolean | null
        }
        Insert: {
          ai_attempts?: number | null
          ai_processed_at?: string | null
          cmp_fingerprint?: string | null
          domain?: string | null
          has_working_pattern?: boolean | null
          id?: number | null
          last_reported?: string | null
          page_url?: string | null
          priority?: never
          report_count?: number | null
          resolved?: boolean | null
        }
        Update: {
          ai_attempts?: number | null
          ai_processed_at?: string | null
          cmp_fingerprint?: string | null
          domain?: string | null
          has_working_pattern?: boolean | null
          id?: number | null
          last_reported?: string | null
          page_url?: string | null
          priority?: never
          report_count?: number | null
          resolved?: boolean | null
        }
        Relationships: []
      }
      v_cookieyeti_pattern_stats: {
        Row: {
          action_type: string | null
          cmp_fingerprint: string | null
          confidence: number | null
          created_at: string | null
          domain: string | null
          id: string | null
          is_active: boolean | null
          last_seen: string | null
          report_count: number | null
          selector: string | null
          source: string | null
          strategy: string | null
          success_count: number | null
          success_rate: number | null
          updated_at: string | null
        }
        Insert: {
          action_type?: string | null
          cmp_fingerprint?: string | null
          confidence?: number | null
          created_at?: string | null
          domain?: string | null
          id?: string | null
          is_active?: boolean | null
          last_seen?: string | null
          report_count?: number | null
          selector?: string | null
          source?: string | null
          strategy?: string | null
          success_count?: number | null
          success_rate?: never
          updated_at?: string | null
        }
        Update: {
          action_type?: string | null
          cmp_fingerprint?: string | null
          confidence?: number | null
          created_at?: string | null
          domain?: string | null
          id?: string | null
          is_active?: boolean | null
          last_seen?: string | null
          report_count?: number | null
          selector?: string | null
          source?: string | null
          strategy?: string | null
          success_count?: number | null
          success_rate?: never
          updated_at?: string | null
        }
        Relationships: []
      }
      v_cookieyeti_platform_stats: {
        Row: {
          device_count: number | null
          platform: string | null
          source: string | null
        }
        Relationships: []
      }
      v_dashboard_overview: {
        Row: {
          active_activations: number | null
          active_patterns: number | null
          active_subscriptions: number | null
          confirmed_waitlist: number | null
          down_systems: string[] | null
          draft_intakes: number | null
          emails_failed: number | null
          emails_sent: number | null
          generated_at: string | null
          new_contacts: number | null
          new_hire_requests: number | null
          successful_ai_generations: number | null
          successful_fixes: number | null
          suppressed_emails: number | null
          system_is_down: boolean | null
          total_activation_codes: number | null
          total_ai_generations: number | null
          total_contacts: number | null
          total_device_registrations: number | null
          total_dismissals: number | null
          total_hire_requests: number | null
          total_intakes: number | null
          total_missed_reports: number | null
          total_passkeys: number | null
          total_patterns: number | null
          total_push_devices: number | null
          total_subscriptions: number | null
          total_users: number | null
          total_waitlist: number | null
          total_webhooks: number | null
          unresolved_reports: number | null
        }
        Relationships: []
      }
      v_growth_product_interest: {
        Row: {
          interest_count: number | null
          product_name: string | null
        }
        Relationships: []
      }
      v_growth_waitlist: {
        Row: {
          confirmation_rate: number | null
          confirmed: number | null
          total_signups: number | null
          unconfirmed: number | null
          unique_products_interest: number | null
        }
        Relationships: []
      }
      v_ops_activity_feed: {
        Row: {
          created_at: string | null
          description: string | null
          event_type: string | null
          id: string | null
          metadata: Json | null
        }
        Relationships: []
      }
      v_ops_contacts: {
        Row: {
          category: string | null
          created_at: string | null
          effective_status: string | null
          email: string | null
          id: string | null
          message: string | null
          name: string | null
          status: string | null
          subject: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          effective_status?: never
          email?: string | null
          id?: string | null
          message?: string | null
          name?: string | null
          status?: string | null
          subject?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          effective_status?: never
          email?: string | null
          id?: string | null
          message?: string | null
          name?: string | null
          status?: string | null
          subject?: string | null
        }
        Relationships: []
      }
      v_ops_email_health: {
        Row: {
          bounce_suppressions: number | null
          complaint_suppressions: number | null
          current_batch_size: number | null
          current_send_delay_ms: number | null
          suppressed_addresses: number | null
          total_bounced: number | null
          total_complained: number | null
          total_dlq: number | null
          total_failed: number | null
          total_sent: number | null
          total_suppressed: number | null
          unsubscribe_suppressions: number | null
        }
        Relationships: []
      }
      v_ops_hire_pipeline: {
        Row: {
          budget_range: string | null
          company: string | null
          created_at: string | null
          description: string | null
          effective_status: string | null
          email: string | null
          id: string | null
          name: string | null
          project_type: string | null
          referral_source: string | null
          status: string | null
          timeline: string | null
        }
        Insert: {
          budget_range?: string | null
          company?: string | null
          created_at?: string | null
          description?: string | null
          effective_status?: never
          email?: string | null
          id?: string | null
          name?: string | null
          project_type?: string | null
          referral_source?: string | null
          status?: string | null
          timeline?: string | null
        }
        Update: {
          budget_range?: string | null
          company?: string | null
          created_at?: string | null
          description?: string | null
          effective_status?: never
          email?: string | null
          id?: string | null
          name?: string | null
          project_type?: string | null
          referral_source?: string | null
          status?: string | null
          timeline?: string | null
        }
        Relationships: []
      }
      v_ops_intakes: {
        Row: {
          admin_notes: string | null
          business_legal_name: string | null
          client_email: string | null
          client_name: string | null
          created_at: string | null
          id: string | null
          platform: string | null
          selected_platforms: string[] | null
          status: string | null
          steps_completed: number | null
          updated_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          business_legal_name?: string | null
          client_email?: string | null
          client_name?: string | null
          created_at?: string | null
          id?: string | null
          platform?: string | null
          selected_platforms?: string[] | null
          status?: string | null
          steps_completed?: never
          updated_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          business_legal_name?: string | null
          client_email?: string | null
          client_name?: string | null
          created_at?: string | null
          id?: string | null
          platform?: string | null
          selected_platforms?: string[] | null
          status?: string | null
          steps_completed?: never
          updated_at?: string | null
        }
        Relationships: []
      }
      v_ops_pihole_latest: {
        Row: {
          active_clients: number | null
          captured_at: string | null
          domains_on_blocklist: number | null
          hourly_chart: Json | null
          id: string | null
          percent_blocked: number | null
          queries_blocked: number | null
          query_types: Json | null
          status: string | null
          top_blocked: Json | null
          top_permitted: Json | null
          total_queries: number | null
        }
        Relationships: []
      }
      v_revenue_subscriptions: {
        Row: {
          active: number | null
          canceled: number | null
          expired: number | null
          lifetime_plans: number | null
          monthly_plans: number | null
          past_due: number | null
          total: number | null
          yearly_plans: number | null
        }
        Relationships: []
      }
      v_revenue_webhook_log: {
        Row: {
          created_at: string | null
          email: string | null
          event_type: string | null
          id: string | null
          stripe_event_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          event_type?: string | null
          id?: string | null
          stripe_event_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          event_type?: string | null
          id?: string | null
          stripe_event_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      auto_fix_pattern_issues: { Args: never; Returns: Json }
      check_activation_rate_limit: {
        Args: { p_action: string; p_email: string }
        Returns: Json
      }
      check_system_health_sql: { Args: never; Returns: Json }
      cleanup_activation_rate_limits: { Args: never; Returns: undefined }
      cleanup_expired_activation_codes: { Args: never; Returns: undefined }
      cleanup_expired_challenges: { Args: never; Returns: undefined }
      cleanup_old_pihole_stats: { Args: never; Returns: undefined }
      current_intake_token: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      find_dismissal_consensus: { Args: never; Returns: Json }
      get_action_type_stats: { Args: never; Returns: Json }
      get_ai_generation_candidates: { Args: { _limit: number }; Returns: Json }
      get_cmp_distribution: { Args: never; Returns: Json }
      get_community_overview: { Args: never; Returns: Json }
      get_confidence_distribution: { Args: never; Returns: Json }
      get_cookieyeti_timeline: { Args: { days_back?: number }; Returns: Json }
      get_daily_pattern_activity: { Args: { p_days?: number }; Returns: Json }
      get_dashboard_overview: { Args: never; Returns: Json }
      get_pattern_issues: { Args: { p_limit?: number }; Returns: Json }
      get_public_status: {
        Args: never
        Returns: {
          current_status: string
          daily_uptime: Json
          last_checked: string
          service: string
          uptime_24h_pct: number
          uptime_30d_pct: number
        }[]
      }
      get_recently_learned: { Args: { p_limit?: number }; Returns: Json }
      get_sms_config: { Args: never; Returns: Json }
      get_source_breakdown: { Args: never; Returns: Json }
      get_stripe_config: { Args: never; Returns: Json }
      get_top_domains: { Args: { p_limit?: number }; Returns: Json }
      get_unresolved_reports: { Args: { p_limit?: number }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invoke_edge_function: {
        Args: { function_slug: string; payload?: Json }
        Returns: number
      }
      log_admin_activity: {
        Args: { p_description: string; p_event_type: string; p_metadata?: Json }
        Returns: string
      }
      mark_ai_processed: {
        Args: { _domain: string; _resolved?: boolean }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      process_user_reports: { Args: never; Returns: Json }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_pattern_success: {
        Args: { _action_type: string; _domain: string; _selector: string }
        Returns: undefined
      }
      report_missed_banner_with_html: {
        Args: {
          _banner_html?: string
          _cmp_fingerprint?: string
          _domain: string
          _page_url?: string
        }
        Returns: undefined
      }
      reset_failed_domains_cron: { Args: never; Returns: Json }
      run_maintenance_cron: { Args: never; Returns: Json }
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
      app_role: "admin" | "moderator" | "user"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const

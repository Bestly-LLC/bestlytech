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
      admin_challenges: {
        Row: {
          challenge: string
          created_at: string
          expires_at: string
          purpose: string
        }
        Insert: {
          challenge: string
          created_at?: string
          expires_at?: string
          purpose: string
        }
        Update: {
          challenge?: string
          created_at?: string
          expires_at?: string
          purpose?: string
        }
        Relationships: []
      }
      admin_chat_actions: {
        Row: {
          args: Json | null
          created_at: string
          id: string
          ok: boolean
          result: Json | null
          thread_id: string | null
          tool: string
        }
        Insert: {
          args?: Json | null
          created_at?: string
          id?: string
          ok?: boolean
          result?: Json | null
          thread_id?: string | null
          tool: string
        }
        Update: {
          args?: Json | null
          created_at?: string
          id?: string
          ok?: boolean
          result?: Json | null
          thread_id?: string | null
          tool?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_chat_actions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "admin_chat_thread_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_chat_actions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "admin_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_chat_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          role: string
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "admin_chat_thread_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "admin_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_chat_threads: {
        Row: {
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      admin_device_logins: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          code: string
          created_at: string
          expires_at: string
          id: string
          ip: string | null
          match_num: number | null
          secret_sha256: string
          status: string
          used_at: string | null
          user_agent: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          code: string
          created_at?: string
          expires_at?: string
          id?: string
          ip?: string | null
          match_num?: number | null
          secret_sha256: string
          status?: string
          used_at?: string | null
          user_agent?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          ip?: string | null
          match_num?: number | null
          secret_sha256?: string
          status?: string
          used_at?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      admin_enrol_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          note: string | null
          used_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string
          note?: string | null
          used_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          note?: string | null
          used_at?: string | null
        }
        Relationships: []
      }
      admin_notifications: {
        Row: {
          body: string | null
          created_at: string
          dedupe_key: string | null
          entity_key: string | null
          id: string
          kind: string
          read_at: string | null
          severity: string
          title: string
          url: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          entity_key?: string | null
          id?: string
          kind: string
          read_at?: string | null
          severity?: string
          title: string
          url?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          entity_key?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          severity?: string
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      admin_passkeys: {
        Row: {
          alg: number
          created_at: string
          credential_id: string
          id: string
          label: string | null
          last_used_at: string | null
          public_key_jwk: Json
          rp_id: string
          sign_count: number
        }
        Insert: {
          alg: number
          created_at?: string
          credential_id: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          public_key_jwk: Json
          rp_id?: string
          sign_count?: number
        }
        Update: {
          alg?: number
          created_at?: string
          credential_id?: string
          id?: string
          label?: string | null
          last_used_at?: string | null
          public_key_jwk?: Json
          rp_id?: string
          sign_count?: number
        }
        Relationships: []
      }
      admin_sessions: {
        Row: {
          created_at: string
          expires_at: string
          last_seen_at: string | null
          passkey_id: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          last_seen_at?: string | null
          passkey_id?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          last_seen_at?: string | null
          passkey_id?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_sessions_passkey_id_fkey"
            columns: ["passkey_id"]
            isOneToOne: false
            referencedRelation: "admin_passkeys"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_site_changes: {
        Row: {
          action: string
          actor: string
          created_at: string
          id: string
          message: string | null
          paths: string[]
          repo: string
          request_id: number | null
          result: Json | null
          status: string
        }
        Insert: {
          action: string
          actor?: string
          created_at?: string
          id?: string
          message?: string | null
          paths?: string[]
          repo: string
          request_id?: number | null
          result?: Json | null
          status?: string
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          id?: string
          message?: string | null
          paths?: string[]
          repo?: string
          request_id?: number | null
          result?: Json | null
          status?: string
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
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      approval_clients: {
        Row: {
          access_token: string
          active: boolean
          approvers: string[]
          brand_note: string | null
          claim_gate_ack: Json | null
          contact_email: string | null
          contact_name: string | null
          created_at: string
          guide_only: boolean
          id: string
          kind: string
          name: string
          notify_email: boolean
          publish_mode: string
          sandbox: boolean
          slug: string
          social_brand: string | null
          talk_room: string | null
        }
        Insert: {
          access_token?: string
          active?: boolean
          approvers?: string[]
          brand_note?: string | null
          claim_gate_ack?: Json | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          guide_only?: boolean
          id?: string
          kind?: string
          name: string
          notify_email?: boolean
          publish_mode?: string
          sandbox?: boolean
          slug: string
          social_brand?: string | null
          talk_room?: string | null
        }
        Update: {
          access_token?: string
          active?: boolean
          approvers?: string[]
          brand_note?: string | null
          claim_gate_ack?: Json | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          guide_only?: boolean
          id?: string
          kind?: string
          name?: string
          notify_email?: boolean
          publish_mode?: string
          sandbox?: boolean
          slug?: string
          social_brand?: string | null
          talk_room?: string | null
        }
        Relationships: []
      }
      approval_item_events: {
        Row: {
          actor_kind: string
          at: string
          id: number
          item_id: string
          kind: string
          payload: Json | null
          staff_id: string | null
        }
        Insert: {
          actor_kind: string
          at?: string
          id?: number
          item_id: string
          kind: string
          payload?: Json | null
          staff_id?: string | null
        }
        Update: {
          actor_kind?: string
          at?: string
          id?: number
          item_id?: string
          kind?: string
          payload?: Json | null
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_item_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_item_events_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_items: {
        Row: {
          caption: string | null
          client_id: string
          content_version: number
          created_at: string
          decided_at: string | null
          external_ref: string | null
          id: string
          internal_status: string | null
          media_type: string
          media_url: string | null
          needs_render_at: string | null
          needs_render_why: string | null
          platform: string | null
          position: number
          posted_at: string | null
          posted_note: string | null
          provenance: Json | null
          regen_last_run_at: string | null
          regen_requested_at: string | null
          scheduled_for: string | null
          stage: string
          status: string
          thumb_url: string | null
          title: string
          work_by: string | null
          work_eta_at: string | null
          work_kind: string | null
          work_note: string | null
          work_started_at: string | null
        }
        Insert: {
          caption?: string | null
          client_id: string
          content_version?: number
          created_at?: string
          decided_at?: string | null
          external_ref?: string | null
          id?: string
          internal_status?: string | null
          media_type?: string
          media_url?: string | null
          needs_render_at?: string | null
          needs_render_why?: string | null
          platform?: string | null
          position?: number
          posted_at?: string | null
          posted_note?: string | null
          provenance?: Json | null
          regen_last_run_at?: string | null
          regen_requested_at?: string | null
          scheduled_for?: string | null
          stage?: string
          status?: string
          thumb_url?: string | null
          title: string
          work_by?: string | null
          work_eta_at?: string | null
          work_kind?: string | null
          work_note?: string | null
          work_started_at?: string | null
        }
        Update: {
          caption?: string | null
          client_id?: string
          content_version?: number
          created_at?: string
          decided_at?: string | null
          external_ref?: string | null
          id?: string
          internal_status?: string | null
          media_type?: string
          media_url?: string | null
          needs_render_at?: string | null
          needs_render_why?: string | null
          platform?: string | null
          position?: number
          posted_at?: string | null
          posted_note?: string | null
          provenance?: Json | null
          regen_last_run_at?: string | null
          regen_requested_at?: string | null
          scheduled_for?: string | null
          stage?: string
          status?: string
          thumb_url?: string | null
          title?: string
          work_by?: string | null
          work_eta_at?: string | null
          work_kind?: string | null
          work_note?: string | null
          work_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_reviews: {
        Row: {
          content_version: number | null
          created_at: string
          decision: string | null
          id: string
          item_id: string
          note: string | null
          parent_id: string | null
          reviewer_kind: string
          slide: number | null
          staff_id: string | null
        }
        Insert: {
          content_version?: number | null
          created_at?: string
          decision?: string | null
          id?: string
          item_id: string
          note?: string | null
          parent_id?: string | null
          reviewer_kind?: string
          slide?: number | null
          staff_id?: string | null
        }
        Update: {
          content_version?: number | null
          created_at?: string
          decision?: string | null
          id?: string
          item_id?: string
          note?: string | null
          parent_id?: string | null
          reviewer_kind?: string
          slide?: number | null
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_reviews_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_reviews_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "approval_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_reviews_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_slides: {
        Row: {
          copy: Json | null
          id: string
          item_id: string
          media_url: string | null
          position: number
        }
        Insert: {
          copy?: Json | null
          id?: string
          item_id: string
          media_url?: string | null
          position?: number
        }
        Update: {
          copy?: Json | null
          id?: string
          item_id?: string
          media_url?: string | null
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "approval_slides_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_staff: {
        Row: {
          active: boolean
          alt_emails: string[]
          can_promote: boolean
          client_scope: string[] | null
          created_at: string
          email: string | null
          enroll_code_hash: string | null
          enroll_expires_at: string | null
          enroll_max: number
          enroll_uses: number
          id: string
          is_fixture: boolean
          is_owner: boolean
          is_system: boolean
          name: string
          notify_clients: string[] | null
          notify_general: boolean
          slug: string
        }
        Insert: {
          active?: boolean
          alt_emails?: string[]
          can_promote?: boolean
          client_scope?: string[] | null
          created_at?: string
          email?: string | null
          enroll_code_hash?: string | null
          enroll_expires_at?: string | null
          enroll_max?: number
          enroll_uses?: number
          id?: string
          is_fixture?: boolean
          is_owner?: boolean
          is_system?: boolean
          name: string
          notify_clients?: string[] | null
          notify_general?: boolean
          slug: string
        }
        Update: {
          active?: boolean
          alt_emails?: string[]
          can_promote?: boolean
          client_scope?: string[] | null
          created_at?: string
          email?: string | null
          enroll_code_hash?: string | null
          enroll_expires_at?: string | null
          enroll_max?: number
          enroll_uses?: number
          id?: string
          is_fixture?: boolean
          is_owner?: boolean
          is_system?: boolean
          name?: string
          notify_clients?: string[] | null
          notify_general?: boolean
          slug?: string
        }
        Relationships: []
      }
      approval_variants: {
        Row: {
          alt_text: string | null
          caption: string
          created_at: string
          hashtag_rationale: Json | null
          hashtags: string[]
          id: string
          item_id: string
          link: string | null
          notes: string | null
          platform: string
          surface: string | null
          title: string | null
        }
        Insert: {
          alt_text?: string | null
          caption: string
          created_at?: string
          hashtag_rationale?: Json | null
          hashtags?: string[]
          id?: string
          item_id: string
          link?: string | null
          notes?: string | null
          platform: string
          surface?: string | null
          title?: string | null
        }
        Update: {
          alt_text?: string | null
          caption?: string
          created_at?: string
          hashtag_rationale?: Json | null
          hashtags?: string[]
          id?: string
          item_id?: string
          link?: string | null
          notes?: string | null
          platform?: string
          surface?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_variants_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
        ]
      }
      bestly_credential_registry: {
        Row: {
          account: string | null
          created_at: string
          holds: string | null
          id: string
          notes: string | null
          purpose: string
          reachable_by: string[] | null
          secret_home: string
          secret_ref: string | null
          status: string
          system: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          account?: string | null
          created_at?: string
          holds?: string | null
          id?: string
          notes?: string | null
          purpose: string
          reachable_by?: string[] | null
          secret_home: string
          secret_ref?: string | null
          status?: string
          system: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          account?: string | null
          created_at?: string
          holds?: string | null
          id?: string
          notes?: string | null
          purpose?: string
          reachable_by?: string[] | null
          secret_home?: string
          secret_ref?: string | null
          status?: string
          system?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      bestly_mail: {
        Row: {
          body_text: string | null
          folder: string
          from_addr: string | null
          from_name: string | null
          has_attach: boolean
          id: string
          ingested_at: string
          mailbox: string
          message_id: string | null
          raw_headers: Json | null
          seen: boolean
          sent_at: string | null
          subject: string | null
          to_addrs: string[] | null
          uid: number
        }
        Insert: {
          body_text?: string | null
          folder?: string
          from_addr?: string | null
          from_name?: string | null
          has_attach?: boolean
          id?: string
          ingested_at?: string
          mailbox: string
          message_id?: string | null
          raw_headers?: Json | null
          seen?: boolean
          sent_at?: string | null
          subject?: string | null
          to_addrs?: string[] | null
          uid: number
        }
        Update: {
          body_text?: string | null
          folder?: string
          from_addr?: string | null
          from_name?: string | null
          has_attach?: boolean
          id?: string
          ingested_at?: string
          mailbox?: string
          message_id?: string | null
          raw_headers?: Json | null
          seen?: boolean
          sent_at?: string | null
          subject?: string | null
          to_addrs?: string[] | null
          uid?: number
        }
        Relationships: []
      }
      bestly_mail_action_log: {
        Row: {
          acted_at: string
          action: string
          dry_run: boolean
          folder_from: string
          folder_to: string | null
          from_addr: string | null
          id: string
          mailbox: string
          new_uid: number | null
          rule_name: string | null
          subject: string | null
          uid: number
        }
        Insert: {
          acted_at?: string
          action: string
          dry_run?: boolean
          folder_from: string
          folder_to?: string | null
          from_addr?: string | null
          id?: string
          mailbox: string
          new_uid?: number | null
          rule_name?: string | null
          subject?: string | null
          uid: number
        }
        Update: {
          acted_at?: string
          action?: string
          dry_run?: boolean
          folder_from?: string
          folder_to?: string | null
          from_addr?: string | null
          id?: string
          mailbox?: string
          new_uid?: number | null
          rule_name?: string | null
          subject?: string | null
          uid?: number
        }
        Relationships: []
      }
      bestly_mail_protected: {
        Row: {
          created_at: string
          pattern: string
          reason: string
        }
        Insert: {
          created_at?: string
          pattern: string
          reason: string
        }
        Update: {
          created_at?: string
          pattern?: string
          reason?: string
        }
        Relationships: []
      }
      bestly_mail_queue: {
        Row: {
          action: string
          attempts: number
          claimed_at: string | null
          created_at: string
          error: string | null
          folder: string
          id: string
          mailbox: string
          rule_id: string | null
          status: string
          target: string | null
          uid: number
        }
        Insert: {
          action: string
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          folder?: string
          id?: string
          mailbox: string
          rule_id?: string | null
          status?: string
          target?: string | null
          uid: number
        }
        Update: {
          action?: string
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          folder?: string
          id?: string
          mailbox?: string
          rule_id?: string | null
          status?: string
          target?: string | null
          uid?: number
        }
        Relationships: [
          {
            foreignKeyName: "bestly_mail_queue_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "bestly_mail_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      bestly_mail_rules: {
        Row: {
          action: string
          created_at: string
          enabled: boolean
          id: string
          match_on: string
          min_age: string
          name: string
          pattern: string | null
          priority: number
          target: string | null
        }
        Insert: {
          action: string
          created_at?: string
          enabled?: boolean
          id?: string
          match_on: string
          min_age?: string
          name: string
          pattern?: string | null
          priority?: number
          target?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          enabled?: boolean
          id?: string
          match_on?: string
          min_age?: string
          name?: string
          pattern?: string | null
          priority?: number
          target?: string | null
        }
        Relationships: []
      }
      bestly_mail_state: {
        Row: {
          folder: string
          last_error: string | null
          last_run_at: string | null
          last_uid: number
          mailbox: string
          uid_validity: number | null
        }
        Insert: {
          folder?: string
          last_error?: string | null
          last_run_at?: string | null
          last_uid?: number
          mailbox: string
          uid_validity?: number | null
        }
        Update: {
          folder?: string
          last_error?: string | null
          last_run_at?: string | null
          last_uid?: number
          mailbox?: string
          uid_validity?: number | null
        }
        Relationships: []
      }
      bestly_memory: {
        Row: {
          active: boolean
          area: string
          body: string
          client_slug: string | null
          created_at: string
          id: string
          key: string
          kind: string
          pinned: boolean
          source: string | null
          tags: string[]
          title: string
          updated_at: string
          written_by: string
        }
        Insert: {
          active?: boolean
          area: string
          body: string
          client_slug?: string | null
          created_at?: string
          id?: string
          key: string
          kind?: string
          pinned?: boolean
          source?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          written_by?: string
        }
        Update: {
          active?: boolean
          area?: string
          body?: string
          client_slug?: string | null
          created_at?: string
          id?: string
          key?: string
          kind?: string
          pinned?: boolean
          source?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          written_by?: string
        }
        Relationships: []
      }
      bestly_memory_history: {
        Row: {
          area: string | null
          body: string | null
          change: string | null
          changed_at: string
          id: number
          key: string | null
          memory_id: string | null
          title: string | null
          written_by: string | null
        }
        Insert: {
          area?: string | null
          body?: string | null
          change?: string | null
          changed_at?: string
          id?: number
          key?: string | null
          memory_id?: string | null
          title?: string | null
          written_by?: string | null
        }
        Update: {
          area?: string | null
          body?: string | null
          change?: string | null
          changed_at?: string
          id?: number
          key?: string | null
          memory_id?: string | null
          title?: string | null
          written_by?: string | null
        }
        Relationships: []
      }
      bestly_private_areas: {
        Row: {
          area: string
          why: string | null
        }
        Insert: {
          area: string
          why?: string | null
        }
        Update: {
          area?: string
          why?: string | null
        }
        Relationships: []
      }
      bestly_private_memory: {
        Row: {
          active: boolean
          area: string
          body: string
          client_slug: string | null
          created_at: string
          id: string
          key: string
          kind: string
          pinned: boolean
          source: string | null
          tags: string[]
          title: string
          updated_at: string
          written_by: string
        }
        Insert: {
          active?: boolean
          area: string
          body: string
          client_slug?: string | null
          created_at?: string
          id?: string
          key: string
          kind?: string
          pinned?: boolean
          source?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          written_by?: string
        }
        Update: {
          active?: boolean
          area?: string
          body?: string
          client_slug?: string | null
          created_at?: string
          id?: string
          key?: string
          kind?: string
          pinned?: boolean
          source?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          written_by?: string
        }
        Relationships: []
      }
      bestly_skills: {
        Row: {
          bytes: number
          captured_at: string
          content: string
          custom: boolean
          description: string | null
          id: string
          is_entrypoint: boolean
          name: string | null
          origin: string
          path: string
          sha256: string
          skill: string
        }
        Insert: {
          bytes: number
          captured_at?: string
          content: string
          custom?: boolean
          description?: string | null
          id?: string
          is_entrypoint?: boolean
          name?: string | null
          origin?: string
          path: string
          sha256: string
          skill: string
        }
        Update: {
          bytes?: number
          captured_at?: string
          content?: string
          custom?: boolean
          description?: string | null
          id?: string
          is_entrypoint?: boolean
          name?: string | null
          origin?: string
          path?: string
          sha256?: string
          skill?: string
        }
        Relationships: []
      }
      bluesteel_sweep_acks: {
        Row: {
          acked_at: string
          id: number
          via: string | null
        }
        Insert: {
          acked_at?: string
          id?: number
          via?: string | null
        }
        Update: {
          acked_at?: string
          id?: number
          via?: string | null
        }
        Relationships: []
      }
      bluesteel_sweep_config: {
        Row: {
          alerts_enabled: boolean
          id: number
          skip_dates: string[]
          updated_at: string
        }
        Insert: {
          alerts_enabled?: boolean
          id?: number
          skip_dates?: string[]
          updated_at?: string
        }
        Update: {
          alerts_enabled?: boolean
          id?: number
          skip_dates?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      bluesteel_sweep_runs: {
        Row: {
          alert_body: string | null
          alert_title: string | null
          id: number
          latitude: number | null
          longitude: number | null
          note: string | null
          ntfy_request_id: number | null
          outcome: string
          ran_at: string
          side: string | null
        }
        Insert: {
          alert_body?: string | null
          alert_title?: string | null
          id?: number
          latitude?: number | null
          longitude?: number | null
          note?: string | null
          ntfy_request_id?: number | null
          outcome: string
          ran_at?: string
          side?: string | null
        }
        Update: {
          alert_body?: string | null
          alert_title?: string | null
          id?: number
          latitude?: number | null
          longitude?: number | null
          note?: string | null
          ntfy_request_id?: number | null
          outcome?: string
          ran_at?: string
          side?: string | null
        }
        Relationships: []
      }
      brand_guide_answers: {
        Row: {
          answer: string | null
          answered_at: string
          chosen: string[] | null
          client_id: string
          extra: string[] | null
          question_key: string
          upload_id: string | null
        }
        Insert: {
          answer?: string | null
          answered_at?: string
          chosen?: string[] | null
          client_id: string
          extra?: string[] | null
          question_key: string
          upload_id?: string | null
        }
        Update: {
          answer?: string | null
          answered_at?: string
          chosen?: string[] | null
          client_id?: string
          extra?: string[] | null
          question_key?: string
          upload_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_guide_answers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_guide_answers_question_key_fkey"
            columns: ["question_key"]
            isOneToOne: false
            referencedRelation: "brand_guide_questions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "brand_guide_answers_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "client_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_guide_questions: {
        Row: {
          active: boolean
          example: string | null
          feeds: string | null
          help: string | null
          key: string
          kind: string
          options: Json
          position: number
          prompt: string
        }
        Insert: {
          active?: boolean
          example?: string | null
          feeds?: string | null
          help?: string | null
          key: string
          kind: string
          options?: Json
          position: number
          prompt: string
        }
        Update: {
          active?: boolean
          example?: string | null
          feeds?: string | null
          help?: string | null
          key?: string
          kind?: string
          options?: Json
          position?: number
          prompt?: string
        }
        Relationships: []
      }
      brand_settings: {
        Row: {
          address_city: string
          address_line1: string
          address_line2: string
          address_state: string
          address_zip: string
          brand: string
          checkout_enabled: boolean
          color_accent: string
          color_deep: string
          color_ink: string
          color_muted: string
          color_paper: string
          currency: string
          display_name: string
          email_logo_url: string | null
          email_mark_url: string | null
          facebook_url: string | null
          favicon_url: string | null
          font_body: string
          font_display: string
          free_ship_over_cents: number | null
          instagram_url: string | null
          legal_name: string
          logo_url: string | null
          mail_from_domain: string | null
          radius_px: number
          shipping_flat_cents: number
          support_email: string
          tagline: string
          tax_enabled: boolean
          tiktok_url: string | null
          updated_at: string
        }
        Insert: {
          address_city?: string
          address_line1?: string
          address_line2?: string
          address_state?: string
          address_zip?: string
          brand: string
          checkout_enabled?: boolean
          color_accent?: string
          color_deep?: string
          color_ink?: string
          color_muted?: string
          color_paper?: string
          currency?: string
          display_name?: string
          email_logo_url?: string | null
          email_mark_url?: string | null
          facebook_url?: string | null
          favicon_url?: string | null
          font_body?: string
          font_display?: string
          free_ship_over_cents?: number | null
          instagram_url?: string | null
          legal_name?: string
          logo_url?: string | null
          mail_from_domain?: string | null
          radius_px?: number
          shipping_flat_cents?: number
          support_email?: string
          tagline?: string
          tax_enabled?: boolean
          tiktok_url?: string | null
          updated_at?: string
        }
        Update: {
          address_city?: string
          address_line1?: string
          address_line2?: string
          address_state?: string
          address_zip?: string
          brand?: string
          checkout_enabled?: boolean
          color_accent?: string
          color_deep?: string
          color_ink?: string
          color_muted?: string
          color_paper?: string
          currency?: string
          display_name?: string
          email_logo_url?: string | null
          email_mark_url?: string | null
          facebook_url?: string | null
          favicon_url?: string | null
          font_body?: string
          font_display?: string
          free_ship_over_cents?: number | null
          instagram_url?: string | null
          legal_name?: string
          logo_url?: string | null
          mail_from_domain?: string | null
          radius_px?: number
          shipping_flat_cents?: number
          support_email?: string
          tagline?: string
          tax_enabled?: boolean
          tiktok_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_settings_brand_fkey"
            columns: ["brand"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["brand"]
          },
        ]
      }
      calendar_feeds: {
        Row: {
          client_id: string | null
          created_at: string
          key: string
          kind: string
          last_read: string | null
          revoked_at: string | null
          staff_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          key?: string
          kind: string
          last_read?: string | null
          revoked_at?: string | null
          staff_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          key?: string
          kind?: string
          last_read?: string | null
          revoked_at?: string | null
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feeds_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_feeds_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_block_log: {
        Row: {
          at: string
          blocked_text: string | null
          client_slug: string | null
          context: string | null
          id: string
          reason: string
          rule_id: string | null
        }
        Insert: {
          at?: string
          blocked_text?: string | null
          client_slug?: string | null
          context?: string | null
          id?: string
          reason: string
          rule_id?: string | null
        }
        Update: {
          at?: string
          blocked_text?: string | null
          client_slug?: string | null
          context?: string | null
          id?: string
          reason?: string
          rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_block_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "claim_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_exemptions: {
        Row: {
          approved_by: string | null
          client_slug: string
          created_at: string
          id: string
          reason: string
          rule_id: string
        }
        Insert: {
          approved_by?: string | null
          client_slug: string
          created_at?: string
          id?: string
          reason: string
          rule_id: string
        }
        Update: {
          approved_by?: string | null
          client_slug?: string
          created_at?: string
          id?: string
          reason?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_exemptions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "claim_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_rule_proposals: {
        Row: {
          client_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          rule_id: string | null
          severity: string
          source_question: string
          source_text: string
          status: string
          suggested_label: string | null
          suggested_pattern: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          rule_id?: string | null
          severity?: string
          source_question: string
          source_text: string
          status?: string
          suggested_label?: string | null
          suggested_pattern?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          rule_id?: string | null
          severity?: string
          source_question?: string
          source_text?: string
          status?: string
          suggested_label?: string | null
          suggested_pattern?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_rule_proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_rule_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_rule_proposals_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "claim_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_rules: {
        Row: {
          active: boolean
          approved_at: string | null
          approved_by: string | null
          client_slug: string | null
          created_at: string
          id: string
          label: string
          notes: string | null
          pattern: string
          severity: string
        }
        Insert: {
          active?: boolean
          approved_at?: string | null
          approved_by?: string | null
          client_slug?: string | null
          created_at?: string
          id?: string
          label: string
          notes?: string | null
          pattern: string
          severity: string
        }
        Update: {
          active?: boolean
          approved_at?: string | null
          approved_by?: string | null
          client_slug?: string | null
          created_at?: string
          id?: string
          label?: string
          notes?: string | null
          pattern?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_rules_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
        ]
      }
      client_asks: {
        Row: {
          brief: string | null
          client_id: string
          clip_note: string | null
          clip_url: string | null
          comment_draft: string | null
          comment_draft_at: string | null
          comment_final: string | null
          comment_final_sent_at: string | null
          created_at: string
          created_by: string | null
          deck_tie: string | null
          due: string | null
          filming: Json | null
          hook_example_url: string | null
          hook_opening: Json | null
          hook_style: string | null
          hook_style_source: string | null
          id: string
          item_id: string | null
          kind: string
          licence: string
          received_at: string | null
          reference: Json | null
          script: Json
          sent_at: string | null
          source: Json | null
          status: string
          target_seconds: number | null
          tips: string[]
          title: string
        }
        Insert: {
          brief?: string | null
          client_id: string
          clip_note?: string | null
          clip_url?: string | null
          comment_draft?: string | null
          comment_draft_at?: string | null
          comment_final?: string | null
          comment_final_sent_at?: string | null
          created_at?: string
          created_by?: string | null
          deck_tie?: string | null
          due?: string | null
          filming?: Json | null
          hook_example_url?: string | null
          hook_opening?: Json | null
          hook_style?: string | null
          hook_style_source?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          licence?: string
          received_at?: string | null
          reference?: Json | null
          script?: Json
          sent_at?: string | null
          source?: Json | null
          status?: string
          target_seconds?: number | null
          tips?: string[]
          title: string
        }
        Update: {
          brief?: string | null
          client_id?: string
          clip_note?: string | null
          clip_url?: string | null
          comment_draft?: string | null
          comment_draft_at?: string | null
          comment_final?: string | null
          comment_final_sent_at?: string | null
          created_at?: string
          created_by?: string | null
          deck_tie?: string | null
          due?: string | null
          filming?: Json | null
          hook_example_url?: string | null
          hook_opening?: Json | null
          hook_style?: string | null
          hook_style_source?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          licence?: string
          received_at?: string | null
          reference?: Json | null
          script?: Json
          sent_at?: string | null
          source?: Json | null
          status?: string
          target_seconds?: number | null
          tips?: string[]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_asks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_asks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_asks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
        ]
      }
      client_brand: {
        Row: {
          audience: string | null
          client_id: string
          compiled_at: string | null
          compiled_by: string | null
          feel: string[] | null
          not_me: string | null
          product_terms: string | null
          resource_has: string | null
          resource_hint: string | null
          resource_when: string | null
          theme: Json | null
          voice: Json | null
          wants: Json | null
          words_avoid: string[] | null
          words_use: string[] | null
        }
        Insert: {
          audience?: string | null
          client_id: string
          compiled_at?: string | null
          compiled_by?: string | null
          feel?: string[] | null
          not_me?: string | null
          product_terms?: string | null
          resource_has?: string | null
          resource_hint?: string | null
          resource_when?: string | null
          theme?: Json | null
          voice?: Json | null
          wants?: Json | null
          words_avoid?: string[] | null
          words_use?: string[] | null
        }
        Update: {
          audience?: string | null
          client_id?: string
          compiled_at?: string | null
          compiled_by?: string | null
          feel?: string[] | null
          not_me?: string | null
          product_terms?: string | null
          resource_has?: string | null
          resource_hint?: string | null
          resource_when?: string | null
          theme?: Json | null
          voice?: Json | null
          wants?: Json | null
          words_avoid?: string[] | null
          words_use?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "client_brand_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_brand_compiled_by_fkey"
            columns: ["compiled_by"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      client_brand_theme_backup: {
        Row: {
          client_id: string | null
          taken_at: string | null
          theme: Json | null
          why: string | null
        }
        Insert: {
          client_id?: string | null
          taken_at?: string | null
          theme?: Json | null
          why?: string | null
        }
        Update: {
          client_id?: string | null
          taken_at?: string | null
          theme?: Json | null
          why?: string | null
        }
        Relationships: []
      }
      client_briefs: {
        Row: {
          attachment: string | null
          body: string
          client_id: string
          from_addr: string | null
          from_name: string | null
          id: string
          kind: string
          message_id: string | null
          part: number | null
          received_at: string
          skip_reason: string | null
          source: string
          status: string
          subject: string | null
          used_ask: string | null
          used_at: string | null
          used_item: string | null
        }
        Insert: {
          attachment?: string | null
          body: string
          client_id: string
          from_addr?: string | null
          from_name?: string | null
          id?: string
          kind?: string
          message_id?: string | null
          part?: number | null
          received_at?: string
          skip_reason?: string | null
          source?: string
          status?: string
          subject?: string | null
          used_ask?: string | null
          used_at?: string | null
          used_item?: string | null
        }
        Update: {
          attachment?: string | null
          body?: string
          client_id?: string
          from_addr?: string | null
          from_name?: string | null
          id?: string
          kind?: string
          message_id?: string | null
          part?: number | null
          received_at?: string
          skip_reason?: string | null
          source?: string
          status?: string
          subject?: string | null
          used_ask?: string | null
          used_at?: string | null
          used_item?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_briefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_briefs_used_ask_fkey"
            columns: ["used_ask"]
            isOneToOne: false
            referencedRelation: "client_asks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_briefs_used_item_fkey"
            columns: ["used_item"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
        ]
      }
      client_consents: {
        Row: {
          accepted_at: string
          accepted_via: string
          client_id: string
          id: string
          name_typed: string | null
          notice: string | null
          user_agent: string | null
          version: number
        }
        Insert: {
          accepted_at?: string
          accepted_via?: string
          client_id: string
          id?: string
          name_typed?: string | null
          notice?: string | null
          user_agent?: string | null
          version: number
        }
        Update: {
          accepted_at?: string
          accepted_via?: string
          client_id?: string
          id?: string
          name_typed?: string | null
          notice?: string | null
          user_agent?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_consents_version_fkey"
            columns: ["version"]
            isOneToOne: false
            referencedRelation: "client_terms"
            referencedColumns: ["version"]
          },
        ]
      }
      client_passkeys: {
        Row: {
          client_slug: string
          counter: number
          created_at: string
          credential_id: string
          device_name: string | null
          id: string
          last_used_at: string | null
          public_key: string
          transports: string[] | null
        }
        Insert: {
          client_slug: string
          counter?: number
          created_at?: string
          credential_id: string
          device_name?: string | null
          id?: string
          last_used_at?: string | null
          public_key: string
          transports?: string[] | null
        }
        Update: {
          client_slug?: string
          counter?: number
          created_at?: string
          credential_id?: string
          device_name?: string | null
          id?: string
          last_used_at?: string | null
          public_key?: string
          transports?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "client_passkeys_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
        ]
      }
      client_proof: {
        Row: {
          approved: boolean
          client_id: string
          created_at: string
          id: string
          label: string
        }
        Insert: {
          approved?: boolean
          client_id: string
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          approved?: boolean
          client_id?: string
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_proof_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_reads: {
        Row: {
          client_id: string
          first_at: string
          item_id: string
          last_at: string
          seconds: number
          times: number
        }
        Insert: {
          client_id: string
          first_at?: string
          item_id: string
          last_at?: string
          seconds?: number
          times?: number
        }
        Update: {
          client_id?: string
          first_at?: string
          item_id?: string
          last_at?: string
          seconds?: number
          times?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_reads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_reads_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
        ]
      }
      client_sessions: {
        Row: {
          client_slug: string
          created_at: string
          expires_at: string
          last_seen_at: string
          passkey_id: string | null
          token_hash: string
        }
        Insert: {
          client_slug: string
          created_at?: string
          expires_at?: string
          last_seen_at?: string
          passkey_id?: string | null
          token_hash: string
        }
        Update: {
          client_slug?: string
          created_at?: string
          expires_at?: string
          last_seen_at?: string
          passkey_id?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_sessions_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "client_sessions_passkey_id_fkey"
            columns: ["passkey_id"]
            isOneToOne: false
            referencedRelation: "client_passkeys"
            referencedColumns: ["id"]
          },
        ]
      }
      client_sources: {
        Row: {
          active: boolean
          client_slug: string
          created_at: string
          source_id: string
          weight: number
        }
        Insert: {
          active?: boolean
          client_slug: string
          created_at?: string
          source_id: string
          weight?: number
        }
        Update: {
          active?: boolean
          client_slug?: string
          created_at?: string
          source_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_sources_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "client_sources_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "content_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      client_style_memo: {
        Row: {
          active: boolean
          body: string
          client_id: string
          created_at: string
          id: string
          source: string | null
          staff_id: string | null
          version: number
        }
        Insert: {
          active?: boolean
          body: string
          client_id: string
          created_at?: string
          id?: string
          source?: string | null
          staff_id?: string | null
          version: number
        }
        Update: {
          active?: boolean
          body?: string
          client_id?: string
          created_at?: string
          id?: string
          source?: string | null
          staff_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_style_memo_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_style_memo_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      client_terms: {
        Row: {
          body: Json
          created_at: string
          effective_at: string
          summary: string | null
          title: string
          version: number
        }
        Insert: {
          body: Json
          created_at?: string
          effective_at?: string
          summary?: string | null
          title: string
          version: number
        }
        Update: {
          body?: Json
          created_at?: string
          effective_at?: string
          summary?: string | null
          title?: string
          version?: number
        }
        Relationships: []
      }
      client_uploads: {
        Row: {
          added_by: string | null
          ask_id: string | null
          asset_kind: string | null
          bucket: string
          bytes: number | null
          client_id: string
          created_at: string
          duration_s: number | null
          error: string | null
          height: number | null
          id: string
          mime: string | null
          note: string | null
          parts: number
          path: string
          poster_url: string | null
          purpose: string
          question_key: string | null
          ready_at: string | null
          source: string | null
          status: string
          tags: string[]
          title: string | null
          transcoded_at: string | null
          transcoded_url: string | null
          width: number | null
        }
        Insert: {
          added_by?: string | null
          ask_id?: string | null
          asset_kind?: string | null
          bucket?: string
          bytes?: number | null
          client_id: string
          created_at?: string
          duration_s?: number | null
          error?: string | null
          height?: number | null
          id?: string
          mime?: string | null
          note?: string | null
          parts?: number
          path: string
          poster_url?: string | null
          purpose?: string
          question_key?: string | null
          ready_at?: string | null
          source?: string | null
          status?: string
          tags?: string[]
          title?: string | null
          transcoded_at?: string | null
          transcoded_url?: string | null
          width?: number | null
        }
        Update: {
          added_by?: string | null
          ask_id?: string | null
          asset_kind?: string | null
          bucket?: string
          bytes?: number | null
          client_id?: string
          created_at?: string
          duration_s?: number | null
          error?: string | null
          height?: number | null
          id?: string
          mime?: string | null
          note?: string | null
          parts?: number
          path?: string
          poster_url?: string | null
          purpose?: string
          question_key?: string | null
          ready_at?: string | null
          source?: string | null
          status?: string
          tags?: string[]
          title?: string | null
          transcoded_at?: string | null
          transcoded_url?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "client_uploads_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_uploads_ask_id_fkey"
            columns: ["ask_id"]
            isOneToOne: false
            referencedRelation: "client_asks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_webauthn_challenges: {
        Row: {
          challenge: string
          client_slug: string | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          staff_slug: string | null
        }
        Insert: {
          challenge: string
          client_slug?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          staff_slug?: string | null
        }
        Update: {
          challenge?: string
          client_slug?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          staff_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_webauthn_challenges_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "client_webauthn_challenges_staff_slug_fkey"
            columns: ["staff_slug"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["slug"]
          },
        ]
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
          {
            foreignKeyName: "cloud_briefs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_cloud_leads_needing_action"
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
          {
            foreignKeyName: "cloud_deal_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_cloud_leads_needing_action"
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
          nda_signed_at: string | null
          notes: string | null
          primary_contact_email: string
          primary_contact_name: string
          provisioning_data: Json
          shield_request_token: string | null
          signing_document_url: string | null
          signing_provider: string
          signing_request_id: string | null
          signing_requests: Json
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
          nda_signed_at?: string | null
          notes?: string | null
          primary_contact_email: string
          primary_contact_name: string
          provisioning_data?: Json
          shield_request_token?: string | null
          signing_document_url?: string | null
          signing_provider?: string
          signing_request_id?: string | null
          signing_requests?: Json
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
          nda_signed_at?: string | null
          notes?: string | null
          primary_contact_email?: string
          primary_contact_name?: string
          provisioning_data?: Json
          shield_request_token?: string | null
          signing_document_url?: string | null
          signing_provider?: string
          signing_request_id?: string | null
          signing_requests?: Json
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
          {
            foreignKeyName: "cloud_deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_cloud_leads_needing_action"
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
      content_dates: {
        Row: {
          active: boolean
          audience: string
          day: number | null
          kind: string
          month: number
          name: string
          note: string | null
          nth: number | null
          rule: string
          slug: string
          weekday: number | null
        }
        Insert: {
          active?: boolean
          audience?: string
          day?: number | null
          kind?: string
          month: number
          name: string
          note?: string | null
          nth?: number | null
          rule?: string
          slug: string
          weekday?: number | null
        }
        Update: {
          active?: boolean
          audience?: string
          day?: number | null
          kind?: string
          month?: number
          name?: string
          note?: string | null
          nth?: number | null
          rule?: string
          slug?: string
          weekday?: number | null
        }
        Relationships: []
      }
      content_documents: {
        Row: {
          author: string | null
          body: string | null
          canonical_url: string | null
          content_hash: string | null
          etag: string | null
          excerpt: string | null
          excerpt_source: string | null
          fetched_at: string | null
          first_seen_at: string
          fts: unknown
          http_status: number | null
          id: string
          kind: string | null
          lang: string | null
          last_modified: string | null
          published_at: string | null
          source_id: string
          status: string
          storage_ref: string | null
          title: string | null
          url: string
          url_hash: string | null
          word_count: number | null
        }
        Insert: {
          author?: string | null
          body?: string | null
          canonical_url?: string | null
          content_hash?: string | null
          etag?: string | null
          excerpt?: string | null
          excerpt_source?: string | null
          fetched_at?: string | null
          first_seen_at?: string
          fts?: unknown
          http_status?: number | null
          id?: string
          kind?: string | null
          lang?: string | null
          last_modified?: string | null
          published_at?: string | null
          source_id: string
          status?: string
          storage_ref?: string | null
          title?: string | null
          url: string
          url_hash?: string | null
          word_count?: number | null
        }
        Update: {
          author?: string | null
          body?: string | null
          canonical_url?: string | null
          content_hash?: string | null
          etag?: string | null
          excerpt?: string | null
          excerpt_source?: string | null
          fetched_at?: string | null
          first_seen_at?: string
          fts?: unknown
          http_status?: number | null
          id?: string
          kind?: string | null
          lang?: string | null
          last_modified?: string | null
          published_at?: string | null
          source_id?: string
          status?: string
          storage_ref?: string | null
          title?: string | null
          url?: string
          url_hash?: string | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "content_documents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "content_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      content_hosts: {
        Row: {
          allow_full_text: boolean
          block_reason: string | null
          blocked_until: string | null
          consecutive_failures: number
          crawl_delay_s: number
          created_at: string
          host: string
          last_request_at: string | null
          notes: string | null
          robots_fetched_at: string | null
          robots_rules: Json
          robots_txt: string | null
        }
        Insert: {
          allow_full_text?: boolean
          block_reason?: string | null
          blocked_until?: string | null
          consecutive_failures?: number
          crawl_delay_s?: number
          created_at?: string
          host: string
          last_request_at?: string | null
          notes?: string | null
          robots_fetched_at?: string | null
          robots_rules?: Json
          robots_txt?: string | null
        }
        Update: {
          allow_full_text?: boolean
          block_reason?: string | null
          blocked_until?: string | null
          consecutive_failures?: number
          crawl_delay_s?: number
          created_at?: string
          host?: string
          last_request_at?: string | null
          notes?: string | null
          robots_fetched_at?: string | null
          robots_rules?: Json
          robots_txt?: string | null
        }
        Relationships: []
      }
      content_sources: {
        Row: {
          active: boolean
          cadence: string
          client_slug: string | null
          created_at: string
          failure_count: number
          feed_url: string | null
          fetch_mode: string
          host: string
          id: string
          kind: string
          last_fetched_at: string | null
          last_ok_at: string | null
          name: string
          notes: string | null
          url: string
        }
        Insert: {
          active?: boolean
          cadence?: string
          client_slug?: string | null
          created_at?: string
          failure_count?: number
          feed_url?: string | null
          fetch_mode: string
          host: string
          id?: string
          kind: string
          last_fetched_at?: string | null
          last_ok_at?: string | null
          name: string
          notes?: string | null
          url: string
        }
        Update: {
          active?: boolean
          cadence?: string
          client_slug?: string | null
          created_at?: string
          failure_count?: number
          feed_url?: string | null
          fetch_mode?: string
          host?: string
          id?: string
          kind?: string
          last_fetched_at?: string | null
          last_ok_at?: string | null
          name?: string
          notes?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_sources_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "content_sources_host_fkey"
            columns: ["host"]
            isOneToOne: false
            referencedRelation: "content_hosts"
            referencedColumns: ["host"]
          },
        ]
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
          steps: Json | null
          strategy: string | null
          success_count: number
          updated_at: string
          validated_at: string | null
          validation_status: string | null
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
          steps?: Json | null
          strategy?: string | null
          success_count?: number
          updated_at?: string
          validated_at?: string | null
          validation_status?: string | null
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
          steps?: Json | null
          strategy?: string | null
          success_count?: number
          updated_at?: string
          validated_at?: string | null
          validation_status?: string | null
        }
        Relationships: []
      }
      crm_lead_meta: {
        Row: {
          follow_up_on: string | null
          lead_key: string
          note: string | null
          starred: boolean
          updated_at: string
        }
        Insert: {
          follow_up_on?: string | null
          lead_key: string
          note?: string | null
          starred?: boolean
          updated_at?: string
        }
        Update: {
          follow_up_on?: string | null
          lead_key?: string
          note?: string | null
          starred?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      cy_extension_releases: {
        Row: {
          channel: string
          detail: string | null
          needs_jared: string | null
          status: string
          store_url: string | null
          updated_at: string
          updated_by: string | null
          version: string | null
        }
        Insert: {
          channel: string
          detail?: string | null
          needs_jared?: string | null
          status?: string
          store_url?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: string | null
        }
        Update: {
          channel?: string
          detail?: string | null
          needs_jared?: string | null
          status?: string
          store_url?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: string | null
        }
        Relationships: []
      }
      cy_pattern_quarantine_log: {
        Row: {
          created_at: string
          domain: string | null
          id: number
          pattern_id: string
          previous: Json
          reason: string
          selector: string | null
        }
        Insert: {
          created_at?: string
          domain?: string | null
          id?: number
          pattern_id: string
          previous: Json
          reason: string
          selector?: string | null
        }
        Update: {
          created_at?: string
          domain?: string | null
          id?: number
          pattern_id?: string
          previous?: Json
          reason?: string
          selector?: string | null
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
      fix_ai_jobs: {
        Row: {
          answer: string | null
          claimed_at: string | null
          created_at: string
          done_at: string | null
          id: string
          issue_key: string
          prompt: string
          status: string
        }
        Insert: {
          answer?: string | null
          claimed_at?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          issue_key: string
          prompt: string
          status?: string
        }
        Update: {
          answer?: string | null
          claimed_at?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          issue_key?: string
          prompt?: string
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
      hoku_approved_photo_keys: {
        Row: {
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          created_at: string
          note: string
          photo_key: string
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          note: string
          photo_key: string
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          note?: string
          photo_key?: string
        }
        Relationships: []
      }
      hoku_channel_listings: {
        Row: {
          channel: string
          external_id: string | null
          external_sku: string | null
          id: string
          last_pushed_at: string | null
          listed: boolean
          price_cents: number | null
          product_id: string
        }
        Insert: {
          channel: string
          external_id?: string | null
          external_sku?: string | null
          id?: string
          last_pushed_at?: string | null
          listed?: boolean
          price_cents?: number | null
          product_id: string
        }
        Update: {
          channel?: string
          external_id?: string | null
          external_sku?: string | null
          id?: string
          last_pushed_at?: string | null
          listed?: boolean
          price_cents?: number | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hoku_channel_listings_channel_fkey"
            columns: ["channel"]
            isOneToOne: false
            referencedRelation: "hoku_channels"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "hoku_channel_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "hoku_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hoku_channel_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "hoku_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      hoku_channels: {
        Row: {
          active: boolean
          created_at: string
          credentials: Json | null
          label: string
          last_sync_at: string | null
          slug: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          credentials?: Json | null
          label: string
          last_sync_at?: string | null
          slug: string
        }
        Update: {
          active?: boolean
          created_at?: string
          credentials?: Json | null
          label?: string
          last_sync_at?: string | null
          slug?: string
        }
        Relationships: []
      }
      hoku_content_bank: {
        Row: {
          approved: boolean
          brand: string
          caption: string
          created_at: string
          eyebrow: string | null
          hashtags: string
          headline: string | null
          id: string
          image_brief: string | null
          last_used_at: string | null
          layout: string
          media_type: string
          media_urls: string[]
          min_gap_days: number
          photo_key: string | null
          priority: number
          queued_at: string | null
          reject_reason: string | null
          rejected: boolean
          source: string
          subhead: string | null
          theme: string
          use_count: number
        }
        Insert: {
          approved?: boolean
          brand?: string
          caption: string
          created_at?: string
          eyebrow?: string | null
          hashtags?: string
          headline?: string | null
          id?: string
          image_brief?: string | null
          last_used_at?: string | null
          layout?: string
          media_type?: string
          media_urls?: string[]
          min_gap_days?: number
          photo_key?: string | null
          priority?: number
          queued_at?: string | null
          reject_reason?: string | null
          rejected?: boolean
          source?: string
          subhead?: string | null
          theme: string
          use_count?: number
        }
        Update: {
          approved?: boolean
          brand?: string
          caption?: string
          created_at?: string
          eyebrow?: string | null
          hashtags?: string
          headline?: string | null
          id?: string
          image_brief?: string | null
          last_used_at?: string | null
          layout?: string
          media_type?: string
          media_urls?: string[]
          min_gap_days?: number
          photo_key?: string | null
          priority?: number
          queued_at?: string | null
          reject_reason?: string | null
          rejected?: boolean
          source?: string
          subhead?: string | null
          theme?: string
          use_count?: number
        }
        Relationships: []
      }
      hoku_content_log: {
        Row: {
          ai_model: string | null
          blocked_phrase: string | null
          brand: string
          caption_preview: string | null
          completion_tokens: number | null
          error_message: string | null
          id: string
          phase: string
          prompt_tokens: number | null
          run_at: string
          status: string
          theme: string | null
        }
        Insert: {
          ai_model?: string | null
          blocked_phrase?: string | null
          brand?: string
          caption_preview?: string | null
          completion_tokens?: number | null
          error_message?: string | null
          id?: string
          phase: string
          prompt_tokens?: number | null
          run_at?: string
          status: string
          theme?: string | null
        }
        Update: {
          ai_model?: string | null
          blocked_phrase?: string | null
          brand?: string
          caption_preview?: string | null
          completion_tokens?: number | null
          error_message?: string | null
          id?: string
          phase?: string
          prompt_tokens?: number | null
          run_at?: string
          status?: string
          theme?: string | null
        }
        Relationships: []
      }
      hoku_content_settings: {
        Row: {
          brand: string
          enabled: boolean
          last_result: string | null
          last_run_at: string | null
          post_hour_utc: number
          posts_per_day: number
          queue_days_ahead: number
        }
        Insert: {
          brand: string
          enabled?: boolean
          last_result?: string | null
          last_run_at?: string | null
          post_hour_utc?: number
          posts_per_day?: number
          queue_days_ahead?: number
        }
        Update: {
          brand?: string
          enabled?: boolean
          last_result?: string | null
          last_run_at?: string | null
          post_hour_utc?: number
          posts_per_day?: number
          queue_days_ahead?: number
        }
        Relationships: []
      }
      hoku_inventory: {
        Row: {
          low_at: number
          on_hand: number
          product_id: string
          reserved: number
          updated_at: string
        }
        Insert: {
          low_at?: number
          on_hand?: number
          product_id: string
          reserved?: number
          updated_at?: string
        }
        Update: {
          low_at?: number
          on_hand?: number
          product_id?: string
          reserved?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hoku_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "hoku_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hoku_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "hoku_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      hoku_inventory_moves: {
        Row: {
          created_at: string
          delta: number
          id: number
          note: string | null
          order_id: string | null
          product_id: string
          reason: string
        }
        Insert: {
          created_at?: string
          delta: number
          id?: number
          note?: string | null
          order_id?: string | null
          product_id: string
          reason: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: number
          note?: string | null
          order_id?: string | null
          product_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "hoku_inventory_moves_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "hoku_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hoku_inventory_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "hoku_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hoku_inventory_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "hoku_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      hoku_order_items: {
        Row: {
          channel_sku: string | null
          description: string
          id: string
          order_id: string
          product_id: string | null
          qty: number
          unit_price_cents: number
        }
        Insert: {
          channel_sku?: string | null
          description: string
          id?: string
          order_id: string
          product_id?: string | null
          qty: number
          unit_price_cents?: number
        }
        Update: {
          channel_sku?: string | null
          description?: string
          id?: string
          order_id?: string
          product_id?: string | null
          qty?: number
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "hoku_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "hoku_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hoku_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "hoku_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hoku_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "hoku_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      hoku_orders: {
        Row: {
          carrier: string | null
          channel: string
          created_at: string
          currency: string
          customer_name: string | null
          email: string | null
          external_id: string
          id: string
          order_number: string | null
          phone: string | null
          placed_at: string
          raw: Json | null
          ship_city: string | null
          ship_country: string | null
          ship_line1: string | null
          ship_line2: string | null
          ship_postal: string | null
          ship_state: string | null
          shipped_at: string | null
          status: string
          total_cents: number
          tracking: string | null
        }
        Insert: {
          carrier?: string | null
          channel: string
          created_at?: string
          currency?: string
          customer_name?: string | null
          email?: string | null
          external_id: string
          id?: string
          order_number?: string | null
          phone?: string | null
          placed_at: string
          raw?: Json | null
          ship_city?: string | null
          ship_country?: string | null
          ship_line1?: string | null
          ship_line2?: string | null
          ship_postal?: string | null
          ship_state?: string | null
          shipped_at?: string | null
          status?: string
          total_cents?: number
          tracking?: string | null
        }
        Update: {
          carrier?: string | null
          channel?: string
          created_at?: string
          currency?: string
          customer_name?: string | null
          email?: string | null
          external_id?: string
          id?: string
          order_number?: string | null
          phone?: string | null
          placed_at?: string
          raw?: Json | null
          ship_city?: string | null
          ship_country?: string | null
          ship_line1?: string | null
          ship_line2?: string | null
          ship_postal?: string | null
          ship_state?: string | null
          shipped_at?: string | null
          status?: string
          total_cents?: number
          tracking?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hoku_orders_channel_fkey"
            columns: ["channel"]
            isOneToOne: false
            referencedRelation: "hoku_channels"
            referencedColumns: ["slug"]
          },
        ]
      }
      hoku_post_render: {
        Row: {
          created_at: string
          eyebrow: string | null
          headline: string
          layout: string
          og_url: string | null
          original_url: string | null
          photo_key: string
          post_id: string
          subhead: string | null
        }
        Insert: {
          created_at?: string
          eyebrow?: string | null
          headline: string
          layout?: string
          og_url?: string | null
          original_url?: string | null
          photo_key?: string
          post_id: string
          subhead?: string | null
        }
        Update: {
          created_at?: string
          eyebrow?: string | null
          headline?: string
          layout?: string
          og_url?: string | null
          original_url?: string | null
          photo_key?: string
          post_id?: string
          subhead?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hoku_post_render_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      hoku_products: {
        Row: {
          active: boolean
          brand: string | null
          cans_per_unit: number
          created_at: string
          description: string | null
          gtin: string | null
          id: string
          name: string
          net_content: string | null
          sku: string
        }
        Insert: {
          active?: boolean
          brand?: string | null
          cans_per_unit?: number
          created_at?: string
          description?: string | null
          gtin?: string | null
          id?: string
          name: string
          net_content?: string | null
          sku: string
        }
        Update: {
          active?: boolean
          brand?: string | null
          cans_per_unit?: number
          created_at?: string
          description?: string | null
          gtin?: string | null
          id?: string
          name?: string
          net_content?: string | null
          sku?: string
        }
        Relationships: []
      }
      hoku_sync_log: {
        Row: {
          action: string
          channel: string
          created_at: string
          detail: Json | null
          id: number
          ok: boolean
        }
        Insert: {
          action: string
          channel: string
          created_at?: string
          detail?: Json | null
          id?: number
          ok: boolean
        }
        Update: {
          action?: string
          channel?: string
          created_at?: string
          detail?: Json | null
          id?: number
          ok?: boolean
        }
        Relationships: []
      }
      home_hub_agent_releases: {
        Row: {
          created_at: string
          notes: string | null
          sha256: string
          source: string
          version: string
        }
        Insert: {
          created_at?: string
          notes?: string | null
          sha256: string
          source: string
          version: string
        }
        Update: {
          created_at?: string
          notes?: string | null
          sha256?: string
          source?: string
          version?: string
        }
        Relationships: []
      }
      home_hub_agent_state: {
        Row: {
          agent: string
          info: Json | null
          last_seen_at: string
          version: string | null
        }
        Insert: {
          agent: string
          info?: Json | null
          last_seen_at?: string
          version?: string | null
        }
        Update: {
          agent?: string
          info?: Json | null
          last_seen_at?: string
          version?: string | null
        }
        Relationships: []
      }
      home_hub_commands: {
        Row: {
          action: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          payload: Json
          requested_by: string | null
          result: Json | null
          status: string
          target: string
        }
        Insert: {
          action: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          requested_by?: string | null
          result?: Json | null
          status?: string
          target: string
        }
        Update: {
          action?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          requested_by?: string | null
          result?: Json | null
          status?: string
          target?: string
        }
        Relationships: []
      }
      home_hub_events: {
        Row: {
          at: string
          body: string | null
          id: number
          key: string
          kind: string
          occurred_at: string | null
          pushed: boolean
          severity: string
          source: string
          title: string
        }
        Insert: {
          at?: string
          body?: string | null
          id?: number
          key: string
          kind: string
          occurred_at?: string | null
          pushed?: boolean
          severity: string
          source?: string
          title: string
        }
        Update: {
          at?: string
          body?: string | null
          id?: number
          key?: string
          kind?: string
          occurred_at?: string | null
          pushed?: boolean
          severity?: string
          source?: string
          title?: string
        }
        Relationships: []
      }
      home_hub_inventory: {
        Row: {
          history: Json
          id: string
          kind: string
          lan_ip: string | null
          login_user: string | null
          name: string
          notes: string | null
          paths: Json
          port: number | null
          runs_on: string | null
          secret_refs: Json
          slug: string
          sort: number
          source: string
          ssh_alias: string | null
          ssh_key: string | null
          ssh_user: string | null
          tailscale_ip: string | null
          tailscale_name: string | null
          updated_at: string
          updated_by: string | null
          url: string | null
          verified_at: string | null
        }
        Insert: {
          history?: Json
          id?: string
          kind: string
          lan_ip?: string | null
          login_user?: string | null
          name: string
          notes?: string | null
          paths?: Json
          port?: number | null
          runs_on?: string | null
          secret_refs?: Json
          slug: string
          sort?: number
          source?: string
          ssh_alias?: string | null
          ssh_key?: string | null
          ssh_user?: string | null
          tailscale_ip?: string | null
          tailscale_name?: string | null
          updated_at?: string
          updated_by?: string | null
          url?: string | null
          verified_at?: string | null
        }
        Update: {
          history?: Json
          id?: string
          kind?: string
          lan_ip?: string | null
          login_user?: string | null
          name?: string
          notes?: string | null
          paths?: Json
          port?: number | null
          runs_on?: string | null
          secret_refs?: Json
          slug?: string
          sort?: number
          source?: string
          ssh_alias?: string | null
          ssh_key?: string | null
          ssh_user?: string | null
          tailscale_ip?: string | null
          tailscale_name?: string | null
          updated_at?: string
          updated_by?: string | null
          url?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      home_hub_issues: {
        Row: {
          body: string | null
          key: string
          last_pushed_at: string | null
          occurrences: number
          opened_at: string
          push_count: number
          resolved_at: string | null
          severity: string
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          key: string
          last_pushed_at?: string | null
          occurrences?: number
          opened_at?: string
          push_count?: number
          resolved_at?: string | null
          severity: string
          source?: string
          status: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          key?: string
          last_pushed_at?: string | null
          occurrences?: number
          opened_at?: string
          push_count?: number
          resolved_at?: string | null
          severity?: string
          source?: string
          status?: string
          title?: string
          updated_at?: string
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
      home_hub_settings: {
        Row: {
          id: boolean
          ntfy_topic: string
          push_enabled: boolean
          quiet_end_hour: number
          quiet_start_hour: number
          repush_hours: number
          updated_at: string
        }
        Insert: {
          id?: boolean
          ntfy_topic?: string
          push_enabled?: boolean
          quiet_end_hour?: number
          quiet_start_hour?: number
          repush_hours?: number
          updated_at?: string
        }
        Update: {
          id?: boolean
          ntfy_topic?: string
          push_enabled?: boolean
          quiet_end_hour?: number
          quiet_start_hour?: number
          repush_hours?: number
          updated_at?: string
        }
        Relationships: []
      }
      home_hub_snapshots: {
        Row: {
          captured_at: string
          data: Json
          error: string | null
          fails: number
          ok: boolean
          source: string
        }
        Insert: {
          captured_at?: string
          data?: Json
          error?: string | null
          fails?: number
          ok: boolean
          source: string
        }
        Update: {
          captured_at?: string
          data?: Json
          error?: string | null
          fails?: number
          ok?: boolean
          source?: string
        }
        Relationships: []
      }
      house_notes: {
        Row: {
          active: boolean
          body: string
          key: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body: string
          key: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          key?: string
          title?: string
          updated_at?: string
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
      internal_fn_secrets: {
        Row: {
          created_at: string
          name: string
          secret: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          name: string
          secret: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          name?: string
          secret?: string
          updated_at?: string
        }
        Relationships: []
      }
      mac_agents: {
        Row: {
          created_at: string
          key_sha256: string
          last_seen_at: string | null
          name: string
          note: string | null
          version: string | null
        }
        Insert: {
          created_at?: string
          key_sha256: string
          last_seen_at?: string | null
          name: string
          note?: string | null
          version?: string | null
        }
        Update: {
          created_at?: string
          key_sha256?: string
          last_seen_at?: string | null
          name?: string
          note?: string | null
          version?: string | null
        }
        Relationships: []
      }
      mac_commands: {
        Row: {
          action: string
          agent: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          payload: Json
          requested_by: string
          result: Json | null
          status: string
        }
        Insert: {
          action: string
          agent?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          requested_by?: string
          result?: Json | null
          status?: string
        }
        Update: {
          action?: string
          agent?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          requested_by?: string
          result?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mac_commands_agent_fkey"
            columns: ["agent"]
            isOneToOne: false
            referencedRelation: "mac_agents"
            referencedColumns: ["name"]
          },
        ]
      }
      mac_jobs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          cwd: string | null
          exit_code: number | null
          finished_at: string | null
          id: string
          output: string
          proposed_by: string
          script: string
          started_at: string | null
          status: string
          thread_id: string | null
          timeout_s: number
          title: string
          updated_at: string
          why: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          cwd?: string | null
          exit_code?: number | null
          finished_at?: string | null
          id?: string
          output?: string
          proposed_by?: string
          script: string
          started_at?: string | null
          status?: string
          thread_id?: string | null
          timeout_s?: number
          title: string
          updated_at?: string
          why?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          cwd?: string | null
          exit_code?: number | null
          finished_at?: string | null
          id?: string
          output?: string
          proposed_by?: string
          script?: string
          started_at?: string | null
          status?: string
          thread_id?: string | null
          timeout_s?: number
          title?: string
          updated_at?: string
          why?: string | null
        }
        Relationships: []
      }
      mail_gap_seen: {
        Row: {
          folder: string
          mailbox: string
          seen_at: string | null
          uid: number
        }
        Insert: {
          folder: string
          mailbox: string
          seen_at?: string | null
          uid: number
        }
        Update: {
          folder?: string
          mailbox?: string
          seen_at?: string | null
          uid?: number
        }
        Relationships: []
      }
      media_relay: {
        Row: {
          bucket: string
          content_type: string
          created_at: string
          data_b64: string
          done_at: string | null
          error: string | null
          id: number
          path: string
          status: string
          url: string | null
        }
        Insert: {
          bucket?: string
          content_type?: string
          created_at?: string
          data_b64: string
          done_at?: string | null
          error?: string | null
          id?: number
          path: string
          status?: string
          url?: string | null
        }
        Update: {
          bucket?: string
          content_type?: string
          created_at?: string
          data_b64?: string
          done_at?: string | null
          error?: string | null
          id?: number
          path?: string
          status?: string
          url?: string | null
        }
        Relationships: []
      }
      meeting_deleted: {
        Row: {
          deleted_at: string
          name: string
        }
        Insert: {
          deleted_at?: string
          name: string
        }
        Update: {
          deleted_at?: string
          name?: string
        }
        Relationships: []
      }
      meeting_recorder_commands: {
        Row: {
          action: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          payload: Json
          requested_by: string
          result: Json | null
          status: string
        }
        Insert: {
          action: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          requested_by?: string
          result?: Json | null
          status?: string
        }
        Update: {
          action?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          requested_by?: string
          result?: Json | null
          status?: string
        }
        Relationships: []
      }
      meeting_recorder_state: {
        Row: {
          current_name: string | null
          id: number
          info: Json
          key_sha256: string | null
          known_voices: string[]
          last_seen_at: string | null
          roster: string[]
          stage: string | null
          started_at: string | null
          status: string
          updated_at: string
          version: string | null
        }
        Insert: {
          current_name?: string | null
          id?: number
          info?: Json
          key_sha256?: string | null
          known_voices?: string[]
          last_seen_at?: string | null
          roster?: string[]
          stage?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          version?: string | null
        }
        Update: {
          current_name?: string | null
          id?: number
          info?: Json
          key_sha256?: string | null
          known_voices?: string[]
          last_seen_at?: string | null
          roster?: string[]
          stage?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          version?: string | null
        }
        Relationships: []
      }
      meeting_recordings: {
        Row: {
          created_at: string
          debriefed_at: string | null
          id: string
          line_count: number | null
          name: string
          people: string[]
          roster: string[]
          source: string
          speakers: Json
          started_at: string | null
          stopped_at: string | null
          summary: Json | null
          tasks_at: string | null
          transcript: string | null
        }
        Insert: {
          created_at?: string
          debriefed_at?: string | null
          id?: string
          line_count?: number | null
          name: string
          people?: string[]
          roster?: string[]
          source?: string
          speakers?: Json
          started_at?: string | null
          stopped_at?: string | null
          summary?: Json | null
          tasks_at?: string | null
          transcript?: string | null
        }
        Update: {
          created_at?: string
          debriefed_at?: string | null
          id?: string
          line_count?: number | null
          name?: string
          people?: string[]
          roster?: string[]
          source?: string
          speakers?: Json
          started_at?: string | null
          stopped_at?: string | null
          summary?: Json | null
          tasks_at?: string | null
          transcript?: string | null
        }
        Relationships: []
      }
      missed_banner_reports: {
        Row: {
          ai_attempts: number
          ai_processed_at: string | null
          autofix_last_at: string | null
          autofix_note: string | null
          autofix_outcome: string | null
          autofix_runs: number
          banner_html: string | null
          cmp_fingerprint: string | null
          created_at: string
          domain: string
          has_working_pattern: boolean
          id: number
          last_reported: string
          page_url: string | null
          render_attempts: number
          render_last_at: string | null
          report_count: number
          resolved: boolean
          resolved_at: string | null
        }
        Insert: {
          ai_attempts?: number
          ai_processed_at?: string | null
          autofix_last_at?: string | null
          autofix_note?: string | null
          autofix_outcome?: string | null
          autofix_runs?: number
          banner_html?: string | null
          cmp_fingerprint?: string | null
          created_at?: string
          domain: string
          has_working_pattern?: boolean
          id?: never
          last_reported?: string
          page_url?: string | null
          render_attempts?: number
          render_last_at?: string | null
          report_count?: number
          resolved?: boolean
          resolved_at?: string | null
        }
        Update: {
          ai_attempts?: number
          ai_processed_at?: string | null
          autofix_last_at?: string | null
          autofix_note?: string | null
          autofix_outcome?: string | null
          autofix_runs?: number
          banner_html?: string | null
          cmp_fingerprint?: string | null
          created_at?: string
          domain?: string
          has_working_pattern?: boolean
          id?: never
          last_reported?: string
          page_url?: string | null
          render_attempts?: number
          render_last_at?: string | null
          report_count?: number
          resolved?: boolean
          resolved_at?: string | null
        }
        Relationships: []
      }
      monitor_events: {
        Row: {
          body: string | null
          id: number
          key: string | null
          kind: string
          occurred_at: string
          pushed: boolean
          severity: string | null
          title: string | null
        }
        Insert: {
          body?: string | null
          id?: number
          key?: string | null
          kind: string
          occurred_at?: string
          pushed?: boolean
          severity?: string | null
          title?: string | null
        }
        Update: {
          body?: string | null
          id?: number
          key?: string | null
          kind?: string
          occurred_at?: string
          pushed?: boolean
          severity?: string | null
          title?: string | null
        }
        Relationships: []
      }
      monitor_issues: {
        Row: {
          ai_diagnosis: string | null
          area: string | null
          body: string | null
          claude_prompt: string | null
          fix_log: Json
          fix_next_at: string | null
          fix_note: string | null
          fix_stage: string
          heal_attempts: number
          key: string
          last_pushed_at: string | null
          needs_jared: string | null
          occurrences: number
          opened_at: string
          push_count: number
          resolved_at: string | null
          scout_ask: string | null
          scout_started_at: string | null
          scout_thread: string | null
          self_healed: boolean
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_diagnosis?: string | null
          area?: string | null
          body?: string | null
          claude_prompt?: string | null
          fix_log?: Json
          fix_next_at?: string | null
          fix_note?: string | null
          fix_stage?: string
          heal_attempts?: number
          key: string
          last_pushed_at?: string | null
          needs_jared?: string | null
          occurrences?: number
          opened_at?: string
          push_count?: number
          resolved_at?: string | null
          scout_ask?: string | null
          scout_started_at?: string | null
          scout_thread?: string | null
          self_healed?: boolean
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_diagnosis?: string | null
          area?: string | null
          body?: string | null
          claude_prompt?: string | null
          fix_log?: Json
          fix_next_at?: string | null
          fix_note?: string | null
          fix_stage?: string
          heal_attempts?: number
          key?: string
          last_pushed_at?: string | null
          needs_jared?: string | null
          occurrences?: number
          opened_at?: string
          push_count?: number
          resolved_at?: string | null
          scout_ask?: string | null
          scout_started_at?: string | null
          scout_thread?: string | null
          self_healed?: boolean
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      nextcloud_seats: {
        Row: {
          client_id: string | null
          created_at: string
          display: string | null
          id: string
          kind: string
          revoked_at: string | null
          secret_name: string
          staff_id: string | null
          uid: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          display?: string | null
          id?: string
          kind: string
          revoked_at?: string | null
          secret_name: string
          staff_id?: string | null
          uid: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          display?: string | null
          id?: string
          kind?: string
          revoked_at?: string | null
          secret_name?: string
          staff_id?: string | null
          uid?: string
        }
        Relationships: [
          {
            foreignKeyName: "nextcloud_seats_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nextcloud_seats_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      notify_outbox: {
        Row: {
          attempts: number
          audience: string
          body: string
          client_id: string | null
          created_at: string
          dedupe: string | null
          error: string | null
          hold_until: string | null
          id: string
          kind: string
          link: string | null
          payload: Json | null
          sent_at: string | null
          staff_id: string | null
          subject: string
          to_email: string | null
        }
        Insert: {
          attempts?: number
          audience: string
          body: string
          client_id?: string | null
          created_at?: string
          dedupe?: string | null
          error?: string | null
          hold_until?: string | null
          id?: string
          kind: string
          link?: string | null
          payload?: Json | null
          sent_at?: string | null
          staff_id?: string | null
          subject: string
          to_email?: string | null
        }
        Update: {
          attempts?: number
          audience?: string
          body?: string
          client_id?: string | null
          created_at?: string
          dedupe?: string | null
          error?: string | null
          hold_until?: string | null
          id?: string
          kind?: string
          link?: string | null
          payload?: Json | null
          sent_at?: string | null
          staff_id?: string | null
          subject?: string
          to_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notify_outbox_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notify_outbox_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_ai_status: {
        Row: {
          id: number
          model: string | null
          seen_at: string | null
        }
        Insert: {
          id?: number
          model?: string | null
          seen_at?: string | null
        }
        Update: {
          id?: number
          model?: string | null
          seen_at?: string | null
        }
        Relationships: []
      }
      partner_chat: {
        Row: {
          content: string
          created_at: string
          id: string
          reply_to: string | null
          role: string
          status: string
          thread_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          reply_to?: string | null
          role: string
          status?: string
          thread_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          reply_to?: string | null
          role?: string
          status?: string
          thread_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_chat_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "partner_chat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_chat_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "partner_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_chat_threads: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      partner_connectors: {
        Row: {
          created_at: string
          id: string
          key_sha256: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_sha256: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_sha256?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      partner_mail: {
        Row: {
          account: string
          attachments: Json
          body_text: string | null
          cc_addrs: string[]
          created_at: string
          id: string
          links: Json
          message_id: string
          roster: string
          sent_at: string | null
          subject: string | null
          to_addrs: string[]
        }
        Insert: {
          account: string
          attachments?: Json
          body_text?: string | null
          cc_addrs?: string[]
          created_at?: string
          id?: string
          links?: Json
          message_id: string
          roster: string
          sent_at?: string | null
          subject?: string | null
          to_addrs?: string[]
        }
        Update: {
          account?: string
          attachments?: Json
          body_text?: string | null
          cc_addrs?: string[]
          created_at?: string
          id?: string
          links?: Json
          message_id?: string
          roster?: string
          sent_at?: string | null
          subject?: string | null
          to_addrs?: string[]
        }
        Relationships: []
      }
      partners: {
        Row: {
          call_url: string | null
          claim_expires_at: string | null
          claim_hash: string | null
          claim_used_at: string | null
          created_at: string
          email: string
          id: string
          link_sent_at: string | null
          name: string
          roster_name: string
          staff_id: string | null
          user_id: string | null
        }
        Insert: {
          call_url?: string | null
          claim_expires_at?: string | null
          claim_hash?: string | null
          claim_used_at?: string | null
          created_at?: string
          email: string
          id?: string
          link_sent_at?: string | null
          name: string
          roster_name: string
          staff_id?: string | null
          user_id?: string | null
        }
        Update: {
          call_url?: string | null
          claim_expires_at?: string | null
          claim_hash?: string | null
          claim_used_at?: string | null
          created_at?: string
          email?: string
          id?: string
          link_sent_at?: string | null
          name?: string
          roster_name?: string
          staff_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
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
      platform_specs: {
        Row: {
          alt_max: number | null
          auto_post: string
          body_aim: string | null
          body_in_bytes: boolean
          body_label: string
          body_max: number
          checked_on: string
          label: string
          needs_link: boolean
          note: string | null
          platform: string
          position: number
          surface: string | null
          tags_aim: string | null
          tags_max: number | null
          title_aim: string | null
          title_label: string | null
          title_max: number | null
          truncates_at: number | null
        }
        Insert: {
          alt_max?: number | null
          auto_post: string
          body_aim?: string | null
          body_in_bytes?: boolean
          body_label: string
          body_max: number
          checked_on?: string
          label: string
          needs_link?: boolean
          note?: string | null
          platform: string
          position: number
          surface?: string | null
          tags_aim?: string | null
          tags_max?: number | null
          title_aim?: string | null
          title_label?: string | null
          title_max?: number | null
          truncates_at?: number | null
        }
        Update: {
          alt_max?: number | null
          auto_post?: string
          body_aim?: string | null
          body_in_bytes?: boolean
          body_label?: string
          body_max?: number
          checked_on?: string
          label?: string
          needs_link?: boolean
          note?: string | null
          platform?: string
          position?: number
          surface?: string | null
          tags_aim?: string | null
          tags_max?: number | null
          title_aim?: string | null
          title_label?: string | null
          title_max?: number | null
          truncates_at?: number | null
        }
        Relationships: []
      }
      product_events: {
        Row: {
          anon_id: string
          app_version: string | null
          created_at: string
          event: string
          id: number
          platform: string
          props: Json
        }
        Insert: {
          anon_id: string
          app_version?: string | null
          created_at?: string
          event: string
          id?: never
          platform: string
          props?: Json
        }
        Update: {
          anon_id?: string
          app_version?: string | null
          created_at?: string
          event?: string
          id?: never
          platform?: string
          props?: Json
        }
        Relationships: []
      }
      re_approvals: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string
          facts_attested: boolean
          id: string
          listing_id: string
          notes: string | null
          stage: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision: string
          facts_attested?: boolean
          id?: string
          listing_id: string
          notes?: string | null
          stage: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          facts_attested?: boolean
          id?: string
          listing_id?: string
          notes?: string | null
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "re_approvals_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "re_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      re_drafts: {
        Row: {
          ai_content: boolean
          body: string
          created_at: string
          hashtags: Json
          id: string
          listing_id: string
          photo_order: Json
          platform: string
          video_stub: Json | null
        }
        Insert: {
          ai_content?: boolean
          body: string
          created_at?: string
          hashtags?: Json
          id?: string
          listing_id: string
          photo_order?: Json
          platform: string
          video_stub?: Json | null
        }
        Update: {
          ai_content?: boolean
          body?: string
          created_at?: string
          hashtags?: Json
          id?: string
          listing_id?: string
          photo_order?: Json
          platform?: string
          video_stub?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "re_drafts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "re_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      re_fact_checks: {
        Row: {
          id: string
          listing_id: string
          note: string | null
          platform: string | null
          token: string
          verdict: string
        }
        Insert: {
          id?: string
          listing_id: string
          note?: string | null
          platform?: string | null
          token: string
          verdict: string
        }
        Update: {
          id?: string
          listing_id?: string
          note?: string | null
          platform?: string | null
          token?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "re_fact_checks_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "re_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      re_listing_photos: {
        Row: {
          ai_altered: boolean
          bytes: number | null
          filename: string
          id: string
          listing_id: string
          local_path: string | null
          mime_type: string | null
          position: number | null
          sha256: string | null
        }
        Insert: {
          ai_altered?: boolean
          bytes?: number | null
          filename: string
          id?: string
          listing_id: string
          local_path?: string | null
          mime_type?: string | null
          position?: number | null
          sha256?: string | null
        }
        Update: {
          ai_altered?: boolean
          bytes?: number | null
          filename?: string
          id?: string
          listing_id?: string
          local_path?: string | null
          mime_type?: string | null
          position?: number | null
          sha256?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "re_listing_photos_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "re_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      re_listings: {
        Row: {
          baths: number | null
          beds: number | null
          city: string | null
          created_at: string
          features: Json
          id: string
          intake_address: string
          job_ref: string
          lot_sqft: number | null
          message_id: string | null
          missing_fields: Json
          open_house: string | null
          postal_code: string | null
          price_usd: number | null
          property_style: string | null
          raw_body: string | null
          received_at: string | null
          sender: string
          sqft: number | null
          state: string | null
          status: string
          street: string | null
          subject: string | null
          year_built: number | null
        }
        Insert: {
          baths?: number | null
          beds?: number | null
          city?: string | null
          created_at?: string
          features?: Json
          id?: string
          intake_address: string
          job_ref: string
          lot_sqft?: number | null
          message_id?: string | null
          missing_fields?: Json
          open_house?: string | null
          postal_code?: string | null
          price_usd?: number | null
          property_style?: string | null
          raw_body?: string | null
          received_at?: string | null
          sender: string
          sqft?: number | null
          state?: string | null
          status?: string
          street?: string | null
          subject?: string | null
          year_built?: number | null
        }
        Update: {
          baths?: number | null
          beds?: number | null
          city?: string | null
          created_at?: string
          features?: Json
          id?: string
          intake_address?: string
          job_ref?: string
          lot_sqft?: number | null
          message_id?: string | null
          missing_fields?: Json
          open_house?: string | null
          postal_code?: string | null
          price_usd?: number | null
          property_style?: string | null
          raw_body?: string | null
          received_at?: string | null
          sender?: string
          sqft?: number | null
          state?: string | null
          status?: string
          street?: string | null
          subject?: string | null
          year_built?: number | null
        }
        Relationships: []
      }
      research_credit_ledger: {
        Row: {
          at: string
          credits: number
          id: string
          provider: string
          run_id: string | null
          url: string | null
          verb: string
        }
        Insert: {
          at?: string
          credits: number
          id?: string
          provider?: string
          run_id?: string | null
          url?: string | null
          verb: string
        }
        Update: {
          at?: string
          credits?: number
          id?: string
          provider?: string
          run_id?: string | null
          url?: string | null
          verb?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_credit_ledger_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_findings: {
        Row: {
          angle: string
          approval_item_id: string | null
          binned_reason: string | null
          claim_type: string | null
          client_slug: string
          created_at: string
          evidence: Json
          evidence_score: number | null
          fit_score: number | null
          id: string
          novelty_score: number | null
          rationale: string | null
          run_id: string
          status: string
          total_score: number | null
        }
        Insert: {
          angle: string
          approval_item_id?: string | null
          binned_reason?: string | null
          claim_type?: string | null
          client_slug: string
          created_at?: string
          evidence?: Json
          evidence_score?: number | null
          fit_score?: number | null
          id?: string
          novelty_score?: number | null
          rationale?: string | null
          run_id: string
          status?: string
          total_score?: number | null
        }
        Update: {
          angle?: string
          approval_item_id?: string | null
          binned_reason?: string | null
          claim_type?: string | null
          client_slug?: string
          created_at?: string
          evidence?: Json
          evidence_score?: number | null
          fit_score?: number | null
          id?: string
          novelty_score?: number | null
          rationale?: string | null
          run_id?: string
          status?: string
          total_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "research_findings_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_findings_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "research_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "research_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      research_runs: {
        Row: {
          actor: string | null
          client_slug: string | null
          error: string | null
          finished_at: string | null
          heartbeat_at: string
          id: string
          kind: string
          started_at: string
          stats: Json
          status: string
          week_start: string | null
        }
        Insert: {
          actor?: string | null
          client_slug?: string | null
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string
          id?: string
          kind: string
          started_at?: string
          stats?: Json
          status?: string
          week_start?: string | null
        }
        Update: {
          actor?: string | null
          client_slug?: string | null
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string
          id?: string
          kind?: string
          started_at?: string
          stats?: Json
          status?: string
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "research_runs_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
        ]
      }
      research_settings: {
        Row: {
          credit_cap_total: number
          credit_cap_week: number
          credits_paused: boolean
          pause_reason: string | null
          scope: string
          synthesis_enabled: boolean
          updated_at: string
        }
        Insert: {
          credit_cap_total?: number
          credit_cap_week?: number
          credits_paused?: boolean
          pause_reason?: string | null
          scope: string
          synthesis_enabled?: boolean
          updated_at?: string
        }
        Update: {
          credit_cap_total?: number
          credit_cap_week?: number
          credits_paused?: boolean
          pause_reason?: string | null
          scope?: string
          synthesis_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      scout_daily: {
        Row: {
          action: Json
          body: string | null
          created_at: string
          day: string
          done_at: string | null
          id: string
          kind: string
          slot: string | null
          source_key: string
          status: string
          title: string
          url: string | null
          why: string | null
        }
        Insert: {
          action?: Json
          body?: string | null
          created_at?: string
          day?: string
          done_at?: string | null
          id?: string
          kind: string
          slot?: string | null
          source_key: string
          status?: string
          title: string
          url?: string | null
          why?: string | null
        }
        Update: {
          action?: Json
          body?: string | null
          created_at?: string
          day?: string
          done_at?: string | null
          id?: string
          kind?: string
          slot?: string | null
          source_key?: string
          status?: string
          title?: string
          url?: string | null
          why?: string | null
        }
        Relationships: []
      }
      scout_daily_runs: {
        Row: {
          day: string
          job: string
          ran_at: string
          result: Json | null
        }
        Insert: {
          day: string
          job: string
          ran_at?: string
          result?: Json | null
        }
        Update: {
          day?: string
          job?: string
          ran_at?: string
          result?: Json | null
        }
        Relationships: []
      }
      scout_lessons: {
        Row: {
          active: boolean
          avoid_text: string | null
          created_at: string
          do_text: string
          evidence: Json
          id: string
          last_used_at: string | null
          losses: number
          scope: string
          shown: number
          signature: string | null
          source: string
          title: string
          updated_at: string
          when_text: string
          wins: number
        }
        Insert: {
          active?: boolean
          avoid_text?: string | null
          created_at?: string
          do_text: string
          evidence?: Json
          id?: string
          last_used_at?: string | null
          losses?: number
          scope: string
          shown?: number
          signature?: string | null
          source?: string
          title: string
          updated_at?: string
          when_text: string
          wins?: number
        }
        Update: {
          active?: boolean
          avoid_text?: string | null
          created_at?: string
          do_text?: string
          evidence?: Json
          id?: string
          last_used_at?: string | null
          losses?: number
          scope?: string
          shown?: number
          signature?: string | null
          source?: string
          title?: string
          updated_at?: string
          when_text?: string
          wins?: number
        }
        Relationships: []
      }
      security_audit_log: {
        Row: {
          action: string
          actor: string
          after: Json | null
          asset: string | null
          at: string
          before: Json | null
          finding_key: string | null
          id: number
          note: string | null
          run_id: string | null
        }
        Insert: {
          action: string
          actor: string
          after?: Json | null
          asset?: string | null
          at?: string
          before?: Json | null
          finding_key?: string | null
          id?: never
          note?: string | null
          run_id?: string | null
        }
        Update: {
          action?: string
          actor?: string
          after?: Json | null
          asset?: string | null
          at?: string
          before?: Json | null
          finding_key?: string | null
          id?: never
          note?: string | null
          run_id?: string | null
        }
        Relationships: []
      }
      security_audit_runs: {
        Row: {
          checks_failed: number
          checks_passed: number
          checks_skipped: number
          checks_total: number
          checks_warn: number
          finished_at: string | null
          fixed_findings: number
          id: string
          inventory: Json
          new_findings: number
          open_red: number
          open_yellow: number
          started_at: string
          status: string
          summary: string | null
          trigger: string
        }
        Insert: {
          checks_failed?: number
          checks_passed?: number
          checks_skipped?: number
          checks_total?: number
          checks_warn?: number
          finished_at?: string | null
          fixed_findings?: number
          id?: string
          inventory?: Json
          new_findings?: number
          open_red?: number
          open_yellow?: number
          started_at?: string
          status?: string
          summary?: string | null
          trigger?: string
        }
        Update: {
          checks_failed?: number
          checks_passed?: number
          checks_skipped?: number
          checks_total?: number
          checks_warn?: number
          finished_at?: string | null
          fixed_findings?: number
          id?: string
          inventory?: Json
          new_findings?: number
          open_red?: number
          open_yellow?: number
          started_at?: string
          status?: string
          summary?: string | null
          trigger?: string
        }
        Relationships: []
      }
      security_findings: {
        Row: {
          asset: string
          check_name: string
          detail: string | null
          dismissed_reason: string | null
          evidence: Json
          first_seen: string
          id: string
          key: string
          last_run_id: string | null
          last_seen: string
          layer: string
          nights_open: number
          proposed_fix: string | null
          resolved_at: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          asset: string
          check_name: string
          detail?: string | null
          dismissed_reason?: string | null
          evidence?: Json
          first_seen?: string
          id?: string
          key: string
          last_run_id?: string | null
          last_seen?: string
          layer: string
          nights_open?: number
          proposed_fix?: string | null
          resolved_at?: string | null
          severity: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          asset?: string
          check_name?: string
          detail?: string | null
          dismissed_reason?: string | null
          evidence?: Json
          first_seen?: string
          id?: string
          key?: string
          last_run_id?: string | null
          last_seen?: string
          layer?: string
          nights_open?: number
          proposed_fix?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_findings_last_run_id_fkey"
            columns: ["last_run_id"]
            isOneToOne: false
            referencedRelation: "security_audit_runs"
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
      shop_abandoned_checkouts: {
        Row: {
          brand: string
          created_at: string
          currency: string
          customer_name: string | null
          email: string
          expired_at: string
          id: string
          items: Json
          livemode: boolean
          recovered_at: string | null
          recovered_session_id: string | null
          recovery_expires_at: string | null
          recovery_url: string
          session_id: string
          subtotal_cents: number
        }
        Insert: {
          brand: string
          created_at?: string
          currency?: string
          customer_name?: string | null
          email: string
          expired_at: string
          id?: string
          items?: Json
          livemode?: boolean
          recovered_at?: string | null
          recovered_session_id?: string | null
          recovery_expires_at?: string | null
          recovery_url: string
          session_id: string
          subtotal_cents?: number
        }
        Update: {
          brand?: string
          created_at?: string
          currency?: string
          customer_name?: string | null
          email?: string
          expired_at?: string
          id?: string
          items?: Json
          livemode?: boolean
          recovered_at?: string | null
          recovered_session_id?: string | null
          recovery_expires_at?: string | null
          recovery_url?: string
          session_id?: string
          subtotal_cents?: number
        }
        Relationships: []
      }
      shop_alert_config: {
        Row: {
          brand: string
          click_url: string | null
          created_at: string
          ntfy_topic: string
        }
        Insert: {
          brand: string
          click_url?: string | null
          created_at?: string
          ntfy_topic: string
        }
        Update: {
          brand?: string
          click_url?: string | null
          created_at?: string
          ntfy_topic?: string
        }
        Relationships: []
      }
      shop_channels: {
        Row: {
          active: boolean
          brand: string
          created_at: string
          credentials: Json | null
          customer_emails: boolean
          label: string
          last_error: string | null
          last_sync_at: string | null
          slug: string
        }
        Insert: {
          active?: boolean
          brand: string
          created_at?: string
          credentials?: Json | null
          customer_emails?: boolean
          label: string
          last_error?: string | null
          last_sync_at?: string | null
          slug: string
        }
        Update: {
          active?: boolean
          brand?: string
          created_at?: string
          credentials?: Json | null
          customer_emails?: boolean
          label?: string
          last_error?: string | null
          last_sync_at?: string | null
          slug?: string
        }
        Relationships: []
      }
      shop_inventory: {
        Row: {
          brand: string
          low_at: number
          on_hand: number
          product_id: string
          reserved: number
          updated_at: string
        }
        Insert: {
          brand: string
          low_at?: number
          on_hand?: number
          product_id: string
          reserved?: number
          updated_at?: string
        }
        Update: {
          brand?: string
          low_at?: number
          on_hand?: number
          product_id?: string
          reserved?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_catalogue"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_pool"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      shop_inventory_moves: {
        Row: {
          brand: string
          created_at: string
          delta: number
          id: number
          note: string | null
          order_id: string | null
          product_id: string
          reason: string
        }
        Insert: {
          brand: string
          created_at?: string
          delta: number
          id?: number
          note?: string | null
          order_id?: string | null
          product_id: string
          reason: string
        }
        Update: {
          brand?: string
          created_at?: string
          delta?: number
          id?: number
          note?: string | null
          order_id?: string | null
          product_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_inventory_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_inventory_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_catalogue"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_inventory_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_pool"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_inventory_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      shop_listings: {
        Row: {
          brand: string
          bullets: string[]
          channel: string
          checked_at: string | null
          compliance: string | null
          description: string | null
          external_id: string | null
          external_sku: string | null
          id: string
          images: string[]
          last_error: string | null
          last_pushed_at: string | null
          listed: boolean
          price_cents: number | null
          product_id: string
          title: string | null
        }
        Insert: {
          brand: string
          bullets?: string[]
          channel: string
          checked_at?: string | null
          compliance?: string | null
          description?: string | null
          external_id?: string | null
          external_sku?: string | null
          id?: string
          images?: string[]
          last_error?: string | null
          last_pushed_at?: string | null
          listed?: boolean
          price_cents?: number | null
          product_id: string
          title?: string | null
        }
        Update: {
          brand?: string
          bullets?: string[]
          channel?: string
          checked_at?: string | null
          compliance?: string | null
          description?: string | null
          external_id?: string | null
          external_sku?: string | null
          id?: string
          images?: string[]
          last_error?: string | null
          last_pushed_at?: string | null
          listed?: boolean
          price_cents?: number | null
          product_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_catalogue"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_pool"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      shop_notifications: {
        Row: {
          abandoned_id: string | null
          attempts: number
          brand: string
          created_at: string
          error: string | null
          id: string
          kind: string
          order_id: string | null
          provider_id: string | null
          sent_at: string | null
          status: string
          to_email: string
        }
        Insert: {
          abandoned_id?: string | null
          attempts?: number
          brand: string
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          order_id?: string | null
          provider_id?: string | null
          sent_at?: string | null
          status?: string
          to_email: string
        }
        Update: {
          abandoned_id?: string | null
          attempts?: number
          brand?: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          order_id?: string | null
          provider_id?: string | null
          sent_at?: string | null
          status?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_notifications_abandoned_id_fkey"
            columns: ["abandoned_id"]
            isOneToOne: false
            referencedRelation: "shop_abandoned_checkouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_order_items: {
        Row: {
          brand: string | null
          description: string | null
          id: string
          order_id: string
          product_id: string | null
          qty: number
          sku: string | null
          unit_price_cents: number
        }
        Insert: {
          brand?: string | null
          description?: string | null
          id?: string
          order_id: string
          product_id?: string | null
          qty?: number
          sku?: string | null
          unit_price_cents?: number
        }
        Update: {
          brand?: string | null
          description?: string | null
          id?: string
          order_id?: string
          product_id?: string | null
          qty?: number
          sku?: string | null
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_catalogue"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_pool"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      shop_orders: {
        Row: {
          brand: string
          cancelled_at: string | null
          carrier: string | null
          channel: string
          created_at: string
          currency: string
          customer_name: string | null
          discount_cents: number
          email: string | null
          external_id: string
          id: string
          livemode: boolean
          order_number: string | null
          payment_intent: string | null
          phone: string | null
          placed_at: string
          promo_code: string | null
          raw: Json | null
          refunded_cents: number
          ship_city: string | null
          ship_country: string | null
          ship_line1: string | null
          ship_line2: string | null
          ship_postal: string | null
          ship_state: string | null
          shipped_at: string | null
          shipping_cents: number
          status: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          tracking: string | null
          updated_at: string
        }
        Insert: {
          brand: string
          cancelled_at?: string | null
          carrier?: string | null
          channel: string
          created_at?: string
          currency?: string
          customer_name?: string | null
          discount_cents?: number
          email?: string | null
          external_id: string
          id?: string
          livemode?: boolean
          order_number?: string | null
          payment_intent?: string | null
          phone?: string | null
          placed_at: string
          promo_code?: string | null
          raw?: Json | null
          refunded_cents?: number
          ship_city?: string | null
          ship_country?: string | null
          ship_line1?: string | null
          ship_line2?: string | null
          ship_postal?: string | null
          ship_state?: string | null
          shipped_at?: string | null
          shipping_cents?: number
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          tracking?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string
          cancelled_at?: string | null
          carrier?: string | null
          channel?: string
          created_at?: string
          currency?: string
          customer_name?: string | null
          discount_cents?: number
          email?: string | null
          external_id?: string
          id?: string
          livemode?: boolean
          order_number?: string | null
          payment_intent?: string | null
          phone?: string | null
          placed_at?: string
          promo_code?: string | null
          raw?: Json | null
          refunded_cents?: number
          ship_city?: string | null
          ship_country?: string | null
          ship_line1?: string | null
          ship_line2?: string | null
          ship_postal?: string | null
          ship_state?: string | null
          shipped_at?: string | null
          shipping_cents?: number
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          tracking?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shop_products: {
        Row: {
          active: boolean
          brand: string
          created_at: string
          description: string | null
          description_long: string | null
          gtin: string | null
          id: string
          name: string
          net_content: string | null
          price_cents: number | null
          sku: string
          stock_product_id: string | null
          units_per_pack: number
        }
        Insert: {
          active?: boolean
          brand: string
          created_at?: string
          description?: string | null
          description_long?: string | null
          gtin?: string | null
          id?: string
          name: string
          net_content?: string | null
          price_cents?: number | null
          sku: string
          stock_product_id?: string | null
          units_per_pack?: number
        }
        Update: {
          active?: boolean
          brand?: string
          created_at?: string
          description?: string | null
          description_long?: string | null
          gtin?: string | null
          id?: string
          name?: string
          net_content?: string | null
          price_cents?: number | null
          sku?: string
          stock_product_id?: string | null
          units_per_pack?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_products_stock_product_id_fkey"
            columns: ["stock_product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_products_stock_product_id_fkey"
            columns: ["stock_product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_catalogue"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_products_stock_product_id_fkey"
            columns: ["stock_product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_pool"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_products_stock_product_id_fkey"
            columns: ["stock_product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      shop_refunds: {
        Row: {
          amount_cents: number
          brand: string
          created_at: string
          id: string
          order_id: string
          provider: string
          provider_refund_id: string | null
          reason: string | null
          restock: boolean
        }
        Insert: {
          amount_cents: number
          brand: string
          created_at?: string
          id?: string
          order_id: string
          provider?: string
          provider_refund_id?: string | null
          reason?: string | null
          restock?: boolean
        }
        Update: {
          amount_cents?: number
          brand?: string
          created_at?: string
          id?: string
          order_id?: string
          provider?: string
          provider_refund_id?: string | null
          reason?: string | null
          restock?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "shop_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_stock_alerts: {
        Row: {
          alerted_at: string
          brand: string
          cleared_at: string | null
          id: number
          low_at: number
          on_hand: number
          product_id: string
        }
        Insert: {
          alerted_at?: string
          brand: string
          cleared_at?: string | null
          id?: number
          low_at: number
          on_hand: number
          product_id: string
        }
        Update: {
          alerted_at?: string
          brand?: string
          cleared_at?: string | null
          id?: number
          low_at?: number
          on_hand?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_stock_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_stock_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_catalogue"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_stock_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_pool"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "shop_stock_alerts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_shop_stock"
            referencedColumns: ["product_id"]
          },
        ]
      }
      shop_sync_log: {
        Row: {
          action: string
          brand: string
          channel: string
          created_at: string
          detail: Json | null
          id: number
          ok: boolean
        }
        Insert: {
          action: string
          brand: string
          channel: string
          created_at?: string
          detail?: Json | null
          id?: number
          ok: boolean
        }
        Update: {
          action?: string
          brand?: string
          channel?: string
          created_at?: string
          detail?: Json | null
          id?: number
          ok?: boolean
        }
        Relationships: []
      }
      social_accounts: {
        Row: {
          accent: string | null
          access_token: string | null
          active: boolean
          app_id: string | null
          app_secret: string | null
          brand: string
          client_id: string | null
          connected_via: string | null
          created_at: string
          handle: string | null
          id: string
          label: string | null
          last_refreshed_at: string | null
          page_id: string | null
          platform: string
          publishing_paused: boolean
          remote_user_id: string | null
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          accent?: string | null
          access_token?: string | null
          active?: boolean
          app_id?: string | null
          app_secret?: string | null
          brand: string
          client_id?: string | null
          connected_via?: string | null
          created_at?: string
          handle?: string | null
          id?: string
          label?: string | null
          last_refreshed_at?: string | null
          page_id?: string | null
          platform: string
          publishing_paused?: boolean
          remote_user_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          accent?: string | null
          access_token?: string | null
          active?: boolean
          app_id?: string | null
          app_secret?: string | null
          brand?: string
          client_id?: string | null
          connected_via?: string | null
          created_at?: string
          handle?: string | null
          id?: string
          label?: string | null
          last_refreshed_at?: string | null
          page_id?: string | null
          platform?: string
          publishing_paused?: boolean
          remote_user_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      social_autoconnect_log: {
        Row: {
          brand: string
          created_at: string
          detail: Json | null
          id: string
          outcome: string
        }
        Insert: {
          brand: string
          created_at?: string
          detail?: Json | null
          id?: string
          outcome: string
        }
        Update: {
          brand?: string
          created_at?: string
          detail?: Json | null
          id?: string
          outcome?: string
        }
        Relationships: []
      }
      social_bank_log: {
        Row: {
          at: string
          brand: string
          finished_at: string | null
          id: number
          note: string | null
          request_id: number | null
          status: number | null
        }
        Insert: {
          at?: string
          brand: string
          finished_at?: string | null
          id?: number
          note?: string | null
          request_id?: number | null
          status?: number | null
        }
        Update: {
          at?: string
          brand?: string
          finished_at?: string | null
          id?: number
          note?: string | null
          request_id?: number | null
          status?: number | null
        }
        Relationships: []
      }
      social_brand_settings: {
        Row: {
          brand: string
          enabled: boolean
          per_run: number
          runway_target_days: number
          slot_utc: string
        }
        Insert: {
          brand: string
          enabled?: boolean
          per_run?: number
          runway_target_days?: number
          slot_utc: string
        }
        Update: {
          brand?: string
          enabled?: boolean
          per_run?: number
          runway_target_days?: number
          slot_utc?: string
        }
        Relationships: []
      }
      social_connect_links: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          result: Json | null
          token_hash: string
          used_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          result?: Json | null
          token_hash: string
          used_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          result?: Json | null
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_connect_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      social_content_bank: {
        Row: {
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          brand: string
          caption: string
          cards: Json
          composition: string | null
          created_at: string
          display_word: string | null
          ground: string | null
          hashtags: string | null
          id: string
          pose: string | null
          post_id: string | null
          priority: number
          queued_at: string | null
          reject_reason: string | null
          rejected: boolean
          slug: string
          source: string
          title: string
          topic: string | null
        }
        Insert: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          brand: string
          caption: string
          cards: Json
          composition?: string | null
          created_at?: string
          display_word?: string | null
          ground?: string | null
          hashtags?: string | null
          id?: string
          pose?: string | null
          post_id?: string | null
          priority?: number
          queued_at?: string | null
          reject_reason?: string | null
          rejected?: boolean
          slug: string
          source?: string
          title: string
          topic?: string | null
        }
        Update: {
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          brand?: string
          caption?: string
          cards?: Json
          composition?: string | null
          created_at?: string
          display_word?: string | null
          ground?: string | null
          hashtags?: string | null
          id?: string
          pose?: string | null
          post_id?: string | null
          priority?: number
          queued_at?: string | null
          reject_reason?: string | null
          rejected?: boolean
          slug?: string
          source?: string
          title?: string
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_content_bank_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_content_bank_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_dims: {
        Row: {
          brand: string
          composition: string | null
          display_word: string | null
          ground: string | null
          pose: string | null
          post_id: string
          topic: string | null
        }
        Insert: {
          brand: string
          composition?: string | null
          display_word?: string | null
          ground?: string | null
          pose?: string | null
          post_id: string
          topic?: string | null
        }
        Update: {
          brand?: string
          composition?: string | null
          display_word?: string | null
          ground?: string | null
          pose?: string | null
          post_id?: string
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_post_dims_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_events: {
        Row: {
          at: string
          brand: string | null
          id: number
          kind: string
          note: string | null
          post_id: string
          staff_id: string | null
        }
        Insert: {
          at?: string
          brand?: string | null
          id?: number
          kind: string
          note?: string | null
          post_id: string
          staff_id?: string | null
        }
        Update: {
          at?: string
          brand?: string | null
          id?: number
          kind?: string
          note?: string | null
          post_id?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_post_events_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_events_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          approval_item_id: string | null
          attempts: number
          brand: string
          caption: string
          claimed_at: string | null
          cover_url: string | null
          created_at: string
          error: string | null
          id: string
          max_attempts: number
          media_type: string
          media_url: string
          media_urls: string[] | null
          permalink: string | null
          platform: string
          posted_at: string | null
          remote_id: string | null
          scheduled_at: string
          status: string
          updated_at: string
        }
        Insert: {
          approval_item_id?: string | null
          attempts?: number
          brand: string
          caption?: string
          claimed_at?: string | null
          cover_url?: string | null
          created_at?: string
          error?: string | null
          id?: string
          max_attempts?: number
          media_type?: string
          media_url: string
          media_urls?: string[] | null
          permalink?: string | null
          platform: string
          posted_at?: string | null
          remote_id?: string | null
          scheduled_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          approval_item_id?: string | null
          attempts?: number
          brand?: string
          caption?: string
          claimed_at?: string | null
          cover_url?: string | null
          created_at?: string
          error?: string | null
          id?: string
          max_attempts?: number
          media_type?: string
          media_url?: string
          media_urls?: string[] | null
          permalink?: string | null
          platform?: string
          posted_at?: string | null
          remote_id?: string | null
          scheduled_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_approval_item_id_fkey"
            columns: ["approval_item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts_v5_snapshot: {
        Row: {
          brand: string | null
          caption_md5: string | null
          cover_url: string | null
          id: string | null
          media_url: string | null
          media_urls: string[] | null
          scheduled_at: string | null
          status: string | null
          taken_at: string | null
        }
        Insert: {
          brand?: string | null
          caption_md5?: string | null
          cover_url?: string | null
          id?: string | null
          media_url?: string | null
          media_urls?: string[] | null
          scheduled_at?: string | null
          status?: string | null
          taken_at?: string | null
        }
        Update: {
          brand?: string | null
          caption_md5?: string | null
          cover_url?: string | null
          id?: string | null
          media_url?: string | null
          media_urls?: string[] | null
          scheduled_at?: string | null
          status?: string | null
          taken_at?: string | null
        }
        Relationships: []
      }
      social_posts_v7_rollback: {
        Row: {
          approval_item_id: string | null
          attempts: number | null
          brand: string | null
          caption: string | null
          claimed_at: string | null
          cover_url: string | null
          created_at: string | null
          error: string | null
          id: string | null
          max_attempts: number | null
          media_type: string | null
          media_url: string | null
          media_urls: string[] | null
          permalink: string | null
          platform: string | null
          posted_at: string | null
          remote_id: string | null
          scheduled_at: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          approval_item_id?: string | null
          attempts?: number | null
          brand?: string | null
          caption?: string | null
          claimed_at?: string | null
          cover_url?: string | null
          created_at?: string | null
          error?: string | null
          id?: string | null
          max_attempts?: number | null
          media_type?: string | null
          media_url?: string | null
          media_urls?: string[] | null
          permalink?: string | null
          platform?: string | null
          posted_at?: string | null
          remote_id?: string | null
          scheduled_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          approval_item_id?: string | null
          attempts?: number | null
          brand?: string | null
          caption?: string | null
          claimed_at?: string | null
          cover_url?: string | null
          created_at?: string | null
          error?: string | null
          id?: string | null
          max_attempts?: number | null
          media_type?: string | null
          media_url?: string | null
          media_urls?: string[] | null
          permalink?: string | null
          platform?: string | null
          posted_at?: string | null
          remote_id?: string | null
          scheduled_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      staff_notify: {
        Row: {
          email_decision: boolean
          email_preview: boolean
          email_recording: boolean
          seen_at: string | null
          staff_id: string
          updated_at: string
        }
        Insert: {
          email_decision?: boolean
          email_preview?: boolean
          email_recording?: boolean
          seen_at?: string | null
          staff_id: string
          updated_at?: string
        }
        Update: {
          email_decision?: boolean
          email_preview?: boolean
          email_recording?: boolean
          seen_at?: string | null
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_notify_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_passkeys: {
        Row: {
          counter: number
          created_at: string
          credential_id: string
          device_name: string | null
          id: string
          last_used_at: string | null
          public_key: string
          staff_id: string
          transports: string[] | null
        }
        Insert: {
          counter?: number
          created_at?: string
          credential_id: string
          device_name?: string | null
          id?: string
          last_used_at?: string | null
          public_key: string
          staff_id: string
          transports?: string[] | null
        }
        Update: {
          counter?: number
          created_at?: string
          credential_id?: string
          device_name?: string | null
          id?: string
          last_used_at?: string | null
          public_key?: string
          staff_id?: string
          transports?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_passkeys_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_recovery: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          staff_id: string
          token_hash: string
          used_at: string | null
          uses: number
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          staff_id: string
          token_hash: string
          used_at?: string | null
          uses?: number
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          staff_id?: string
          token_hash?: string
          used_at?: string | null
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_recovery_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_sessions: {
        Row: {
          created_at: string
          expires_at: string
          last_seen_at: string
          passkey_id: string | null
          staff_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          last_seen_at?: string
          passkey_id?: string | null
          staff_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          last_seen_at?: string
          passkey_id?: string | null
          staff_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_sessions_passkey_id_fkey"
            columns: ["passkey_id"]
            isOneToOne: false
            referencedRelation: "staff_passkeys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_sessions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_builds: {
        Row: {
          base_build: string | null
          created_at: string
          files: Json
          id: string
          note: string | null
          parts: Json
          request_id: string | null
          status: string
          vercel: Json
        }
        Insert: {
          base_build?: string | null
          created_at?: string
          files: Json
          id?: string
          note?: string | null
          parts: Json
          request_id?: string | null
          status?: string
          vercel: Json
        }
        Update: {
          base_build?: string | null
          created_at?: string
          files?: Json
          id?: string
          note?: string | null
          parts?: Json
          request_id?: string | null
          status?: string
          vercel?: Json
        }
        Relationships: [
          {
            foreignKeyName: "studio_builds_base_build_fkey"
            columns: ["base_build"]
            isOneToOne: false
            referencedRelation: "studio_builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studio_builds_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "studio_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_chat_actions: {
        Row: {
          args: Json | null
          created_at: string
          id: string
          ok: boolean | null
          request_id: string | null
          result: Json | null
          staff_id: string | null
          tool: string
        }
        Insert: {
          args?: Json | null
          created_at?: string
          id?: string
          ok?: boolean | null
          request_id?: string | null
          result?: Json | null
          staff_id?: string | null
          tool: string
        }
        Update: {
          args?: Json | null
          created_at?: string
          id?: string
          ok?: boolean | null
          request_id?: string | null
          result?: Json | null
          staff_id?: string | null
          tool?: string
        }
        Relationships: [
          {
            foreignKeyName: "studio_chat_actions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "studio_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studio_chat_actions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_connectors: {
        Row: {
          calls: number
          created_at: string
          id: string
          key_hash: string
          label: string
          last_used_at: string | null
          owner_staff: string
          revoked_at: string | null
        }
        Insert: {
          calls?: number
          created_at?: string
          id?: string
          key_hash: string
          label: string
          last_used_at?: string | null
          owner_staff: string
          revoked_at?: string | null
        }
        Update: {
          calls?: number
          created_at?: string
          id?: string
          key_hash?: string
          label?: string
          last_used_at?: string | null
          owner_staff?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "studio_connectors_owner_staff_fkey"
            columns: ["owner_staff"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_preview_docs: {
        Row: {
          created_at: string
          html: string
          slug: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          html: string
          slug: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          html?: string
          slug?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      studio_request_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          request_id: string
          role: string
          staff_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          request_id: string
          role: string
          staff_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          request_id?: string
          role?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "studio_request_messages_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "studio_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studio_request_messages_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_requests: {
        Row: {
          client_slug: string | null
          context: Json
          created_at: string
          id: string
          kind: string
          preview_url: string | null
          staff_id: string
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          client_slug?: string | null
          context?: Json
          created_at?: string
          id?: string
          kind?: string
          preview_url?: string | null
          staff_id: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          client_slug?: string | null
          context?: Json
          created_at?: string
          id?: string
          kind?: string
          preview_url?: string | null
          staff_id?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "studio_requests_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
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
      survey_questions: {
        Row: {
          active: boolean
          client_slug: string
          created_at: string
          id: string
          key: string
          options: Json
          position: number
          prompt: string
          required: boolean
        }
        Insert: {
          active?: boolean
          client_slug: string
          created_at?: string
          id?: string
          key: string
          options: Json
          position?: number
          prompt: string
          required?: boolean
        }
        Update: {
          active?: boolean
          client_slug?: string
          created_at?: string
          id?: string
          key?: string
          options?: Json
          position?: number
          prompt?: string
          required?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "survey_questions_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
        ]
      }
      survey_responses: {
        Row: {
          answers: Json
          claimed_utm: Json | null
          client_slug: string
          created_at: string
          id: string
          note: string | null
          order_ref: string | null
          pushed_to_shopify_at: string | null
          updated_at: string
        }
        Insert: {
          answers?: Json
          claimed_utm?: Json | null
          client_slug: string
          created_at?: string
          id?: string
          note?: string | null
          order_ref?: string | null
          pushed_to_shopify_at?: string | null
          updated_at?: string
        }
        Update: {
          answers?: Json
          claimed_utm?: Json | null
          client_slug?: string
          created_at?: string
          id?: string
          note?: string | null
          order_ref?: string | null
          pushed_to_shopify_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
        ]
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
      talk_messages: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          actor_type: string
          body: string
          created_at: string
          from_studio: boolean
          id: number
          raw: Json | null
          room_token: string
          sent_at: string
          staff_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          actor_type: string
          body: string
          created_at?: string
          from_studio?: boolean
          id: number
          raw?: Json | null
          room_token: string
          sent_at: string
          staff_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          actor_type?: string
          body?: string
          created_at?: string
          from_studio?: boolean
          id?: number
          raw?: Json | null
          room_token?: string
          sent_at?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "talk_messages_room_token_fkey"
            columns: ["room_token"]
            isOneToOne: false
            referencedRelation: "talk_rooms"
            referencedColumns: ["token"]
          },
          {
            foreignKeyName: "talk_messages_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      talk_outbox: {
        Row: {
          created_at: string
          dedupe: string | null
          error: string | null
          id: string
          kind: string
          line: string
          many: string | null
          payload: Json | null
          room: string | null
          sent_at: string | null
        }
        Insert: {
          created_at?: string
          dedupe?: string | null
          error?: string | null
          id?: string
          kind: string
          line: string
          many?: string | null
          payload?: Json | null
          room?: string | null
          sent_at?: string | null
        }
        Update: {
          created_at?: string
          dedupe?: string | null
          error?: string | null
          id?: string
          kind?: string
          line?: string
          many?: string | null
          payload?: Json | null
          room?: string | null
          sent_at?: string | null
        }
        Relationships: []
      }
      talk_rooms: {
        Row: {
          active: boolean
          client_slug: string | null
          created_at: string
          label: string
          token: string
        }
        Insert: {
          active?: boolean
          client_slug?: string | null
          created_at?: string
          label: string
          token: string
        }
        Update: {
          active?: boolean
          client_slug?: string | null
          created_at?: string
          label?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "talk_rooms_client_slug_fkey"
            columns: ["client_slug"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["slug"]
          },
        ]
      }
      tenants: {
        Row: {
          active: boolean
          brand: string
          created_at: string
          display_name: string
          domain: string | null
        }
        Insert: {
          active?: boolean
          brand: string
          created_at?: string
          display_name: string
          domain?: string | null
        }
        Update: {
          active?: boolean
          brand?: string
          created_at?: string
          display_name?: string
          domain?: string | null
        }
        Relationships: []
      }
      turo_competitor_prices: {
        Row: {
          car: string | null
          host_equiv: number | null
          id: number
          nights: number | null
          observed_at: string
          renter_daily: number | null
          src: string
          target_id: string
          trip_total: number | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          car?: string | null
          host_equiv?: number | null
          id?: number
          nights?: number | null
          observed_at?: string
          renter_daily?: number | null
          src?: string
          target_id: string
          trip_total?: number | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          car?: string | null
          host_equiv?: number | null
          id?: number
          nights?: number | null
          observed_at?: string
          renter_daily?: number | null
          src?: string
          target_id?: string
          trip_total?: number | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "turo_competitor_prices_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "turo_watch_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      turo_comps: {
        Row: {
          daily_renter: number | null
          distance_mi: number | null
          id: string
          listing_id: string
          run_id: string
          trip_total: number | null
        }
        Insert: {
          daily_renter?: number | null
          distance_mi?: number | null
          id?: string
          listing_id: string
          run_id: string
          trip_total?: number | null
        }
        Update: {
          daily_renter?: number | null
          distance_mi?: number | null
          id?: string
          listing_id?: string
          run_id?: string
          trip_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "turo_comps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "turo_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      turo_day_prices: {
        Row: {
          actual: number | null
          applied: number | null
          cur: number | null
          date: string
          floor: number | null
          gate: string | null
          id: string
          lead: number | null
          proposed: number | null
          reason: string | null
          run_id: string
          src: string | null
          status: string
          verified: boolean
        }
        Insert: {
          actual?: number | null
          applied?: number | null
          cur?: number | null
          date: string
          floor?: number | null
          gate?: string | null
          id?: string
          lead?: number | null
          proposed?: number | null
          reason?: string | null
          run_id: string
          src?: string | null
          status: string
          verified?: boolean
        }
        Update: {
          actual?: number | null
          applied?: number | null
          cur?: number | null
          date?: string
          floor?: number | null
          gate?: string | null
          id?: string
          lead?: number | null
          proposed?: number | null
          reason?: string | null
          run_id?: string
          src?: string | null
          status?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "turo_day_prices_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "turo_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      turo_demand: {
        Row: {
          booked_share: number | null
          far_capped: boolean | null
          far_count: number | null
          far_median_daily: number | null
          id: number
          near_count: number | null
          near_median_daily: number | null
          note: string | null
          observed_at: string
          scope: string
          score: number
          src: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          booked_share?: number | null
          far_capped?: boolean | null
          far_count?: number | null
          far_median_daily?: number | null
          id?: number
          near_count?: number | null
          near_median_daily?: number | null
          note?: string | null
          observed_at?: string
          scope: string
          score: number
          src?: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          booked_share?: number | null
          far_capped?: boolean | null
          far_count?: number | null
          far_median_daily?: number | null
          id?: number
          near_count?: number | null
          near_median_daily?: number | null
          note?: string | null
          observed_at?: string
          scope?: string
          score?: number
          src?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      turo_market_daily: {
        Row: {
          host_net: number | null
          market_base: number | null
          n: number | null
          observed_on: string
          src: string
        }
        Insert: {
          host_net?: number | null
          market_base?: number | null
          n?: number | null
          observed_on: string
          src?: string
        }
        Update: {
          host_net?: number | null
          market_base?: number | null
          n?: number | null
          observed_on?: string
          src?: string
        }
        Relationships: []
      }
      turo_price_log: {
        Row: {
          applied_at: string
          ceiling: number | null
          date: string
          floor: number | null
          id: number
          new: number
          old: number | null
          src: string
          verified: boolean
        }
        Insert: {
          applied_at: string
          ceiling?: number | null
          date: string
          floor?: number | null
          id?: number
          new: number
          old?: number | null
          src?: string
          verified?: boolean
        }
        Update: {
          applied_at?: string
          ceiling?: number | null
          date?: string
          floor?: number | null
          id?: number
          new?: number
          old?: number | null
          src?: string
          verified?: boolean
        }
        Relationships: []
      }
      turo_runs: {
        Row: {
          ceiling: number | null
          comp_n: number | null
          days_blocked: number
          days_verified: number
          days_written: number
          gates: Json
          host_net: number | null
          id: string
          market_base: number | null
          mode: string
          notes: string | null
          ok: boolean
          ran_at: string
          runner: string
          vehicle_id: number
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          ceiling?: number | null
          comp_n?: number | null
          days_blocked?: number
          days_verified?: number
          days_written?: number
          gates?: Json
          host_net?: number | null
          id?: string
          market_base?: number | null
          mode: string
          notes?: string | null
          ok?: boolean
          ran_at?: string
          runner?: string
          vehicle_id?: number
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          ceiling?: number | null
          comp_n?: number | null
          days_blocked?: number
          days_verified?: number
          days_written?: number
          gates?: Json
          host_net?: number | null
          id?: string
          market_base?: number | null
          mode?: string
          notes?: string | null
          ok?: boolean
          ran_at?: string
          runner?: string
          vehicle_id?: number
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      turo_settings: {
        Row: {
          id: number
          note_for_claude: string | null
          note_set_at: string | null
          pause_reason: string | null
          paused: boolean
          runner: string
          updated_at: string
        }
        Insert: {
          id?: number
          note_for_claude?: string | null
          note_set_at?: string | null
          pause_reason?: string | null
          paused?: boolean
          runner?: string
          updated_at?: string
        }
        Update: {
          id?: number
          note_for_claude?: string | null
          note_set_at?: string | null
          pause_reason?: string | null
          paused?: boolean
          runner?: string
          updated_at?: string
        }
        Relationships: []
      }
      turo_watch_targets: {
        Row: {
          active: boolean
          chart: boolean
          id: string
          label: string
          note: string | null
          page_url: string
          vehicle: string | null
        }
        Insert: {
          active?: boolean
          chart?: boolean
          id: string
          label: string
          note?: string | null
          page_url: string
          vehicle?: string | null
        }
        Update: {
          active?: boolean
          chart?: boolean
          id?: string
          label?: string
          note?: string | null
          page_url?: string
          vehicle?: string | null
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
      voice_clips: {
        Row: {
          bytes: number
          created_at: string
          done_at: string | null
          error: string | null
          id: string
          note: string | null
          path: string
          recorded_at: string | null
          seconds: number | null
          source: string
          status: string
          summary: Json | null
          title: string | null
          transcript: string | null
        }
        Insert: {
          bytes?: number
          created_at?: string
          done_at?: string | null
          error?: string | null
          id?: string
          note?: string | null
          path: string
          recorded_at?: string | null
          seconds?: number | null
          source?: string
          status?: string
          summary?: Json | null
          title?: string | null
          transcript?: string | null
        }
        Update: {
          bytes?: number
          created_at?: string
          done_at?: string | null
          error?: string | null
          id?: string
          note?: string | null
          path?: string
          recorded_at?: string | null
          seconds?: number | null
          source?: string
          status?: string
          summary?: Json | null
          title?: string | null
          transcript?: string | null
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
      web_events: {
        Row: {
          brand: string
          city: string | null
          country: string | null
          device: string | null
          id: number
          kind: string
          lat: number | null
          lon: number | null
          meta: Json | null
          path: string | null
          referrer_host: string | null
          region: string | null
          session_hash: string
          ts: string
        }
        Insert: {
          brand?: string
          city?: string | null
          country?: string | null
          device?: string | null
          id?: number
          kind: string
          lat?: number | null
          lon?: number | null
          meta?: Json | null
          path?: string | null
          referrer_host?: string | null
          region?: string | null
          session_hash: string
          ts?: string
        }
        Update: {
          brand?: string
          city?: string | null
          country?: string | null
          device?: string | null
          id?: number
          kind?: string
          lat?: number | null
          lon?: number | null
          meta?: Json | null
          path?: string | null
          referrer_host?: string | null
          region?: string | null
          session_hash?: string
          ts?: string
        }
        Relationships: []
      }
      web_events_daily: {
        Row: {
          brand: string
          day: string
          pageviews: number | null
          sessions: number | null
          signups: number | null
          top_city: string | null
          top_country: string | null
        }
        Insert: {
          brand: string
          day: string
          pageviews?: number | null
          sessions?: number | null
          signups?: number | null
          top_city?: string | null
          top_country?: string | null
        }
        Update: {
          brand?: string
          day?: string
          pageviews?: number | null
          sessions?: number | null
          signups?: number | null
          top_city?: string | null
          top_country?: string | null
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
      admin_chat_thread_list: {
        Row: {
          created_at: string | null
          id: string | null
          last_body: string | null
          message_count: number | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          last_body?: never
          message_count?: never
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          last_body?: never
          message_count?: never
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      hoku_stock: {
        Row: {
          available: number | null
          cans_per_unit: number | null
          is_low: boolean | null
          low_at: number | null
          name: string | null
          on_hand: number | null
          product_id: string | null
          reserved: number | null
          sku: string | null
        }
        Relationships: []
      }
      meeting_recorder_status: {
        Row: {
          current_name: string | null
          info: Json | null
          known_voices: string[] | null
          last_seen_at: string | null
          roster: string[] | null
          seconds_since: number | null
          stage: string | null
          started_at: string | null
          status: string | null
          version: string | null
        }
        Insert: {
          current_name?: string | null
          info?: Json | null
          known_voices?: string[] | null
          last_seen_at?: string | null
          roster?: string[] | null
          seconds_since?: never
          stage?: string | null
          started_at?: string | null
          status?: string | null
          version?: string | null
        }
        Update: {
          current_name?: string | null
          info?: Json | null
          known_voices?: string[] | null
          last_seen_at?: string | null
          roster?: string[] | null
          seconds_since?: never
          stage?: string | null
          started_at?: string | null
          status?: string | null
          version?: string | null
        }
        Relationships: []
      }
      turo_price_series: {
        Row: {
          day: string | null
          series: string | null
          value: number | null
        }
        Relationships: []
      }
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
      v_cloud_leads_needing_action: {
        Row: {
          id: string | null
        }
        Insert: {
          id?: string | null
        }
        Update: {
          id?: string | null
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
            foreignKeyName: "cloud_deals_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_cloud_leads_needing_action"
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
      v_cookieyeti_needs_attention: {
        Row: {
          ai_attempts: number | null
          autofix_last_at: string | null
          autofix_note: string | null
          autofix_outcome: string | null
          autofix_runs: number | null
          domain: string | null
          id: number | null
          last_reported: string | null
          page_url: string | null
          reason: string | null
          render_attempts: number | null
          report_count: number | null
        }
        Insert: {
          ai_attempts?: number | null
          autofix_last_at?: string | null
          autofix_note?: string | null
          autofix_outcome?: string | null
          autofix_runs?: number | null
          domain?: string | null
          id?: number | null
          last_reported?: string | null
          page_url?: string | null
          reason?: never
          render_attempts?: number | null
          report_count?: number | null
        }
        Update: {
          ai_attempts?: number | null
          autofix_last_at?: string | null
          autofix_note?: string | null
          autofix_outcome?: string | null
          autofix_runs?: number | null
          domain?: string | null
          id?: number | null
          last_reported?: string | null
          page_url?: string | null
          reason?: never
          render_attempts?: number | null
          report_count?: number | null
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
      v_cookieyeti_pipeline_health: {
        Row: {
          ai_fail_24h: number | null
          ai_success_24h: number | null
          autofix_queue: number | null
          in_progress: number | null
          needs_attention: number | null
          patterns_pulled: number | null
          patterns_serving: number | null
          patterns_validated: number | null
          resolved_24h: number | null
          unresolved_total: number | null
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
      v_crm_leads: {
        Row: {
          company: string | null
          created_at: string | null
          detail_url: string | null
          email: string | null
          follow_up_on: string | null
          funnel: string | null
          funnel_status: string | null
          has_deal: boolean | null
          last_activity_at: string | null
          lead_key: string | null
          name: string | null
          note: string | null
          origin: string | null
          phone: string | null
          source_id: string | null
          stage: string | null
          starred: boolean | null
          summary: string | null
          value_cents: number | null
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
      v_hoku_image_gate: {
        Row: {
          approved: boolean | null
          drafts_waiting_on_it: number | null
          note: string | null
          photo_key: string | null
        }
        Relationships: []
      }
      v_hoku_queue_health: {
        Row: {
          bank_approved: number | null
          bank_awaiting_review: number | null
          brand: string | null
          enabled: boolean | null
          queue_days_ahead: number | null
          queue_ends_at: string | null
          queued_posts: number | null
          runway_days: number | null
        }
        Insert: {
          bank_approved?: never
          bank_awaiting_review?: never
          brand?: string | null
          enabled?: boolean | null
          queue_days_ahead?: number | null
          queue_ends_at?: never
          queued_posts?: never
          runway_days?: never
        }
        Update: {
          bank_approved?: never
          bank_awaiting_review?: never
          brand?: string | null
          enabled?: boolean | null
          queue_days_ahead?: number | null
          queue_ends_at?: never
          queued_posts?: never
          runway_days?: never
        }
        Relationships: []
      }
      v_live_funnel: {
        Row: {
          active_carts: number | null
          brand: string | null
          browsing: number | null
          checking_out: number | null
          orders_today: number | null
          purchased: number | null
          revenue_cents_today: number | null
        }
        Relationships: []
      }
      v_live_geo_coverage: {
        Row: {
          brand: string | null
          located: number | null
          total_24h: number | null
          unknown: number | null
        }
        Relationships: []
      }
      v_live_locations: {
        Row: {
          brand: string | null
          city: string | null
          country: string | null
          last_seen: string | null
          lat: number | null
          lon: number | null
          region: string | null
          sessions: number | null
        }
        Relationships: []
      }
      v_live_now: {
        Row: {
          brand: string | null
          visitors_30m: number | null
          visitors_now: number | null
        }
        Relationships: []
      }
      v_live_referrers: {
        Row: {
          brand: string | null
          sessions: number | null
          source: string | null
        }
        Relationships: []
      }
      v_live_today: {
        Row: {
          brand: string | null
          pageviews: number | null
          sessions: number | null
          signup_rate_pct: number | null
          signups: number | null
        }
        Relationships: []
      }
      v_mail_cleanup_proposal: {
        Row: {
          folder: string | null
          from_addr: string | null
          mailbox: string | null
          seen: boolean | null
          sent_at: string | null
          subject: string | null
          uid: number | null
          verdict: string | null
        }
        Insert: {
          folder?: string | null
          from_addr?: string | null
          mailbox?: string | null
          seen?: boolean | null
          sent_at?: string | null
          subject?: string | null
          uid?: number | null
          verdict?: never
        }
        Update: {
          folder?: string | null
          from_addr?: string | null
          mailbox?: string | null
          seen?: boolean | null
          sent_at?: string | null
          subject?: string | null
          uid?: number | null
          verdict?: never
        }
        Relationships: []
      }
      v_mail_queue_health: {
        Row: {
          mailbox: string | null
          max_attempts: number | null
          n: number | null
          oldest: string | null
          status: string | null
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
      v_public_catalogue: {
        Row: {
          brand: string | null
          description: string | null
          in_stock: boolean | null
          max_qty: number | null
          name: string | null
          net_content: string | null
          pool_on_hand: number | null
          pool_sku: string | null
          price_cents: number | null
          sku: string | null
          units_per_pack: number | null
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
      v_shop_activity: {
        Row: {
          at: string | null
          brand: string | null
          detail: string | null
          kind: string | null
          ref: string | null
          severity: string | null
          tab: string | null
          title: string | null
        }
        Relationships: []
      }
      v_shop_buyable: {
        Row: {
          brand: string | null
          buyable: boolean | null
          description: string | null
          name: string | null
          on_hand: number | null
          price_cents: number | null
          sku: string | null
        }
        Relationships: []
      }
      v_shop_catalogue: {
        Row: {
          active: boolean | null
          brand: string | null
          gtin: string | null
          is_bundle: boolean | null
          listings: Json | null
          low_at: number | null
          name: string | null
          net_content: string | null
          on_hand: number | null
          pool_sku: string | null
          price_cents: number | null
          product_id: string | null
          sku: string | null
          units_per_pack: number | null
        }
        Relationships: []
      }
      v_shop_pool: {
        Row: {
          active: boolean | null
          brand: string | null
          name: string | null
          pool_on_hand: number | null
          pool_product_id: string | null
          price_cents: number | null
          product_id: string | null
          sellable_qty: number | null
          sku: string | null
          units_per_pack: number | null
        }
        Relationships: []
      }
      v_shop_stock: {
        Row: {
          available: number | null
          brand: string | null
          is_bundle: boolean | null
          is_low: boolean | null
          low_at: number | null
          name: string | null
          on_hand: number | null
          pool_sku: string | null
          product_id: string | null
          reserved: number | null
          sku: string | null
          units_per_pack: number | null
        }
        Relationships: []
      }
      v_social_health: {
        Row: {
          active: boolean | null
          brand: string | null
          failed_posts: number | null
          handle: string | null
          has_token: boolean | null
          has_user_id: boolean | null
          last_posted_at: string | null
          next_slot: string | null
          platform: string | null
          posted_posts: number | null
          queued_posts: number | null
          status: string | null
          token_expires_at: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _cy_admin_or_internal_guard: { Args: never; Returns: undefined }
      _cy_analytics_guard: { Args: never; Returns: undefined }
      admin_bluesteel_sweep_ack: { Args: never; Returns: Json }
      admin_bluesteel_sweep_set: {
        Args: { p_alerts_enabled?: boolean; p_skip_dates?: string[] }
        Returns: Json
      }
      admin_bluesteel_sweep_state: { Args: never; Returns: Json }
      admin_bluesteel_sweep_test: { Args: never; Returns: number }
      admin_chat_delete_thread: {
        Args: { p_thread_id: string }
        Returns: boolean
      }
      admin_chat_rename: {
        Args: { p_thread_id: string; p_title: string }
        Returns: boolean
      }
      admin_chat_truncate: { Args: { p_message_id: string }; Returns: string }
      admin_clear_alerts: {
        Args: {
          p_match?: string
          p_older_than_minutes?: number
          p_severity?: string
        }
        Returns: Json
      }
      admin_delete_cloud_lead: { Args: { p_lead_id: string }; Returns: Json }
      admin_git: { Args: { p_body: Json; p_timeout_s?: number }; Returns: Json }
      admin_git_call: { Args: { p_body: Json }; Returns: number }
      admin_git_poll: { Args: { p_request_id: number }; Returns: Json }
      admin_login_email: { Args: { p_username: string }; Returns: string }
      admin_login_push: { Args: never; Returns: number }
      admin_meeting_forget: { Args: { p_name: string }; Returns: Json }
      admin_meeting_rename: {
        Args: { p_new: string; p_old: string }
        Returns: Json
      }
      admin_notify: {
        Args: {
          p_body: string
          p_dedupe_key?: string
          p_entity_key: string
          p_kind: string
          p_severity?: string
          p_title: string
          p_url: string
        }
        Returns: undefined
      }
      admin_require_admin: { Args: never; Returns: undefined }
      admin_sql_read: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      admin_sql_write: { Args: { p_query: string }; Returns: Json }
      admin_today: {
        Args: never
        Returns: {
          action_label: string
          detail: string
          item_count: number
          key: string
          rank: number
          severity: string
          since: string
          source: string
          title: string
          url: string
        }[]
      }
      admin_today_done: { Args: { p_key: string }; Returns: boolean }
      admin_today_rows: {
        Args: never
        Returns: {
          action_label: string
          detail: string
          item_count: number
          key: string
          rank: number
          severity: string
          since: string
          source: string
          title: string
          url: string
        }[]
      }
      approval_board: { Args: { p_token: string }; Returns: Json }
      approval_resolve_client: {
        Args: { p_token: string }
        Returns: Database["public"]["CompositeTypes"]["approval_caller"]
        SetofOptions: {
          from: "*"
          to: "approval_caller"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approval_review: {
        Args: {
          p_decision: string
          p_item: string
          p_note?: string
          p_token: string
          p_version?: number
        }
        Returns: Json
      }
      ask_hook_styles: { Args: never; Returns: string[] }
      ask_norm_hook_style: { Args: { t: string }; Returns: string }
      ask_opening_say: {
        Args: { a: Database["public"]["Tables"]["client_asks"]["Row"] }
        Returns: string
      }
      ask_readiness: {
        Args: { a: Database["public"]["Tables"]["client_asks"]["Row"] }
        Returns: string[]
      }
      ask_recent_hooks: {
        Args: { p_client: string; p_days?: number }
        Returns: {
          ask_id: string
          at: string
          hook_style: string
          on_screen: string
          say: string
          seen: string
          status: string
          title: string
        }[]
      }
      ask_sim: { Args: { a: string; b: string }; Returns: number }
      ask_words: { Args: { t: string }; Returns: string[] }
      auto_fix_pattern_issues: { Args: never; Returns: Json }
      bestly_is_bulk: {
        Args: { p_from: string; p_list_id: string }
        Returns: boolean
      }
      bestly_is_protected: { Args: { p_from: string }; Returns: boolean }
      bestly_mail_claim: {
        Args: { p_limit?: number; p_mailbox: string }
        Returns: {
          action: string
          attempts: number
          claimed_at: string | null
          created_at: string
          error: string | null
          folder: string
          id: string
          mailbox: string
          rule_id: string | null
          status: string
          target: string | null
          uid: number
        }[]
        SetofOptions: {
          from: "*"
          to: "bestly_mail_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      bestly_mail_complete: {
        Args: {
          p_dry_run?: boolean
          p_error?: string
          p_id: string
          p_new_uid?: number
          p_ok: boolean
        }
        Returns: undefined
      }
      bestly_mail_enqueue_cleanup: {
        Args: { p_mailbox?: string }
        Returns: {
          queued: number
          skipped: number
        }[]
      }
      bestly_mail_key_ok: { Args: { p_key: string }; Returns: boolean }
      bestly_mail_undo: { Args: { p_log_id: string }; Returns: string }
      bestly_memory_index: { Args: never; Returns: Json }
      bestly_ntfy: {
        Args: {
          p_body: string
          p_immediate?: boolean
          p_priority: number
          p_tags?: string[]
          p_title: string
        }
        Returns: number
      }
      bestly_raise: {
        Args: {
          p_area?: string
          p_body?: string
          p_healed?: boolean
          p_key: string
          p_kind: string
          p_needs_jared?: string
          p_severity?: string
          p_title?: string
        }
        Returns: Json
      }
      bluesteel_ack_key: { Args: never; Returns: string }
      bluesteel_la_today: { Args: never; Returns: string }
      bluesteel_sweep_ack: { Args: { p_via?: string }; Returns: Json }
      bluesteel_sweep_log_run: {
        Args: {
          p_alert_body?: string
          p_alert_title?: string
          p_latitude?: number
          p_longitude?: number
          p_note?: string
          p_ntfy_request_id?: number
          p_outcome: string
          p_side?: string
        }
        Returns: number
      }
      bluesteel_sweep_precheck: { Args: never; Returns: Json }
      bluesteel_sweep_send_alert: {
        Args: { p_body: string; p_test?: boolean; p_title: string }
        Returns: number
      }
      brand_guide_form: { Args: { p_token: string }; Returns: Json }
      brand_guide_save: {
        Args: {
          p_answer?: string
          p_chosen?: string[]
          p_extra?: string[]
          p_key: string
          p_token: string
          p_upload?: string
        }
        Returns: Json
      }
      calendar_dates: {
        Args: { p_from: string; p_to: string }
        Returns: {
          kind: string
          name: string
          note: string
          on_date: string
          slug: string
        }[]
      }
      calendar_feed_read: {
        Args: { p_back?: number; p_fwd?: number; p_key: string }
        Returns: Json
      }
      check_activation_rate_limit: {
        Args: { p_action: string; p_email: string }
        Returns: Json
      }
      check_system_health_sql: { Args: never; Returns: Json }
      claim_check: {
        Args: { _client_slug: string; _context?: string; _text: string }
        Returns: Json
      }
      claim_gate_ready: { Args: { _client_slug: string }; Returns: boolean }
      claim_gate_selftest: { Args: never; Returns: Json }
      claim_has_resource: {
        Args: { _client_slug: string; _text: string }
        Returns: boolean
      }
      claim_needs_resource: {
        Args: { _client_slug: string; _text: string }
        Returns: boolean
      }
      claim_next_social_post: {
        Args: { p_platform: string }
        Returns: {
          approval_item_id: string | null
          attempts: number
          brand: string
          caption: string
          claimed_at: string | null
          cover_url: string | null
          created_at: string
          error: string | null
          id: string
          max_attempts: number
          media_type: string
          media_url: string
          media_urls: string[] | null
          permalink: string | null
          platform: string
          posted_at: string | null
          remote_id: string | null
          scheduled_at: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "social_posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_violation: {
        Args: { _client_slug: string; _text: string }
        Returns: {
          label: string
          pattern: string
          rule_id: string
          severity: string
        }[]
      }
      cleanup_activation_rate_limits: { Args: never; Returns: undefined }
      cleanup_expired_activation_codes: { Args: never; Returns: undefined }
      cleanup_expired_challenges: { Args: never; Returns: undefined }
      cleanup_old_pihole_stats: { Args: never; Returns: undefined }
      client_ask_reply: {
        Args: { p_ask: string; p_text: string; p_token: string }
        Returns: Json
      }
      client_asks_board: { Args: { p_token: string }; Returns: Json }
      client_assets_brief: { Args: { p_client_slug: string }; Returns: string }
      client_calendar: {
        Args: { p_days?: number; p_token: string }
        Returns: Json
      }
      client_calendar_feed: {
        Args: { p_rotate?: boolean; p_token: string }
        Returns: Json
      }
      client_consent_forget: { Args: { p_token: string }; Returns: Json }
      client_item_publish: {
        Args: { p_at?: string; p_item: string; p_token: string }
        Returns: Json
      }
      client_media_finish: {
        Args: {
          p_duration: number
          p_error?: string
          p_poster: string
          p_upload: string
          p_url: string
        }
        Returns: Json
      }
      client_media_pending: { Args: never; Returns: Json }
      client_notifications: {
        Args: { p_since?: string; p_token: string }
        Returns: Json
      }
      client_ping: { Args: { p_token: string }; Returns: Json }
      client_seen: {
        Args: { p_item: string; p_seconds: number; p_token: string }
        Returns: Json
      }
      client_social_brand: { Args: { p_client: string }; Returns: string }
      client_social_connect_link: { Args: { p_token: string }; Returns: Json }
      client_social_state: { Args: { p_client: string }; Returns: Json }
      client_social_state_for: { Args: { p_token: string }; Returns: Json }
      client_talk_ctx: { Args: { p_token: string }; Returns: Json }
      client_terms_accept: {
        Args: {
          p_notice?: string
          p_token: string
          p_ua?: string
          p_version: number
          p_via?: string
        }
        Returns: Json
      }
      client_terms_current: { Args: { p_token: string }; Returns: Json }
      client_theme: { Args: { p_client_slug: string }; Returns: Json }
      client_upload_begin: {
        Args: {
          p_ask: string
          p_bytes: number
          p_mime: string
          p_purpose?: string
          p_question_key?: string
          p_token: string
        }
        Returns: Json
      }
      client_upload_done: {
        Args: {
          p_duration?: number
          p_parts?: number
          p_token: string
          p_upload: string
        }
        Returns: Json
      }
      client_upload_path_open: { Args: { p_path: string }; Returns: boolean }
      clip_claim: { Args: { p_key: string }; Returns: Json }
      clip_new: {
        Args: {
          p_bytes: number
          p_key: string
          p_path: string
          p_recorded_at?: string
          p_source?: string
          p_title: string
        }
        Returns: string
      }
      clip_write: {
        Args: {
          p_error?: string
          p_id: string
          p_key: string
          p_seconds?: number
          p_summary?: Json
          p_title?: string
          p_transcript?: string
        }
        Returns: undefined
      }
      crm_set_stage: {
        Args: { p_key: string; p_stage: string }
        Returns: string
      }
      current_brand: { Args: never; Returns: string }
      current_intake_token: { Args: never; Returns: string }
      cy_autofix_candidates: { Args: { p_limit?: number }; Returns: string[] }
      cy_community_ai_totals: { Args: never; Returns: Json }
      cy_conversion: { Args: never; Returns: Json }
      cy_dau: { Args: { days?: number }; Returns: Json }
      cy_devices_protected: { Args: never; Returns: number }
      cy_event_activity: { Args: { p_days?: number }; Returns: Json }
      cy_funnel: { Args: never; Returns: Json }
      cy_is_own_domain: { Args: { p_domain: string }; Returns: boolean }
      cy_operations_stats: { Args: { p_days?: number }; Returns: Json }
      cy_platform_breakdown: { Args: never; Returns: Json }
      cy_render_key: { Args: never; Returns: string }
      cy_render_key_ok: { Args: { p_key: string }; Returns: boolean }
      cy_selector_cookie_like: {
        Args: { p_selector: string }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_stale_home_hub_commands: { Args: never; Returns: undefined }
      find_dismissal_consensus: { Args: never; Returns: Json }
      fix_ai_claim: { Args: { p_key: string }; Returns: Json }
      fix_ai_write: {
        Args: {
          p_answer: string
          p_error?: string
          p_id: string
          p_key: string
        }
        Returns: undefined
      }
      fix_cron_last_error: { Args: { p_job: string }; Returns: string }
      fix_grant_select: { Args: { p_table: string }; Returns: boolean }
      fix_log_add: {
        Args: { p_by: string; p_key: string; p_ok?: boolean; p_text: string }
        Returns: undefined
      }
      get_action_type_stats: { Args: never; Returns: Json }
      get_ai_generation_candidates: { Args: { _limit: number }; Returns: Json }
      get_cmp_distribution: { Args: never; Returns: Json }
      get_community_overview: { Args: never; Returns: Json }
      get_confidence_distribution: { Args: never; Returns: Json }
      get_cookieyeti_timeline: { Args: { days_back?: number }; Returns: Json }
      get_daily_pattern_activity: { Args: { p_days?: number }; Returns: Json }
      get_dashboard_overview: { Args: never; Returns: Json }
      get_edge_proxy_key: { Args: never; Returns: string }
      get_github_token: { Args: never; Returns: string }
      get_home_hub_agent_key: { Args: never; Returns: string }
      get_meta_master_token: { Args: never; Returns: string }
      get_nextcloud_credentials: {
        Args: never
        Returns: {
          app_password: string
          base_url: string
          username: string
        }[]
      }
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
      get_render_queue: { Args: { _token: string }; Returns: Json }
      get_sms_config: { Args: never; Returns: Json }
      get_source_breakdown: { Args: never; Returns: Json }
      get_stripe_config: { Args: { p_livemode?: boolean }; Returns: Json }
      get_top_domains: {
        Args: { p_limit?: number; p_order?: string }
        Returns: Json
      }
      get_unresolved_reports: { Args: { p_limit?: number }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hoku_clean_caption: { Args: { _caption: string }; Returns: string }
      hoku_compliance_violation: { Args: { _text: string }; Returns: string }
      hoku_content_tick: { Args: never; Returns: Json }
      hoku_gtin12_valid: { Args: { g: string }; Returns: boolean }
      hoku_live_spark: {
        Args: { p_brand?: string }
        Returns: {
          hour: string
          sessions: number
        }[]
      }
      hoku_move_stock: {
        Args: {
          p_delta: number
          p_note?: string
          p_order?: string
          p_product: string
          p_reason: string
        }
        Returns: number
      }
      hoku_next_slots: {
        Args: { _brand: string; _want: number }
        Returns: string[]
      }
      hoku_og_url: {
        Args: {
          _eyebrow?: string
          _headline: string
          _layout?: string
          _photo?: string
          _subhead?: string
        }
        Returns: string
      }
      hoku_queue_from_bank: {
        Args: { _brand?: string; _force?: boolean }
        Returns: {
          queued_id: string
          slot: string
          theme: string
        }[]
      }
      hoku_release_order: {
        Args: { p_order: string; p_status: string }
        Returns: undefined
      }
      hoku_reserve_order: { Args: { p_order: string }; Returns: number }
      hoku_ship_order: {
        Args: { p_carrier?: string; p_order: string; p_tracking?: string }
        Returns: undefined
      }
      hoku_soft_claim_violation: { Args: { _text: string }; Returns: string }
      home_hub_check_agent: { Args: never; Returns: undefined }
      home_hub_ingest_snapshot: {
        Args: { p_data: Json; p_error: string; p_ok: boolean; p_source: string }
        Returns: undefined
      }
      home_hub_ntfy: {
        Args: {
          p_body: string
          p_immediate?: boolean
          p_priority: number
          p_tags?: string[]
          p_title: string
        }
        Returns: number
      }
      home_hub_raise: {
        Args: {
          p_body?: string
          p_key: string
          p_kind: string
          p_occurred_at?: string
          p_push?: boolean
          p_severity: string
          p_source?: string
          p_title: string
        }
        Returns: Json
      }
      home_hub_vault_list: {
        Args: never
        Returns: {
          description: string
          name: string
          updated_at: string
        }[]
      }
      home_hub_vault_put: {
        Args: { p_description?: string; p_name: string; p_value: string }
        Returns: string
      }
      intake_doc_path_ok: { Args: { p_name: string }; Returns: boolean }
      internal_proxy_key_ok: { Args: { p_key: string }; Returns: boolean }
      invoke_edge_function: {
        Args: { function_slug: string; payload?: Json; timeout_ms?: number }
        Returns: number
      }
      live_range: {
        Args: { _from?: string; _range?: string; _to?: string }
        Returns: {
          r_clamped: boolean
          r_from: string
          r_label: string
          r_to: string
        }[]
      }
      live_snapshot: {
        Args: { _brand: string; _from: string; _to: string }
        Returns: Json
      }
      log_admin_activity: {
        Args: { p_description: string; p_event_type: string; p_metadata?: Json }
        Returns: string
      }
      mac_agent_health: {
        Args: never
        Returns: {
          last_seen_at: string
          minutes_since: number
          name: string
          pending: number
        }[]
      }
      mac_agent_watchdog: { Args: never; Returns: undefined }
      mac_job_decide: { Args: { p_id: string; p_run: boolean }; Returns: Json }
      mac_mail_tick: { Args: never; Returns: undefined }
      mac_queue_command: {
        Args: { p_action: string; p_payload?: Json }
        Returns: string
      }
      mail_gap_check: { Args: never; Returns: number }
      mark_ai_processed: {
        Args: { _domain: string; _resolved?: boolean }
        Returns: undefined
      }
      mark_render: { Args: { _id: number; _token: string }; Returns: undefined }
      meeting_people:
        | {
            Args: { p_roster: string[]; p_transcript: string }
            Returns: string[]
          }
        | {
            Args: {
              p_roster: string[]
              p_speakers?: Json
              p_transcript: string
            }
            Returns: string[]
          }
      monitor_tick: { Args: never; Returns: Json }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      next_digest_time: { Args: { p_tz?: string }; Returns: string }
      nextcloud_cred: { Args: never; Returns: Json }
      nextcloud_seat_cred: {
        Args: { p_client?: string; p_staff?: string }
        Returns: Json
      }
      nextcloud_seat_put: {
        Args: {
          p_app_password: string
          p_display: string
          p_kind: string
          p_slug: string
          p_uid: string
        }
        Returns: Json
      }
      notify_client: {
        Args: {
          p_body: string
          p_client: string
          p_dedupe?: string
          p_kind: string
          p_link: string
          p_payload?: Json
          p_subject: string
        }
        Returns: undefined
      }
      notify_outbox_done: {
        Args: { p_error?: string; p_id: string; p_ok: boolean }
        Returns: undefined
      }
      notify_outbox_take: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          audience: string
          body: string
          client_id: string | null
          created_at: string
          dedupe: string | null
          error: string | null
          hold_until: string | null
          id: string
          kind: string
          link: string | null
          payload: Json | null
          sent_at: string | null
          staff_id: string | null
          subject: string
          to_email: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "notify_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      notify_row_client: {
        Args: { o: Database["public"]["Tables"]["notify_outbox"]["Row"] }
        Returns: string
      }
      notify_staff:
        | {
            Args: {
              p_body: string
              p_kind: string
              p_link: string
              p_payload?: Json
              p_pref: string
              p_subject: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_body: string
              p_hold?: string
              p_kind: string
              p_link: string
              p_need_promote?: boolean
              p_only?: string
              p_payload?: Json
              p_pref: string
              p_subject: string
            }
            Returns: undefined
          }
      partner_ai_claim: {
        Args: { p_key: string; p_model?: string }
        Returns: Json
      }
      partner_ai_key_ok: { Args: { p_key: string }; Returns: boolean }
      partner_ai_write: {
        Args: {
          p_content: string
          p_done?: boolean
          p_error?: string
          p_key: string
          p_reply_id: string
        }
        Returns: undefined
      }
      partner_chat_clear: { Args: never; Returns: undefined }
      partner_chat_send: {
        Args: { p_text: string; p_thread?: string }
        Returns: {
          content: string
          created_at: string
          id: string
          reply_to: string | null
          role: string
          status: string
          thread_id: string | null
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "partner_chat"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      partner_connector_auth: { Args: { p_key: string }; Returns: Json }
      partner_connector_create: { Args: { p_label?: string }; Returns: Json }
      partner_connector_list: { Args: never; Returns: Json }
      partner_connector_revoke: { Args: { p_id: string }; Returns: boolean }
      partner_mail_known: {
        Args: { p_ids: string[]; p_key: string; p_roster: string }
        Returns: string[]
      }
      partner_mail_targets: { Args: { p_key: string }; Returns: Json }
      partner_pipeline: { Args: never; Returns: Json }
      partner_roster_name: { Args: never; Returns: string }
      partner_staff_id: { Args: never; Returns: string }
      partner_studio_notifications: {
        Args: { p_roster?: string }
        Returns: Json
      }
      partner_studio_seen: { Args: never; Returns: undefined }
      partner_task_set: {
        Args: { p_id: string; p_status: string }
        Returns: Json
      }
      partner_thread_delete: { Args: { p_id: string }; Returns: undefined }
      partner_thread_rename: {
        Args: { p_id: string; p_title: string }
        Returns: undefined
      }
      platform_specs: { Args: never; Returns: Json }
      post_sells_product: { Args: { p_item: string }; Returns: string[] }
      process_user_reports: { Args: never; Returns: Json }
      purge_expired_admin_auth: { Args: never; Returns: undefined }
      purge_expired_enrol_codes: { Args: never; Returns: undefined }
      purge_old_bestly_mail: { Args: never; Returns: undefined }
      re_intake_failed: {
        Args: { p_job_ref: string; p_note?: string; p_token: string }
        Returns: Json
      }
      re_intake_open: {
        Args: {
          p_address?: string
          p_client?: string
          p_job_ref: string
          p_title: string
          p_token: string
        }
        Returns: Json
      }
      re_intake_ready: {
        Args: {
          p_job_ref: string
          p_note?: string
          p_slug: string
          p_status?: string
          p_token: string
        }
        Returns: Json
      }
      re_intake_slides: {
        Args: { p_job_ref: string; p_token: string; p_urls: Json }
        Returns: Json
      }
      re_intake_variants: {
        Args: { p_job_ref: string; p_token: string; p_variants: Json }
        Returns: Json
      }
      re_listing_put: {
        Args: { p_bundle: Json; p_token: string }
        Returns: Json
      }
      re_listing_seen: {
        Args: { p_mid: string; p_token: string }
        Returns: Json
      }
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
      requeue_stuck_social_posts: { Args: never; Returns: number }
      research_credit_reserve: {
        Args: {
          p_credits: number
          p_run_id?: string
          p_url?: string
          p_verb: string
        }
        Returns: Json
      }
      reset_failed_domains_cron: { Args: never; Returns: Json }
      reset_render_attempts: { Args: { p_domain: string }; Returns: number }
      run_maintenance_cron: { Args: never; Returns: Json }
      scout_daily_set: {
        Args: { p_id: string; p_status: string }
        Returns: Json
      }
      scout_digest: { Args: never; Returns: Json }
      scout_lesson_admin: {
        Args: { p_active?: boolean; p_delete?: boolean; p_id: string }
        Returns: undefined
      }
      scout_lesson_used: {
        Args: { p_ids: string[]; p_worked: boolean }
        Returns: undefined
      }
      scout_lessons_for: {
        Args: { p_limit?: number; p_scope: string; p_text?: string }
        Returns: {
          avoid_text: string
          do_text: string
          id: string
          losses: number
          scope: string
          title: string
          when_text: string
          wins: number
        }[]
      }
      scout_notify: {
        Args: {
          p_body?: string
          p_dedupe?: string
          p_push?: boolean
          p_severity?: string
          p_title: string
          p_url?: string
        }
        Returns: Json
      }
      security_check: {
        Args: {
          p_asset: string
          p_check: string
          p_detail?: string
          p_evidence?: Json
          p_fix?: string
          p_key: string
          p_layer: string
          p_result: string
          p_run: string
          p_title?: string
        }
        Returns: string
      }
      security_finding_set_status: {
        Args: { p_id: string; p_note?: string; p_status: string }
        Returns: undefined
      }
      security_run_finish: {
        Args: { p_failed?: boolean; p_run: string; p_summary?: string }
        Returns: Json
      }
      security_run_start: {
        Args: { p_inventory?: Json; p_trigger?: string }
        Returns: string
      }
      shop_admin_data: { Args: { _brand: string }; Returns: Json }
      shop_create_order: {
        Args: {
          p_brand: string
          p_channel: string
          p_currency: string
          p_customer_name: string
          p_email: string
          p_external_id: string
          p_extra?: Json
          p_items: Json
          p_phone: string
          p_placed_at: string
          p_ship: Json
          p_total_cents: number
        }
        Returns: string
      }
      shop_enqueue_abandoned: { Args: { _id: string }; Returns: undefined }
      shop_enqueue_notification: {
        Args: { _kind: string; _order_id: string }
        Returns: undefined
      }
      shop_mark_shipped: {
        Args: {
          _carrier?: string
          _order_id: string
          _tracking?: string
          _undo?: boolean
        }
        Returns: Json
      }
      shop_refund_order: {
        Args: {
          _amount_cents: number
          _order_id: string
          _provider?: string
          _provider_refund_id?: string
          _reason?: string
          _restock?: boolean
        }
        Returns: Json
      }
      shop_replace_order_items: {
        Args: { _items: Json; _order_id: string }
        Returns: number
      }
      shop_set_stock: {
        Args: {
          _brand: string
          _low_at?: number
          _on_hand?: number
          _sku: string
        }
        Returns: Json
      }
      social_bank_commit: {
        Args: { p_bank_id: string; p_media_urls: string[]; p_slot: string }
        Returns: Json
      }
      social_bank_next: { Args: { p_brand: string }; Returns: Json }
      social_bank_tick: { Args: never; Returns: undefined }
      social_connect_mint: {
        Args: { p_by: string; p_client: string }
        Returns: string
      }
      social_drain_status: {
        Args: never
        Returns: {
          last_run: string
          last_status: string
          overdue_posts: number
          schedule: string
          scheduled: boolean
        }[]
      }
      social_enqueue_item: {
        Args: {
          p_actor: string
          p_at: string
          p_force?: boolean
          p_item: string
        }
        Returns: Json
      }
      social_next_slot: { Args: { p_brand: string }; Returns: string }
      social_plan_check: {
        Args: {
          p_brand: string
          p_composition: string
          p_ground: string
          p_pose: string
          p_topic: string
          p_word: string
        }
        Returns: Json
      }
      staff_invite_link: {
        Args: { p_staff_slug: string; p_token: string }
        Returns: Json
      }
      staff_may_hear: {
        Args: { p_client: string; p_staff: string }
        Returns: boolean
      }
      staff_may_see: {
        Args: { p_client: string; p_staff: string }
        Returns: boolean
      }
      staff_may_see_item: {
        Args: { p_item: string; p_staff: string }
        Returns: boolean
      }
      staff_may_see_slug: {
        Args: { p_slug: string; p_staff: string }
        Returns: boolean
      }
      staff_recovery_redeem: { Args: { p_token: string }; Returns: Json }
      staff_recovery_start: { Args: { p_who: string }; Returns: Json }
      store_bestly_secret: {
        Args: { p_name: string; p_value: string }
        Returns: string
      }
      studio_ask_attach: {
        Args: { p_item?: string; p_token: string; p_upload: string }
        Returns: Json
      }
      studio_ask_close: {
        Args: { p_ask: string; p_token: string }
        Returns: Json
      }
      studio_ask_comment_final: {
        Args: {
          p_ask: string
          p_send?: boolean
          p_text: string
          p_token: string
        }
        Returns: Json
      }
      studio_ask_create: {
        Args: { p_client_slug: string; p_payload: Json; p_token: string }
        Returns: Json
      }
      studio_ask_delete: {
        Args: { p_ask: string; p_token: string }
        Returns: Json
      }
      studio_ask_from_item: {
        Args: { p_item: string; p_token: string }
        Returns: Json
      }
      studio_ask_pull: {
        Args: { p_ask: string; p_token: string }
        Returns: Json
      }
      studio_ask_send: {
        Args: { p_ask: string; p_token: string }
        Returns: Json
      }
      studio_ask_update: {
        Args: { p_ask: string; p_payload: Json; p_token: string }
        Returns: Json
      }
      studio_asks: {
        Args: { p_client_slug: string; p_token: string }
        Returns: Json
      }
      studio_asset_begin: {
        Args: {
          p_bytes: number
          p_client_slug: string
          p_filename?: string
          p_kind?: string
          p_mime: string
          p_note?: string
          p_tags?: string[]
          p_title: string
          p_token: string
        }
        Returns: Json
      }
      studio_asset_done: {
        Args: {
          p_duration?: number
          p_height?: number
          p_token: string
          p_upload: string
          p_width?: number
        }
        Returns: Json
      }
      studio_asset_remove: {
        Args: { p_token: string; p_upload: string }
        Returns: Json
      }
      studio_asset_update: {
        Args: {
          p_kind?: string
          p_note?: string
          p_tags?: string[]
          p_title?: string
          p_token: string
          p_upload: string
        }
        Returns: Json
      }
      studio_assets: {
        Args: { p_client_slug: string; p_token: string }
        Returns: Json
      }
      studio_assets_retire_tag: {
        Args: {
          p_client_slug: string
          p_kind?: string
          p_tag: string
          p_token: string
        }
        Returns: Json
      }
      studio_bank: { Args: { p_slug: string; p_token: string }; Returns: Json }
      studio_bank_decide: {
        Args: {
          p_decision: string
          p_id: string
          p_reason?: string
          p_slug: string
          p_token: string
        }
        Returns: Json
      }
      studio_bank_run: {
        Args: { p_slug: string; p_token: string; p_what?: string }
        Returns: Json
      }
      studio_board: {
        Args: { p_client_slug?: string; p_token: string }
        Returns: Json
      }
      studio_board_stamp: {
        Args: { p_client_slug?: string; p_token: string }
        Returns: Json
      }
      studio_boot: {
        Args: { p_file: string; p_preview?: string }
        Returns: Json
      }
      studio_brand: {
        Args: { p_client_slug: string; p_token: string }
        Returns: Json
      }
      studio_brand_asset_begin: {
        Args: {
          p_bytes: number
          p_client_slug: string
          p_mime: string
          p_question_key: string
          p_token: string
        }
        Returns: Json
      }
      studio_brand_asset_done: {
        Args: { p_token: string; p_upload: string }
        Returns: Json
      }
      studio_brand_asset_remove: {
        Args: { p_token: string; p_upload: string }
        Returns: Json
      }
      studio_brand_compile: {
        Args: { p_client_slug: string; p_token: string }
        Returns: Json
      }
      studio_brief_done: {
        Args: {
          p_ask?: string
          p_brief: string
          p_item?: string
          p_reason?: string
          p_status?: string
          p_token: string
        }
        Returns: Json
      }
      studio_brief_edit: {
        Args: {
          p_body: string
          p_brief: string
          p_kind?: string
          p_token: string
        }
        Returns: Json
      }
      studio_brief_file: {
        Args: {
          p_attachment?: string
          p_body: string
          p_client_slug: string
          p_from_addr?: string
          p_from_name?: string
          p_kind?: string
          p_message_id?: string
          p_part?: number
          p_source?: string
          p_subject?: string
          p_token: string
        }
        Returns: Json
      }
      studio_briefs: {
        Args: { p_client_slug: string; p_status?: string; p_token: string }
        Returns: Json
      }
      studio_build_key_ok: { Args: { p_key: string }; Returns: boolean }
      studio_calendar: {
        Args: {
          p_client_slug: string
          p_days?: number
          p_from?: string
          p_token: string
        }
        Returns: Json
      }
      studio_calendar_feed: {
        Args: { p_client_slug: string; p_rotate?: boolean; p_token: string }
        Returns: Json
      }
      studio_chat_snapshot: { Args: { p_client_slug?: string }; Returns: Json }
      studio_chat_snapshot_base: {
        Args: { p_client_slug?: string }
        Returns: Json
      }
      studio_check_enroll_code: {
        Args: { p_code: string; p_slug: string }
        Returns: boolean
      }
      studio_claim_gate_ack: {
        Args: { p_client_slug: string; p_note: string; p_token: string }
        Returns: Json
      }
      studio_claim_try: {
        Args: { p_client_slug: string; p_text: string; p_token: string }
        Returns: Json
      }
      studio_client_create: {
        Args: {
          p_brand_note?: string
          p_name: string
          p_slug: string
          p_token: string
        }
        Returns: Json
      }
      studio_client_delete: {
        Args: { p_confirm: string; p_slug: string; p_token: string }
        Returns: Json
      }
      studio_client_footprint: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      studio_client_invite_info: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      studio_client_notify: {
        Args: { p_on: boolean; p_slug: string; p_token: string }
        Returns: Json
      }
      studio_client_rename: {
        Args: { p_new_slug: string; p_slug: string; p_token: string }
        Returns: Json
      }
      studio_client_rotate_token: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      studio_client_theme: {
        Args: { p_client_slug: string; p_token: string }
        Returns: Json
      }
      studio_client_update: {
        Args: { p_patch: Json; p_slug: string; p_token: string }
        Returns: Json
      }
      studio_clients: { Args: { p_token: string }; Returns: Json }
      studio_connector_auth: { Args: { p_key: string }; Returns: Json }
      studio_connector_mint: {
        Args: { p_label: string; p_token: string }
        Returns: Json
      }
      studio_connector_revoke: {
        Args: { p_id: string; p_token: string }
        Returns: Json
      }
      studio_connector_session: { Args: { p_staff: string }; Returns: string }
      studio_connectors_mine: { Args: { p_token: string }; Returns: Json }
      studio_consume_enroll_code: {
        Args: { p_code: string; p_slug: string }
        Returns: Database["public"]["CompositeTypes"]["studio_caller"]
        SetofOptions: {
          from: "*"
          to: "studio_caller"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      studio_decide: {
        Args: {
          p_decision: string
          p_item: string
          p_note?: string
          p_slide?: number
          p_token: string
        }
        Returns: Json
      }
      studio_enroll_code: {
        Args: { p_hours?: number; p_staff_slug: string; p_token: string }
        Returns: Json
      }
      studio_enroll_code_why: {
        Args: { p_code: string; p_slug: string }
        Returns: string
      }
      studio_house_board: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      studio_house_rule_toggle: {
        Args: { p_active: boolean; p_rule: string; p_token: string }
        Returns: Json
      }
      studio_ig_app_get: { Args: never; Returns: Json }
      studio_ig_app_set: {
        Args: { p_app_id: string; p_app_secret: string }
        Returns: Json
      }
      studio_item_create: {
        Args: { p_client_slug: string; p_payload: Json; p_token: string }
        Returns: Json
      }
      studio_item_delete: {
        Args: { p_item: string; p_token: string }
        Returns: Json
      }
      studio_item_edit: {
        Args: {
          p_caption: string
          p_item: string
          p_title: string
          p_token: string
        }
        Returns: Json
      }
      studio_item_publish: {
        Args: {
          p_at?: string
          p_force?: boolean
          p_item: string
          p_token: string
        }
        Returns: Json
      }
      studio_item_schedule: {
        Args: { p_date: string; p_item: string; p_token: string }
        Returns: Json
      }
      studio_item_set_media:
        | {
            Args: {
              p_item: string
              p_note?: string
              p_token: string
              p_url: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_item: string
              p_note?: string
              p_thumb?: string
              p_token: string
              p_url: string
            }
            Returns: Json
          }
      studio_item_set_thumb: {
        Args: { p_item: string; p_token: string; p_url: string }
        Returns: Json
      }
      studio_library: {
        Args: { p_client_slug: string; p_scope?: string; p_token: string }
        Returns: Json
      }
      studio_live_manifest: { Args: never; Returns: Json }
      studio_mark_posted: {
        Args: {
          p_item: string
          p_note?: string
          p_on?: boolean
          p_token: string
        }
        Returns: Json
      }
      studio_memo_activate: {
        Args: { p_client_slug: string; p_token: string; p_version: number }
        Returns: Json
      }
      studio_memory: {
        Args: { p_client_slug?: string; p_token: string }
        Returns: Json
      }
      studio_memory_recall: {
        Args: {
          p_area?: string
          p_limit?: number
          p_query?: string
          p_token: string
        }
        Returns: Json
      }
      studio_memory_remember: {
        Args: {
          p_area: string
          p_body: string
          p_by?: string
          p_client_slug?: string
          p_key: string
          p_title: string
          p_token: string
        }
        Returns: Json
      }
      studio_mint_enroll_code: {
        Args: { p_hours?: number; p_slug: string }
        Returns: string
      }
      studio_needs_render: {
        Args: { p_item: string; p_token: string; p_why: string }
        Returns: Json
      }
      studio_note: {
        Args: {
          p_item: string
          p_note: string
          p_parent?: string
          p_slide?: number
          p_token: string
        }
        Returns: Json
      }
      studio_note_delete: {
        Args: { p_review: string; p_token: string }
        Returns: Json
      }
      studio_note_edit: {
        Args: { p_note: string; p_review: string; p_token: string }
        Returns: Json
      }
      studio_notifications: {
        Args: { p_since?: string; p_token: string }
        Returns: Json
      }
      studio_notify_prefs: {
        Args: { p_patch: Json; p_token: string }
        Returns: Json
      }
      studio_notify_seen: { Args: { p_token: string }; Returns: Json }
      studio_open_session: {
        Args: {
          p_days?: number
          p_passkey: string
          p_staff: string
          p_token_hash: string
        }
        Returns: string
      }
      studio_passkey_remove: {
        Args: { p_passkey: string; p_token: string }
        Returns: Json
      }
      studio_ping: { Args: { p_token: string }; Returns: Json }
      studio_presence: { Args: { p_token: string }; Returns: Json }
      studio_preview_doc: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      studio_preview_doc_put: {
        Args: {
          p_html: string
          p_slug: string
          p_title: string
          p_token: string
        }
        Returns: Json
      }
      studio_promote: {
        Args: { p_item: string; p_token: string }
        Returns: Json
      }
      studio_read_state: {
        Args: { p_client_slug: string; p_token: string }
        Returns: Json
      }
      studio_regen_done: {
        Args: { p_item: string; p_token: string }
        Returns: Json
      }
      studio_regen_queue: {
        Args: { p_client_slug?: string; p_token: string }
        Returns: Json
      }
      studio_regen_request: {
        Args: { p_item: string; p_on?: boolean; p_token: string }
        Returns: Json
      }
      studio_render_cleared: {
        Args: { p_item: string; p_token: string }
        Returns: Json
      }
      studio_request_new: {
        Args: { p_body: string; p_context?: Json; p_token: string }
        Returns: Json
      }
      studio_request_reply: {
        Args: { p_body: string; p_request: string; p_token: string }
        Returns: Json
      }
      studio_request_ship: {
        Args: { p_go?: boolean; p_request: string; p_token: string }
        Returns: Json
      }
      studio_requests_list: {
        Args: { p_limit?: number; p_token: string }
        Returns: Json
      }
      studio_resolve_staff: {
        Args: { p_token: string }
        Returns: Database["public"]["CompositeTypes"]["studio_caller"]
        SetofOptions: {
          from: "*"
          to: "studio_caller"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      studio_rule_accept: {
        Args: {
          p_force?: boolean
          p_label: string
          p_pattern: string
          p_proposal: string
          p_severity?: string
          p_token: string
        }
        Returns: Json
      }
      studio_rule_dismiss: {
        Args: { p_proposal: string; p_token: string }
        Returns: Json
      }
      studio_rule_toggle: {
        Args: { p_active: boolean; p_rule: string; p_token: string }
        Returns: Json
      }
      studio_seats: { Args: { p_token: string }; Returns: Json }
      studio_seed_item: {
        Args: { p_client_slug: string; p_payload: Json }
        Returns: string
      }
      studio_seed_item_rel: {
        Args: { p_client_slug: string; p_payload: Json }
        Returns: string
      }
      studio_selftest: { Args: never; Returns: Json }
      studio_selftest_stage: { Args: never; Returns: Json }
      studio_selftest_t3: {
        Args: { p_internal: string; p_token: string }
        Returns: Json
      }
      studio_settings: { Args: { p_token: string }; Returns: Json }
      studio_ship_sign_poll: { Args: { p_req: number }; Returns: Json }
      studio_ship_sign_upload: { Args: { p_path: string }; Returns: number }
      studio_signoff: { Args: { p_item: string }; Returns: Json }
      studio_social_connect_link: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      studio_social_hold: {
        Args: {
          p_note?: string
          p_on?: boolean
          p_post: string
          p_token: string
        }
        Returns: Json
      }
      studio_social_mode: {
        Args: { p_mode: string; p_slug: string; p_token: string }
        Returns: Json
      }
      studio_social_pause: {
        Args: { p_on: boolean; p_slug: string; p_token: string }
        Returns: Json
      }
      studio_social_post_now: {
        Args: { p_post: string; p_token: string }
        Returns: Json
      }
      studio_social_state: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      studio_staff_email: {
        Args: { p_email: string; p_staff_slug: string; p_token: string }
        Returns: Json
      }
      studio_staff_invite: {
        Args: {
          p_can_promote?: boolean
          p_email: string
          p_name: string
          p_token: string
        }
        Returns: Json
      }
      studio_staff_update: {
        Args: { p_patch: Json; p_staff_slug: string; p_token: string }
        Returns: Json
      }
      studio_talk: {
        Args: { p_limit?: number; p_room?: string; p_token: string }
        Returns: Json
      }
      studio_theme_from_guide: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      studio_touch_session: { Args: { p_token: string }; Returns: undefined }
      studio_unpromote: {
        Args: { p_force?: boolean; p_item: string; p_token: string }
        Returns: Json
      }
      studio_work_done: {
        Args: { p_item: string; p_note?: string; p_token: string }
        Returns: Json
      }
      studio_work_start: {
        Args: {
          p_by?: string
          p_item: string
          p_kind: string
          p_minutes?: number
          p_note?: string
          p_token: string
        }
        Returns: Json
      }
      submit_intake: { Args: { p_id: string }; Returns: Json }
      survey_form: { Args: { p_client_slug: string }; Returns: Json }
      survey_results: {
        Args: { p_client_slug: string; p_days?: number }
        Returns: Json
      }
      survey_submit: {
        Args: {
          p_answers: Json
          p_client_slug: string
          p_note?: string
          p_order_ref: string
        }
        Returns: Json
      }
      talk_bucket: { Args: never; Returns: string }
      talk_outbox_done: {
        Args: { p_error?: string; p_ids: string[]; p_ok: boolean }
        Returns: undefined
      }
      talk_outbox_take: {
        Args: never
        Returns: {
          ids: string[]
          kind: string
          line: string
          room: string
        }[]
      }
      talk_say: {
        Args: {
          p_dedupe?: string
          p_kind: string
          p_line: string
          p_many?: string
          p_payload?: Json
        }
        Returns: undefined
      }
      turo_breadcrumbs: { Args: never; Returns: Json }
      turo_settings_set: {
        Args: { p_note?: string; p_paused?: boolean; p_reason?: string }
        Returns: Json
      }
      turo_watchdog: { Args: never; Returns: Json }
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
      url_encode: { Args: { _s: string }; Returns: string }
      waitlist_admin: {
        Args: { _brand?: string; _limit?: number }
        Returns: Json
      }
      web_events_prune: { Args: never; Returns: undefined }
      web_events_rollup: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "partner"
    }
    CompositeTypes: {
      approval_caller: {
        id: string | null
        slug: string | null
        name: string | null
        brand_note: string | null
      }
      studio_caller: {
        id: string | null
        slug: string | null
        name: string | null
        can_promote: boolean | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "moderator", "user", "partner"],
    },
  },
} as const

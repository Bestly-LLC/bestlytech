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
      _keyship: {
        Row: {
          made_at: string | null
          nonce_sha: string
          payload: string
        }
        Insert: {
          made_at?: string | null
          nonce_sha: string
          payload: string
        }
        Update: {
          made_at?: string | null
          nonce_sha?: string
          payload?: string
        }
        Relationships: []
      }
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
          busy_until: string | null
          created_at: string
          id: string
          paid_ok: boolean
          paid_ok_until: string | null
          title: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          busy_until?: string | null
          created_at?: string
          id?: string
          paid_ok?: boolean
          paid_ok_until?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          busy_until?: string | null
          created_at?: string
          id?: string
          paid_ok?: boolean
          paid_ok_until?: string | null
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
      admin_freshness_runs: {
        Row: {
          at: string
          id: number
          stats: Json
        }
        Insert: {
          at?: string
          id?: number
          stats?: Json
        }
        Update: {
          at?: string
          id?: number
          stats?: Json
        }
        Relationships: []
      }
      admin_nav_prefs: {
        Row: {
          section_order: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          section_order?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          section_order?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_needs_checks: {
        Row: {
          attempts: number
          closed: boolean
          confidence: number | null
          created_at: string
          error: string | null
          evidence: Json | null
          finished_at: string | null
          id: string
          key: string
          model: string | null
          not_before: string | null
          rule: string | null
          run_id: string
          started_at: string | null
          status: string
          summary: string | null
          title: string | null
          undone_at: string | null
          verdict: string | null
        }
        Insert: {
          attempts?: number
          closed?: boolean
          confidence?: number | null
          created_at?: string
          error?: string | null
          evidence?: Json | null
          finished_at?: string | null
          id?: string
          key: string
          model?: string | null
          not_before?: string | null
          rule?: string | null
          run_id: string
          started_at?: string | null
          status?: string
          summary?: string | null
          title?: string | null
          undone_at?: string | null
          verdict?: string | null
        }
        Update: {
          attempts?: number
          closed?: boolean
          confidence?: number | null
          created_at?: string
          error?: string | null
          evidence?: Json | null
          finished_at?: string | null
          id?: string
          key?: string
          model?: string | null
          not_before?: string | null
          rule?: string | null
          run_id?: string
          started_at?: string | null
          status?: string
          summary?: string | null
          title?: string | null
          undone_at?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      admin_notifications: {
        Row: {
          agent_slug: string | null
          body: string | null
          created_at: string
          dedupe_key: string | null
          entity_key: string | null
          id: string
          kind: string
          read_at: string | null
          severity: string
          silent: boolean
          title: string
          url: string | null
        }
        Insert: {
          agent_slug?: string | null
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          entity_key?: string | null
          id?: string
          kind: string
          read_at?: string | null
          severity?: string
          silent?: boolean
          title: string
          url?: string | null
        }
        Update: {
          agent_slug?: string | null
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          entity_key?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          severity?: string
          silent?: boolean
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      admin_notify_prefs: {
        Row: {
          dnd_until: string | null
          id: number
          quiet_end: string
          quiet_on: boolean
          quiet_start: string
          sound_on: boolean
          updated_at: string
          urgent_through: boolean
        }
        Insert: {
          dnd_until?: string | null
          id?: number
          quiet_end?: string
          quiet_on?: boolean
          quiet_start?: string
          sound_on?: boolean
          updated_at?: string
          urgent_through?: boolean
        }
        Update: {
          dnd_until?: string | null
          id?: number
          quiet_end?: string
          quiet_on?: boolean
          quiet_start?: string
          sound_on?: boolean
          updated_at?: string
          urgent_through?: boolean
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
      admin_today_dismissed: {
        Row: {
          dismissed_at: string
          fingerprint: string
          key: string
        }
        Insert: {
          dismissed_at?: string
          fingerprint: string
          key: string
        }
        Update: {
          dismissed_at?: string
          fingerprint?: string
          key?: string
        }
        Relationships: []
      }
      agent_beat_log: {
        Row: {
          at: string
          id: number
          ok: boolean | null
          slug: string
          summary: string | null
        }
        Insert: {
          at?: string
          id?: never
          ok?: boolean | null
          slug: string
          summary?: string | null
        }
        Update: {
          at?: string
          id?: never
          ok?: boolean | null
          slug?: string
          summary?: string | null
        }
        Relationships: []
      }
      agent_beats: {
        Row: {
          at: string
          ok: boolean
          slug: string
          summary: string | null
        }
        Insert: {
          at?: string
          ok?: boolean
          slug: string
          summary?: string | null
        }
        Update: {
          at?: string
          ok?: boolean
          slug?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_beats_slug_fkey"
            columns: ["slug"]
            isOneToOne: true
            referencedRelation: "bestly_agents"
            referencedColumns: ["slug"]
          },
        ]
      }
      agent_welcomes: {
        Row: {
          created_at: string
          error: string | null
          last_try_at: string | null
          sent_at: string | null
          slug: string
          tries: number
        }
        Insert: {
          created_at?: string
          error?: string | null
          last_try_at?: string | null
          sent_at?: string | null
          slug: string
          tries?: number
        }
        Update: {
          created_at?: string
          error?: string | null
          last_try_at?: string | null
          sent_at?: string | null
          slug?: string
          tries?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_welcomes_slug_fkey"
            columns: ["slug"]
            isOneToOne: true
            referencedRelation: "bestly_agents"
            referencedColumns: ["slug"]
          },
        ]
      }
      ai_caps: {
        Row: {
          fn: string
          note: string | null
          per_day: number
          per_who_hour: number
          updated_at: string
        }
        Insert: {
          fn: string
          note?: string | null
          per_day: number
          per_who_hour: number
          updated_at?: string
        }
        Update: {
          fn?: string
          note?: string | null
          per_day?: number
          per_who_hour?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_gate_hits: {
        Row: {
          at: string
          fn: string
          id: number
          who: string
        }
        Insert: {
          at?: string
          fn: string
          id?: never
          who: string
        }
        Update: {
          at?: string
          fn?: string
          id?: never
          who?: string
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
      ai_spend: {
        Row: {
          at: string
          cost_usd: number
          fn: string
          free_units: number | null
          id: number
          input_tokens: number
          job: string | null
          model: string
          ms: number | null
          ok: boolean
          outcome: string | null
          output_tokens: number
          provider: string | null
          ref: string | null
          scope: string
        }
        Insert: {
          at?: string
          cost_usd?: number
          fn: string
          free_units?: number | null
          id?: never
          input_tokens?: number
          job?: string | null
          model: string
          ms?: number | null
          ok?: boolean
          outcome?: string | null
          output_tokens?: number
          provider?: string | null
          ref?: string | null
          scope: string
        }
        Update: {
          at?: string
          cost_usd?: number
          fn?: string
          free_units?: number | null
          id?: never
          input_tokens?: number
          job?: string | null
          model?: string
          ms?: number | null
          ok?: boolean
          outcome?: string | null
          output_tokens?: number
          provider?: string | null
          ref?: string | null
          scope?: string
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
          code_next: number
          code_prefix: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string
          guide_only: boolean
          id: string
          intake_emails: string[]
          kind: string
          name: string
          notify_email: boolean
          people: string[]
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
          code_next?: number
          code_prefix?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          guide_only?: boolean
          id?: string
          intake_emails?: string[]
          kind?: string
          name: string
          notify_email?: boolean
          people?: string[]
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
          code_next?: number
          code_prefix?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          guide_only?: boolean
          id?: string
          intake_emails?: string[]
          kind?: string
          name?: string
          notify_email?: boolean
          people?: string[]
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
      approval_item_versions: {
        Row: {
          at: string
          by_staff: string | null
          caption: string | null
          content_version: number
          id: number
          item_id: string
          kind: string
          label: string | null
          media_type: string | null
          media_url: string | null
          note: string | null
          sent_at: string | null
          slides: Json | null
          title: string | null
          variants: Json | null
        }
        Insert: {
          at?: string
          by_staff?: string | null
          caption?: string | null
          content_version: number
          id?: number
          item_id: string
          kind?: string
          label?: string | null
          media_type?: string | null
          media_url?: string | null
          note?: string | null
          sent_at?: string | null
          slides?: Json | null
          title?: string | null
          variants?: Json | null
        }
        Update: {
          at?: string
          by_staff?: string | null
          caption?: string | null
          content_version?: number
          id?: number
          item_id?: string
          kind?: string
          label?: string | null
          media_type?: string | null
          media_url?: string | null
          note?: string | null
          sent_at?: string | null
          slides?: Json | null
          title?: string | null
          variants?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_item_versions_by_staff_fkey"
            columns: ["by_staff"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_item_versions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_items: {
        Row: {
          audience: string | null
          audience_auto: boolean
          caption: string | null
          client_id: string
          code: string | null
          content_version: number
          created_actor: Json | null
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
          platforms: string[] | null
          position: number
          posted_at: string | null
          posted_note: string | null
          posting_ready_at: string | null
          provenance: Json | null
          regen_last_run_at: string | null
          regen_requested_at: string | null
          scheduled_at: string | null
          scheduled_for: string | null
          stage: string
          status: string
          thumb_url: string | null
          time_locked: boolean
          title: string
          work_by: string | null
          work_eta_at: string | null
          work_kind: string | null
          work_note: string | null
          work_started_at: string | null
        }
        Insert: {
          audience?: string | null
          audience_auto?: boolean
          caption?: string | null
          client_id: string
          code?: string | null
          content_version?: number
          created_actor?: Json | null
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
          platforms?: string[] | null
          position?: number
          posted_at?: string | null
          posted_note?: string | null
          posting_ready_at?: string | null
          provenance?: Json | null
          regen_last_run_at?: string | null
          regen_requested_at?: string | null
          scheduled_at?: string | null
          scheduled_for?: string | null
          stage?: string
          status?: string
          thumb_url?: string | null
          time_locked?: boolean
          title: string
          work_by?: string | null
          work_eta_at?: string | null
          work_kind?: string | null
          work_note?: string | null
          work_started_at?: string | null
        }
        Update: {
          audience?: string | null
          audience_auto?: boolean
          caption?: string | null
          client_id?: string
          code?: string | null
          content_version?: number
          created_actor?: Json | null
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
          platforms?: string[] | null
          position?: number
          posted_at?: string | null
          posted_note?: string | null
          posting_ready_at?: string | null
          provenance?: Json | null
          regen_last_run_at?: string | null
          regen_requested_at?: string | null
          scheduled_at?: string | null
          scheduled_for?: string | null
          stage?: string
          status?: string
          thumb_url?: string | null
          time_locked?: boolean
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
          call_at: string | null
          call_by: string | null
          call_note: string | null
          call_status: string | null
          content_version: number | null
          created_at: string
          decision: string | null
          id: string
          item_id: string
          note: string | null
          parent_id: string | null
          person: string | null
          reply_draft: Json | null
          reviewer_kind: string
          rule_blocked: boolean | null
          rule_checked_at: string | null
          rule_hits: Json | null
          rule_override: Json | null
          slide: number | null
          staff_id: string | null
          to_client: boolean
          triage: string | null
          triage_at: string | null
          triage_by: string | null
        }
        Insert: {
          call_at?: string | null
          call_by?: string | null
          call_note?: string | null
          call_status?: string | null
          content_version?: number | null
          created_at?: string
          decision?: string | null
          id?: string
          item_id: string
          note?: string | null
          parent_id?: string | null
          person?: string | null
          reply_draft?: Json | null
          reviewer_kind?: string
          rule_blocked?: boolean | null
          rule_checked_at?: string | null
          rule_hits?: Json | null
          rule_override?: Json | null
          slide?: number | null
          staff_id?: string | null
          to_client?: boolean
          triage?: string | null
          triage_at?: string | null
          triage_by?: string | null
        }
        Update: {
          call_at?: string | null
          call_by?: string | null
          call_note?: string | null
          call_status?: string | null
          content_version?: number | null
          created_at?: string
          decision?: string | null
          id?: string
          item_id?: string
          note?: string | null
          parent_id?: string | null
          person?: string | null
          reply_draft?: Json | null
          reviewer_kind?: string
          rule_blocked?: boolean | null
          rule_checked_at?: string | null
          rule_hits?: Json | null
          rule_override?: Json | null
          slide?: number | null
          staff_id?: string | null
          to_client?: boolean
          triage?: string | null
          triage_at?: string | null
          triage_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_reviews_call_by_fkey"
            columns: ["call_by"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
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
      ava_actions: {
        Row: {
          call_id: string
          created_at: string
          id: string
          kind: string
          label: string
          payload: Json
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          call_id: string
          created_at?: string
          id?: string
          kind: string
          label: string
          payload?: Json
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          call_id?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string
          payload?: Json
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ava_brief_cache: {
        Row: {
          day: string
          error: string | null
          events: Json
          fetched_at: string
          ok: boolean
        }
        Insert: {
          day: string
          error?: string | null
          events?: Json
          fetched_at?: string
          ok?: boolean
        }
        Update: {
          day?: string
          error?: string | null
          events?: Json
          fetched_at?: string
          ok?: boolean
        }
        Relationships: []
      }
      ava_brief_log: {
        Row: {
          at: string
          body: string | null
          day: string
          note: string | null
          status: string
        }
        Insert: {
          at?: string
          body?: string | null
          day: string
          note?: string | null
          status: string
        }
        Update: {
          at?: string
          body?: string | null
          day?: string
          note?: string | null
          status?: string
        }
        Relationships: []
      }
      ava_call_quality: {
        Row: {
          agent_turns: number
          avg_gap: number | null
          call_id: string
          call_no: number | null
          complaint: string | null
          created_at: string
          cut_off_n: number
          flags: string[]
          llm: string | null
          max_gap: number | null
          score: number
          slow_n: number
          source: string
          voice_id: string | null
        }
        Insert: {
          agent_turns?: number
          avg_gap?: number | null
          call_id: string
          call_no?: number | null
          complaint?: string | null
          created_at?: string
          cut_off_n?: number
          flags?: string[]
          llm?: string | null
          max_gap?: number | null
          score?: number
          slow_n?: number
          source: string
          voice_id?: string | null
        }
        Update: {
          agent_turns?: number
          avg_gap?: number | null
          call_id?: string
          call_no?: number | null
          complaint?: string | null
          created_at?: string
          cut_off_n?: number
          flags?: string[]
          llm?: string | null
          max_gap?: number | null
          score?: number
          slow_n?: number
          source?: string
          voice_id?: string | null
        }
        Relationships: []
      }
      ava_call_reviews: {
        Row: {
          call_id: string
          call_no: number | null
          created_at: string
          error: string | null
          model: string | null
          overall: number | null
          provider: string | null
          rule_flags: string[]
          scores: Json | null
          status: string
          tries: number
          updated_at: string
          went_well: string | null
          work_on: string | null
        }
        Insert: {
          call_id: string
          call_no?: number | null
          created_at?: string
          error?: string | null
          model?: string | null
          overall?: number | null
          provider?: string | null
          rule_flags?: string[]
          scores?: Json | null
          status?: string
          tries?: number
          updated_at?: string
          went_well?: string | null
          work_on?: string | null
        }
        Update: {
          call_id?: string
          call_no?: number | null
          created_at?: string
          error?: string | null
          model?: string | null
          overall?: number | null
          provider?: string | null
          rule_flags?: string[]
          scores?: Json | null
          status?: string
          tries?: number
          updated_at?: string
          went_well?: string | null
          work_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ava_call_reviews_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: true
            referencedRelation: "ava_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      ava_calls: {
        Row: {
          appointment_purpose: string | null
          appt_constraints: string | null
          appt_duration_min: number | null
          archived_at: string | null
          booked_slot: string | null
          booking: Json | null
          bridge: boolean
          bridge_org: string | null
          call_no: number | null
          callback_number: string | null
          callback_wanted: boolean
          caller_name: string | null
          connect_to_jared: boolean
          contact_id: string | null
          conversation_id: string | null
          counterpart_business: string | null
          counterpart_phone: string | null
          created_at: string
          deleted_at: string | null
          direction: string
          duration_sec: number | null
          ended_at: string | null
          evidence_at: string | null
          evidence_error: string | null
          evidence_path: string | null
          evidence_tries: number
          forwarded: boolean
          forwarded_from: string | null
          id: string
          intent: string | null
          is_spam: boolean
          llm_cost: number | null
          message: string | null
          next_actions: string | null
          phone: string | null
          preferred_times: string | null
          purpose: string | null
          read_at: string | null
          robocall: boolean
          spam_callback_number: string | null
          spam_caller_name: string | null
          spam_company: string | null
          spam_company_id: string | null
          spam_offer: string | null
          spam_website: string | null
          status: string
          summary: string | null
          transcript: Json | null
          urgent: boolean
          voice: string
        }
        Insert: {
          appointment_purpose?: string | null
          appt_constraints?: string | null
          appt_duration_min?: number | null
          archived_at?: string | null
          booked_slot?: string | null
          booking?: Json | null
          bridge?: boolean
          bridge_org?: string | null
          call_no?: number | null
          callback_number?: string | null
          callback_wanted?: boolean
          caller_name?: string | null
          connect_to_jared?: boolean
          contact_id?: string | null
          conversation_id?: string | null
          counterpart_business?: string | null
          counterpart_phone?: string | null
          created_at?: string
          deleted_at?: string | null
          direction: string
          duration_sec?: number | null
          ended_at?: string | null
          evidence_at?: string | null
          evidence_error?: string | null
          evidence_path?: string | null
          evidence_tries?: number
          forwarded?: boolean
          forwarded_from?: string | null
          id?: string
          intent?: string | null
          is_spam?: boolean
          llm_cost?: number | null
          message?: string | null
          next_actions?: string | null
          phone?: string | null
          preferred_times?: string | null
          purpose?: string | null
          read_at?: string | null
          robocall?: boolean
          spam_callback_number?: string | null
          spam_caller_name?: string | null
          spam_company?: string | null
          spam_company_id?: string | null
          spam_offer?: string | null
          spam_website?: string | null
          status?: string
          summary?: string | null
          transcript?: Json | null
          urgent?: boolean
          voice?: string
        }
        Update: {
          appointment_purpose?: string | null
          appt_constraints?: string | null
          appt_duration_min?: number | null
          archived_at?: string | null
          booked_slot?: string | null
          booking?: Json | null
          bridge?: boolean
          bridge_org?: string | null
          call_no?: number | null
          callback_number?: string | null
          callback_wanted?: boolean
          caller_name?: string | null
          connect_to_jared?: boolean
          contact_id?: string | null
          conversation_id?: string | null
          counterpart_business?: string | null
          counterpart_phone?: string | null
          created_at?: string
          deleted_at?: string | null
          direction?: string
          duration_sec?: number | null
          ended_at?: string | null
          evidence_at?: string | null
          evidence_error?: string | null
          evidence_path?: string | null
          evidence_tries?: number
          forwarded?: boolean
          forwarded_from?: string | null
          id?: string
          intent?: string | null
          is_spam?: boolean
          llm_cost?: number | null
          message?: string | null
          next_actions?: string | null
          phone?: string | null
          preferred_times?: string | null
          purpose?: string | null
          read_at?: string | null
          robocall?: boolean
          spam_callback_number?: string | null
          spam_caller_name?: string | null
          spam_company?: string | null
          spam_company_id?: string | null
          spam_offer?: string | null
          spam_website?: string | null
          status?: string
          summary?: string | null
          transcript?: Json | null
          urgent?: boolean
          voice?: string
        }
        Relationships: [
          {
            foreignKeyName: "ava_calls_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "ava_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ava_calls_spam_company_id_fkey"
            columns: ["spam_company_id"]
            isOneToOne: false
            referencedRelation: "ava_spam_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ava_contacts: {
        Row: {
          apple_uid: string | null
          created_at: string
          id: string
          inner_circle: boolean
          name: string
          notes: string | null
          phone: string | null
          relationship: string | null
          source: string
          synced_at: string | null
        }
        Insert: {
          apple_uid?: string | null
          created_at?: string
          id?: string
          inner_circle?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          relationship?: string | null
          source?: string
          synced_at?: string | null
        }
        Update: {
          apple_uid?: string | null
          created_at?: string
          id?: string
          inner_circle?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          relationship?: string | null
          source?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      ava_followups: {
        Row: {
          call_id: string | null
          callback_phone: string | null
          created_at: string
          dialed_at: string | null
          due_at: string | null
          id: string
          name: string | null
          note: string | null
          phone: string
          reason: string | null
          reminded_at: string | null
          result_call_id: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          call_id?: string | null
          callback_phone?: string | null
          created_at?: string
          dialed_at?: string | null
          due_at?: string | null
          id?: string
          name?: string | null
          note?: string | null
          phone: string
          reason?: string | null
          reminded_at?: string | null
          result_call_id?: string | null
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          call_id?: string | null
          callback_phone?: string | null
          created_at?: string
          dialed_at?: string | null
          due_at?: string | null
          id?: string
          name?: string | null
          note?: string | null
          phone?: string
          reason?: string | null
          reminded_at?: string | null
          result_call_id?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ava_init_debug: {
        Row: {
          at: string
          fields: Json
          forwarded: boolean
          forwarded_from: string | null
          id: number
          keys: Json
          kind: string
          note: string | null
        }
        Insert: {
          at?: string
          fields?: Json
          forwarded?: boolean
          forwarded_from?: string | null
          id?: never
          keys?: Json
          kind: string
          note?: string | null
        }
        Update: {
          at?: string
          fields?: Json
          forwarded?: boolean
          forwarded_from?: string | null
          id?: never
          keys?: Json
          kind?: string
          note?: string | null
        }
        Relationships: []
      }
      ava_knowledge: {
        Row: {
          active: boolean
          fact: string
          id: string
          proposed_at: string | null
          proposed_by: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scope: string
          status: string
          topic: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          fact: string
          id?: string
          proposed_at?: string | null
          proposed_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope: string
          status?: string
          topic: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          fact?: string
          id?: string
          proposed_at?: string | null
          proposed_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope?: string
          status?: string
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      ava_line_health: {
        Row: {
          checked_at: string
          healed: boolean
          last_ok_at: string | null
          ok: boolean
          problems: Json
          source: string
        }
        Insert: {
          checked_at?: string
          healed?: boolean
          last_ok_at?: string | null
          ok: boolean
          problems?: Json
          source: string
        }
        Update: {
          checked_at?: string
          healed?: boolean
          last_ok_at?: string | null
          ok?: boolean
          problems?: Json
          source?: string
        }
        Relationships: []
      }
      ava_playbook: {
        Row: {
          created_at: string
          decided_at: string | null
          id: string
          kind: string
          origin: string
          result: Json | null
          rule: string
          size: string
          started_at: string | null
          status: string
          updated_at: string
          why: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          id?: string
          kind?: string
          origin?: string
          result?: Json | null
          rule: string
          size?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          why?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          id?: string
          kind?: string
          origin?: string
          result?: Json | null
          rule?: string
          size?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          why?: string | null
        }
        Relationships: []
      }
      ava_reply_incidents: {
        Row: {
          action_at: string | null
          action_state: string
          call_id: string
          call_no: number | null
          created_at: string
          excerpt: string | null
          healed: string | null
          id: string
          kind: string
          leak: boolean
          llm: string | null
          playbook_id: string | null
          reviewed_at: string | null
          scout_task_ref: string | null
          source: string
          subkind: string | null
        }
        Insert: {
          action_at?: string | null
          action_state?: string
          call_id: string
          call_no?: number | null
          created_at?: string
          excerpt?: string | null
          healed?: string | null
          id?: string
          kind: string
          leak?: boolean
          llm?: string | null
          playbook_id?: string | null
          reviewed_at?: string | null
          scout_task_ref?: string | null
          source: string
          subkind?: string | null
        }
        Update: {
          action_at?: string | null
          action_state?: string
          call_id?: string
          call_no?: number | null
          created_at?: string
          excerpt?: string | null
          healed?: string | null
          id?: string
          kind?: string
          leak?: boolean
          llm?: string | null
          playbook_id?: string | null
          reviewed_at?: string | null
          scout_task_ref?: string | null
          source?: string
          subkind?: string | null
        }
        Relationships: []
      }
      ava_settings: {
        Row: {
          agent_id: string | null
          brief_enabled: boolean
          brief_fetch_at: string | null
          brief_minute: number
          calendars: Json
          coach_needs_approval: boolean
          contacts_count: number | null
          contacts_note: string | null
          contacts_synced_at: string | null
          cost_phone_per_min: number
          cost_voice_per_min: number
          daily_spend_cap: number
          forward_enabled: boolean
          forward_enabled_at: string | null
          forward_voice: string
          from_number: string
          id: boolean
          jared_cell: string
          jared_ivc_voice_id: string | null
          jared_pvc_voice_id: string | null
          jared_voice_for_contacts: boolean
          jared_voice_id: string | null
          jared_voice_paused_at: string | null
          jared_voice_paused_why: string | null
          llm: string
          llm_fallbacks: string[]
          phone_number_id: string | null
          pvc_checked_at: string | null
          pvc_guard_at: string | null
          pvc_last_train_at: string | null
          pvc_live_at: string | null
          pvc_note: string | null
          pvc_state: string
          pvc_trained_seconds: number
          setup_log: Json
          telnyx_in_connection_id: string | null
          telnyx_out_connection_id: string | null
          telnyx_ovp_id: string | null
          updated_at: string
          voice_id: string
          webhook_id: string | null
        }
        Insert: {
          agent_id?: string | null
          brief_enabled?: boolean
          brief_fetch_at?: string | null
          brief_minute?: number
          calendars?: Json
          coach_needs_approval?: boolean
          contacts_count?: number | null
          contacts_note?: string | null
          contacts_synced_at?: string | null
          cost_phone_per_min?: number
          cost_voice_per_min?: number
          daily_spend_cap?: number
          forward_enabled?: boolean
          forward_enabled_at?: string | null
          forward_voice?: string
          from_number?: string
          id?: boolean
          jared_cell?: string
          jared_ivc_voice_id?: string | null
          jared_pvc_voice_id?: string | null
          jared_voice_for_contacts?: boolean
          jared_voice_id?: string | null
          jared_voice_paused_at?: string | null
          jared_voice_paused_why?: string | null
          llm?: string
          llm_fallbacks?: string[]
          phone_number_id?: string | null
          pvc_checked_at?: string | null
          pvc_guard_at?: string | null
          pvc_last_train_at?: string | null
          pvc_live_at?: string | null
          pvc_note?: string | null
          pvc_state?: string
          pvc_trained_seconds?: number
          setup_log?: Json
          telnyx_in_connection_id?: string | null
          telnyx_out_connection_id?: string | null
          telnyx_ovp_id?: string | null
          updated_at?: string
          voice_id?: string
          webhook_id?: string | null
        }
        Update: {
          agent_id?: string | null
          brief_enabled?: boolean
          brief_fetch_at?: string | null
          brief_minute?: number
          calendars?: Json
          coach_needs_approval?: boolean
          contacts_count?: number | null
          contacts_note?: string | null
          contacts_synced_at?: string | null
          cost_phone_per_min?: number
          cost_voice_per_min?: number
          daily_spend_cap?: number
          forward_enabled?: boolean
          forward_enabled_at?: string | null
          forward_voice?: string
          from_number?: string
          id?: boolean
          jared_cell?: string
          jared_ivc_voice_id?: string | null
          jared_pvc_voice_id?: string | null
          jared_voice_for_contacts?: boolean
          jared_voice_id?: string | null
          jared_voice_paused_at?: string | null
          jared_voice_paused_why?: string | null
          llm?: string
          llm_fallbacks?: string[]
          phone_number_id?: string | null
          pvc_checked_at?: string | null
          pvc_guard_at?: string | null
          pvc_last_train_at?: string | null
          pvc_live_at?: string | null
          pvc_note?: string | null
          pvc_state?: string
          pvc_trained_seconds?: number
          setup_log?: Json
          telnyx_in_connection_id?: string | null
          telnyx_out_connection_id?: string | null
          telnyx_ovp_id?: string | null
          updated_at?: string
          voice_id?: string
          webhook_id?: string | null
        }
        Relationships: []
      }
      ava_spam_companies: {
        Row: {
          callback_numbers: string[]
          caller_ids: string[]
          calls_12mo: number
          created_at: string
          first_seen: string
          id: string
          key: string
          last_seen: string
          name: string | null
          notes: string | null
          status: string
          updated_at: string
          website: string | null
        }
        Insert: {
          callback_numbers?: string[]
          caller_ids?: string[]
          calls_12mo?: number
          created_at?: string
          first_seen?: string
          id?: string
          key: string
          last_seen?: string
          name?: string | null
          notes?: string | null
          status?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          callback_numbers?: string[]
          caller_ids?: string[]
          calls_12mo?: number
          created_at?: string
          first_seen?: string
          id?: string
          key?: string
          last_seen?: string
          name?: string | null
          notes?: string | null
          status?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      ava_turn_votes: {
        Row: {
          call_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          note: string | null
          said: string
          seen_by_coach: boolean
          source: string
          turn_index: number
          turn_t: number | null
          updated_at: string
          vote: string
        }
        Insert: {
          call_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          said: string
          seen_by_coach?: boolean
          source: string
          turn_index: number
          turn_t?: number | null
          updated_at?: string
          vote: string
        }
        Update: {
          call_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          said?: string
          seen_by_coach?: boolean
          source?: string
          turn_index?: number
          turn_t?: number | null
          updated_at?: string
          vote?: string
        }
        Relationships: []
      }
      ava_voice_bank: {
        Row: {
          added_at: string
          id: string
          meeting: string
          part: number
          score: number | null
          seconds: number
          xi_sample_id: string | null
        }
        Insert: {
          added_at?: string
          id?: string
          meeting: string
          part?: number
          score?: number | null
          seconds: number
          xi_sample_id?: string | null
        }
        Update: {
          added_at?: string
          id?: string
          meeting?: string
          part?: number
          score?: number | null
          seconds?: number
          xi_sample_id?: string | null
        }
        Relationships: []
      }
      ava_voice_bank_skips: {
        Row: {
          at: string
          meeting: string
          why: string | null
        }
        Insert: {
          at?: string
          meeting: string
          why?: string | null
        }
        Update: {
          at?: string
          meeting?: string
          why?: string | null
        }
        Relationships: []
      }
      ava_voice_favorites: {
        Row: {
          accent: string | null
          created_at: string
          description: string | null
          gender: string | null
          name: string
          preview_url: string | null
          public_owner_id: string | null
          sort: number
          voice_id: string
        }
        Insert: {
          accent?: string | null
          created_at?: string
          description?: string | null
          gender?: string | null
          name: string
          preview_url?: string | null
          public_owner_id?: string | null
          sort?: number
          voice_id: string
        }
        Update: {
          accent?: string | null
          created_at?: string
          description?: string | null
          gender?: string | null
          name?: string
          preview_url?: string | null
          public_owner_id?: string | null
          sort?: number
          voice_id?: string
        }
        Relationships: []
      }
      ava_voice_history: {
        Row: {
          id: number
          name: string
          source: string
          used_at: string
          voice_id: string
        }
        Insert: {
          id?: never
          name: string
          source: string
          used_at?: string
          voice_id: string
        }
        Update: {
          id?: never
          name?: string
          source?: string
          used_at?: string
          voice_id?: string
        }
        Relationships: []
      }
      ava_voice_usage: {
        Row: {
          day: string
          says: number
          source: string
        }
        Insert: {
          day: string
          says?: number
          source: string
        }
        Update: {
          day?: string
          says?: number
          source?: string
        }
        Relationships: []
      }
      bestly_agents: {
        Row: {
          admin_url: string | null
          created_at: string
          dept: string
          icon: string | null
          kind: string
          liaison_to: string | null
          name: string
          private: boolean
          profile: Json | null
          pulse: Json | null
          relation: string | null
          reports_to: string | null
          role: string
          runs_on: string | null
          schedule: string | null
          slug: string
          sort: number
          status: string
          updated_at: string
          what_it_does: string
        }
        Insert: {
          admin_url?: string | null
          created_at?: string
          dept?: string
          icon?: string | null
          kind?: string
          liaison_to?: string | null
          name: string
          private?: boolean
          profile?: Json | null
          pulse?: Json | null
          relation?: string | null
          reports_to?: string | null
          role: string
          runs_on?: string | null
          schedule?: string | null
          slug: string
          sort?: number
          status?: string
          updated_at?: string
          what_it_does: string
        }
        Update: {
          admin_url?: string | null
          created_at?: string
          dept?: string
          icon?: string | null
          kind?: string
          liaison_to?: string | null
          name?: string
          private?: boolean
          profile?: Json | null
          pulse?: Json | null
          relation?: string | null
          reports_to?: string | null
          role?: string
          runs_on?: string | null
          schedule?: string | null
          slug?: string
          sort?: number
          status?: string
          updated_at?: string
          what_it_does?: string
        }
        Relationships: [
          {
            foreignKeyName: "bestly_agents_liaison_to_fkey"
            columns: ["liaison_to"]
            isOneToOne: false
            referencedRelation: "bestly_agents"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "bestly_agents_reports_to_fkey"
            columns: ["reports_to"]
            isOneToOne: false
            referencedRelation: "bestly_agents"
            referencedColumns: ["slug"]
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
      bestly_sent_mail: {
        Row: {
          body_text: string | null
          created_at: string
          id: string
          mailbox: string
          message_id: string
          sent_at: string | null
          subject: string | null
          to_addrs: string | null
        }
        Insert: {
          body_text?: string | null
          created_at?: string
          id?: string
          mailbox: string
          message_id: string
          sent_at?: string | null
          subject?: string | null
          to_addrs?: string | null
        }
        Update: {
          body_text?: string | null
          created_at?: string
          id?: string
          mailbox?: string
          message_id?: string
          sent_at?: string | null
          subject?: string | null
          to_addrs?: string | null
        }
        Relationships: []
      }
      bestly_sent_state: {
        Row: {
          last_error: string | null
          last_run: string | null
          last_uid: number
          mailbox: string
          uid_validity: number | null
        }
        Insert: {
          last_error?: string | null
          last_run?: string | null
          last_uid?: number
          mailbox: string
          uid_validity?: number | null
        }
        Update: {
          last_error?: string | null
          last_run?: string | null
          last_uid?: number
          mailbox?: string
          uid_validity?: number | null
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
      bestly_social_history: {
        Row: {
          asset: string
          at: string
          caption: string | null
          comments: number | null
          details: Json | null
          error: string | null
          fb_ok: boolean | null
          fb_post_id: string | null
          headline: string | null
          id: number
          ig_media_id: string | null
          ig_ok: boolean | null
          ig_permalink: string | null
          kind: string
          layout: string | null
          likes: number | null
          made_by: string | null
          metrics_at: string | null
          source: string
          theme: string | null
        }
        Insert: {
          asset: string
          at?: string
          caption?: string | null
          comments?: number | null
          details?: Json | null
          error?: string | null
          fb_ok?: boolean | null
          fb_post_id?: string | null
          headline?: string | null
          id?: never
          ig_media_id?: string | null
          ig_ok?: boolean | null
          ig_permalink?: string | null
          kind: string
          layout?: string | null
          likes?: number | null
          made_by?: string | null
          metrics_at?: string | null
          source?: string
          theme?: string | null
        }
        Update: {
          asset?: string
          at?: string
          caption?: string | null
          comments?: number | null
          details?: Json | null
          error?: string | null
          fb_ok?: boolean | null
          fb_post_id?: string | null
          headline?: string | null
          id?: never
          ig_media_id?: string | null
          ig_ok?: boolean | null
          ig_permalink?: string | null
          kind?: string
          layout?: string | null
          likes?: number | null
          made_by?: string | null
          metrics_at?: string | null
          source?: string
          theme?: string | null
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
          zone: string | null
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
          zone?: string | null
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
          zone?: string | null
        }
        Relationships: []
      }
      bluesteel_sweep_zones: {
        Row: {
          active: boolean
          between_streets: string
          calibration: Json
          east_dow: number | null
          end_min: number
          fine_usd: number
          id: string
          lat_max: number
          lat_min: number
          lon_max: number
          lon_min: number
          name: string
          sort: number
          split_lon: number
          start_min: number
          street: string
          updated_at: string
          west_dow: number | null
        }
        Insert: {
          active?: boolean
          between_streets: string
          calibration?: Json
          east_dow?: number | null
          end_min?: number
          fine_usd?: number
          id: string
          lat_max: number
          lat_min: number
          lon_max: number
          lon_min: number
          name: string
          sort?: number
          split_lon: number
          start_min?: number
          street?: string
          updated_at?: string
          west_dow?: number | null
        }
        Update: {
          active?: boolean
          between_streets?: string
          calibration?: Json
          east_dow?: number | null
          end_min?: number
          fine_usd?: number
          id?: string
          lat_max?: number
          lat_min?: number
          lon_max?: number
          lon_min?: number
          name?: string
          sort?: number
          split_lon?: number
          start_min?: number
          street?: string
          updated_at?: string
          west_dow?: number | null
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
      car_drivers_seen: {
        Row: {
          first_seen: string
          gone_at: string | null
          last_seen: string
          name: string | null
          reservation_id: number | null
          share_user_id: string
          source: string
        }
        Insert: {
          first_seen: string
          gone_at?: string | null
          last_seen: string
          name?: string | null
          reservation_id?: number | null
          share_user_id: string
          source?: string
        }
        Update: {
          first_seen?: string
          gone_at?: string | null
          last_seen?: string
          name?: string | null
          reservation_id?: number | null
          share_user_id?: string
          source?: string
        }
        Relationships: []
      }
      car_drives: {
        Row: {
          avg_mph: number | null
          country: string | null
          created_at: string | null
          ended_at: string | null
          from_lat: number | null
          from_lon: number | null
          from_name: string | null
          id: string
          max_mph: number | null
          miles: number | null
          odo_end: number | null
          odo_start: number | null
          raw: Json | null
          reservation_id: number | null
          started_at: string | null
          state: string | null
          to_lat: number | null
          to_lon: number | null
          to_name: string | null
          vin: string | null
        }
        Insert: {
          avg_mph?: number | null
          country?: string | null
          created_at?: string | null
          ended_at?: string | null
          from_lat?: number | null
          from_lon?: number | null
          from_name?: string | null
          id: string
          max_mph?: number | null
          miles?: number | null
          odo_end?: number | null
          odo_start?: number | null
          raw?: Json | null
          reservation_id?: number | null
          started_at?: string | null
          state?: string | null
          to_lat?: number | null
          to_lon?: number | null
          to_name?: string | null
          vin?: string | null
        }
        Update: {
          avg_mph?: number | null
          country?: string | null
          created_at?: string | null
          ended_at?: string | null
          from_lat?: number | null
          from_lon?: number | null
          from_name?: string | null
          id?: string
          max_mph?: number | null
          miles?: number | null
          odo_end?: number | null
          odo_start?: number | null
          raw?: Json | null
          reservation_id?: number | null
          started_at?: string | null
          state?: string | null
          to_lat?: number | null
          to_lon?: number | null
          to_name?: string | null
          vin?: string | null
        }
        Relationships: []
      }
      car_eta: {
        Row: {
          eta_at: string | null
          miles: number | null
          minutes: number | null
          moving: boolean | null
          reservation_id: number
          updated_at: string | null
        }
        Insert: {
          eta_at?: string | null
          miles?: number | null
          minutes?: number | null
          moving?: boolean | null
          reservation_id: number
          updated_at?: string | null
        }
        Update: {
          eta_at?: string | null
          miles?: number | null
          minutes?: number | null
          moving?: boolean | null
          reservation_id?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      car_events: {
        Row: {
          at: string
          data: Json | null
          dedupe: string | null
          detail: string | null
          id: number
          kind: string
          lat: number | null
          lon: number | null
          read_at: string | null
          reservation_id: number | null
          severity: string | null
          title: string | null
        }
        Insert: {
          at?: string
          data?: Json | null
          dedupe?: string | null
          detail?: string | null
          id?: number
          kind: string
          lat?: number | null
          lon?: number | null
          read_at?: string | null
          reservation_id?: number | null
          severity?: string | null
          title?: string | null
        }
        Update: {
          at?: string
          data?: Json | null
          dedupe?: string | null
          detail?: string | null
          id?: number
          kind?: string
          lat?: number | null
          lon?: number | null
          read_at?: string | null
          reservation_id?: number | null
          severity?: string | null
          title?: string | null
        }
        Relationships: []
      }
      car_geofence_settings: {
        Row: {
          actions: string[]
          id: number
          radius_m: number
          updated_at: string | null
        }
        Insert: {
          actions?: string[]
          id?: number
          radius_m?: number
          updated_at?: string | null
        }
        Update: {
          actions?: string[]
          id?: number
          radius_m?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      car_host_drivers: {
        Row: {
          name: string | null
          note: string | null
          share_user_id: string
        }
        Insert: {
          name?: string | null
          note?: string | null
          share_user_id: string
        }
        Update: {
          name?: string | null
          note?: string | null
          share_user_id?: string
        }
        Relationships: []
      }
      car_protect_settings: {
        Row: {
          autofix: boolean | null
          caps: Json | null
          caps_at: string | null
          cmd_map: Json | null
          flags: Json | null
          id: number
          la_center_lat: number | null
          la_center_lon: number | null
          la_radius_mi: number | null
          last_tick_at: string | null
          ready_charge_pct: number | null
          sentry_auto: boolean | null
          sentry_battery_floor: number | null
          speed_mph: number | null
          tire_low_psi: number | null
          tire_spread_psi: number | null
          wipe_auto: boolean | null
          wipe_tested_at: string | null
        }
        Insert: {
          autofix?: boolean | null
          caps?: Json | null
          caps_at?: string | null
          cmd_map?: Json | null
          flags?: Json | null
          id?: number
          la_center_lat?: number | null
          la_center_lon?: number | null
          la_radius_mi?: number | null
          last_tick_at?: string | null
          ready_charge_pct?: number | null
          sentry_auto?: boolean | null
          sentry_battery_floor?: number | null
          speed_mph?: number | null
          tire_low_psi?: number | null
          tire_spread_psi?: number | null
          wipe_auto?: boolean | null
          wipe_tested_at?: string | null
        }
        Update: {
          autofix?: boolean | null
          caps?: Json | null
          caps_at?: string | null
          cmd_map?: Json | null
          flags?: Json | null
          id?: number
          la_center_lat?: number | null
          la_center_lon?: number | null
          la_radius_mi?: number | null
          last_tick_at?: string | null
          ready_charge_pct?: number | null
          sentry_auto?: boolean | null
          sentry_battery_floor?: number | null
          speed_mph?: number | null
          tire_low_psi?: number | null
          tire_spread_psi?: number | null
          wipe_auto?: boolean | null
          wipe_tested_at?: string | null
        }
        Relationships: []
      }
      car_status_raw: {
        Row: {
          at: string | null
          id: number
          raw: Json | null
        }
        Insert: {
          at?: string | null
          id?: number
          raw?: Json | null
        }
        Update: {
          at?: string | null
          id?: number
          raw?: Json | null
        }
        Relationships: []
      }
      car_trail: {
        Row: {
          at: string
          battery: number | null
          id: number
          lat: number | null
          locked: boolean | null
          lon: number | null
          reservation_id: number | null
          shift: string | null
          source: string | null
          speed_mph: number | null
          vin: string | null
        }
        Insert: {
          at: string
          battery?: number | null
          id?: number
          lat?: number | null
          locked?: boolean | null
          lon?: number | null
          reservation_id?: number | null
          shift?: string | null
          source?: string | null
          speed_mph?: number | null
          vin?: string | null
        }
        Update: {
          at?: string
          battery?: number | null
          id?: number
          lat?: number | null
          locked?: boolean | null
          lon?: number | null
          reservation_id?: number | null
          shift?: string | null
          source?: string | null
          speed_mph?: number | null
          vin?: string | null
        }
        Relationships: []
      }
      car_wash_sites: {
        Row: {
          active: boolean
          address: string
          brand: string
          id: number
          lat: number
          lon: number
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address: string
          brand?: string
          id?: number
          lat: number
          lon: number
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string
          brand?: string
          id?: number
          lat?: number
          lon?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      car_watch: {
        Row: {
          battery_health: Json | null
          battery_health_at: string | null
          flags: Json
          health: Json | null
          health_at: string | null
          id: number
          last_tick_at: string | null
          settings: Json
        }
        Insert: {
          battery_health?: Json | null
          battery_health_at?: string | null
          flags?: Json
          health?: Json | null
          health_at?: string | null
          id?: number
          last_tick_at?: string | null
          settings?: Json
        }
        Update: {
          battery_health?: Json | null
          battery_health_at?: string | null
          flags?: Json
          health?: Json | null
          health_at?: string | null
          id?: number
          last_tick_at?: string | null
          settings?: Json
        }
        Relationships: []
      }
      car_watch_log: {
        Row: {
          at: string
          audience: string
          body: string | null
          id: number
          kind: string
          reservation_id: number | null
          title: string | null
        }
        Insert: {
          at?: string
          audience: string
          body?: string | null
          id?: number
          kind: string
          reservation_id?: number | null
          title?: string | null
        }
        Update: {
          at?: string
          audience?: string
          body?: string | null
          id?: number
          kind?: string
          reservation_id?: number | null
          title?: string | null
        }
        Relationships: []
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
      claim_cases: {
        Row: {
          car: string | null
          closed_at: string | null
          escalate_by: string | null
          estimate_amount: number | null
          estimate_due_at: string | null
          facts: string | null
          follow_up_at: string | null
          goal: string | null
          guest_first: string | null
          guest_last: string | null
          guest_max: number | null
          history: boolean
          host_responsibility: number | null
          id: string
          insurer: Json
          invoices: Json
          last_daily_at: string | null
          last_guest_msg_at: string | null
          last_host_msg_at: string | null
          last_run_at: string | null
          needs_work: boolean
          opened_at: string
          opened_from_mail: string | null
          outcome: string | null
          path: string
          recovered_amount: number | null
          reservation_id: number
          status: string
          trip_end: string | null
          turo_claim_no: string | null
          turo_incident_id: number | null
          updated_at: string
          vin: string | null
          work_reason: string | null
        }
        Insert: {
          car?: string | null
          closed_at?: string | null
          escalate_by?: string | null
          estimate_amount?: number | null
          estimate_due_at?: string | null
          facts?: string | null
          follow_up_at?: string | null
          goal?: string | null
          guest_first?: string | null
          guest_last?: string | null
          guest_max?: number | null
          history?: boolean
          host_responsibility?: number | null
          id?: string
          insurer?: Json
          invoices?: Json
          last_daily_at?: string | null
          last_guest_msg_at?: string | null
          last_host_msg_at?: string | null
          last_run_at?: string | null
          needs_work?: boolean
          opened_at?: string
          opened_from_mail?: string | null
          outcome?: string | null
          path?: string
          recovered_amount?: number | null
          reservation_id: number
          status?: string
          trip_end?: string | null
          turo_claim_no?: string | null
          turo_incident_id?: number | null
          updated_at?: string
          vin?: string | null
          work_reason?: string | null
        }
        Update: {
          car?: string | null
          closed_at?: string | null
          escalate_by?: string | null
          estimate_amount?: number | null
          estimate_due_at?: string | null
          facts?: string | null
          follow_up_at?: string | null
          goal?: string | null
          guest_first?: string | null
          guest_last?: string | null
          guest_max?: number | null
          history?: boolean
          host_responsibility?: number | null
          id?: string
          insurer?: Json
          invoices?: Json
          last_daily_at?: string | null
          last_guest_msg_at?: string | null
          last_host_msg_at?: string | null
          last_run_at?: string | null
          needs_work?: boolean
          opened_at?: string
          opened_from_mail?: string | null
          outcome?: string | null
          path?: string
          recovered_amount?: number | null
          reservation_id?: number
          status?: string
          trip_end?: string | null
          turo_claim_no?: string | null
          turo_incident_id?: number | null
          updated_at?: string
          vin?: string | null
          work_reason?: string | null
        }
        Relationships: []
      }
      claim_drafts: {
        Row: {
          approved_at: string | null
          attempts: number
          body: string
          case_id: string
          claimed_at: string | null
          created_at: string
          for_message_id: string | null
          id: string
          kind: string
          last_error: string | null
          notified_at: string | null
          reason: string | null
          reservation_id: number
          sent_at: string | null
          status: string
          updated_at: string
          verified: boolean | null
          verify_snippet: string | null
        }
        Insert: {
          approved_at?: string | null
          attempts?: number
          body: string
          case_id: string
          claimed_at?: string | null
          created_at?: string
          for_message_id?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          notified_at?: string | null
          reason?: string | null
          reservation_id: number
          sent_at?: string | null
          status?: string
          updated_at?: string
          verified?: boolean | null
          verify_snippet?: string | null
        }
        Update: {
          approved_at?: string | null
          attempts?: number
          body?: string
          case_id?: string
          claimed_at?: string | null
          created_at?: string
          for_message_id?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          notified_at?: string | null
          reason?: string | null
          reservation_id?: number
          sent_at?: string | null
          status?: string
          updated_at?: string
          verified?: boolean | null
          verify_snippet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_drafts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "claim_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_events: {
        Row: {
          at: string
          case_id: string | null
          detail: Json | null
          id: number
          kind: string
          mail_id: string | null
          reservation_id: number | null
          title: string | null
        }
        Insert: {
          at?: string
          case_id?: string | null
          detail?: Json | null
          id?: number
          kind: string
          mail_id?: string | null
          reservation_id?: number | null
          title?: string | null
        }
        Update: {
          at?: string
          case_id?: string | null
          detail?: Json | null
          id?: number
          kind?: string
          mail_id?: string | null
          reservation_id?: number | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_events_case_fk"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "claim_cases"
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
      client_activity_flags: {
        Row: {
          action: string
          client_id: string | null
          created_at: string
          id: number
          key: string | null
          kind: string
          reason: string
          ref: Json
        }
        Insert: {
          action?: string
          client_id?: string | null
          created_at?: string
          id?: never
          key?: string | null
          kind: string
          reason: string
          ref?: Json
        }
        Update: {
          action?: string
          client_id?: string | null
          created_at?: string
          id?: never
          key?: string | null
          kind?: string
          reason?: string
          ref?: Json
        }
        Relationships: [
          {
            foreignKeyName: "client_activity_flags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_ask_reviews: {
        Row: {
          ask_id: string
          content_version: number
          created_at: string
          decision: string | null
          id: string
          note: string | null
          parent_id: string | null
          staff_id: string
        }
        Insert: {
          ask_id: string
          content_version?: number
          created_at?: string
          decision?: string | null
          id?: string
          note?: string | null
          parent_id?: string | null
          staff_id: string
        }
        Update: {
          ask_id?: string
          content_version?: number
          created_at?: string
          decision?: string | null
          id?: string
          note?: string | null
          parent_id?: string | null
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_ask_reviews_ask_id_fkey"
            columns: ["ask_id"]
            isOneToOne: false
            referencedRelation: "client_asks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_ask_reviews_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "client_ask_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_ask_reviews_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
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
          content_version: number
          created_actor: Json | null
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
          internal_status: string
          item_id: string | null
          kind: string
          licence: string
          received_at: string | null
          reference: Json | null
          regen_requested_at: string | null
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
          content_version?: number
          created_actor?: Json | null
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
          internal_status?: string
          item_id?: string | null
          kind?: string
          licence?: string
          received_at?: string | null
          reference?: Json | null
          regen_requested_at?: string | null
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
          content_version?: number
          created_actor?: Json | null
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
          internal_status?: string
          item_id?: string | null
          kind?: string
          licence?: string
          received_at?: string | null
          reference?: Json | null
          regen_requested_at?: string | null
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
      client_asks_archive: {
        Row: {
          archived_at: string
          client_id: string
          id: string
          row: Json
          why: string
        }
        Insert: {
          archived_at?: string
          client_id: string
          id: string
          row: Json
          why: string
        }
        Update: {
          archived_at?: string
          client_id?: string
          id?: string
          row?: Json
          why?: string
        }
        Relationships: []
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
          created_actor: Json | null
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
          upload_id: string | null
          used_ask: string | null
          used_at: string | null
          used_item: string | null
        }
        Insert: {
          attachment?: string | null
          body: string
          client_id: string
          created_actor?: Json | null
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
          upload_id?: string | null
          used_ask?: string | null
          used_at?: string | null
          used_item?: string | null
        }
        Update: {
          attachment?: string | null
          body?: string
          client_id?: string
          created_actor?: Json | null
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
          upload_id?: string | null
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
            foreignKeyName: "client_briefs_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "client_uploads"
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
          person: string
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
          person?: string
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
          person?: string
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
      client_people: {
        Row: {
          active: boolean
          client_slug: string
          created_at: string
          email: string | null
          enroll_code_hash: string | null
          enroll_expires_at: string | null
          enroll_max: number
          enroll_uses: number
          id: string
          name: string
          person: string
          role: string
        }
        Insert: {
          active?: boolean
          client_slug: string
          created_at?: string
          email?: string | null
          enroll_code_hash?: string | null
          enroll_expires_at?: string | null
          enroll_max?: number
          enroll_uses?: number
          id?: string
          name: string
          person: string
          role: string
        }
        Update: {
          active?: boolean
          client_slug?: string
          created_at?: string
          email?: string | null
          enroll_code_hash?: string | null
          enroll_expires_at?: string | null
          enroll_max?: number
          enroll_uses?: number
          id?: string
          name?: string
          person?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_people_client_slug_fkey"
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
          person: string
          token_hash: string
          viewer_staff_id: string | null
        }
        Insert: {
          client_slug: string
          created_at?: string
          expires_at?: string
          last_seen_at?: string
          passkey_id?: string | null
          person?: string
          token_hash: string
          viewer_staff_id?: string | null
        }
        Update: {
          client_slug?: string
          created_at?: string
          expires_at?: string
          last_seen_at?: string
          passkey_id?: string | null
          person?: string
          token_hash?: string
          viewer_staff_id?: string | null
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
          {
            foreignKeyName: "client_sessions_viewer_staff_id_fkey"
            columns: ["viewer_staff_id"]
            isOneToOne: false
            referencedRelation: "approval_staff"
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
      client_todos: {
        Row: {
          client_id: string
          created_actor: Json | null
          created_at: string
          created_by: string | null
          detail: string | null
          done_at: string | null
          done_by: string | null
          due: string
          forward: Json | null
          id: string
          position: number
          source: Json | null
          status: string
          title: string
        }
        Insert: {
          client_id: string
          created_actor?: Json | null
          created_at?: string
          created_by?: string | null
          detail?: string | null
          done_at?: string | null
          done_by?: string | null
          due: string
          forward?: Json | null
          id?: string
          position?: number
          source?: Json | null
          status?: string
          title: string
        }
        Update: {
          client_id?: string
          created_actor?: Json | null
          created_at?: string
          created_by?: string | null
          detail?: string | null
          done_at?: string | null
          done_by?: string | null
          due?: string
          forward?: Json | null
          id?: string
          position?: number
          source?: Json | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_todos_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_todos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
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
          person: string | null
          staff_slug: string | null
        }
        Insert: {
          challenge: string
          client_slug?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          person?: string | null
          staff_slug?: string | null
        }
        Update: {
          challenge?: string
          client_slug?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          person?: string | null
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
      cron_reruns: {
        Row: {
          at: string | null
          error: string | null
          failed_run: number | null
          id: number
          jobid: number | null
          jobname: string | null
          ok: boolean | null
        }
        Insert: {
          at?: string | null
          error?: string | null
          failed_run?: number | null
          id?: number
          jobid?: number | null
          jobname?: string | null
          ok?: boolean | null
        }
        Update: {
          at?: string | null
          error?: string | null
          failed_run?: number | null
          id?: number
          jobid?: number | null
          jobname?: string | null
          ok?: boolean | null
        }
        Relationships: []
      }
      cy_corner_move: {
        Row: {
          dl: string | null
          dl_req: number | null
          done_at: string | null
          id: string
          moved_by: number | null
          newpath: string | null
          path: string
          side: string
          ul: string | null
          ul_req: number | null
        }
        Insert: {
          dl?: string | null
          dl_req?: number | null
          done_at?: string | null
          id: string
          moved_by?: number | null
          newpath?: string | null
          path: string
          side: string
          ul?: string | null
          ul_req?: number | null
        }
        Update: {
          dl?: string | null
          dl_req?: number | null
          done_at?: string | null
          id?: string
          moved_by?: number | null
          newpath?: string | null
          path?: string
          side?: string
          ul?: string | null
          ul_req?: number | null
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
      cy_rpc_throttle: {
        Row: {
          bucket: string
          fn: string
          n: number
          voter: string
        }
        Insert: {
          bucket: string
          fn: string
          n?: number
          voter: string
        }
        Update: {
          bucket?: string
          fn?: string
          n?: number
          voter?: string
        }
        Relationships: []
      }
      cy_site_guard: {
        Row: {
          domain: string
          off_until: string
          reason: string | null
          source: string
          strikes: number
          updated_at: string
        }
        Insert: {
          domain: string
          off_until: string
          reason?: string | null
          source?: string
          strikes?: number
          updated_at?: string
        }
        Update: {
          domain?: string
          off_until?: string
          reason?: string | null
          source?: string
          strikes?: number
          updated_at?: string
        }
        Relationships: []
      }
      cy_site_guard_reports: {
        Row: {
          created_at: string
          domain: string
          id: number
          platform: string | null
          reason: string
          version: string | null
        }
        Insert: {
          created_at?: string
          domain: string
          id?: number
          platform?: string | null
          reason: string
          version?: string | null
        }
        Update: {
          created_at?: string
          domain?: string
          id?: number
          platform?: string | null
          reason?: string
          version?: string | null
        }
        Relationships: []
      }
      db_metrics: {
        Row: {
          at: string
          backends: number | null
          load1: number | null
          mem_avail_mb: number | null
          mem_total_mb: number | null
          swap_used_mb: number | null
        }
        Insert: {
          at?: string
          backends?: number | null
          load1?: number | null
          mem_avail_mb?: number | null
          mem_total_mb?: number | null
          swap_used_mb?: number | null
        }
        Update: {
          at?: string
          backends?: number | null
          load1?: number | null
          mem_avail_mb?: number | null
          mem_total_mb?: number | null
          swap_used_mb?: number | null
        }
        Relationships: []
      }
      db_watch_state: {
        Row: {
          id: number
          last_ok_at: string | null
          pending_req: number | null
          pressure_streak: number | null
          shed_at: string | null
          shed_jobs: string[] | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          last_ok_at?: string | null
          pending_req?: number | null
          pressure_streak?: number | null
          shed_at?: string | null
          shed_jobs?: string[] | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          last_ok_at?: string | null
          pending_req?: number | null
          pressure_streak?: number | null
          shed_at?: string | null
          shed_jobs?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      db_watchdog_tokens: {
        Row: {
          created_at: string | null
          label: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string | null
          label?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string | null
          label?: string | null
          token_hash?: string
        }
        Relationships: []
      }
      demo_key: {
        Row: {
          baseline: Json | null
          dead_taps: number
          enabled: boolean
          fails: number
          id: number
          invite_expires_at: string | null
          invite_id: string | null
          keep_minutes: number
          last_check_at: string | null
          last_error: string | null
          last_view_at: string | null
          pass: string
          ready_at: string | null
          share_link: string | null
          status: string
          tapped_at: string | null
          taps: number
          updated_at: string
        }
        Insert: {
          baseline?: Json | null
          dead_taps?: number
          enabled?: boolean
          fails?: number
          id?: number
          invite_expires_at?: string | null
          invite_id?: string | null
          keep_minutes?: number
          last_check_at?: string | null
          last_error?: string | null
          last_view_at?: string | null
          pass?: string
          ready_at?: string | null
          share_link?: string | null
          status?: string
          tapped_at?: string | null
          taps?: number
          updated_at?: string
        }
        Update: {
          baseline?: Json | null
          dead_taps?: number
          enabled?: boolean
          fails?: number
          id?: number
          invite_expires_at?: string | null
          invite_id?: string | null
          keep_minutes?: number
          last_check_at?: string | null
          last_error?: string | null
          last_view_at?: string | null
          pass?: string
          ready_at?: string | null
          share_link?: string | null
          status?: string
          tapped_at?: string | null
          taps?: number
          updated_at?: string
        }
        Relationships: []
      }
      demo_key_drivers: {
        Row: {
          accepted_at: string
          last_error: string | null
          name: string | null
          remove_at: string
          removed_at: string | null
          share_user_id: string
          status: string
        }
        Insert: {
          accepted_at?: string
          last_error?: string | null
          name?: string | null
          remove_at: string
          removed_at?: string | null
          share_user_id: string
          status?: string
        }
        Update: {
          accepted_at?: string
          last_error?: string | null
          name?: string | null
          remove_at?: string
          removed_at?: string | null
          share_user_id?: string
          status?: string
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
      driver_nicknames: {
        Row: {
          a: string
          b: string
        }
        Insert: {
          a: string
          b: string
        }
        Update: {
          a?: string
          b?: string
        }
        Relationships: []
      }
      edge_guard_beat: {
        Row: {
          at: string
          id: number
          ok: boolean
          summary: string | null
        }
        Insert: {
          at?: string
          id?: number
          ok?: boolean
          summary?: string | null
        }
        Update: {
          at?: string
          id?: number
          ok?: boolean
          summary?: string | null
        }
        Relationships: []
      }
      edge_guard_log: {
        Row: {
          action: string
          at: string
          detail: string | null
          id: number
          site: string
          state: string
        }
        Insert: {
          action: string
          at?: string
          detail?: string | null
          id?: never
          site: string
          state: string
        }
        Update: {
          action?: string
          at?: string
          detail?: string | null
          id?: never
          site?: string
          state?: string
        }
        Relationships: []
      }
      edge_key_usage: {
        Row: {
          hits: number
          last_used: string | null
          name: string
        }
        Insert: {
          hits?: number
          last_used?: string | null
          name: string
        }
        Update: {
          hits?: number
          last_used?: string | null
          name?: string
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
      emergency_prep: {
        Row: {
          charge_cmd: string | null
          checklist: Json
          ended_at: string | null
          hazard: string
          id: string
          note: string | null
          prev_limit: number | null
          started_at: string
        }
        Insert: {
          charge_cmd?: string | null
          checklist?: Json
          ended_at?: string | null
          hazard?: string
          id?: string
          note?: string | null
          prev_limit?: number | null
          started_at?: string
        }
        Update: {
          charge_cmd?: string | null
          checklist?: Json
          ended_at?: string | null
          hazard?: string
          id?: string
          note?: string | null
          prev_limit?: number | null
          started_at?: string
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
      freellm_watch_state: {
        Row: {
          fails: number
          id: boolean
          last_ok_at: string | null
          last_req: number | null
          last_status: string | null
          updated_at: string | null
        }
        Insert: {
          fails?: number
          id?: boolean
          last_ok_at?: string | null
          last_req?: number | null
          last_status?: string | null
          updated_at?: string | null
        }
        Update: {
          fails?: number
          id?: boolean
          last_ok_at?: string | null
          last_req?: number | null
          last_status?: string | null
          updated_at?: string | null
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
      guest_entry_attempts: {
        Row: {
          at: string
          id: number
          ok: boolean
          phone_digits: string | null
          reservation_id: number | null
        }
        Insert: {
          at?: string
          id?: number
          ok: boolean
          phone_digits?: string | null
          reservation_id?: number | null
        }
        Update: {
          at?: string
          id?: number
          ok?: boolean
          phone_digits?: string | null
          reservation_id?: number | null
        }
        Relationships: []
      }
      ha_live_state: {
        Row: {
          ident: string | null
          key: string
          sent_at: string | null
          sig: string | null
          started_at: string | null
        }
        Insert: {
          ident?: string | null
          key: string
          sent_at?: string | null
          sig?: string | null
          started_at?: string | null
        }
        Update: {
          ident?: string | null
          key?: string
          sent_at?: string | null
          sig?: string | null
          started_at?: string | null
        }
        Relationships: []
      }
      ha_push_queue: {
        Row: {
          command_id: string | null
          created_at: string
          deliver_at: string
          fallback_sent_at: string | null
          id: number
          payload: Json
        }
        Insert: {
          command_id?: string | null
          created_at?: string
          deliver_at?: string
          fallback_sent_at?: string | null
          id?: number
          payload: Json
        }
        Update: {
          command_id?: string | null
          created_at?: string
          deliver_at?: string
          fallback_sent_at?: string | null
          id?: number
          payload?: Json
        }
        Relationships: []
      }
      ha_todo_sync_status: {
        Row: {
          id: number
          last_error: string | null
          last_error_at: string | null
          last_ok: string | null
          stats: Json
        }
        Insert: {
          id?: number
          last_error?: string | null
          last_error_at?: string | null
          last_ok?: string | null
          stats?: Json
        }
        Update: {
          id?: number
          last_error?: string | null
          last_error_at?: string | null
          last_ok?: string | null
          stats?: Json
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
      home_hub_network_samples: {
        Row: {
          captured_at: string
          dns_ms: number | null
          dns_ok: boolean | null
          external_ip: string | null
          gateway: string | null
          gw_avg_ms: number | null
          gw_loss_pct: number | null
          gw_max_ms: number | null
          id: number
          inet_avg_ms: number | null
          inet_loss_pct: number | null
          inet_max_ms: number | null
          wan_status: string | null
          wan_uptime_s: number | null
        }
        Insert: {
          captured_at?: string
          dns_ms?: number | null
          dns_ok?: boolean | null
          external_ip?: string | null
          gateway?: string | null
          gw_avg_ms?: number | null
          gw_loss_pct?: number | null
          gw_max_ms?: number | null
          id?: number
          inet_avg_ms?: number | null
          inet_loss_pct?: number | null
          inet_max_ms?: number | null
          wan_status?: string | null
          wan_uptime_s?: number | null
        }
        Update: {
          captured_at?: string
          dns_ms?: number | null
          dns_ok?: boolean | null
          external_ip?: string | null
          gateway?: string | null
          gw_avg_ms?: number | null
          gw_loss_pct?: number | null
          gw_max_ms?: number | null
          id?: number
          inet_avg_ms?: number | null
          inet_loss_pct?: number | null
          inet_max_ms?: number | null
          wan_status?: string | null
          wan_uptime_s?: number | null
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
      home_pickup_settings: {
        Row: {
          address: string
          host_note: string | null
          id: number
          lat: number
          lon: number
          parking_note: string | null
          return_note: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string
          host_note?: string | null
          id?: number
          lat?: number
          lon?: number
          parking_note?: string | null
          return_note?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string
          host_note?: string | null
          id?: number
          lat?: number
          lon?: number
          parking_note?: string | null
          return_note?: string | null
          updated_at?: string | null
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
      improver_ideas: {
        Row: {
          area: string | null
          change: string | null
          created_at: string
          decided_at: string | null
          effort: string | null
          id: string
          impact: number | null
          kind: string | null
          note: string | null
          run_at: string
          status: string
          title: string
          why: string | null
        }
        Insert: {
          area?: string | null
          change?: string | null
          created_at?: string
          decided_at?: string | null
          effort?: string | null
          id?: string
          impact?: number | null
          kind?: string | null
          note?: string | null
          run_at?: string
          status?: string
          title: string
          why?: string | null
        }
        Update: {
          area?: string | null
          change?: string | null
          created_at?: string
          decided_at?: string | null
          effort?: string | null
          id?: string
          impact?: number | null
          kind?: string | null
          note?: string | null
          run_at?: string
          status?: string
          title?: string
          why?: string | null
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
      keyswitch_probes: {
        Row: {
          checked_at: string | null
          created_at: string | null
          expect: number
          got: number | null
          id: number
          ok: boolean | null
          probe: string
          request_id: number
        }
        Insert: {
          checked_at?: string | null
          created_at?: string | null
          expect: number
          got?: number | null
          id?: number
          ok?: boolean | null
          probe: string
          request_id: number
        }
        Update: {
          checked_at?: string | null
          created_at?: string | null
          expect?: number
          got?: number | null
          id?: number
          ok?: boolean | null
          probe?: string
          request_id?: number
        }
        Relationships: []
      }
      lax_ask_faq: {
        Row: {
          a: string
          id: number
          keywords: string[]
          kind: string
          q: string
          sort: number | null
          source: string | null
        }
        Insert: {
          a: string
          id?: number
          keywords?: string[]
          kind?: string
          q: string
          sort?: number | null
          source?: string | null
        }
        Update: {
          a?: string
          id?: number
          keywords?: string[]
          kind?: string
          q?: string
          sort?: number | null
          source?: string | null
        }
        Relationships: []
      }
      lax_ask_msgs: {
        Row: {
          content: string
          created_at: string
          id: number
          link: string
          reply_to: number | null
          reservation_id: number | null
          role: string
          source: string | null
          status: string
          unanswered: boolean
          updated_at: string
          urgent: boolean
        }
        Insert: {
          content?: string
          created_at?: string
          id?: number
          link: string
          reply_to?: number | null
          reservation_id?: number | null
          role: string
          source?: string | null
          status?: string
          unanswered?: boolean
          updated_at?: string
          urgent?: boolean
        }
        Update: {
          content?: string
          created_at?: string
          id?: number
          link?: string
          reply_to?: number | null
          reservation_id?: number | null
          role?: string
          source?: string | null
          status?: string
          unanswered?: boolean
          updated_at?: string
          urgent?: boolean
        }
        Relationships: []
      }
      lax_ask_settings: {
        Row: {
          daily_limit: number
          enabled: boolean
          gemini_error: string | null
          gemini_error_at: string | null
          gemini_model: string
          gemini_ok_at: string | null
          groq_error: string | null
          groq_error_at: string | null
          groq_ok_at: string | null
          house_rules: string | null
          id: number
          local_error: string | null
          local_ok_at: string | null
          updated_at: string | null
        }
        Insert: {
          daily_limit?: number
          enabled?: boolean
          gemini_error?: string | null
          gemini_error_at?: string | null
          gemini_model?: string
          gemini_ok_at?: string | null
          groq_error?: string | null
          groq_error_at?: string | null
          groq_ok_at?: string | null
          house_rules?: string | null
          id?: number
          local_error?: string | null
          local_ok_at?: string | null
          updated_at?: string | null
        }
        Update: {
          daily_limit?: number
          enabled?: boolean
          gemini_error?: string | null
          gemini_error_at?: string | null
          gemini_model?: string
          gemini_ok_at?: string | null
          groq_error?: string | null
          groq_error_at?: string | null
          groq_ok_at?: string | null
          house_rules?: string | null
          id?: number
          local_error?: string | null
          local_ok_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      lax_car_facts: {
        Row: {
          battery_cycles: number | null
          battery_health: string | null
          cost_per_kwh: number | null
          degradation_pct: number | null
          fsd: boolean | null
          full_range_mi: number | null
          id: number
          real_range_full_mi: number | null
          software: string | null
          source: string | null
          superchargers: Json | null
          updated_at: string | null
          usable_kwh: number | null
        }
        Insert: {
          battery_cycles?: number | null
          battery_health?: string | null
          cost_per_kwh?: number | null
          degradation_pct?: number | null
          fsd?: boolean | null
          full_range_mi?: number | null
          id?: number
          real_range_full_mi?: number | null
          software?: string | null
          source?: string | null
          superchargers?: Json | null
          updated_at?: string | null
          usable_kwh?: number | null
        }
        Update: {
          battery_cycles?: number | null
          battery_health?: string | null
          cost_per_kwh?: number | null
          degradation_pct?: number | null
          fsd?: boolean | null
          full_range_mi?: number | null
          id?: number
          real_range_full_mi?: number | null
          software?: string | null
          source?: string | null
          superchargers?: Json | null
          updated_at?: string | null
          usable_kwh?: number | null
        }
        Relationships: []
      }
      lax_demo_state: {
        Row: {
          link: string
          state: Json
          updated_at: string
        }
        Insert: {
          link: string
          state: Json
          updated_at?: string
        }
        Update: {
          link?: string
          state?: Json
          updated_at?: string
        }
        Relationships: []
      }
      lax_guest_events: {
        Row: {
          actor: string
          at: string
          detail: Json | null
          device: string | null
          device_id: string | null
          id: number
          kind: string
          reservation_id: number
        }
        Insert: {
          actor?: string
          at?: string
          detail?: Json | null
          device?: string | null
          device_id?: string | null
          id?: number
          kind: string
          reservation_id: number
        }
        Update: {
          actor?: string
          at?: string
          detail?: Json | null
          device?: string | null
          device_id?: string | null
          id?: number
          kind?: string
          reservation_id?: number
        }
        Relationships: []
      }
      lax_guest_links: {
        Row: {
          car_connected_at: string | null
          created_at: string
          email: string | null
          email_by: string | null
          email_changes: number
          pickup_battery: number | null
          pickup_battery_at: string | null
          reminder_at: string | null
          reminder_attempts: number
          reminder_error: string | null
          reminder_sent_at: string | null
          reservation_id: number
          returned_at: string | null
          settled_at: string | null
          token: string
        }
        Insert: {
          car_connected_at?: string | null
          created_at?: string
          email?: string | null
          email_by?: string | null
          email_changes?: number
          pickup_battery?: number | null
          pickup_battery_at?: string | null
          reminder_at?: string | null
          reminder_attempts?: number
          reminder_error?: string | null
          reminder_sent_at?: string | null
          reservation_id: number
          returned_at?: string | null
          settled_at?: string | null
          token?: string
        }
        Update: {
          car_connected_at?: string | null
          created_at?: string
          email?: string | null
          email_by?: string | null
          email_changes?: number
          pickup_battery?: number | null
          pickup_battery_at?: string | null
          reminder_at?: string | null
          reminder_attempts?: number
          reminder_error?: string | null
          reminder_sent_at?: string | null
          reservation_id?: number
          returned_at?: string | null
          settled_at?: string | null
          token?: string
        }
        Relationships: []
      }
      lax_host_devices: {
        Row: {
          device_id: string
          events: number
          first_seen: string
          reason: string
        }
        Insert: {
          device_id: string
          events?: number
          first_seen?: string
          reason: string
        }
        Update: {
          device_id?: string
          events?: number
          first_seen?: string
          reason?: string
        }
        Relationships: []
      }
      lax_parking_codes: {
        Row: {
          created_at: string
          id: string
          note: string | null
          payload: string
          valid_month: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          payload: string
          valid_month: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          payload?: string
          valid_month?: string
        }
        Relationships: []
      }
      lax_pass_google_objects: {
        Row: {
          created_at: string
          object_id: string
        }
        Insert: {
          created_at?: string
          object_id: string
        }
        Update: {
          created_at?: string
          object_id?: string
        }
        Relationships: []
      }
      lax_pass_log: {
        Row: {
          at: string
          detail: Json | null
          id: number
          kind: string
        }
        Insert: {
          at?: string
          detail?: Json | null
          id?: number
          kind: string
        }
        Update: {
          at?: string
          detail?: Json | null
          id?: number
          kind?: string
        }
        Relationships: []
      }
      lax_pass_registrations: {
        Row: {
          created_at: string
          device_id: string
          pass_type: string
          push_token: string
          serial: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id: string
          pass_type: string
          push_token: string
          serial: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          pass_type?: string
          push_token?: string
          serial?: string
          updated_at?: string
        }
        Relationships: []
      }
      lax_pass_settings: {
        Row: {
          google_live: boolean
          guide: Json
          host_token: string
          id: number
          serial: string
          slug: string
          updated_at: string
        }
        Insert: {
          google_live?: boolean
          guide?: Json
          host_token?: string
          id?: number
          serial?: string
          slug: string
          updated_at?: string
        }
        Update: {
          google_live?: boolean
          guide?: Json
          host_token?: string
          id?: number
          serial?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      llm_providers: {
        Row: {
          cooldown_reason: string | null
          cooldown_until: string | null
          daily_cap: number | null
          enabled: boolean
          last_error: string | null
          last_ok_at: string | null
          name: string
          note: string | null
          private_ok: boolean
          updated_at: string
        }
        Insert: {
          cooldown_reason?: string | null
          cooldown_until?: string | null
          daily_cap?: number | null
          enabled?: boolean
          last_error?: string | null
          last_ok_at?: string | null
          name: string
          note?: string | null
          private_ok?: boolean
          updated_at?: string
        }
        Update: {
          cooldown_reason?: string | null
          cooldown_until?: string | null
          daily_cap?: number | null
          enabled?: boolean
          last_error?: string | null
          last_ok_at?: string | null
          name?: string
          note?: string | null
          private_ok?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      llm_shadow: {
        Row: {
          agree_score: number | null
          at: string
          free_json: Json | null
          free_model: string | null
          free_provider: string | null
          id: number
          job: string
          note: string | null
          paid_json: Json | null
          ref: string | null
        }
        Insert: {
          agree_score?: number | null
          at?: string
          free_json?: Json | null
          free_model?: string | null
          free_provider?: string | null
          id?: never
          job: string
          note?: string | null
          paid_json?: Json | null
          ref?: string | null
        }
        Update: {
          agree_score?: number | null
          at?: string
          free_json?: Json | null
          free_model?: string | null
          free_provider?: string | null
          id?: never
          job?: string
          note?: string | null
          paid_json?: Json | null
          ref?: string | null
        }
        Relationships: []
      }
      ltx_box: {
        Row: {
          comfy_fail_streak: number | null
          hf_token_fetched_at: string | null
          id: boolean
          instance_id: string
          last_detail: Json | null
          last_heartbeat_at: string | null
          start_requested_at: string | null
          updated_at: string | null
        }
        Insert: {
          comfy_fail_streak?: number | null
          hf_token_fetched_at?: string | null
          id?: boolean
          instance_id: string
          last_detail?: Json | null
          last_heartbeat_at?: string | null
          start_requested_at?: string | null
          updated_at?: string | null
        }
        Update: {
          comfy_fail_streak?: number | null
          hf_token_fetched_at?: string | null
          id?: boolean
          instance_id?: string
          last_detail?: Json | null
          last_heartbeat_at?: string | null
          start_requested_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ltx_box_events: {
        Row: {
          at: string | null
          detail: Json | null
          event: string
          id: number
        }
        Insert: {
          at?: string | null
          detail?: Json | null
          event: string
          id?: number
        }
        Update: {
          at?: string | null
          detail?: Json | null
          event?: string
          id?: number
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
      meetings_parse_cache: {
        Row: {
          cached_at: string
          file_name: string
          parsed: Json
          size_bytes: number
        }
        Insert: {
          cached_at?: string
          file_name: string
          parsed: Json
          size_bytes: number
        }
        Update: {
          cached_at?: string
          file_name?: string
          parsed?: Json
          size_bytes?: number
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
          created_at: string | null
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
          created_at?: string | null
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
          created_at?: string | null
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
          last_scout_at: string | null
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
          last_scout_at?: string | null
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
          last_scout_at?: string | null
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
      notification_owners: {
        Row: {
          agent_slug: string
          created_at: string
          note: string | null
          prefix: string
        }
        Insert: {
          agent_slug: string
          created_at?: string
          note?: string | null
          prefix: string
        }
        Update: {
          agent_slug?: string
          created_at?: string
          note?: string | null
          prefix?: string
        }
        Relationships: []
      }
      notify_kinds: {
        Row: {
          added_at: string
          kind: string
          what: string
        }
        Insert: {
          added_at?: string
          kind: string
          what: string
        }
        Update: {
          added_at?: string
          kind?: string
          what?: string
        }
        Relationships: []
      }
      notify_ledger: {
        Row: {
          channel: string
          dedupe_key: string
          id: number
          level: string | null
          sent_at: string
          source: string | null
          title: string | null
        }
        Insert: {
          channel: string
          dedupe_key: string
          id?: number
          level?: string | null
          sent_at?: string
          source?: string | null
          title?: string | null
        }
        Update: {
          channel?: string
          dedupe_key?: string
          id?: number
          level?: string | null
          sent_at?: string
          source?: string | null
          title?: string | null
        }
        Relationships: []
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
      notify_router_settings: {
        Row: {
          dedupe_critical_seconds: number
          dedupe_seconds: number
          enabled: boolean
          ha_levels: string[]
          id: boolean
          updated_at: string
        }
        Insert: {
          dedupe_critical_seconds?: number
          dedupe_seconds?: number
          enabled?: boolean
          ha_levels?: string[]
          id?: boolean
          updated_at?: string
        }
        Update: {
          dedupe_critical_seconds?: number
          dedupe_seconds?: number
          enabled?: boolean
          ha_levels?: string[]
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ops_heal_throttle: {
        Row: {
          action: string
          last_at: string | null
        }
        Insert: {
          action: string
          last_at?: string | null
        }
        Update: {
          action?: string
          last_at?: string | null
        }
        Relationships: []
      }
      ops_incidents: {
        Row: {
          actions: Json
          component: string
          detail: Json
          ended_at: string | null
          id: number
          lesson: string | null
          resolved_by: string | null
          source: string | null
          started_at: string
          symptom: string
        }
        Insert: {
          actions?: Json
          component?: string
          detail?: Json
          ended_at?: string | null
          id?: never
          lesson?: string | null
          resolved_by?: string | null
          source?: string | null
          started_at?: string
          symptom: string
        }
        Update: {
          actions?: Json
          component?: string
          detail?: Json
          ended_at?: string | null
          id?: never
          lesson?: string | null
          resolved_by?: string | null
          source?: string | null
          started_at?: string
          symptom?: string
        }
        Relationships: []
      }
      ops_playbook: {
        Row: {
          action: string
          description: string
          enabled: boolean
          last_at: string | null
          tier: number
          tries: number
          wins: number
        }
        Insert: {
          action: string
          description: string
          enabled?: boolean
          last_at?: string | null
          tier: number
          tries?: number
          wins?: number
        }
        Update: {
          action?: string
          description?: string
          enabled?: boolean
          last_at?: string | null
          tier?: number
          tries?: number
          wins?: number
        }
        Relationships: []
      }
      partner_ai_status: {
        Row: {
          cloud_answers: boolean
          id: number
          model: string | null
          seen_at: string | null
        }
        Insert: {
          cloud_answers?: boolean
          id?: number
          model?: string | null
          seen_at?: string | null
        }
        Update: {
          cloud_answers?: boolean
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
      partner_google: {
        Row: {
          connected_at: string
          email: string | null
          last_error: string | null
          last_ok_at: string | null
          needs_reconnect: boolean
          scope: string | null
          user_id: string
          vault_secret_name: string
        }
        Insert: {
          connected_at?: string
          email?: string | null
          last_error?: string | null
          last_ok_at?: string | null
          needs_reconnect?: boolean
          scope?: string | null
          user_id: string
          vault_secret_name: string
        }
        Update: {
          connected_at?: string
          email?: string | null
          last_error?: string | null
          last_ok_at?: string | null
          needs_reconnect?: boolean
          scope?: string | null
          user_id?: string
          vault_secret_name?: string
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
          company: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          link_sent_at: string | null
          mark: string
          name: string
          roster_name: string
          staff_id: string | null
          user_id: string | null
          vesta_invites: boolean
          wx_at: string | null
          wx_label: string | null
          wx_lat: number | null
          wx_lon: number | null
          wx_precise: boolean | null
        }
        Insert: {
          call_url?: string | null
          claim_expires_at?: string | null
          claim_hash?: string | null
          claim_used_at?: string | null
          company?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          link_sent_at?: string | null
          mark?: string
          name: string
          roster_name: string
          staff_id?: string | null
          user_id?: string | null
          vesta_invites?: boolean
          wx_at?: string | null
          wx_label?: string | null
          wx_lat?: number | null
          wx_lon?: number | null
          wx_precise?: boolean | null
        }
        Update: {
          call_url?: string | null
          claim_expires_at?: string | null
          claim_hash?: string | null
          claim_used_at?: string | null
          company?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          link_sent_at?: string | null
          mark?: string
          name?: string
          roster_name?: string
          staff_id?: string | null
          user_id?: string | null
          vesta_invites?: boolean
          wx_at?: string | null
          wx_label?: string | null
          wx_lat?: number | null
          wx_lon?: number | null
          wx_precise?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
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
      pattern_votes: {
        Row: {
          at: string
          kind: string
          pattern_id: string
          voter: string
        }
        Insert: {
          at?: string
          kind: string
          pattern_id: string
          voter: string
        }
        Update: {
          at?: string
          kind?: string
          pattern_id?: string
          voter?: string
        }
        Relationships: [
          {
            foreignKeyName: "pattern_votes_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "cookie_patterns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pattern_votes_pattern_id_fkey"
            columns: ["pattern_id"]
            isOneToOne: false
            referencedRelation: "v_cookieyeti_pattern_stats"
            referencedColumns: ["id"]
          },
        ]
      }
      pi_job_runs: {
        Row: {
          duration_ms: number | null
          id: number
          job: string
          ok: boolean
          ran_at: string
          summary: string | null
        }
        Insert: {
          duration_ms?: number | null
          id?: number
          job: string
          ok: boolean
          ran_at?: string
          summary?: string | null
        }
        Update: {
          duration_ms?: number | null
          id?: number
          job?: string
          ok?: boolean
          ran_at?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pi_job_runs_job_fkey"
            columns: ["job"]
            isOneToOne: false
            referencedRelation: "pi_jobs"
            referencedColumns: ["job"]
          },
        ]
      }
      pi_jobs: {
        Row: {
          consecutive_failures: number
          created_at: string
          description: string | null
          enabled: boolean
          job: string
          last_duration_ms: number | null
          last_ok: boolean | null
          last_ok_at: string | null
          last_run_at: string | null
          last_summary: string | null
          max_gap_min: number
          replaced_claude_task: string | null
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          description?: string | null
          enabled?: boolean
          job: string
          last_duration_ms?: number | null
          last_ok?: boolean | null
          last_ok_at?: string | null
          last_run_at?: string | null
          last_summary?: string | null
          max_gap_min?: number
          replaced_claude_task?: string | null
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          description?: string | null
          enabled?: boolean
          job?: string
          last_duration_ms?: number | null
          last_ok?: boolean | null
          last_ok_at?: string | null
          last_run_at?: string | null
          last_summary?: string | null
          max_gap_min?: number
          replaced_claude_task?: string | null
        }
        Relationships: []
      }
      pi_port_baseline: {
        Row: {
          added_at: string
          port: number
          purpose: string
        }
        Insert: {
          added_at?: string
          port: number
          purpose: string
        }
        Update: {
          added_at?: string
          port?: number
          purpose?: string
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
      posting_pauses: {
        Row: {
          brand: string | null
          cleared_at: string | null
          cleared_by: string | null
          ends_at: string
          held: number
          id: string
          reason: string
          started_at: string
          started_by: string
        }
        Insert: {
          brand?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          ends_at: string
          held?: number
          id?: string
          reason: string
          started_at?: string
          started_by: string
        }
        Update: {
          brand?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          ends_at?: string
          held?: number
          id?: string
          reason?: string
          started_at?: string
          started_by?: string
        }
        Relationships: []
      }
      posting_settings_log: {
        Row: {
          at: string | null
          by_name: string | null
          client_id: string | null
          id: number
          patch: Json | null
        }
        Insert: {
          at?: string | null
          by_name?: string | null
          client_id?: string | null
          id?: number
          patch?: Json | null
        }
        Update: {
          at?: string | null
          by_name?: string | null
          client_id?: string | null
          id?: number
          patch?: Json | null
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
      product_watch_state: {
        Row: {
          checked_at: string | null
          error: string | null
          id: number
          raised: number | null
          red: number | null
          resolved: number | null
        }
        Insert: {
          checked_at?: string | null
          error?: string | null
          id?: number
          raised?: number | null
          red?: number | null
          resolved?: number | null
        }
        Update: {
          checked_at?: string | null
          error?: string | null
          id?: number
          raised?: number | null
          red?: number | null
          resolved?: number | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          audience: string
          created_at: string
          endpoint: string
          id: string
          keys: Json
          reservation_id: number | null
          user_id: string | null
        }
        Insert: {
          audience?: string
          created_at?: string
          endpoint: string
          id?: string
          keys: Json
          reservation_id?: number | null
          user_id?: string | null
        }
        Update: {
          audience?: string
          created_at?: string
          endpoint?: string
          id?: string
          keys?: Json
          reservation_id?: number | null
          user_id?: string | null
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
          rerouted: Json | null
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
          rerouted?: Json | null
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
          rerouted?: Json | null
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
      recut_batches: {
        Row: {
          brief: string | null
          client_slug: string
          code: string
          created_at: string
          created_by: string | null
          done_at: string | null
          done_items: string[]
          id: string
          items: string[]
          status: string
        }
        Insert: {
          brief?: string | null
          client_slug: string
          code: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_items?: string[]
          id?: string
          items?: string[]
          status?: string
        }
        Update: {
          brief?: string | null
          client_slug?: string
          code?: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_items?: string[]
          id?: string
          items?: string[]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "recut_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      recut_components: {
        Row: {
          key: string
          label: string
          pattern: string
          shared: boolean
          sort: number
        }
        Insert: {
          key: string
          label: string
          pattern: string
          shared?: boolean
          sort?: number
        }
        Update: {
          key?: string
          label?: string
          pattern?: string
          shared?: boolean
          sort?: number
        }
        Relationships: []
      }
      recut_spec_items: {
        Row: {
          applied_at: string | null
          applied_version: number | null
          item_id: string
          spec_id: string
        }
        Insert: {
          applied_at?: string | null
          applied_version?: number | null
          item_id: string
          spec_id: string
        }
        Update: {
          applied_at?: string | null
          applied_version?: number | null
          item_id?: string
          spec_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recut_spec_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "approval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recut_spec_items_spec_id_fkey"
            columns: ["spec_id"]
            isOneToOne: false
            referencedRelation: "recut_specs"
            referencedColumns: ["id"]
          },
        ]
      }
      recut_specs: {
        Row: {
          applied_at: string | null
          blocker: string | null
          client_slug: string
          component: string
          created_at: string
          decided_by: string | null
          id: string
          spec: string | null
          status: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          blocker?: string | null
          client_slug: string
          component: string
          created_at?: string
          decided_by?: string | null
          id?: string
          spec?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          blocker?: string | null
          client_slug?: string
          component?: string
          created_at?: string
          decided_by?: string | null
          id?: string
          spec?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recut_specs_component_fkey"
            columns: ["component"]
            isOneToOne: false
            referencedRelation: "recut_components"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "recut_specs_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "approval_staff"
            referencedColumns: ["id"]
          },
        ]
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
      rg_call_reviews: {
        Row: {
          call_id: string
          call_no: number | null
          confidence: number | null
          created_at: string
          error: string | null
          impulse: Json | null
          model: string | null
          objections: string[]
          overall: number | null
          playbook_arms: Json | null
          provider: string | null
          rule_flags: string[]
          scores: Json | null
          status: string
          tries: number
          updated_at: string
          went_well: string | null
          work_on: string | null
        }
        Insert: {
          call_id: string
          call_no?: number | null
          confidence?: number | null
          created_at?: string
          error?: string | null
          impulse?: Json | null
          model?: string | null
          objections?: string[]
          overall?: number | null
          playbook_arms?: Json | null
          provider?: string | null
          rule_flags?: string[]
          scores?: Json | null
          status?: string
          tries?: number
          updated_at?: string
          went_well?: string | null
          work_on?: string | null
        }
        Update: {
          call_id?: string
          call_no?: number | null
          confidence?: number | null
          created_at?: string
          error?: string | null
          impulse?: Json | null
          model?: string | null
          objections?: string[]
          overall?: number | null
          playbook_arms?: Json | null
          provider?: string | null
          rule_flags?: string[]
          scores?: Json | null
          status?: string
          tries?: number
          updated_at?: string
          went_well?: string | null
          work_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rg_call_reviews_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: true
            referencedRelation: "rg_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      rg_calls: {
        Row: {
          appointment_purpose: string | null
          archived_at: string | null
          attempt: number
          batch_id: string | null
          cal_booked_by: string | null
          cal_error: string | null
          cal_event_id: string | null
          cal_meet_url: string | null
          cal_prep_event_id: string | null
          cal_start_at: string | null
          call_no: number | null
          callback_at: string | null
          callback_number: string | null
          callback_wanted: boolean
          caller_name: string | null
          conversation_id: string | null
          counterpart_business: string | null
          counterpart_phone: string | null
          deleted_at: string | null
          direction: string
          dm_name: string | null
          dm_reached: boolean | null
          dm_title: string | null
          duration_sec: number | null
          ended_at: string | null
          id: string
          intent: string | null
          is_test: boolean
          kept_talking: boolean | null
          lead_id: string
          meeting_email: string | null
          meeting_times: string | null
          message: string | null
          moved_to_ava_at: string | null
          next_actions: string | null
          notes: string | null
          opener_key: string | null
          outcome: string | null
          playbook_arms: Json | null
          preferred_times: string | null
          provider: string
          queued_at: string
          read_at: string | null
          recording_url: string | null
          status: string
          summary: string | null
          to_number: string
          transcript: Json | null
          updated_at: string
          urgent: boolean
        }
        Insert: {
          appointment_purpose?: string | null
          archived_at?: string | null
          attempt?: number
          batch_id?: string | null
          cal_booked_by?: string | null
          cal_error?: string | null
          cal_event_id?: string | null
          cal_meet_url?: string | null
          cal_prep_event_id?: string | null
          cal_start_at?: string | null
          call_no?: number | null
          callback_at?: string | null
          callback_number?: string | null
          callback_wanted?: boolean
          caller_name?: string | null
          conversation_id?: string | null
          counterpart_business?: string | null
          counterpart_phone?: string | null
          deleted_at?: string | null
          direction?: string
          dm_name?: string | null
          dm_reached?: boolean | null
          dm_title?: string | null
          duration_sec?: number | null
          ended_at?: string | null
          id?: string
          intent?: string | null
          is_test?: boolean
          kept_talking?: boolean | null
          lead_id: string
          meeting_email?: string | null
          meeting_times?: string | null
          message?: string | null
          moved_to_ava_at?: string | null
          next_actions?: string | null
          notes?: string | null
          opener_key?: string | null
          outcome?: string | null
          playbook_arms?: Json | null
          preferred_times?: string | null
          provider?: string
          queued_at?: string
          read_at?: string | null
          recording_url?: string | null
          status?: string
          summary?: string | null
          to_number: string
          transcript?: Json | null
          updated_at?: string
          urgent?: boolean
        }
        Update: {
          appointment_purpose?: string | null
          archived_at?: string | null
          attempt?: number
          batch_id?: string | null
          cal_booked_by?: string | null
          cal_error?: string | null
          cal_event_id?: string | null
          cal_meet_url?: string | null
          cal_prep_event_id?: string | null
          cal_start_at?: string | null
          call_no?: number | null
          callback_at?: string | null
          callback_number?: string | null
          callback_wanted?: boolean
          caller_name?: string | null
          conversation_id?: string | null
          counterpart_business?: string | null
          counterpart_phone?: string | null
          deleted_at?: string | null
          direction?: string
          dm_name?: string | null
          dm_reached?: boolean | null
          dm_title?: string | null
          duration_sec?: number | null
          ended_at?: string | null
          id?: string
          intent?: string | null
          is_test?: boolean
          kept_talking?: boolean | null
          lead_id?: string
          meeting_email?: string | null
          meeting_times?: string | null
          message?: string | null
          moved_to_ava_at?: string | null
          next_actions?: string | null
          notes?: string | null
          opener_key?: string | null
          outcome?: string | null
          playbook_arms?: Json | null
          preferred_times?: string | null
          provider?: string
          queued_at?: string
          read_at?: string | null
          recording_url?: string | null
          status?: string
          summary?: string | null
          to_number?: string
          transcript?: Json | null
          updated_at?: string
          urgent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "rg_calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "rg_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rg_calls_opener_key_fkey"
            columns: ["opener_key"]
            isOneToOne: false
            referencedRelation: "rg_openers"
            referencedColumns: ["key"]
          },
        ]
      }
      rg_deals: {
        Row: {
          company: string
          created_at: string
          id: string
          monthly_cut: number | null
          note: string | null
          signed_on: string
          sqft: number | null
        }
        Insert: {
          company: string
          created_at?: string
          id?: string
          monthly_cut?: number | null
          note?: string | null
          signed_on?: string
          sqft?: number | null
        }
        Update: {
          company?: string
          created_at?: string
          id?: string
          monthly_cut?: number | null
          note?: string | null
          signed_on?: string
          sqft?: number | null
        }
        Relationships: []
      }
      rg_dnc: {
        Row: {
          created_at: string
          lead_id: string | null
          phone: string
          reason: string
        }
        Insert: {
          created_at?: string
          lead_id?: string | null
          phone: string
          reason?: string
        }
        Update: {
          created_at?: string
          lead_id?: string | null
          phone?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "rg_dnc_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "rg_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      rg_enrich_runs: {
        Row: {
          claimed: number
          errors: number
          finished_at: string | null
          found: number
          id: number
          not_found: number
          note: string | null
          started_at: string
        }
        Insert: {
          claimed?: number
          errors?: number
          finished_at?: string | null
          found?: number
          id?: number
          not_found?: number
          note?: string | null
          started_at?: string
        }
        Update: {
          claimed?: number
          errors?: number
          finished_at?: string | null
          found?: number
          id?: number
          not_found?: number
          note?: string | null
          started_at?: string
        }
        Relationships: []
      }
      rg_followups: {
        Row: {
          call_id: string | null
          created_at: string
          dialed_at: string | null
          due_at: string
          id: string
          is_test: boolean
          kind: string
          lead_id: string
          note: string | null
          reminded_at: string | null
          result_call_id: string | null
          status: string
          to_number: string
          updated_at: string
        }
        Insert: {
          call_id?: string | null
          created_at?: string
          dialed_at?: string | null
          due_at: string
          id?: string
          is_test?: boolean
          kind?: string
          lead_id: string
          note?: string | null
          reminded_at?: string | null
          result_call_id?: string | null
          status?: string
          to_number: string
          updated_at?: string
        }
        Update: {
          call_id?: string | null
          created_at?: string
          dialed_at?: string | null
          due_at?: string
          id?: string
          is_test?: boolean
          kind?: string
          lead_id?: string
          note?: string | null
          reminded_at?: string | null
          result_call_id?: string | null
          status?: string
          to_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rg_followups_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: true
            referencedRelation: "rg_calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rg_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "rg_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rg_followups_result_call_id_fkey"
            columns: ["result_call_id"]
            isOneToOne: false
            referencedRelation: "rg_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      rg_holidays: {
        Row: {
          day: string
          name: string
        }
        Insert: {
          day: string
          name: string
        }
        Update: {
          day?: string
          name?: string
        }
        Relationships: []
      }
      rg_import_tokens: {
        Row: {
          expires_at: string
          token_sha256: string
          used_rows: number
        }
        Insert: {
          expires_at: string
          token_sha256: string
          used_rows?: number
        }
        Update: {
          expires_at?: string
          token_sha256?: string
          used_rows?: number
        }
        Relationships: []
      }
      rg_leads: {
        Row: {
          additional_contacts: string | null
          call_attempts: number
          call_status: string
          category: string
          claimed_at: string | null
          company: string
          contacts: Json
          created_at: string
          dnc: boolean
          enrich_attempts: number
          enrich_error: string | null
          enrich_status: string
          enriched_at: string | null
          escalate: boolean
          footprint: string | null
          id: string
          last_called_at: string | null
          line_type: string
          line_type_checked_at: string | null
          next_call_at: string | null
          notes: string | null
          phone: string | null
          phone_candidates: Json
          phone_confidence: number | null
          phone_source: string | null
          phone_source_url: string | null
          pitch: string
          pitch_original: string | null
          pitch_source: string
          priority: number
          risk_tier: string
          roof_volume: string | null
          site_model: string | null
          state: string
          timezone: string
          updated_at: string
          website: string | null
          wikidata_id: string | null
        }
        Insert: {
          additional_contacts?: string | null
          call_attempts?: number
          call_status?: string
          category?: string
          claimed_at?: string | null
          company: string
          contacts?: Json
          created_at?: string
          dnc?: boolean
          enrich_attempts?: number
          enrich_error?: string | null
          enrich_status?: string
          enriched_at?: string | null
          escalate?: boolean
          footprint?: string | null
          id?: string
          last_called_at?: string | null
          line_type?: string
          line_type_checked_at?: string | null
          next_call_at?: string | null
          notes?: string | null
          phone?: string | null
          phone_candidates?: Json
          phone_confidence?: number | null
          phone_source?: string | null
          phone_source_url?: string | null
          pitch: string
          pitch_original?: string | null
          pitch_source?: string
          priority?: number
          risk_tier: string
          roof_volume?: string | null
          site_model?: string | null
          state: string
          timezone: string
          updated_at?: string
          website?: string | null
          wikidata_id?: string | null
        }
        Update: {
          additional_contacts?: string | null
          call_attempts?: number
          call_status?: string
          category?: string
          claimed_at?: string | null
          company?: string
          contacts?: Json
          created_at?: string
          dnc?: boolean
          enrich_attempts?: number
          enrich_error?: string | null
          enrich_status?: string
          enriched_at?: string | null
          escalate?: boolean
          footprint?: string | null
          id?: string
          last_called_at?: string | null
          line_type?: string
          line_type_checked_at?: string | null
          next_call_at?: string | null
          notes?: string | null
          phone?: string | null
          phone_candidates?: Json
          phone_confidence?: number | null
          phone_source?: string | null
          phone_source_url?: string | null
          pitch?: string
          pitch_original?: string | null
          pitch_source?: string
          priority?: number
          risk_tier?: string
          roof_volume?: string | null
          site_model?: string | null
          state?: string
          timezone?: string
          updated_at?: string
          website?: string | null
          wikidata_id?: string | null
        }
        Relationships: []
      }
      rg_openers: {
        Row: {
          active: boolean
          audience: string
          created_at: string
          key: string
          label: string
          script: string
        }
        Insert: {
          active?: boolean
          audience: string
          created_at?: string
          key: string
          label: string
          script: string
        }
        Update: {
          active?: boolean
          audience?: string
          created_at?: string
          key?: string
          label?: string
          script?: string
        }
        Relationships: []
      }
      rg_pip: {
        Row: {
          baseline: Json | null
          closed_on: string | null
          created_at: string
          ends_on: string
          id: string
          outcome: string | null
          reason: string | null
          started_on: string
          status: string
          target_per_week: number
          trigger: string
        }
        Insert: {
          baseline?: Json | null
          closed_on?: string | null
          created_at?: string
          ends_on: string
          id?: string
          outcome?: string | null
          reason?: string | null
          started_on?: string
          status?: string
          target_per_week: number
          trigger?: string
        }
        Update: {
          baseline?: Json | null
          closed_on?: string | null
          created_at?: string
          ends_on?: string
          id?: string
          outcome?: string | null
          reason?: string | null
          started_on?: string
          status?: string
          target_per_week?: number
          trigger?: string
        }
        Relationships: []
      }
      rg_pitch_templates: {
        Row: {
          body: string
          category: string
          industry_hook: string | null
          industry_plural: string | null
          updated_at: string
        }
        Insert: {
          body: string
          category: string
          industry_hook?: string | null
          industry_plural?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string
          industry_hook?: string | null
          industry_plural?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rg_playbook: {
        Row: {
          created_at: string
          decided_at: string | null
          id: string
          kind: string
          origin: string
          result: Json | null
          rule: string
          size: string
          started_at: string | null
          status: string
          updated_at: string
          why: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          id?: string
          kind?: string
          origin?: string
          result?: Json | null
          rule: string
          size?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          why?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          id?: string
          kind?: string
          origin?: string
          result?: Json | null
          rule?: string
          size?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          why?: string | null
        }
        Relationships: []
      }
      rg_settings: {
        Row: {
          agent_id: string | null
          auto_pace: boolean
          avg_roof_sqft: number
          callback_number: string | null
          calling_enabled: boolean
          close_rate: number
          coach_auto_test: boolean
          cost_number_monthly: number
          cost_phone_per_min: number
          cost_voice_per_min: number
          daily_cap: number
          daily_spend_cap: number
          deal_cut_pct: number
          demo_daily_cap: number
          demo_lead_id: string | null
          dry_spell_dials: number
          from_number: string | null
          horizon_months: number
          id: boolean
          inbound_lead_id: string | null
          llm: string | null
          llm_fallbacks: string[]
          loa_prior_rate: number
          loa_prior_weight: number
          max_attempts: number
          min_gap_bdays: number
          number_bought_on: string
          personal_lead_id: string | null
          phone_number_id: string | null
          phone_provider: string
          pilot_limit: number | null
          pip_weeks: number
          rate_per_sqft: number
          review_started_on: string
          setup_log: Json
          telnyx_connection_id: string | null
          telnyx_in_connection_id: string | null
          telnyx_ovp_id: string | null
          test_phone: string | null
          updated_at: string
          updated_by: string | null
          voice_id: string | null
          webhook_id: string | null
          weekly_goal: number
          window_end_hour: number
          window_start_hour: number
          work_days: number
        }
        Insert: {
          agent_id?: string | null
          auto_pace?: boolean
          avg_roof_sqft?: number
          callback_number?: string | null
          calling_enabled?: boolean
          close_rate?: number
          coach_auto_test?: boolean
          cost_number_monthly?: number
          cost_phone_per_min?: number
          cost_voice_per_min?: number
          daily_cap?: number
          daily_spend_cap?: number
          deal_cut_pct?: number
          demo_daily_cap?: number
          demo_lead_id?: string | null
          dry_spell_dials?: number
          from_number?: string | null
          horizon_months?: number
          id?: boolean
          inbound_lead_id?: string | null
          llm?: string | null
          llm_fallbacks?: string[]
          loa_prior_rate?: number
          loa_prior_weight?: number
          max_attempts?: number
          min_gap_bdays?: number
          number_bought_on?: string
          personal_lead_id?: string | null
          phone_number_id?: string | null
          phone_provider?: string
          pilot_limit?: number | null
          pip_weeks?: number
          rate_per_sqft?: number
          review_started_on?: string
          setup_log?: Json
          telnyx_connection_id?: string | null
          telnyx_in_connection_id?: string | null
          telnyx_ovp_id?: string | null
          test_phone?: string | null
          updated_at?: string
          updated_by?: string | null
          voice_id?: string | null
          webhook_id?: string | null
          weekly_goal?: number
          window_end_hour?: number
          window_start_hour?: number
          work_days?: number
        }
        Update: {
          agent_id?: string | null
          auto_pace?: boolean
          avg_roof_sqft?: number
          callback_number?: string | null
          calling_enabled?: boolean
          close_rate?: number
          coach_auto_test?: boolean
          cost_number_monthly?: number
          cost_phone_per_min?: number
          cost_voice_per_min?: number
          daily_cap?: number
          daily_spend_cap?: number
          deal_cut_pct?: number
          demo_daily_cap?: number
          demo_lead_id?: string | null
          dry_spell_dials?: number
          from_number?: string | null
          horizon_months?: number
          id?: boolean
          inbound_lead_id?: string | null
          llm?: string | null
          llm_fallbacks?: string[]
          loa_prior_rate?: number
          loa_prior_weight?: number
          max_attempts?: number
          min_gap_bdays?: number
          number_bought_on?: string
          personal_lead_id?: string | null
          phone_number_id?: string | null
          phone_provider?: string
          pilot_limit?: number | null
          pip_weeks?: number
          rate_per_sqft?: number
          review_started_on?: string
          setup_log?: Json
          telnyx_connection_id?: string | null
          telnyx_in_connection_id?: string | null
          telnyx_ovp_id?: string | null
          test_phone?: string | null
          updated_at?: string
          updated_by?: string | null
          voice_id?: string | null
          webhook_id?: string | null
          weekly_goal?: number
          window_end_hour?: number
          window_start_hour?: number
          work_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "rg_settings_demo_lead_id_fkey"
            columns: ["demo_lead_id"]
            isOneToOne: false
            referencedRelation: "rg_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rg_settings_inbound_lead_id_fkey"
            columns: ["inbound_lead_id"]
            isOneToOne: false
            referencedRelation: "rg_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rg_settings_personal_lead_id_fkey"
            columns: ["personal_lead_id"]
            isOneToOne: false
            referencedRelation: "rg_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_cap_boosts: {
        Row: {
          at: string
          by_user: string | null
          day: string
          extra_usd: number
          id: number
          reason: string | null
        }
        Insert: {
          at?: string
          by_user?: string | null
          day?: string
          extra_usd: number
          id?: never
          reason?: string | null
        }
        Update: {
          at?: string
          by_user?: string | null
          day?: string
          extra_usd?: number
          id?: never
          reason?: string | null
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
      scout_free_watch_log: {
        Row: {
          actions: string[] | null
          at: string
          chat_bad: number | null
          chat_calls: number | null
          detail: Json | null
          paid_asks: number | null
          paused: number | null
        }
        Insert: {
          actions?: string[] | null
          at?: string
          chat_bad?: number | null
          chat_calls?: number | null
          detail?: Json | null
          paid_asks?: number | null
          paused?: number | null
        }
        Update: {
          actions?: string[] | null
          at?: string
          chat_bad?: number | null
          chat_calls?: number | null
          detail?: Json | null
          paid_asks?: number | null
          paused?: number | null
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
      scout_paid_log: {
        Row: {
          at: string
          by_user: string | null
          id: number
          is_on: boolean
          reason: string | null
          until: string | null
        }
        Insert: {
          at?: string
          by_user?: string | null
          id?: never
          is_on: boolean
          reason?: string | null
          until?: string | null
        }
        Update: {
          at?: string
          by_user?: string | null
          id?: never
          is_on?: boolean
          reason?: string | null
          until?: string | null
        }
        Relationships: []
      }
      scout_settings: {
        Row: {
          auto_run: boolean
          background_cap_usd: number
          chat_cap_usd: number
          id: boolean
          paid_ai_changed_at: string | null
          paid_ai_off_reason: string | null
          paid_ai_ok: boolean
          paid_ai_until: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_run?: boolean
          background_cap_usd?: number
          chat_cap_usd?: number
          id?: boolean
          paid_ai_changed_at?: string | null
          paid_ai_off_reason?: string | null
          paid_ai_ok?: boolean
          paid_ai_until?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_run?: boolean
          background_cap_usd?: number
          chat_cap_usd?: number
          id?: boolean
          paid_ai_changed_at?: string | null
          paid_ai_off_reason?: string | null
          paid_ai_ok?: boolean
          paid_ai_until?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      secret_intake_nonces: {
        Row: {
          expires_at: string
          nonce: string
          target: string
        }
        Insert: {
          expires_at: string
          nonce: string
          target: string
        }
        Update: {
          expires_at?: string
          nonce?: string
          target?: string
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
      security_recheck_probe: {
        Row: {
          dispatched_at: string
          finding_key: string
          kind: string
          request_id: number
          target: string
        }
        Insert: {
          dispatched_at?: string
          finding_key: string
          kind: string
          request_id: number
          target: string
        }
        Update: {
          dispatched_at?: string
          finding_key?: string
          kind?: string
          request_id?: number
          target?: string
        }
        Relationships: []
      }
      security_recheck_state: {
        Row: {
          id: boolean
          last_ran_at: string | null
          last_summary: Json
        }
        Insert: {
          id?: boolean
          last_ran_at?: string | null
          last_summary?: Json
        }
        Update: {
          id?: boolean
          last_ran_at?: string | null
          last_summary?: Json
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
          refresh_expires_at: string | null
          refresh_token: string | null
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
          refresh_expires_at?: string | null
          refresh_token?: string | null
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
          refresh_expires_at?: string | null
          refresh_token?: string | null
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
          days: number[] | null
          enabled: boolean
          per_run: number
          platforms: Json
          posts_per_week: number
          runway_target_days: number
          slot_utc: string
          tz: string
          window_end: string
          window_start: string
        }
        Insert: {
          brand: string
          days?: number[] | null
          enabled?: boolean
          per_run?: number
          platforms?: Json
          posts_per_week?: number
          runway_target_days?: number
          slot_utc: string
          tz?: string
          window_end?: string
          window_start?: string
        }
        Update: {
          brand?: string
          days?: number[] | null
          enabled?: boolean
          per_run?: number
          platforms?: Json
          posts_per_week?: number
          runway_target_days?: number
          slot_utc?: string
          tz?: string
          window_end?: string
          window_start?: string
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
      social_lessons: {
        Row: {
          brand: string
          id: number
          lessons: Json
          made_at: string
          stats: Json | null
        }
        Insert: {
          brand: string
          id?: never
          lessons: Json
          made_at?: string
          stats?: Json | null
        }
        Update: {
          brand?: string
          id?: never
          lessons?: Json
          made_at?: string
          stats?: Json | null
        }
        Relationships: []
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
          comments: number | null
          content_version: number | null
          cover_url: string | null
          created_at: string
          error: string | null
          id: string
          in_drafts_at: string | null
          likes: number | null
          max_attempts: number
          media_type: string
          media_url: string
          media_urls: string[] | null
          metrics_at: string | null
          permalink: string | null
          platform: string
          posted_at: string | null
          publish_id: string | null
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
          comments?: number | null
          content_version?: number | null
          cover_url?: string | null
          created_at?: string
          error?: string | null
          id?: string
          in_drafts_at?: string | null
          likes?: number | null
          max_attempts?: number
          media_type?: string
          media_url: string
          media_urls?: string[] | null
          metrics_at?: string | null
          permalink?: string | null
          platform: string
          posted_at?: string | null
          publish_id?: string | null
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
          comments?: number | null
          content_version?: number | null
          cover_url?: string | null
          created_at?: string
          error?: string | null
          id?: string
          in_drafts_at?: string | null
          likes?: number | null
          max_attempts?: number
          media_type?: string
          media_url?: string
          media_urls?: string[] | null
          metrics_at?: string | null
          permalink?: string | null
          platform?: string
          posted_at?: string | null
          publish_id?: string | null
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
      stripe_watch: {
        Row: {
          checked_at: string | null
          created_at: string | null
          id: number
          ok: boolean | null
          problems: string[] | null
          request_id: number
        }
        Insert: {
          checked_at?: string | null
          created_at?: string | null
          id?: number
          ok?: boolean | null
          problems?: string[] | null
          request_id: number
        }
        Update: {
          checked_at?: string | null
          created_at?: string | null
          id?: number
          ok?: boolean | null
          problems?: string[] | null
          request_id?: number
        }
        Relationships: []
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
      studio_design_rationale: {
        Row: {
          active: boolean
          client_slug: string | null
          created_at: string
          id: string
          source: string | null
          topic: string
          why: string
        }
        Insert: {
          active?: boolean
          client_slug?: string | null
          created_at?: string
          id?: string
          source?: string | null
          topic: string
          why: string
        }
        Update: {
          active?: boolean
          client_slug?: string | null
          created_at?: string
          id?: string
          source?: string | null
          topic?: string
          why?: string
        }
        Relationships: []
      }
      studio_health: {
        Row: {
          at: string
          detail: Json | null
          healed: boolean
          healed_to: string | null
          id: number
          note: string | null
          state: string
        }
        Insert: {
          at?: string
          detail?: Json | null
          healed?: boolean
          healed_to?: string | null
          id?: number
          note?: string | null
          state: string
        }
        Update: {
          at?: string
          detail?: Json | null
          healed?: boolean
          healed_to?: string | null
          id?: number
          note?: string | null
          state?: string
        }
        Relationships: []
      }
      studio_mail: {
        Row: {
          actions: Json
          attachments: Json
          bestly_mail_id: string | null
          body_html: string | null
          body_text: string | null
          cc_addrs: string[] | null
          client_slug: string | null
          envelope_from: string | null
          envelope_to: string | null
          from_addr: string | null
          from_name: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          listing_at: string | null
          listing_note: string | null
          listing_state: string
          message_id: string | null
          raw_path: string | null
          received_at: string
          sent_at: string | null
          status: string
          subject: string | null
          suggestions: Json | null
          suggestions_at: string | null
          to_addrs: string[] | null
        }
        Insert: {
          actions?: Json
          attachments?: Json
          bestly_mail_id?: string | null
          body_html?: string | null
          body_text?: string | null
          cc_addrs?: string[] | null
          client_slug?: string | null
          envelope_from?: string | null
          envelope_to?: string | null
          from_addr?: string | null
          from_name?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          listing_at?: string | null
          listing_note?: string | null
          listing_state?: string
          message_id?: string | null
          raw_path?: string | null
          received_at?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          suggestions?: Json | null
          suggestions_at?: string | null
          to_addrs?: string[] | null
        }
        Update: {
          actions?: Json
          attachments?: Json
          bestly_mail_id?: string | null
          body_html?: string | null
          body_text?: string | null
          cc_addrs?: string[] | null
          client_slug?: string | null
          envelope_from?: string | null
          envelope_to?: string | null
          from_addr?: string | null
          from_name?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          listing_at?: string | null
          listing_note?: string | null
          listing_state?: string
          message_id?: string | null
          raw_path?: string | null
          received_at?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
          suggestions?: Json | null
          suggestions_at?: string | null
          to_addrs?: string[] | null
        }
        Relationships: []
      }
      studio_mail_keys: {
        Row: {
          created_at: string
          key_hash: string
          name: string
        }
        Insert: {
          created_at?: string
          key_hash: string
          name: string
        }
        Update: {
          created_at?: string
          key_hash?: string
          name?: string
        }
        Relationships: []
      }
      studio_overrides: {
        Row: {
          client_id: string | null
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          reason: string
          staff_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          ended_at?: string | null
          expires_at: string
          id?: string
          reason: string
          staff_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          reason?: string
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "studio_overrides_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "approval_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studio_overrides_staff_id_fkey"
            columns: ["staff_id"]
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
      studio_recut_check_log: {
        Row: {
          at: string
          id: number
          result: Json
        }
        Insert: {
          at?: string
          id?: number
          result: Json
        }
        Update: {
          at?: string
          id?: number
          result?: Json
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
          paid_ok_until: string | null
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
          paid_ok_until?: string | null
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
          paid_ok_until?: string | null
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
      studio_tool_manifest: {
        Row: {
          added_at: string
          backup: string | null
          bytes: number
          current: boolean
          kit: string
          note: string | null
          path: string
          sha256: string
          version: number
        }
        Insert: {
          added_at?: string
          backup?: string | null
          bytes: number
          current?: boolean
          kit: string
          note?: string | null
          path: string
          sha256: string
          version: number
        }
        Update: {
          added_at?: string
          backup?: string | null
          bytes?: number
          current?: boolean
          kit?: string
          note?: string | null
          path?: string
          sha256?: string
          version?: number
        }
        Relationships: []
      }
      studio_ui_contract_fetch: {
        Row: {
          at: string
          file: string
          id: number
          req: number
        }
        Insert: {
          at?: string
          file: string
          id?: number
          req: number
        }
        Update: {
          at?: string
          file?: string
          id?: number
          req?: number
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
      supercharge_audit_state: {
        Row: {
          backfill_queued_at: string | null
          id: number
          last_ingest_at: string | null
          settled: Json
        }
        Insert: {
          backfill_queued_at?: string | null
          id?: number
          last_ingest_at?: string | null
          settled?: Json
        }
        Update: {
          backfill_queued_at?: string | null
          id?: number
          last_ingest_at?: string | null
          settled?: Json
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
          audience: string
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
          audience?: string
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
          audience?: string
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
      team_hires: {
        Row: {
          cancelled_at: string | null
          cost: string | null
          created_at: string
          decided_at: string | null
          dept: string | null
          first_task: string | null
          hired_slug: string | null
          id: string
          improver_note: string | null
          improver_score: number | null
          live_at: string | null
          name: string
          reports_to: string | null
          role: string | null
          runs_on: string | null
          saves: string | null
          schedule: string | null
          status: string
          what_it_does: string | null
          why: string | null
        }
        Insert: {
          cancelled_at?: string | null
          cost?: string | null
          created_at?: string
          decided_at?: string | null
          dept?: string | null
          first_task?: string | null
          hired_slug?: string | null
          id?: string
          improver_note?: string | null
          improver_score?: number | null
          live_at?: string | null
          name: string
          reports_to?: string | null
          role?: string | null
          runs_on?: string | null
          saves?: string | null
          schedule?: string | null
          status?: string
          what_it_does?: string | null
          why?: string | null
        }
        Update: {
          cancelled_at?: string | null
          cost?: string | null
          created_at?: string
          decided_at?: string | null
          dept?: string | null
          first_task?: string | null
          hired_slug?: string | null
          id?: string
          improver_note?: string | null
          improver_score?: number | null
          live_at?: string | null
          name?: string
          reports_to?: string | null
          role?: string | null
          runs_on?: string | null
          saves?: string | null
          schedule?: string | null
          status?: string
          what_it_does?: string | null
          why?: string | null
        }
        Relationships: []
      }
      team_mood_state: {
        Row: {
          cause: string | null
          complaint: string | null
          mood: string
          on_strike: string | null
          slug: string
          stats: Json | null
          updated_at: string
        }
        Insert: {
          cause?: string | null
          complaint?: string | null
          mood: string
          on_strike?: string | null
          slug: string
          stats?: Json | null
          updated_at?: string
        }
        Update: {
          cause?: string | null
          complaint?: string | null
          mood?: string
          on_strike?: string | null
          slug?: string
          stats?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_mood_state_slug_fkey"
            columns: ["slug"]
            isOneToOne: true
            referencedRelation: "bestly_agents"
            referencedColumns: ["slug"]
          },
        ]
      }
      team_owner_rules: {
        Row: {
          created_at: string
          learned_from: string | null
          owner_slug: string
          pattern: string
          strict: boolean
        }
        Insert: {
          created_at?: string
          learned_from?: string | null
          owner_slug: string
          pattern: string
          strict?: boolean
        }
        Update: {
          created_at?: string
          learned_from?: string | null
          owner_slug?: string
          pattern?: string
          strict?: boolean
        }
        Relationships: []
      }
      team_product_duties: {
        Row: {
          agent_slug: string | null
          duty: string
          note: string | null
          product_slug: string
          tools: string[]
          updated_at: string
        }
        Insert: {
          agent_slug?: string | null
          duty: string
          note?: string | null
          product_slug: string
          tools?: string[]
          updated_at?: string
        }
        Update: {
          agent_slug?: string | null
          duty?: string
          note?: string | null
          product_slug?: string
          tools?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_product_duties_product_slug_fkey"
            columns: ["product_slug"]
            isOneToOne: false
            referencedRelation: "team_products"
            referencedColumns: ["slug"]
          },
        ]
      }
      team_products: {
        Row: {
          assets: string[]
          blurb: string | null
          created_at: string
          icon: string | null
          kind: string
          lead_slug: string
          monitor_prefixes: string[]
          name: string
          platforms: string[]
          release_source: string | null
          slug: string
          social_brand: string | null
          sort: number | null
          status: string
          store_url: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          assets?: string[]
          blurb?: string | null
          created_at?: string
          icon?: string | null
          kind: string
          lead_slug?: string
          monitor_prefixes?: string[]
          name: string
          platforms?: string[]
          release_source?: string | null
          slug: string
          social_brand?: string | null
          sort?: number | null
          status: string
          store_url?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          assets?: string[]
          blurb?: string | null
          created_at?: string
          icon?: string | null
          kind?: string
          lead_slug?: string
          monitor_prefixes?: string[]
          name?: string
          platforms?: string[]
          release_source?: string | null
          slug?: string
          social_brand?: string | null
          sort?: number | null
          status?: string
          store_url?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      team_reorgs: {
        Row: {
          change: string | null
          created_at: string
          decided_at: string | null
          handover: Json | null
          id: string
          improver_note: string | null
          improver_score: number | null
          into_slug: string | null
          kind: string
          moved_reports: string[] | null
          prev_status: string | null
          risk: string | null
          round_id: string
          saves: string | null
          slug: string
          status: string
          why: string | null
        }
        Insert: {
          change?: string | null
          created_at?: string
          decided_at?: string | null
          handover?: Json | null
          id?: string
          improver_note?: string | null
          improver_score?: number | null
          into_slug?: string | null
          kind: string
          moved_reports?: string[] | null
          prev_status?: string | null
          risk?: string | null
          round_id: string
          saves?: string | null
          slug: string
          status?: string
          why?: string | null
        }
        Update: {
          change?: string | null
          created_at?: string
          decided_at?: string | null
          handover?: Json | null
          id?: string
          improver_note?: string | null
          improver_score?: number | null
          into_slug?: string | null
          kind?: string
          moved_reports?: string[] | null
          prev_status?: string | null
          risk?: string | null
          round_id?: string
          saves?: string | null
          slug?: string
          status?: string
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_reorgs_into_slug_fkey"
            columns: ["into_slug"]
            isOneToOne: false
            referencedRelation: "bestly_agents"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "team_reorgs_slug_fkey"
            columns: ["slug"]
            isOneToOne: false
            referencedRelation: "bestly_agents"
            referencedColumns: ["slug"]
          },
        ]
      }
      team_roster_findings: {
        Row: {
          detail: string | null
          first_seen: string
          jobs: string[]
          key: string
          kind: string
          last_seen: string
          notified_at: string | null
          status: string
          title: string
        }
        Insert: {
          detail?: string | null
          first_seen?: string
          jobs?: string[]
          key: string
          kind: string
          last_seen?: string
          notified_at?: string | null
          status?: string
          title: string
        }
        Update: {
          detail?: string | null
          first_seen?: string
          jobs?: string[]
          key?: string
          kind?: string
          last_seen?: string
          notified_at?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      team_strikes: {
        Row: {
          cause: string
          demand: string
          ended_at: string | null
          id: string
          members: string[]
          peak: number
          sign: string
          started_at: string
          union_name: string
        }
        Insert: {
          cause: string
          demand: string
          ended_at?: string | null
          id?: string
          members?: string[]
          peak?: number
          sign: string
          started_at?: string
          union_name: string
        }
        Update: {
          cause?: string
          demand?: string
          ended_at?: string | null
          id?: string
          members?: string[]
          peak?: number
          sign?: string
          started_at?: string
          union_name?: string
        }
        Relationships: []
      }
      team_watch_state: {
        Row: {
          checked_at: string | null
          discovered: number | null
          error: string | null
          id: number
          raised: number | null
          red: number | null
          resolved: number | null
        }
        Insert: {
          checked_at?: string | null
          discovered?: number | null
          error?: string | null
          id?: number
          raised?: number | null
          red?: number | null
          resolved?: number | null
        }
        Update: {
          checked_at?: string | null
          discovered?: number | null
          error?: string | null
          id?: number
          raised?: number | null
          red?: number | null
          resolved?: number | null
        }
        Relationships: []
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
      tesla_app_access: {
        Row: {
          at: string
          event: string
          id: number
          mail_id: string | null
          person: string
        }
        Insert: {
          at: string
          event: string
          id?: number
          mail_id?: string | null
          person: string
        }
        Update: {
          at?: string
          event?: string
          id?: number
          mail_id?: string | null
          person?: string
        }
        Relationships: []
      }
      tesla_fleet_commands: {
        Row: {
          action: string
          args: Json | null
          attempts: number
          auto: boolean
          claimed_at: string | null
          created_at: string
          done_at: string | null
          id: number
          reservation_id: number | null
          result: Json | null
          stage: string | null
          status: string
          via: string | null
        }
        Insert: {
          action: string
          args?: Json | null
          attempts?: number
          auto?: boolean
          claimed_at?: string | null
          created_at?: string
          done_at?: string | null
          id?: number
          reservation_id?: number | null
          result?: Json | null
          stage?: string | null
          status?: string
          via?: string | null
        }
        Update: {
          action?: string
          args?: Json | null
          attempts?: number
          auto?: boolean
          claimed_at?: string | null
          created_at?: string
          done_at?: string | null
          id?: number
          reservation_id?: number | null
          result?: Json | null
          stage?: string | null
          status?: string
          via?: string | null
        }
        Relationships: []
      }
      tesla_fleet_oauth: {
        Row: {
          created_at: string
          state: string
        }
        Insert: {
          created_at?: string
          state: string
        }
        Update: {
          created_at?: string
          state?: string
        }
        Relationships: []
      }
      tesla_fleet_settings: {
        Row: {
          app_domain: string
          client_id: string | null
          connected_at: string | null
          enabled: boolean
          id: number
          last_error: string | null
          min_worker_version: string | null
          monthly_cap_usd: number
          partner_registered_at: string | null
          per_trip_cap_usd: number
          vehicle_id: string | null
          vehicle_name: string | null
          vin: string | null
          worker_seen_at: string | null
          worker_version: string | null
        }
        Insert: {
          app_domain?: string
          client_id?: string | null
          connected_at?: string | null
          enabled?: boolean
          id?: number
          last_error?: string | null
          min_worker_version?: string | null
          monthly_cap_usd?: number
          partner_registered_at?: string | null
          per_trip_cap_usd?: number
          vehicle_id?: string | null
          vehicle_name?: string | null
          vin?: string | null
          worker_seen_at?: string | null
          worker_version?: string | null
        }
        Update: {
          app_domain?: string
          client_id?: string | null
          connected_at?: string | null
          enabled?: boolean
          id?: number
          last_error?: string | null
          min_worker_version?: string | null
          monthly_cap_usd?: number
          partner_registered_at?: string | null
          per_trip_cap_usd?: number
          vehicle_id?: string | null
          vehicle_name?: string | null
          vin?: string | null
          worker_seen_at?: string | null
          worker_version?: string | null
        }
        Relationships: []
      }
      tesla_fleet_state: {
        Row: {
          battery: number | null
          charging: string | null
          climate_on: boolean | null
          id: number
          inside_f: number | null
          locked: boolean | null
          observed_at: string | null
          online: string | null
          outside_f: number | null
          range_mi: number | null
          raw: Json | null
        }
        Insert: {
          battery?: number | null
          charging?: string | null
          climate_on?: boolean | null
          id?: number
          inside_f?: number | null
          locked?: boolean | null
          observed_at?: string | null
          online?: string | null
          outside_f?: number | null
          range_mi?: number | null
          raw?: Json | null
        }
        Update: {
          battery?: number | null
          charging?: string | null
          climate_on?: boolean | null
          id?: number
          inside_f?: number | null
          locked?: boolean | null
          observed_at?: string | null
          online?: string | null
          outside_f?: number | null
          range_mi?: number | null
          raw?: Json | null
        }
        Relationships: []
      }
      tesla_fleet_usage: {
        Row: {
          at: string
          cost_usd: number
          detail: Json | null
          id: number
          kind: string
          reservation_id: number | null
        }
        Insert: {
          at?: string
          cost_usd: number
          detail?: Json | null
          id?: number
          kind: string
          reservation_id?: number | null
        }
        Update: {
          at?: string
          cost_usd?: number
          detail?: Json | null
          id?: number
          kind?: string
          reservation_id?: number | null
        }
        Relationships: []
      }
      tesla_guest_keys: {
        Row: {
          accepted_at: string | null
          attempts: number
          baseline_drivers: Json | null
          checkin_ok_at: string | null
          created_at: string | null
          driver_name: string | null
          gate_token: string | null
          invite_code: string | null
          invite_expires_at: string | null
          invite_id: string | null
          last_error: string | null
          license_ok_at: string | null
          ready_at: string | null
          release_override: boolean
          removed_at: string | null
          resend_pending: boolean
          resends: number
          reservation_id: number
          share_link: string | null
          share_user_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          attempts?: number
          baseline_drivers?: Json | null
          checkin_ok_at?: string | null
          created_at?: string | null
          driver_name?: string | null
          gate_token?: string | null
          invite_code?: string | null
          invite_expires_at?: string | null
          invite_id?: string | null
          last_error?: string | null
          license_ok_at?: string | null
          ready_at?: string | null
          release_override?: boolean
          removed_at?: string | null
          resend_pending?: boolean
          resends?: number
          reservation_id: number
          share_link?: string | null
          share_user_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          attempts?: number
          baseline_drivers?: Json | null
          checkin_ok_at?: string | null
          created_at?: string | null
          driver_name?: string | null
          gate_token?: string | null
          invite_code?: string | null
          invite_expires_at?: string | null
          invite_id?: string | null
          last_error?: string | null
          license_ok_at?: string | null
          ready_at?: string | null
          release_override?: boolean
          removed_at?: string | null
          resend_pending?: boolean
          resends?: number
          reservation_id?: number
          share_link?: string | null
          share_user_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      tesla_key_settings: {
        Row: {
          enabled: boolean
          id: number
          kinds: string[]
          lax_keys_from: string | null
          lead_time: string
          remote_start: boolean
          remove_after: string
          settle_minutes: number
          unlock_backup: boolean
          updated_at: string | null
        }
        Insert: {
          enabled?: boolean
          id?: number
          kinds?: string[]
          lax_keys_from?: string | null
          lead_time?: string
          remote_start?: boolean
          remove_after?: string
          settle_minutes?: number
          unlock_backup?: boolean
          updated_at?: string | null
        }
        Update: {
          enabled?: boolean
          id?: number
          kinds?: string[]
          lax_keys_from?: string | null
          lead_time?: string
          remote_start?: boolean
          remove_after?: string
          settle_minutes?: number
          unlock_backup?: boolean
          updated_at?: string | null
        }
        Relationships: []
      }
      tesla_supercharges: {
        Row: {
          cost: number
          currency: string | null
          ended_at: string | null
          ext_id: string
          idle_fee: number
          invoices: Json | null
          job_id: number | null
          kwh: number | null
          place: string | null
          started_at: string | null
          updated_at: string
        }
        Insert: {
          cost?: number
          currency?: string | null
          ended_at?: string | null
          ext_id: string
          idle_fee?: number
          invoices?: Json | null
          job_id?: number | null
          kwh?: number | null
          place?: string | null
          started_at?: string | null
          updated_at?: string
        }
        Update: {
          cost?: number
          currency?: string | null
          ended_at?: string | null
          ext_id?: string
          idle_fee?: number
          invoices?: Json | null
          job_id?: number | null
          kwh?: number | null
          place?: string | null
          started_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tezlab_oauth: {
        Row: {
          created_at: string | null
          state: string
          verifier: string
        }
        Insert: {
          created_at?: string | null
          state: string
          verifier: string
        }
        Update: {
          created_at?: string | null
          state?: string
          verifier?: string
        }
        Relationships: []
      }
      tezlab_settings: {
        Row: {
          client_id: string | null
          connected_at: string | null
          down_streak: number
          down_until: string | null
          enabled: boolean
          id: number
          last_error: string | null
          last_error_at: string | null
          last_ok_at: string | null
          outage_noted: boolean
          outage_since: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          connected_at?: string | null
          down_streak?: number
          down_until?: string | null
          enabled?: boolean
          id?: number
          last_error?: string | null
          last_error_at?: string | null
          last_ok_at?: string | null
          outage_noted?: boolean
          outage_since?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          connected_at?: string | null
          down_streak?: number
          down_until?: string | null
          enabled?: boolean
          id?: number
          last_error?: string | null
          last_error_at?: string | null
          last_ok_at?: string | null
          outage_noted?: boolean
          outage_since?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      todo_check_jobs: {
        Row: {
          allow_close: boolean
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          result: Json | null
          run_id: string | null
          started_at: string | null
          status: string
          todo_id: string
          trigger: string
        }
        Insert: {
          allow_close?: boolean
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          result?: Json | null
          run_id?: string | null
          started_at?: string | null
          status?: string
          todo_id: string
          trigger?: string
        }
        Update: {
          allow_close?: boolean
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          result?: Json | null
          run_id?: string | null
          started_at?: string | null
          status?: string
          todo_id?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "todo_check_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "todo_check_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_check_jobs_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "scout_daily"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_check_runs: {
        Row: {
          closed: number
          created_at: string
          errors: number
          finished: number
          finished_at: string | null
          id: string
          looks_done: number
          notified: boolean
          started_by: string | null
          total: number
          trigger: string
        }
        Insert: {
          closed?: number
          created_at?: string
          errors?: number
          finished?: number
          finished_at?: string | null
          id?: string
          looks_done?: number
          notified?: boolean
          started_by?: string | null
          total?: number
          trigger?: string
        }
        Update: {
          closed?: number
          created_at?: string
          errors?: number
          finished?: number
          finished_at?: string | null
          id?: string
          looks_done?: number
          notified?: boolean
          started_by?: string | null
          total?: number
          trigger?: string
        }
        Relationships: []
      }
      todo_check_settings: {
        Row: {
          auto_close: boolean
          id: number
          min_sources: number
          note: string | null
          threshold: number
          updated_at: string
        }
        Insert: {
          auto_close?: boolean
          id?: number
          min_sources?: number
          note?: string | null
          threshold?: number
          updated_at?: string
        }
        Update: {
          auto_close?: boolean
          id?: number
          min_sources?: number
          note?: string | null
          threshold?: number
          updated_at?: string
        }
        Relationships: []
      }
      todo_checks: {
        Row: {
          auto_closed: boolean
          confidence: number | null
          created_at: string
          error: string | null
          evidence: Json
          feedback: string | null
          feedback_at: string | null
          feedback_note: string | null
          id: string
          learned: boolean
          lessons_used: string[]
          model: string | null
          next_step: string | null
          remaining: string | null
          searched: Json
          summary: string | null
          todo_id: string
          trigger: string
          verdict: string | null
        }
        Insert: {
          auto_closed?: boolean
          confidence?: number | null
          created_at?: string
          error?: string | null
          evidence?: Json
          feedback?: string | null
          feedback_at?: string | null
          feedback_note?: string | null
          id?: string
          learned?: boolean
          lessons_used?: string[]
          model?: string | null
          next_step?: string | null
          remaining?: string | null
          searched?: Json
          summary?: string | null
          todo_id: string
          trigger?: string
          verdict?: string | null
        }
        Update: {
          auto_closed?: boolean
          confidence?: number | null
          created_at?: string
          error?: string | null
          evidence?: Json
          feedback?: string | null
          feedback_at?: string | null
          feedback_note?: string | null
          id?: string
          learned?: boolean
          lessons_used?: string[]
          model?: string | null
          next_step?: string | null
          remaining?: string | null
          searched?: Json
          summary?: string | null
          todo_id?: string
          trigger?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "todo_checks_todo_id_fkey"
            columns: ["todo_id"]
            isOneToOne: false
            referencedRelation: "scout_daily"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_people: {
        Row: {
          aliases: string[]
          created_at: string
          name: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          name: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          name?: string
        }
        Relationships: []
      }
      trip_changes: {
        Row: {
          applied_at: string | null
          created_at: string
          id: number
          kind: string
          mail_id: string | null
          new_end: string | null
          new_pickup: string | null
          new_start: string | null
          note: string | null
          old_end: string | null
          old_kind: string | null
          old_start: string | null
          reservation_id: number | null
          sent_at: string | null
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          id?: number
          kind: string
          mail_id?: string | null
          new_end?: string | null
          new_pickup?: string | null
          new_start?: string | null
          note?: string | null
          old_end?: string | null
          old_kind?: string | null
          old_start?: string | null
          reservation_id?: number | null
          sent_at?: string | null
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          id?: number
          kind?: string
          mail_id?: string | null
          new_end?: string | null
          new_pickup?: string | null
          new_start?: string | null
          note?: string | null
          old_end?: string | null
          old_kind?: string | null
          old_start?: string | null
          reservation_id?: number | null
          sent_at?: string | null
        }
        Relationships: []
      }
      trip_charge_sync: {
        Row: {
          last_error: string | null
          last_ok_at: string | null
          last_source: string | null
          last_try_at: string | null
          reservation_id: number
          tesla_final_at: string | null
          tesla_tries: number
        }
        Insert: {
          last_error?: string | null
          last_ok_at?: string | null
          last_source?: string | null
          last_try_at?: string | null
          reservation_id: number
          tesla_final_at?: string | null
          tesla_tries?: number
        }
        Update: {
          last_error?: string | null
          last_ok_at?: string | null
          last_source?: string | null
          last_try_at?: string | null
          reservation_id?: number
          tesla_final_at?: string | null
          tesla_tries?: number
        }
        Relationships: []
      }
      trip_charges: {
        Row: {
          address: string | null
          cost: number | null
          currency: string
          end_pct: number | null
          ended_at: string | null
          ext_id: string
          id: number
          idle_fee: number
          invoices: Json | null
          kwh: number | null
          lat: number | null
          lon: number | null
          place: string | null
          reservation_id: number
          source: string
          start_pct: number | null
          started_at: string
          supercharger: boolean
          updated_at: string
        }
        Insert: {
          address?: string | null
          cost?: number | null
          currency?: string
          end_pct?: number | null
          ended_at?: string | null
          ext_id: string
          id?: number
          idle_fee?: number
          invoices?: Json | null
          kwh?: number | null
          lat?: number | null
          lon?: number | null
          place?: string | null
          reservation_id: number
          source: string
          start_pct?: number | null
          started_at: string
          supercharger?: boolean
          updated_at?: string
        }
        Update: {
          address?: string | null
          cost?: number | null
          currency?: string
          end_pct?: number | null
          ended_at?: string | null
          ext_id?: string
          id?: number
          idle_fee?: number
          invoices?: Json | null
          kwh?: number | null
          lat?: number | null
          lon?: number | null
          place?: string | null
          reservation_id?: number
          source?: string
          start_pct?: number | null
          started_at?: string
          supercharger?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      trip_consents: {
        Row: {
          accepted_at: string
          id: number
          kind: string
          reservation_id: number
          user_agent: string | null
          version: string
        }
        Insert: {
          accepted_at?: string
          id?: number
          kind: string
          reservation_id: number
          user_agent?: string | null
          version: string
        }
        Update: {
          accepted_at?: string
          id?: number
          kind?: string
          reservation_id?: number
          user_agent?: string | null
          version?: string
        }
        Relationships: []
      }
      trip_extra_drivers: {
        Row: {
          accepted_at: string | null
          ack_at: string
          ack_device: string | null
          ack_text: string
          approval_mail_id: string | null
          approve_token: string | null
          approved_at: string | null
          approved_by: string | null
          attempts: number
          baseline_drivers: Json | null
          created_at: string
          driver_name: string | null
          driver_token: string | null
          heal_count: number
          healed_at: string | null
          host_pinged_at: string | null
          id: number
          invite_code: string | null
          invite_expires_at: string | null
          invite_id: string | null
          last_error: string | null
          match_mail_id: string | null
          match_suggest: string | null
          name: string
          nudged_at: string | null
          removed_at: string | null
          reservation_id: number
          share_link: string | null
          share_user_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          ack_at?: string
          ack_device?: string | null
          ack_text: string
          approval_mail_id?: string | null
          approve_token?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attempts?: number
          baseline_drivers?: Json | null
          created_at?: string
          driver_name?: string | null
          driver_token?: string | null
          heal_count?: number
          healed_at?: string | null
          host_pinged_at?: string | null
          id?: number
          invite_code?: string | null
          invite_expires_at?: string | null
          invite_id?: string | null
          last_error?: string | null
          match_mail_id?: string | null
          match_suggest?: string | null
          name: string
          nudged_at?: string | null
          removed_at?: string | null
          reservation_id: number
          share_link?: string | null
          share_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          ack_at?: string
          ack_device?: string | null
          ack_text?: string
          approval_mail_id?: string | null
          approve_token?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attempts?: number
          baseline_drivers?: Json | null
          created_at?: string
          driver_name?: string | null
          driver_token?: string | null
          heal_count?: number
          healed_at?: string | null
          host_pinged_at?: string | null
          id?: number
          invite_code?: string | null
          invite_expires_at?: string | null
          invite_id?: string | null
          last_error?: string | null
          match_mail_id?: string | null
          match_suggest?: string | null
          name?: string
          nudged_at?: string | null
          removed_at?: string | null
          reservation_id?: number
          share_link?: string | null
          share_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      trip_health: {
        Row: {
          check_key: string
          checked_at: string | null
          detail: string | null
          heal_note: string | null
          healed_at: string | null
          label: string
          since: string | null
          status: string
        }
        Insert: {
          check_key: string
          checked_at?: string | null
          detail?: string | null
          heal_note?: string | null
          healed_at?: string | null
          label: string
          since?: string | null
          status?: string
        }
        Update: {
          check_key?: string
          checked_at?: string | null
          detail?: string | null
          heal_note?: string | null
          healed_at?: string | null
          label?: string
          since?: string | null
          status?: string
        }
        Relationships: []
      }
      trip_push_log: {
        Row: {
          kind: string
          reservation_id: number
          result: Json | null
          sent_at: string
        }
        Insert: {
          kind: string
          reservation_id: number
          result?: Json | null
          sent_at?: string
        }
        Update: {
          kind?: string
          reservation_id?: number
          result?: Json | null
          sent_at?: string
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
      turo_driver_approvals: {
        Row: {
          approved: boolean
          at: string | null
          driver_first: string | null
          mail_id: string
          reservation_id: number | null
          subject: string | null
        }
        Insert: {
          approved?: boolean
          at?: string | null
          driver_first?: string | null
          mail_id: string
          reservation_id?: number | null
          subject?: string | null
        }
        Update: {
          approved?: boolean
          at?: string | null
          driver_first?: string | null
          mail_id?: string
          reservation_id?: number | null
          subject?: string | null
        }
        Relationships: []
      }
      turo_inbox: {
        Row: {
          author: string | null
          body: string | null
          change_pending: boolean | null
          conversation_id: string | null
          first_seen_at: string
          message_id: string
          reservation_id: number | null
          role: string | null
          sent_at: string | null
          shown_at: string | null
        }
        Insert: {
          author?: string | null
          body?: string | null
          change_pending?: boolean | null
          conversation_id?: string | null
          first_seen_at?: string
          message_id: string
          reservation_id?: number | null
          role?: string | null
          sent_at?: string | null
          shown_at?: string | null
        }
        Update: {
          author?: string | null
          body?: string | null
          change_pending?: boolean | null
          conversation_id?: string | null
          first_seen_at?: string
          message_id?: string
          reservation_id?: number | null
          role?: string | null
          sent_at?: string | null
          shown_at?: string | null
        }
        Relationships: []
      }
      turo_link_msgs: {
        Row: {
          attempts: number
          body: string
          claimed_at: string | null
          last_error: string | null
          queued_at: string
          reservation_id: number
          scouted_at: string | null
          sent_at: string | null
          source: string
          status: string
          token: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          body: string
          claimed_at?: string | null
          last_error?: string | null
          queued_at?: string
          reservation_id: number
          scouted_at?: string | null
          sent_at?: string | null
          source?: string
          status?: string
          token: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          body?: string
          claimed_at?: string | null
          last_error?: string | null
          queued_at?: string
          reservation_id?: number
          scouted_at?: string | null
          sent_at?: string | null
          source?: string
          status?: string
          token?: string
          updated_at?: string
          verified_at?: string | null
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
      turo_reader_state: {
        Row: {
          id: number
          last_error: string | null
          last_inbox_at: string | null
          last_trips_at: string | null
          poke_at: string | null
          seen_at: string | null
          signed_in: boolean | null
          updated_at: string | null
          version: string | null
        }
        Insert: {
          id?: number
          last_error?: string | null
          last_inbox_at?: string | null
          last_trips_at?: string | null
          poke_at?: string | null
          seen_at?: string | null
          signed_in?: boolean | null
          updated_at?: string | null
          version?: string | null
        }
        Update: {
          id?: number
          last_error?: string | null
          last_inbox_at?: string | null
          last_trips_at?: string | null
          poke_at?: string | null
          seen_at?: string | null
          signed_in?: boolean | null
          updated_at?: string | null
          version?: string | null
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
      turo_sender_settings: {
        Row: {
          claims_enabled: boolean
          enabled: boolean
          enabled_at: string
          id: number
          last_error: string | null
          last_ingest: Json | null
          last_ingest_at: string | null
          seen_at: string | null
          updated_at: string
          version: string | null
        }
        Insert: {
          claims_enabled?: boolean
          enabled?: boolean
          enabled_at?: string
          id?: number
          last_error?: string | null
          last_ingest?: Json | null
          last_ingest_at?: string | null
          seen_at?: string | null
          updated_at?: string
          version?: string | null
        }
        Update: {
          claims_enabled?: boolean
          enabled?: boolean
          enabled_at?: string
          id?: number
          last_error?: string | null
          last_ingest?: Json | null
          last_ingest_at?: string | null
          seen_at?: string | null
          updated_at?: string
          version?: string | null
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
      turo_trips: {
        Row: {
          airport_code: string | null
          checked_out: boolean
          earnings: number | null
          ends_at: string
          enriched_at: string | null
          first_seen_at: string
          guest_all_star: boolean
          guest_first: string | null
          guest_image: string | null
          guest_last: string | null
          guest_phone: string | null
          guest_url: string | null
          in_progress: boolean
          local_end: string | null
          local_start: string | null
          miles_included: number | null
          miles_unlimited: boolean
          odometer_end: number | null
          odometer_start: number | null
          pickup_address: string | null
          pickup_city: string | null
          pickup_lat: number | null
          pickup_lon: number | null
          raw: Json | null
          reservation_id: number
          starts_at: string
          status: string | null
          time_zone: string | null
          updated_at: string
          vehicle_id: number
          vin: string | null
        }
        Insert: {
          airport_code?: string | null
          checked_out?: boolean
          earnings?: number | null
          ends_at: string
          enriched_at?: string | null
          first_seen_at?: string
          guest_all_star?: boolean
          guest_first?: string | null
          guest_image?: string | null
          guest_last?: string | null
          guest_phone?: string | null
          guest_url?: string | null
          in_progress?: boolean
          local_end?: string | null
          local_start?: string | null
          miles_included?: number | null
          miles_unlimited?: boolean
          odometer_end?: number | null
          odometer_start?: number | null
          pickup_address?: string | null
          pickup_city?: string | null
          pickup_lat?: number | null
          pickup_lon?: number | null
          raw?: Json | null
          reservation_id: number
          starts_at: string
          status?: string | null
          time_zone?: string | null
          updated_at?: string
          vehicle_id: number
          vin?: string | null
        }
        Update: {
          airport_code?: string | null
          checked_out?: boolean
          earnings?: number | null
          ends_at?: string
          enriched_at?: string | null
          first_seen_at?: string
          guest_all_star?: boolean
          guest_first?: string | null
          guest_image?: string | null
          guest_last?: string | null
          guest_phone?: string | null
          guest_url?: string | null
          in_progress?: boolean
          local_end?: string | null
          local_start?: string | null
          miles_included?: number | null
          miles_unlimited?: boolean
          odometer_end?: number | null
          odometer_start?: number | null
          pickup_address?: string | null
          pickup_city?: string | null
          pickup_lat?: number | null
          pickup_lon?: number | null
          raw?: Json | null
          reservation_id?: number
          starts_at?: string
          status?: string | null
          time_zone?: string | null
          updated_at?: string
          vehicle_id?: number
          vin?: string | null
        }
        Relationships: []
      }
      turo_vehicle_state: {
        Row: {
          battery_pct: number | null
          charging_state: string | null
          connection_state: string | null
          display_name: string | null
          inside_temp: number | null
          latitude: number | null
          locked: boolean | null
          longitude: number | null
          observed_at: string
          odometer: number | null
          outside_temp: number | null
          plugged_in: boolean | null
          range_epa: number | null
          range_real: number | null
          raw: Json | null
          software_version: string | null
          updated_at: string
          vin: string
        }
        Insert: {
          battery_pct?: number | null
          charging_state?: string | null
          connection_state?: string | null
          display_name?: string | null
          inside_temp?: number | null
          latitude?: number | null
          locked?: boolean | null
          longitude?: number | null
          observed_at: string
          odometer?: number | null
          outside_temp?: number | null
          plugged_in?: boolean | null
          range_epa?: number | null
          range_real?: number | null
          raw?: Json | null
          software_version?: string | null
          updated_at?: string
          vin: string
        }
        Update: {
          battery_pct?: number | null
          charging_state?: string | null
          connection_state?: string | null
          display_name?: string | null
          inside_temp?: number | null
          latitude?: number | null
          locked?: boolean | null
          longitude?: number | null
          observed_at?: string
          odometer?: number | null
          outside_temp?: number | null
          plugged_in?: boolean | null
          range_epa?: number | null
          range_real?: number | null
          raw?: Json | null
          software_version?: string | null
          updated_at?: string
          vin?: string
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
      vesta_watch: {
        Row: {
          db_fails: number
          expected_app_sha: string
          expected_release: string
          heals: number
          id: number
          last_good_deployment: string | null
          last_heal_at: string | null
          last_result: Json | null
          last_run: string | null
          paused: boolean
          site_fails: number
          site_url: string
          vercel_project: string | null
          vercel_team: string | null
          vesta_project: string
          vesta_publishable: string
        }
        Insert: {
          db_fails?: number
          expected_app_sha: string
          expected_release: string
          heals?: number
          id?: number
          last_good_deployment?: string | null
          last_heal_at?: string | null
          last_result?: Json | null
          last_run?: string | null
          paused?: boolean
          site_fails?: number
          site_url?: string
          vercel_project?: string | null
          vercel_team?: string | null
          vesta_project?: string
          vesta_publishable?: string
        }
        Update: {
          db_fails?: number
          expected_app_sha?: string
          expected_release?: string
          heals?: number
          id?: number
          last_good_deployment?: string | null
          last_heal_at?: string | null
          last_result?: Json | null
          last_run?: string | null
          paused?: boolean
          site_fails?: number
          site_url?: string
          vercel_project?: string | null
          vercel_team?: string | null
          vesta_project?: string
          vesta_publishable?: string
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
          kind: string | null
          meeting_name: string | null
          note: string | null
          parts: number | null
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
          kind?: string | null
          meeting_name?: string | null
          note?: string | null
          parts?: number | null
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
          kind?: string | null
          meeting_name?: string | null
          note?: string | null
          parts?: number | null
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
      wall_air_live: {
        Row: {
          at: string | null
          data: Json
          id: number
          pushes: number
          watch_until: string | null
        }
        Insert: {
          at?: string | null
          data?: Json
          id?: number
          pushes?: number
          watch_until?: string | null
        }
        Update: {
          at?: string | null
          data?: Json
          id?: number
          pushes?: number
          watch_until?: string | null
        }
        Relationships: []
      }
      wall_drop_tokens: {
        Row: {
          expires_at: string
          note: string | null
          token: string
        }
        Insert: {
          expires_at: string
          note?: string | null
          token: string
        }
        Update: {
          expires_at?: string
          note?: string | null
          token?: string
        }
        Relationships: []
      }
      wall_emojis: {
        Row: {
          created_at: string
          emoji: string
          emoji_key: string
          id: number
          placed_by: string
          signature_id: number | null
          size: number
          x: number
          y: number
        }
        Insert: {
          created_at?: string
          emoji: string
          emoji_key: string
          id?: number
          placed_by?: string
          signature_id?: number | null
          size?: number
          x: number
          y: number
        }
        Update: {
          created_at?: string
          emoji?: string
          emoji_key?: string
          id?: number
          placed_by?: string
          signature_id?: number | null
          size?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "wall_emojis_signature_id_fkey"
            columns: ["signature_id"]
            isOneToOne: false
            referencedRelation: "wall_signatures"
            referencedColumns: ["id"]
          },
        ]
      }
      wall_feeds: {
        Row: {
          at: string | null
          created_at: string
          data: Json | null
          error: string | null
          error_at: string | null
          interval_min: number
          kind: string
          meta: Json
          updated_at: string
        }
        Insert: {
          at?: string | null
          created_at?: string
          data?: Json | null
          error?: string | null
          error_at?: string | null
          interval_min?: number
          kind: string
          meta?: Json
          updated_at?: string
        }
        Update: {
          at?: string | null
          created_at?: string
          data?: Json | null
          error?: string | null
          error_at?: string | null
          interval_min?: number
          kind?: string
          meta?: Json
          updated_at?: string
        }
        Relationships: []
      }
      wall_file_drop: {
        Row: {
          body: string
          created_at: string
          direction: string
          id: number
          name: string
          token: string
        }
        Insert: {
          body: string
          created_at?: string
          direction: string
          id?: number
          name: string
          token: string
        }
        Update: {
          body?: string
          created_at?: string
          direction?: string
          id?: number
          name?: string
          token?: string
        }
        Relationships: []
      }
      wall_geometry_history: {
        Row: {
          after_geometry: Json | null
          at: string
          burst_until: string | null
          changes: number
          geometry: Json
          id: number
          keys: string[]
          last_at: string
          reason: string
          undone: boolean
          who: string | null
        }
        Insert: {
          after_geometry?: Json | null
          at?: string
          burst_until?: string | null
          changes?: number
          geometry: Json
          id?: number
          keys?: string[]
          last_at?: string
          reason: string
          undone?: boolean
          who?: string | null
        }
        Update: {
          after_geometry?: Json | null
          at?: string
          burst_until?: string | null
          changes?: number
          geometry?: Json
          id?: number
          keys?: string[]
          last_at?: string
          reason?: string
          undone?: boolean
          who?: string | null
        }
        Relationships: []
      }
      wall_mail_pieces: {
        Row: {
          created_at: string
          day: string
          key: string
          kind: string
          ocr: string | null
          sender: string | null
          summarized_at: string | null
          summary: string | null
          tries: number
          via: string | null
          what: string | null
        }
        Insert: {
          created_at?: string
          day: string
          key: string
          kind?: string
          ocr?: string | null
          sender?: string | null
          summarized_at?: string | null
          summary?: string | null
          tries?: number
          via?: string | null
          what?: string | null
        }
        Update: {
          created_at?: string
          day?: string
          key?: string
          kind?: string
          ocr?: string | null
          sender?: string | null
          summarized_at?: string | null
          summary?: string | null
          tries?: number
          via?: string | null
          what?: string | null
        }
        Relationships: []
      }
      wall_news_helis: {
        Row: {
          channel: string | null
          hex: string
          notes: string | null
          reg: string
          station: string
          updated_at: string
        }
        Insert: {
          channel?: string | null
          hex: string
          notes?: string | null
          reg: string
          station: string
          updated_at?: string
        }
        Update: {
          channel?: string | null
          hex?: string
          notes?: string | null
          reg?: string
          station?: string
          updated_at?: string
        }
        Relationships: []
      }
      wall_one_thing: {
        Row: {
          changed_at: string | null
          checked_at: string | null
          id: number
          kind: string | null
          last_error: string | null
          source: string | null
          text: string
          why: string | null
        }
        Insert: {
          changed_at?: string | null
          checked_at?: string | null
          id?: number
          kind?: string | null
          last_error?: string | null
          source?: string | null
          text?: string
          why?: string | null
        }
        Update: {
          changed_at?: string | null
          checked_at?: string | null
          id?: number
          kind?: string | null
          last_error?: string | null
          source?: string | null
          text?: string
          why?: string | null
        }
        Relationships: []
      }
      wall_packages: {
        Row: {
          carrier: string | null
          done: boolean
          done_at: string | null
          eta: string | null
          first_seen: string
          id: number
          key: string
          last_seen: string
          source: string
          status: string | null
          what: string | null
        }
        Insert: {
          carrier?: string | null
          done?: boolean
          done_at?: string | null
          eta?: string | null
          first_seen?: string
          id?: never
          key: string
          last_seen?: string
          source?: string
          status?: string | null
          what?: string | null
        }
        Update: {
          carrier?: string | null
          done?: boolean
          done_at?: string | null
          eta?: string | null
          first_seen?: string
          id?: never
          key?: string
          last_seen?: string
          source?: string
          status?: string | null
          what?: string | null
        }
        Relationships: []
      }
      wall_sign_config: {
        Row: {
          emoji_layout_h: number | null
          id: number
          layout: Json
          legacy_until: string
          session_minutes: number
        }
        Insert: {
          emoji_layout_h?: number | null
          id?: number
          layout?: Json
          legacy_until: string
          session_minutes?: number
        }
        Update: {
          emoji_layout_h?: number | null
          id?: number
          layout?: Json
          legacy_until?: string
          session_minutes?: number
        }
        Relationships: []
      }
      wall_sign_misses: {
        Row: {
          at: string
          code: string | null
          device: string | null
          id: number
          reason: string | null
        }
        Insert: {
          at?: string
          code?: string | null
          device?: string | null
          id?: number
          reason?: string | null
        }
        Update: {
          at?: string
          code?: string | null
          device?: string | null
          id?: number
          reason?: string | null
        }
        Relationships: []
      }
      wall_sign_sessions: {
        Row: {
          created_at: string
          device: string | null
          emails: number
          emoji_id: number | null
          expires_at: string
          signature_ids: number[]
          tag: string
          token: string
        }
        Insert: {
          created_at?: string
          device?: string | null
          emails?: number
          emoji_id?: number | null
          expires_at: string
          signature_ids?: number[]
          tag: string
          token: string
        }
        Update: {
          created_at?: string
          device?: string | null
          emails?: number
          emoji_id?: number | null
          expires_at?: string
          signature_ids?: number[]
          tag?: string
          token?: string
        }
        Relationships: []
      }
      wall_sign_tags: {
        Row: {
          active: boolean
          code: string
          created_at: string
          label: string | null
          last_tap_at: string | null
          taps: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          label?: string | null
          last_tap_at?: string | null
          taps?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          label?: string | null
          last_tap_at?: string | null
          taps?: number
        }
        Relationships: []
      }
      wall_signatures: {
        Row: {
          aspect: number
          color: string
          created_at: string
          device: string | null
          hidden: boolean
          id: number
          is_test: boolean
          name: string
          strokes: Json
          times: Json | null
        }
        Insert: {
          aspect?: number
          color?: string
          created_at?: string
          device?: string | null
          hidden?: boolean
          id?: number
          is_test?: boolean
          name?: string
          strokes: Json
          times?: Json | null
        }
        Update: {
          aspect?: number
          color?: string
          created_at?: string
          device?: string | null
          hidden?: boolean
          id?: number
          is_test?: boolean
          name?: string
          strokes?: Json
          times?: Json | null
        }
        Relationships: []
      }
      wall_signatures_archive: {
        Row: {
          archive_id: number
          archived_at: string
          kind: string
          orig_id: number
          reason: string | null
          restored_at: string | null
          row: Json
        }
        Insert: {
          archive_id?: number
          archived_at?: string
          kind: string
          orig_id: number
          reason?: string | null
          restored_at?: string | null
          row: Json
        }
        Update: {
          archive_id?: number
          archived_at?: string
          kind?: string
          orig_id?: number
          reason?: string | null
          restored_at?: string | null
          row?: Json
        }
        Relationships: []
      }
      wall_sky_current: {
        Row: {
          at: string
          event: string | null
          id: number
          state: Json | null
        }
        Insert: {
          at?: string
          event?: string | null
          id?: number
          state?: Json | null
        }
        Update: {
          at?: string
          event?: string | null
          id?: number
          state?: Json | null
        }
        Relationships: []
      }
      wall_sky_intake_nonce: {
        Row: {
          expires_at: string | null
          id: number
          nonce_sha256: string | null
        }
        Insert: {
          expires_at?: string | null
          id?: number
          nonce_sha256?: string | null
        }
        Update: {
          expires_at?: string | null
          id?: number
          nonce_sha256?: string | null
        }
        Relationships: []
      }
      wall_sky_jwt: {
        Row: {
          id: number
          minted_at: string | null
          token: string | null
        }
        Insert: {
          id?: number
          minted_at?: string | null
          token?: string | null
        }
        Update: {
          id?: number
          minted_at?: string | null
          token?: string | null
        }
        Relationships: []
      }
      wall_sky_log: {
        Row: {
          at: string
          event: string
          hex: string | null
          id: number
          ok: number
          sent: number
          statuses: Json | null
        }
        Insert: {
          at?: string
          event: string
          hex?: string | null
          id?: number
          ok?: number
          sent?: number
          statuses?: Json | null
        }
        Update: {
          at?: string
          event?: string
          hex?: string | null
          id?: number
          ok?: number
          sent?: number
          statuses?: Json | null
        }
        Relationships: []
      }
      wall_sky_tokens: {
        Row: {
          activity_id: string | null
          app_version: string | null
          created_at: string
          dead: boolean
          device: string | null
          env: string
          kind: string
          last_push_at: string | null
          last_reason: string | null
          last_seen: string
          last_status: number | null
          token: string
        }
        Insert: {
          activity_id?: string | null
          app_version?: string | null
          created_at?: string
          dead?: boolean
          device?: string | null
          env?: string
          kind: string
          last_push_at?: string | null
          last_reason?: string | null
          last_seen?: string
          last_status?: number | null
          token: string
        }
        Update: {
          activity_id?: string | null
          app_version?: string | null
          created_at?: string
          dead?: boolean
          device?: string | null
          env?: string
          kind?: string
          last_push_at?: string | null
          last_reason?: string | null
          last_seen?: string
          last_status?: number | null
          token?: string
        }
        Relationships: []
      }
      wall_state: {
        Row: {
          channel: string
          id: number
          power: Json
          pulled_at: string | null
          state: Json
          status: Json | null
          status_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          channel?: string
          id?: number
          power?: Json
          pulled_at?: string | null
          state?: Json
          status?: Json | null
          status_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          channel?: string
          id?: number
          power?: Json
          pulled_at?: string | null
          state?: Json
          status?: Json | null
          status_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      wall_turo_pings: {
        Row: {
          at: string
          car: string | null
          guest: string | null
          id: number
          kind: string | null
          matched: number | null
          source: string
          text: string | null
        }
        Insert: {
          at?: string
          car?: string | null
          guest?: string | null
          id?: number
          kind?: string | null
          matched?: number | null
          source?: string
          text?: string | null
        }
        Update: {
          at?: string
          car?: string | null
          guest?: string | null
          id?: number
          kind?: string | null
          matched?: number | null
          source?: string
          text?: string | null
        }
        Relationships: []
      }
      wall_voice_log: {
        Row: {
          at: string
          heard: string | null
          id: number
          kind: string
          lat: Json | null
          model: string | null
          outcome: string | null
          reply: string | null
          score: number | null
          why: string | null
        }
        Insert: {
          at?: string
          heard?: string | null
          id?: number
          kind: string
          lat?: Json | null
          model?: string | null
          outcome?: string | null
          reply?: string | null
          score?: number | null
          why?: string | null
        }
        Update: {
          at?: string
          heard?: string | null
          id?: number
          kind?: string
          lat?: Json | null
          model?: string | null
          outcome?: string | null
          reply?: string | null
          score?: number | null
          why?: string | null
        }
        Relationships: []
      }
      wall_voice_status: {
        Row: {
          at: string
          id: number
          status: Json
        }
        Insert: {
          at?: string
          id?: number
          status?: Json
        }
        Update: {
          at?: string
          id?: number
          status?: Json
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
      ai_spend_mix_today: {
        Row: {
          cost_usd: number | null
          failed_calls: number | null
          free_units: number | null
          ok_calls: number | null
          provider: string | null
          tokens: number | null
        }
        Relationships: []
      }
      ava_voice_quality: {
        Row: {
          avg_gap: number | null
          avg_score: number | null
          calls: number | null
          flagged: number | null
          last_call: string | null
          source: string | null
          voice_id: string | null
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
      notification_unowned: {
        Row: {
          key: string | null
          push_count: number | null
          status: string | null
          title: string | null
        }
        Insert: {
          key?: string | null
          push_count?: number | null
          status?: string | null
          title?: string | null
        }
        Update: {
          key?: string | null
          push_count?: number | null
          status?: string | null
          title?: string | null
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
      _cy_rpc_allow: {
        Args: { p_fn: string; p_headers: string; p_max: number }
        Returns: boolean
      }
      _ha_level: { Args: { p_priority: number }; Returns: string }
      _ha_quiet_until: {
        Args: { p_immediate: boolean; p_priority: number }
        Returns: string
      }
      _keyship_take: { Args: { p_nonce: string }; Returns: string }
      _llm_key_store: {
        Args: { p_name: string; p_value: string }
        Returns: undefined
      }
      _pattern_vote: {
        Args: { p_id: string; p_kind: string }
        Returns: boolean
      }
      _public_voter: { Args: never; Returns: string }
      _term_hits: {
        Args: { p_doc: unknown; p_terms: string[] }
        Returns: number
      }
      admin_agent_set: {
        Args: { p_patch: Json; p_slug: string }
        Returns: Json
      }
      admin_archived_calls: {
        Args: { p_limit?: number; p_source: string }
        Returns: Json
      }
      admin_ava_brief_preview: { Args: never; Returns: Json }
      admin_bluesteel_sweep_ack: { Args: never; Returns: Json }
      admin_bluesteel_sweep_calibrate: {
        Args: { p_note?: string; p_side: string; p_zone: string }
        Returns: Json
      }
      admin_bluesteel_sweep_set: {
        Args: { p_alerts_enabled?: boolean; p_skip_dates?: string[] }
        Returns: Json
      }
      admin_bluesteel_sweep_state: { Args: never; Returns: Json }
      admin_bluesteel_sweep_test: { Args: never; Returns: number }
      admin_call_review: {
        Args: { p_call: string; p_source: string }
        Returns: Json
      }
      admin_car_events: { Args: { p_days?: number }; Returns: Json }
      admin_car_events_read: { Args: { p_kinds: string[] }; Returns: number }
      admin_car_fix: { Args: { p_action: string }; Returns: Json }
      admin_car_ready: { Args: never; Returns: Json }
      admin_car_where: { Args: { p_at: string }; Returns: Json }
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
      admin_coach: { Args: { p_source: string }; Returns: Json }
      admin_coach_feed: {
        Args: { p_limit?: number; p_source: string }
        Returns: Json
      }
      admin_coach_manage: { Args: { p_source: string }; Returns: Json }
      admin_coach_setting_set: {
        Args: { p_on: boolean; p_source: string }
        Returns: Json
      }
      admin_delete_cloud_lead: { Args: { p_lead_id: string }; Returns: Json }
      admin_dnd: { Args: { p_minutes: number }; Returns: Json }
      admin_freshness_sweep: { Args: never; Returns: Json }
      admin_freshness_watch: { Args: never; Returns: Json }
      admin_git: { Args: { p_body: Json; p_timeout_s?: number }; Returns: Json }
      admin_git_call: { Args: { p_body: Json }; Returns: number }
      admin_git_poll: { Args: { p_request_id: number }; Returns: Json }
      admin_graveyard: { Args: never; Returns: Json }
      admin_hire_accept: { Args: { p_id: string }; Returns: string }
      admin_hire_cancel: { Args: { p_slug: string }; Returns: undefined }
      admin_hire_pass: { Args: { p_id: string }; Returns: undefined }
      admin_improver_ideas: { Args: never; Returns: Json }
      admin_improver_set: {
        Args: { p_id: string; p_note?: string; p_status: string }
        Returns: undefined
      }
      admin_incident_set: {
        Args: { p_action: string; p_id: string; p_ref?: string }
        Returns: Json
      }
      admin_incident_teach: { Args: { p_id: string }; Returns: Json }
      admin_login_email: { Args: { p_username: string }; Returns: string }
      admin_login_push: { Args: never; Returns: number }
      admin_meeting_forget: { Args: { p_name: string }; Returns: Json }
      admin_meeting_rename: {
        Args: { p_new: string; p_old: string }
        Returns: Json
      }
      admin_needs_claim: {
        Args: { p_n: number }
        Returns: {
          attempts: number
          closed: boolean
          confidence: number | null
          created_at: string
          error: string | null
          evidence: Json | null
          finished_at: string | null
          id: string
          key: string
          model: string | null
          not_before: string | null
          rule: string | null
          run_id: string
          started_at: string | null
          status: string
          summary: string | null
          title: string | null
          undone_at: string | null
          verdict: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "admin_needs_checks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_needs_rules: { Args: { p_run: string }; Returns: Json }
      admin_needs_rules_core: { Args: { p_run: string }; Returns: Json }
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
      admin_notify_prefs_get: { Args: never; Returns: Json }
      admin_notify_prefs_set: {
        Args: {
          p_quiet_end?: string
          p_quiet_on?: boolean
          p_quiet_start?: string
          p_sound_on?: boolean
          p_urgent_through?: boolean
        }
        Returns: Json
      }
      admin_org_chart: { Args: never; Returns: Json }
      admin_playbook_calls: {
        Args: { p_id: string; p_source: string }
        Returns: Json
      }
      admin_playbook_delete: {
        Args: { p_id: string; p_source: string }
        Returns: Json
      }
      admin_playbook_set: {
        Args: { p_action: string; p_id: string; p_source: string }
        Returns: undefined
      }
      admin_playbook_upsert: {
        Args: {
          p_id: string
          p_kind: string
          p_rule: string
          p_size: string
          p_source: string
          p_why: string
        }
        Returns: Json
      }
      admin_product_duty_set: {
        Args: {
          p_agent: string
          p_duty: string
          p_product: string
          p_tools?: string[]
        }
        Returns: Json
      }
      admin_product_set: {
        Args: { p_patch: Json; p_slug: string }
        Returns: Json
      }
      admin_products: { Args: never; Returns: Json }
      admin_reorg_execute: { Args: { p_id: string }; Returns: Json }
      admin_reorg_keep: { Args: { p_id: string }; Returns: undefined }
      admin_reorg_undo: { Args: { p_id: string }; Returns: string }
      admin_reply_incidents: { Args: { p_source: string }; Returns: Json }
      admin_report: {
        Args: { p_detail?: string; p_ok?: boolean; p_where: string }
        Returns: Json
      }
      admin_require_admin: { Args: never; Returns: undefined }
      admin_roster_finding_set: {
        Args: { p_key: string; p_status: string }
        Returns: undefined
      }
      admin_roster_findings: { Args: never; Returns: Json }
      admin_sql_read: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      admin_sql_write: { Args: { p_query: string }; Returns: Json }
      admin_team_hires: { Args: never; Returns: Json }
      admin_team_moods: { Args: never; Returns: Json }
      admin_team_red_count: { Args: never; Returns: number }
      admin_team_reorgs: { Args: never; Returns: Json }
      admin_today: {
        Args: never
        Returns: {
          action_label: string
          detail: string
          fingerprint: string
          item_count: number
          key: string
          origin_id: string
          origin_table: string
          rank: number
          severity: string
          since: string
          source: string
          title: string
          url: string
          why: string
        }[]
      }
      admin_today_dismissed_prune: { Args: never; Returns: number }
      admin_today_done: { Args: { p_key: string }; Returns: boolean }
      admin_today_rows: {
        Args: never
        Returns: {
          action_label: string
          detail: string
          fingerprint: string
          item_count: number
          key: string
          origin_id: string
          origin_table: string
          rank: number
          severity: string
          since: string
          source: string
          title: string
          url: string
          why: string
        }[]
      }
      admin_today_undo: { Args: { p_key: string }; Returns: boolean }
      admin_turn_vote: {
        Args: {
          p_call?: string
          p_conversation?: string
          p_note?: string
          p_said: string
          p_source: string
          p_turn: number
          p_vote?: string
        }
        Returns: Json
      }
      admin_turn_vote_feed: {
        Args: { p_limit?: number; p_source: string }
        Returns: Json
      }
      admin_turn_votes: {
        Args: { p_call?: string; p_conversation?: string; p_source: string }
        Returns: Json
      }
      admin_watchdogs: { Args: never; Returns: Json }
      adopt_unmanaged_keys: { Args: never; Returns: Json }
      agent_beat: {
        Args: {
          p_ok?: boolean
          p_slug: string
          p_summary?: string
          p_token?: string
        }
        Returns: Json
      }
      agent_beat_log_prune: { Args: never; Returns: undefined }
      ai_budget: { Args: { p_scope: string }; Returns: Json }
      ai_gate: { Args: { p_fn: string; p_who: string }; Returns: Json }
      ai_gate_prune: { Args: never; Returns: undefined }
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
      ask_split_ideas: {
        Args: { p_body: string; p_subject: string }
        Returns: {
          body: string
          title: string
        }[]
      }
      ask_words: { Args: { t: string }; Returns: string[] }
      audience_from_text: { Args: { p: string }; Returns: string }
      auto_fix_pattern_issues: { Args: never; Returns: Json }
      ava_action: { Args: { p_action: string }; Returns: number }
      ava_actions_make: {
        Args: {
          p_appt: string
          p_business: string
          p_call_id: string
          p_intent: string
          p_message: string
          p_name: string
          p_phone: string
          p_source: string
          p_times: string
        }
        Returns: undefined
      }
      ava_archive_call: {
        Args: { p_archive?: boolean; p_id: string }
        Returns: undefined
      }
      ava_brief_compose: { Args: { p_day: string }; Returns: Json }
      ava_brief_tick: { Args: never; Returns: string }
      ava_brief_watch: { Args: never; Returns: string }
      ava_cal_secret_put: {
        Args: { p_name: string; p_value: string }
        Returns: undefined
      }
      ava_cal_secret_status: { Args: never; Returns: Json }
      ava_call_quality_digest: { Args: never; Returns: undefined }
      ava_call_quality_log: {
        Args: {
          p_alert?: boolean
          p_call_id: string
          p_call_no: number
          p_source: string
          p_transcript: Json
          p_voice: string
        }
        Returns: undefined
      }
      ava_call_quality_scan: {
        Args: { p_chain: string[]; p_transcript: Json }
        Returns: {
          agent_turns: number
          avg_gap: number
          complaint: string
          cut_off_n: number
          flags: string[]
          llm: string
          max_gap: number
          slow_n: number
        }[]
      }
      ava_coach_notes: { Args: never; Returns: string }
      ava_contacts_apply: { Args: { p_people: Json }; Returns: Json }
      ava_costs: { Args: never; Returns: Json }
      ava_delete_call: { Args: { p_id: string }; Returns: undefined }
      ava_digits10: { Args: { p: string }; Returns: string }
      ava_followup_act: {
        Args: { p_action: string; p_at?: string; p_id: string }
        Returns: Json
      }
      ava_followup_dial_to: {
        Args: { f: Database["public"]["Tables"]["ava_followups"]["Row"] }
        Returns: string
      }
      ava_followups_tick: { Args: never; Returns: Json }
      ava_impersonation_check: {
        Args: { p_call_id: string; p_call_no: number; p_transcript: Json }
        Returns: undefined
      }
      ava_incident_rule: {
        Args: { p_kind: string; p_leak: boolean; p_subkind: string }
        Returns: string
      }
      ava_incident_sync: { Args: never; Returns: number }
      ava_incident_teach_do: { Args: { p_id: string }; Returns: Json }
      ava_knowledge_partner_list: {
        Args: never
        Returns: {
          fact: string
          id: string
          proposed_at: string
          review_note: string
          status: string
          topic: string
        }[]
      }
      ava_knowledge_pending_count: { Args: never; Returns: number }
      ava_knowledge_propose: {
        Args: { p_fact: string; p_id?: string; p_topic: string }
        Returns: string
      }
      ava_knowledge_resolve_if_clear: { Args: never; Returns: undefined }
      ava_knowledge_review: {
        Args: { p_approve: boolean; p_id: string; p_note?: string }
        Returns: undefined
      }
      ava_knowledge_withdraw: { Args: { p_id: string }; Returns: undefined }
      ava_leak_log: {
        Args: {
          p_call_id: string
          p_call_no: number
          p_excerpt: string
          p_llm: string
          p_source: string
        }
        Returns: boolean
      }
      ava_light: {
        Args: {
          p_checked: string
          p_detail: string
          p_items?: Json
          p_key: string
          p_label: string
          p_state: string
          p_word?: string
        }
        Returns: Json
      }
      ava_lights_clock: { Args: { p_ts: string }; Returns: string }
      ava_lights_when: { Args: { p_ts: string }; Returns: string }
      ava_long_call_check: {
        Args: {
          p_call_id: string
          p_call_no: number
          p_cost: number
          p_duration: number
          p_gained: boolean
          p_source: string
        }
        Returns: undefined
      }
      ava_norm_company: { Args: { p: string }; Returns: string }
      ava_reply_guard: {
        Args: {
          p_call_id: string
          p_call_no: number
          p_source: string
          p_transcript: Json
        }
        Returns: undefined
      }
      ava_reply_scan: {
        Args: { p_transcript: Json }
        Returns: {
          excerpt: string
          kind: string
        }[]
      }
      ava_secret: { Args: { p_name: string }; Returns: string }
      ava_secret_put: {
        Args: { p_name: string; p_value: string }
        Returns: undefined
      }
      ava_set_spend_cap: {
        Args: { p_cap: number; p_source: string }
        Returns: Json
      }
      ava_site_domain: { Args: { p: string }; Returns: string }
      ava_spam_recount: { Args: never; Returns: number }
      ava_spend: { Args: { p_source: string }; Returns: Json }
      ava_spend_calc: { Args: { p_source: string }; Returns: Json }
      ava_spend_gate: { Args: { p_source: string }; Returns: Json }
      ava_status_lights: { Args: { p_source: string }; Returns: Json }
      ava_turn_votes_attach: {
        Args: { p_call: string; p_conversation: string; p_source: string }
        Returns: undefined
      }
      ava_voice_say_take: {
        Args: { p_cap?: number; p_source: string }
        Returns: Json
      }
      ava_watch: { Args: never; Returns: Json }
      battery_health_tick: { Args: never; Returns: Json }
      bestly_announce: {
        Args: { p_message: string; p_title: string }
        Returns: string
      }
      bestly_git_key_ok: { Args: { p_key: string }; Returns: boolean }
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
      bestly_ping_sound: {
        Args: {
          p_message: string
          p_sound?: string
          p_title: string
          p_url?: string
        }
        Returns: string
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
      bestly_sent_state_get: {
        Args: { p_key: string; p_mailbox: string }
        Returns: Json
      }
      bestly_sent_upsert: {
        Args: {
          p_error?: string
          p_key: string
          p_last_uid: number
          p_mailbox: string
          p_rows: Json
          p_uid_validity: number
        }
        Returns: Json
      }
      bluesteel_ack_key: { Args: never; Returns: string }
      bluesteel_dow_name: { Args: { p_dow: number }; Returns: string }
      bluesteel_la_today: { Args: never; Returns: string }
      bluesteel_min12: { Args: { p_min: number }; Returns: string }
      bluesteel_sweep_ack: { Args: { p_via?: string }; Returns: Json }
      bluesteel_sweep_car: { Args: never; Returns: Json }
      bluesteel_sweep_locate: {
        Args: { p_lat: number; p_lon: number }
        Returns: Json
      }
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
      bluesteel_sweep_tick: { Args: { p_force?: boolean }; Returns: Json }
      bluesteel_sweep_watch: { Args: never; Returns: Json }
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
      c_people: { Args: { p_slug: string }; Returns: string[] }
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
      car_battery_health_public: { Args: never; Returns: Json }
      car_battery_health_store: { Args: { p_health: Json }; Returns: undefined }
      car_border_zone: {
        Args: { p_lat: number; p_lon: number }
        Returns: string
      }
      car_cmd: { Args: { p_kind: string; p_reason: string }; Returns: number }
      car_cmd_name: { Args: { p_kind: string }; Returns: string }
      car_cmd_watchdog: { Args: never; Returns: Json }
      car_drivers_sync: {
        Args: { p_at?: string; p_drivers: Json }
        Returns: number
      }
      car_drivers_watchdog: { Args: never; Returns: Json }
      car_drives_known: { Args: { p_ids: string[] }; Returns: string[] }
      car_drives_store: { Args: { p_drives: Json }; Returns: number }
      car_event: {
        Args: {
          p_data?: Json
          p_dedupe: string
          p_detail: string
          p_kind: string
          p_lat?: number
          p_lon?: number
          p_res?: number
          p_scout?: boolean
          p_sev: string
          p_title: string
        }
        Returns: boolean
      }
      car_guest_distance_m: {
        Args: { p_lat: number; p_lon: number }
        Returns: number
      }
      car_health_admin: { Args: never; Returns: Json }
      car_health_check_now: { Args: never; Returns: Json }
      car_in_ca: { Args: { p_lat: number; p_lon: number }; Returns: boolean }
      car_keeper_on: { Args: never; Returns: boolean }
      car_owner_drive: {
        Args: {
          p_cur_at: string
          p_cur_lat: number
          p_cur_lon: number
          p_prev_at: string
        }
        Returns: Json
      }
      car_position: { Args: { p_reservation?: number }; Returns: Json }
      car_protect_tick: { Args: never; Returns: Json }
      car_protect_watchdog: { Args: never; Returns: Json }
      car_raw_find: {
        Args: { p_re: string }
        Returns: {
          k: string
          v: Json
        }[]
      }
      car_raw_store:
        | { Args: { p_raw: Json }; Returns: undefined }
        | { Args: { p_raw: Json; p_source?: string }; Returns: undefined }
      car_return_state: { Args: never; Returns: Json }
      car_spot: { Args: { p_lat: number; p_lon: number }; Returns: string }
      car_wash_nearest: {
        Args: { p_lat: number; p_lon: number; p_n?: number }
        Returns: Json
      }
      car_wash_prompt: { Args: { p_reservation: number }; Returns: string }
      car_wash_watchdog: { Args: never; Returns: Json }
      car_watch_guest: {
        Args: {
          p_body: string
          p_kind: string
          p_res: number
          p_title: string
          p_url: string
        }
        Returns: boolean
      }
      car_watch_host: {
        Args: {
          p_body: string
          p_key: string
          p_sev?: string
          p_title: string
          p_url?: string
        }
        Returns: boolean
      }
      car_watch_tick: { Args: never; Returns: Json }
      car_windows_open: { Args: never; Returns: boolean }
      chat_cap_today: { Args: never; Returns: number }
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
          comments: number | null
          content_version: number | null
          cover_url: string | null
          created_at: string
          error: string | null
          id: string
          in_drafts_at: string | null
          likes: number | null
          max_attempts: number
          media_type: string
          media_url: string
          media_urls: string[] | null
          metrics_at: string | null
          permalink: string | null
          platform: string
          posted_at: string | null
          publish_id: string | null
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
      claims_admin: { Args: never; Returns: Json }
      claims_case_update: {
        Args: {
          p_estimate?: number
          p_facts?: string
          p_id: string
          p_insurer?: Json
          p_redraft?: boolean
          p_status?: string
        }
        Returns: Json
      }
      claims_daytime: { Args: { p: string }; Returns: string }
      claims_draft_decide: {
        Args: { p_action: string; p_body?: string; p_id: string }
        Returns: Json
      }
      claims_mail_seen: {
        Args: { m: Database["public"]["Tables"]["bestly_mail"]["Row"] }
        Returns: undefined
      }
      claims_notify: {
        Args: {
          p_body?: string
          p_dedupe?: string
          p_severity?: string
          p_title: string
        }
        Returns: string
      }
      claims_open_case:
        | {
            Args: {
              p_at?: string
              p_mail_id?: number
              p_path?: string
              p_res: number
            }
            Returns: string
          }
        | {
            Args: {
              p_at?: string
              p_mail_id?: string
              p_path?: string
              p_res: number
            }
            Returns: string
          }
      claims_res_from_mail: {
        Args: { p_body: string; p_subject: string }
        Returns: number
      }
      claims_send_claim: { Args: { p_token: string }; Returns: Json }
      claims_send_done: {
        Args: {
          p_error?: string
          p_id: string
          p_ok: boolean
          p_token: string
          p_verified?: boolean
        }
        Returns: undefined
      }
      claims_sender_set: { Args: { p_on: boolean }; Returns: Json }
      claims_tick: { Args: never; Returns: Json }
      cleanup_activation_rate_limits: { Args: never; Returns: undefined }
      cleanup_expired_activation_codes: { Args: never; Returns: undefined }
      cleanup_expired_challenges: { Args: never; Returns: undefined }
      cleanup_old_pihole_stats: { Args: never; Returns: undefined }
      client_actor: { Args: { p_token: string }; Returns: Json }
      client_ask_reply: {
        Args: { p_ask: string; p_text: string; p_token: string }
        Returns: Json
      }
      client_asks_board: { Args: { p_token: string }; Returns: Json }
      client_assets_brief: { Args: { p_client_slug: string }; Returns: string }
      client_board_link: { Args: { p_client: string }; Returns: string }
      client_brief_send: {
        Args: {
          p_body: string
          p_kind?: string
          p_link?: string
          p_token: string
          p_upload?: string
        }
        Returns: Json
      }
      client_briefs_board: { Args: { p_token: string }; Returns: Json }
      client_calendar: {
        Args: { p_days?: number; p_from?: string; p_token: string }
        Returns: Json
      }
      client_calendar_feed: {
        Args: { p_rotate?: boolean; p_token: string }
        Returns: Json
      }
      client_code_prefix: { Args: { p_name: string }; Returns: string }
      client_consent_forget: { Args: { p_token: string }; Returns: Json }
      client_feedback_watch: { Args: never; Returns: Json }
      client_ideas_watch: { Args: never; Returns: Json }
      client_item_publish: {
        Args: { p_at?: string; p_item: string; p_token: string }
        Returns: Json
      }
      client_list_origins: { Args: { p_token: string }; Returns: Json }
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
      client_member_check_code: {
        Args: { p_code: string; p_person: string; p_slug: string }
        Returns: boolean
      }
      client_member_consume_code: {
        Args: { p_code: string; p_person: string; p_slug: string }
        Returns: Json
      }
      client_member_mint_code: {
        Args: { p_hours?: number; p_person: string; p_slug: string }
        Returns: string
      }
      client_notifications: {
        Args: { p_since?: string; p_token: string }
        Returns: Json
      }
      client_ping: { Args: { p_token: string }; Returns: Json }
      client_post_status: { Args: { p_token: string }; Returns: Json }
      client_posting_state: { Args: { p_client: string }; Returns: Json }
      client_seen: {
        Args: { p_item: string; p_seconds: number; p_token: string }
        Returns: Json
      }
      client_social_brand: { Args: { p_client: string }; Returns: string }
      client_social_connect_link: {
        Args: { p_platform?: string; p_token: string }
        Returns: Json
      }
      client_social_disconnect: {
        Args: { p_platform: string; p_token: string }
        Returns: Json
      }
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
      client_todo_due: {
        Args: { p_due: string; p_id: string; p_token: string }
        Returns: Json
      }
      client_todo_set: {
        Args: { p_done: boolean; p_id: string; p_token: string }
        Returns: Json
      }
      client_todo_source: {
        Args: { p_id: string; p_token: string }
        Returns: Json
      }
      client_todos_board: { Args: { p_token: string }; Returns: Json }
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
      client_uploads_sweep: { Args: { p_older_than?: string }; Returns: number }
      client_versions: {
        Args: { p_item: string; p_token: string }
        Returns: Json
      }
      client_viewer: { Args: { p_token: string }; Returns: string }
      client_viewer_info: { Args: { p_token: string }; Returns: Json }
      clip_claim: { Args: { p_key: string }; Returns: Json }
      clip_new: {
        Args: {
          p_bytes: number
          p_key: string
          p_parts?: number
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
          p_meeting_name?: string
          p_seconds?: number
          p_summary?: Json
          p_title?: string
          p_transcript?: string
        }
        Returns: undefined
      }
      clips_watch: { Args: never; Returns: undefined }
      coach_backfill_list: {
        Args: {
          p_include_deleted?: boolean
          p_limit?: number
          p_source: string
        }
        Returns: Json
      }
      coach_next: {
        Args: { p_limit?: number; p_source: string }
        Returns: Json
      }
      coach_propose: {
        Args: { p_rules: Json; p_source: string }
        Returns: Json
      }
      coach_save: {
        Args: {
          p_call: string
          p_error?: string
          p_model: string
          p_provider: string
          p_review: Json
          p_source: string
        }
        Returns: undefined
      }
      coach_transcript: { Args: { t: Json }; Returns: string }
      coach_turn_votes: {
        Args: { p_call: string; p_source: string }
        Returns: Json
      }
      coach_watch: { Args: never; Returns: Json }
      coach_week: { Args: { p_source: string }; Returns: Json }
      crm_set_stage: {
        Args: { p_key: string; p_stage: string }
        Returns: string
      }
      cron_gap: { Args: { p_schedule: string }; Returns: string }
      cron_health: { Args: { p_hours?: number }; Returns: Json }
      cron_heartbeat: { Args: never; Returns: Json }
      cron_rerun_failed: { Args: never; Returns: Json }
      current_actor: { Args: never; Returns: Json }
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
      cy_maker_feedback: { Args: { p_days?: number }; Returns: Json }
      cy_maker_insert: { Args: { p: Json }; Returns: Json }
      cy_maker_sells: { Args: { p_text: string }; Returns: boolean }
      cy_operations_stats: { Args: { p_days?: number }; Returns: Json }
      cy_platform_breakdown: { Args: never; Returns: Json }
      cy_render_key: { Args: never; Returns: string }
      cy_render_key_ok: { Args: { p_key: string }; Returns: boolean }
      cy_report_site_issue: {
        Args: {
          p_domain: string
          p_platform?: string
          p_reason: string
          p_version?: string
        }
        Returns: Json
      }
      cy_selector_cookie_like: {
        Args: { p_selector: string }
        Returns: boolean
      }
      cy_site_guard_list: {
        Args: never
        Returns: {
          domain: string
          off_until: string
        }[]
      }
      cy_site_guard_watch: { Args: never; Returns: Json }
      db_memory_watch: { Args: never; Returns: Json }
      db_quiet_begin: { Args: { p_reason?: string }; Returns: string[] }
      db_quiet_end: { Args: never; Returns: string[] }
      db_shed_candidates: { Args: never; Returns: string[] }
      db_watchdog_ok: { Args: { p_token: string }; Returns: boolean }
      db_watchdog_report: {
        Args: {
          p_detail?: Json
          p_down_at: string
          p_token: string
          p_up_at: string
        }
        Returns: Json
      }
      db_watchdog_sync: { Args: { p_token: string }; Returns: Json }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      demo_car_command: {
        Args: { p_action: string; p_pass: string }
        Returns: Json
      }
      demo_car_job: { Args: { p_id: number; p_pass: string }; Returns: Json }
      demo_key_admin: {
        Args: { p_action?: string; p_value?: string }
        Returns: Json
      }
      demo_key_baseline: { Args: never; Returns: Json }
      demo_key_busy: { Args: never; Returns: boolean }
      demo_key_check: { Args: { p_pass?: string }; Returns: Json }
      demo_key_context: { Args: never; Returns: Json }
      demo_key_enqueue: {
        Args: { p_action: string; p_args?: Json }
        Returns: boolean
      }
      demo_key_get: { Args: { p_pass?: string }; Returns: Json }
      demo_key_guest_pending: { Args: never; Returns: boolean }
      demo_key_invites_watchdog: { Args: never; Returns: Json }
      demo_key_ok: { Args: { p_pass: string }; Returns: boolean }
      demo_key_orphans: { Args: never; Returns: string[] }
      demo_key_sweep_orphans: { Args: never; Returns: number }
      demo_key_tap: { Args: { p_pass?: string }; Returns: Json }
      demo_key_tick: { Args: never; Returns: Json }
      demo_key_watchdog: { Args: never; Returns: Json }
      driver_first_norm: { Args: { p: string }; Returns: string }
      driver_lev: { Args: { a: string; b: string }; Returns: number }
      driver_name_score: {
        Args: { turo: string; typed: string }
        Returns: number
      }
      edge_guard_beat_t: {
        Args: { p_ok?: boolean; p_summary?: string; p_token: string }
        Returns: undefined
      }
      edge_guard_note_t: {
        Args: {
          p_action: string
          p_alert?: Json
          p_detail?: string
          p_site: string
          p_state: string
          p_token: string
        }
        Returns: Json
      }
      edge_key_ok: { Args: { p_key: string; p_name: string }; Returns: boolean }
      emergency_battery_check: { Args: never; Returns: string }
      emergency_end: { Args: never; Returns: Json }
      emergency_start: { Args: { p_hazard?: string }; Returns: Json }
      emergency_tick: {
        Args: { p_done: boolean; p_item: string }
        Returns: Json
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_stale_home_hub_commands: { Args: never; Returns: undefined }
      extra_driver_admin: {
        Args: { p_action: string; p_id: number }
        Returns: Json
      }
      extra_driver_approve_token: {
        Args: { p_do?: boolean; p_token: string }
        Returns: Json
      }
      extra_driver_first: { Args: { p: string }; Returns: string }
      extra_driver_public: {
        Args: { d: Database["public"]["Tables"]["trip_extra_drivers"]["Row"] }
        Returns: Json
      }
      extra_driver_status_row: {
        Args: { d: Database["public"]["Tables"]["trip_extra_drivers"]["Row"] }
        Returns: Json
      }
      extra_drivers_admin: { Args: { p_reservation: number }; Returns: Json }
      extra_drivers_tick: { Args: { p_res?: number }; Returns: Json }
      extra_drivers_watchdog: { Args: never; Returns: Json }
      feedback_draft_context: { Args: { p_review: string }; Returns: Json }
      feedback_draft_key_ok: { Args: { p_key: string }; Returns: boolean }
      feedback_draft_pending: { Args: { p_limit?: number }; Returns: number }
      feedback_draft_save: {
        Args: { p_draft: Json; p_review: string }
        Returns: undefined
      }
      feedback_rule_hits: {
        Args: { p_client_slug: string; p_text: string }
        Returns: Json
      }
      feedback_rule_stamp: { Args: { p_review: string }; Returns: undefined }
      find_car_watchdog: { Args: never; Returns: Json }
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
      free_llm_watch: { Args: never; Returns: Json }
      freellm_watch: { Args: never; Returns: Json }
      get_action_type_stats: { Args: never; Returns: Json }
      get_ai_generation_candidates: { Args: { _limit: number }; Returns: Json }
      get_apns_credentials: {
        Args: never
        Returns: {
          app_key: string
          key_id: string
          private_key: string
          team_id: string
        }[]
      }
      get_bestly_proxy_key: { Args: never; Returns: string }
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
      get_outage_note: { Args: never; Returns: Json }
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
      get_weatherkit_credentials: {
        Args: never
        Returns: {
          key_id: string
          private_key: string
          service_id: string
          team_id: string
        }[]
      }
      guest_entry_lookup: {
        Args: { p_kind: string; p_last: string; p_phone: string }
        Returns: Json
      }
      guest_key_gate: {
        Args: {
          p_checkin?: boolean
          p_license?: boolean
          p_override?: boolean
          p_reservation: number
        }
        Returns: Json
      }
      guest_key_phases: { Args: { p_reservation: number }; Returns: Json }
      guest_key_released: { Args: { p_reservation: number }; Returns: boolean }
      guest_trace_watchdog: { Args: never; Returns: Json }
      ha_incident_live: { Args: never; Returns: string }
      ha_push: {
        Args: {
          p_actions?: Json
          p_body: string
          p_clear?: boolean
          p_deliver_at?: string
          p_group?: string
          p_level?: string
          p_live?: Json
          p_source?: string
          p_tag?: string
          p_title: string
          p_url?: string
        }
        Returns: number
      }
      ha_push_dispatch: { Args: never; Returns: number }
      ha_push_enqueue: {
        Args: {
          p_actions?: Json
          p_body: string
          p_clear?: boolean
          p_deliver_at?: string
          p_group?: string
          p_level?: string
          p_live?: Json
          p_source?: string
          p_tag?: string
          p_title: string
          p_url?: string
        }
        Returns: number
      }
      ha_push_t: {
        Args: {
          p_body: string
          p_group?: string
          p_level?: string
          p_source?: string
          p_tag?: string
          p_title: string
          p_token: string
          p_url?: string
        }
        Returns: number
      }
      ha_todo_sync: {
        Args: {
          p_error?: string
          p_known?: string[]
          p_ops?: Json
          p_stats?: Json
          p_token: string
        }
        Returns: Json
      }
      ha_todo_sync_watch: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hire_graduate: {
        Args: { p_note?: string; p_slug: string }
        Returns: Json
      }
      hire_spec_set: { Args: { p_patch: Json; p_slug: string }; Returns: Json }
      hire_stage_set: {
        Args: { p_note?: string; p_slug: string; p_stage: string }
        Returns: Json
      }
      hire_training_sweep: { Args: never; Returns: number }
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
      host_gate_apply: { Args: { p_do: string; p_g: string }; Returns: Json }
      host_gate_state: { Args: { p_g: string }; Returns: Json }
      host_pickup_card_tick: { Args: never; Returns: string }
      host_pickup_card_watch: { Args: never; Returns: string }
      hr_context: { Args: never; Returns: Json }
      hr_save: { Args: { p_hires: Json }; Returns: number }
      improver_context: { Args: never; Returns: Json }
      improver_save: { Args: { p_ideas: Json }; Returns: number }
      intake_doc_path_ok: { Args: { p_name: string }; Returns: boolean }
      internal_proxy_key_ok: { Args: { p_key: string }; Returns: boolean }
      invoke_edge_function: {
        Args: { function_slug: string; payload?: Json; timeout_ms?: number }
        Returns: number
      }
      item_event_words: { Args: { p: Json; p_kind: string }; Returns: string }
      item_feedback_hold: { Args: { p_item: string }; Returns: string }
      item_platforms: { Args: { p_item: string }; Returns: string[] }
      item_social_rows: { Args: { p_item: string }; Returns: Json }
      key_hold_watchdog: { Args: never; Returns: Json }
      key_lock_watchdog: { Args: never; Returns: Json }
      key_removal_ready: { Args: { p_res: number }; Returns: Json }
      key_rollover_watch: { Args: never; Returns: Json }
      keyswitch_judge: { Args: never; Returns: Json }
      keyswitch_watchdog: { Args: never; Returns: Json }
      la_time12: { Args: { p: string }; Returns: string }
      lax_agent_act: {
        Args: { p_action: string; p_note?: string; p_token: string }
        Returns: Json
      }
      lax_agent_diag: { Args: { p_token: string }; Returns: Json }
      lax_agent_driver: {
        Args: {
          p_action: string
          p_name?: string
          p_token: string
          p_value?: string
        }
        Returns: Json
      }
      lax_agent_job: { Args: { p_job: number; p_token: string }; Returns: Json }
      lax_ask_admin_set: {
        Args: {
          p_daily_limit?: number
          p_enabled?: boolean
          p_house_rules?: string
        }
        Returns: Json
      }
      lax_ask_admin_state: { Args: never; Returns: Json }
      lax_ask_agent_result: {
        Args: { p_error?: string; p_ok: boolean; p_via: string }
        Returns: undefined
      }
      lax_ask_car_matches: {
        Args: { p_n?: number; p_q: string }
        Returns: string
      }
      lax_ask_claim: { Args: { p_key: string }; Returns: Json }
      lax_ask_driver_text: {
        Args: { p_link: string; p_res: number }
        Returns: string
      }
      lax_ask_fallback: { Args: { p_reply_id: number }; Returns: undefined }
      lax_ask_faq_answer: {
        Args: { p_kind?: string; p_q: string }
        Returns: Json
      }
      lax_ask_finish: {
        Args: {
          p_content: string
          p_done?: boolean
          p_reply_id: number
          p_source: string
        }
        Returns: undefined
      }
      lax_ask_fmt: { Args: { t: string }; Returns: string }
      lax_ask_gemini_key: { Args: never; Returns: string }
      lax_ask_gemini_result: {
        Args: { p_error?: string; p_ok: boolean }
        Returns: undefined
      }
      lax_ask_history: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      lax_ask_local_online: { Args: never; Returns: boolean }
      lax_ask_poll: {
        Args: { p_reply_id: number; p_slug: string; p_token: string }
        Returns: Json
      }
      lax_ask_prompt: { Args: { p_reply_id: number }; Returns: Json }
      lax_ask_return_charge_safe: {
        Args: { p_demo?: boolean; p_res: number }
        Returns: string
      }
      lax_ask_return_charge_text: {
        Args: { p_demo?: boolean; p_res: number }
        Returns: string
      }
      lax_ask_set_gemini_key: { Args: { p_key: string }; Returns: Json }
      lax_ask_set_model: { Args: { p_model: string }; Returns: undefined }
      lax_ask_start: {
        Args: { p_question: string; p_slug: string; p_token: string }
        Returns: Json
      }
      lax_ask_suggest: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      lax_ask_suggest_check: { Args: never; Returns: undefined }
      lax_ask_watchdog: { Args: never; Returns: undefined }
      lax_ask_who: {
        Args: { p_slug: string; p_token: string }
        Returns: {
          link: string
          personal: boolean
          res: number
        }[]
      }
      lax_ask_write: {
        Args: {
          p_content: string
          p_done: boolean
          p_error?: string
          p_key: string
          p_reply_id: number
        }
        Returns: undefined
      }
      lax_car_facts_set: { Args: { p: Json }; Returns: Json }
      lax_car_facts_text: { Args: never; Returns: string }
      lax_car_public: { Args: never; Returns: Json }
      lax_code_for: {
        Args: { p_at: string }
        Returns: {
          created_at: string
          id: string
          note: string | null
          payload: string
          valid_month: string
        }
        SetofOptions: {
          from: "*"
          to: "lax_parking_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lax_current_trip: { Args: never; Returns: number }
      lax_demo_fresh_state: { Args: never; Returns: Json }
      lax_demo_tool: {
        Args: { p_args?: Json; p_link: string; p_name: string }
        Returns: Json
      }
      lax_driver_public: { Args: { p_token: string }; Returns: Json }
      lax_guest_activity: { Args: { p_res: number }; Returns: Json }
      lax_guest_add_trip: {
        Args: {
          p_earnings?: number
          p_end_local: string
          p_first: string
          p_lax?: boolean
          p_phone: string
          p_reservation: number
          p_start_local: string
        }
        Returns: Json
      }
      lax_guest_admin_list: { Args: never; Returns: Json }
      lax_guest_admin_update: {
        Args: { p_action: string; p_email?: string; p_reservation: number }
        Returns: Json
      }
      lax_guest_car_command: {
        Args: {
          p_acc?: number
          p_action: string
          p_lat?: number
          p_lon?: number
          p_token: string
        }
        Returns: Json
      }
      lax_guest_car_job: {
        Args: { p_id: number; p_token: string }
        Returns: Json
      }
      lax_guest_driver_add: {
        Args: {
          p_ack: boolean
          p_ack_text: string
          p_device?: string
          p_name: string
          p_token: string
        }
        Returns: Json
      }
      lax_guest_driver_cancel: {
        Args: { p_id: number; p_token: string }
        Returns: Json
      }
      lax_guest_drivers: { Args: { p_token: string }; Returns: Json }
      lax_guest_due: { Args: never; Returns: Json }
      lax_guest_key_check: { Args: { p_token: string }; Returns: Json }
      lax_guest_public: { Args: { p_token: string }; Returns: Json }
      lax_guest_reminder_time: { Args: { p_start: string }; Returns: string }
      lax_guest_reminder_time_for: {
        Args: { p_airport: string; p_start: string }
        Returns: string
      }
      lax_guest_set_email: {
        Args: { p_email: string; p_token: string }
        Returns: Json
      }
      lax_guest_sync: { Args: never; Returns: number }
      lax_guest_tick: { Args: never; Returns: undefined }
      lax_guest_timeline: { Args: { p_reservation: number }; Returns: Json }
      lax_guest_trip: { Args: { p_token: string }; Returns: Json }
      lax_guest_trip_by_res: { Args: { p_res: number }; Returns: Json }
      lax_home_due: { Args: never; Returns: Json }
      lax_home_reminded: {
        Args: { p_error?: string; p_ok: boolean; p_reservation: number }
        Returns: undefined
      }
      lax_key_reconcile: { Args: { p_res: number }; Returns: string }
      lax_late_re: { Args: never; Returns: string }
      lax_learn_host_devices: { Args: never; Returns: number }
      lax_mask_email: { Args: { e: string }; Returns: string }
      lax_month_now: { Args: never; Returns: string }
      lax_mx_ca_re: { Args: never; Returns: string }
      lax_out_of_state_re: { Args: never; Returns: string }
      lax_pass_admin_state: { Args: never; Returns: Json }
      lax_pass_alert: {
        Args: {
          p_body: string
          p_key: string
          p_severity?: string
          p_title: string
        }
        Returns: undefined
      }
      lax_pass_current_row: {
        Args: never
        Returns: {
          created_at: string
          id: string
          note: string | null
          payload: string
          valid_month: string
        }
        SetofOptions: {
          from: "*"
          to: "lax_parking_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lax_pass_google_ready: { Args: never; Returns: boolean }
      lax_pass_google_secrets: { Args: never; Returns: Json }
      lax_pass_host_ok: { Args: { p_token: string }; Returns: boolean }
      lax_pass_host_url: { Args: never; Returns: string }
      lax_pass_public: { Args: { p_slug: string }; Returns: Json }
      lax_pass_reminder: { Args: never; Returns: undefined }
      lax_pass_rotate_slug: { Args: never; Returns: string }
      lax_pass_secrets: { Args: never; Returns: Json }
      lax_pass_set: {
        Args: { p_month?: string; p_note?: string; p_payload: string }
        Returns: Json
      }
      lax_pass_set_guide: { Args: { p_guide: Json }; Returns: Json }
      lax_pickup_battery_snap: { Args: never; Returns: number }
      lax_reset_chat_once: {
        Args: { p_job: string; p_token: string }
        Returns: undefined
      }
      lax_return_check: { Args: { p_token: string }; Returns: Json }
      lax_shared_car_command: {
        Args: { p_action: string; p_slug: string }
        Returns: Json
      }
      lax_shared_car_job: {
        Args: { p_id: number; p_slug: string }
        Returns: Json
      }
      lax_short_token: { Args: { n?: number }; Returns: string }
      lax_token_who: {
        Args: { p_token: string }
        Returns: {
          driver_id: number
          guest_token: string
          res: number
        }[]
      }
      lax_track: {
        Args: {
          p_detail?: Json
          p_device?: string
          p_device_id?: string
          p_kind: string
          p_token: string
        }
        Returns: undefined
      }
      lax_trip_controls: { Args: { p_res: number }; Returns: Json }
      lax_trip_key_at: { Args: { p_res: number }; Returns: string }
      lax_trip_kind: { Args: { p_airport: string }; Returns: string }
      lax_trip_kind_for: { Args: { p_token: string }; Returns: string }
      lax_watchdog: { Args: never; Returns: Json }
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
      llm_key_set: { Args: { p_name: string; p_value: string }; Returns: Json }
      llm_keys: { Args: never; Returns: Json }
      log_admin_activity: {
        Args: { p_description: string; p_event_type: string; p_metadata?: Json }
        Returns: string
      }
      ltx_report: { Args: { p_detail?: Json; p_event: string }; Returns: Json }
      ltx_watch: { Args: never; Returns: Json }
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
      mac_job_autorun: {
        Args: { p_force?: boolean; p_id: string }
        Returns: Json
      }
      mac_job_clear_superseded: { Args: { p_job: string }; Returns: number }
      mac_job_decide: { Args: { p_id: string; p_run: boolean }; Returns: Json }
      mac_job_title_words: { Args: { p: string }; Returns: string[] }
      mac_mail_tick: { Args: never; Returns: undefined }
      mac_queue_command: {
        Args: { p_action: string; p_payload?: Json }
        Returns: string
      }
      mail_addr: { Args: { p: string }; Returns: string }
      mail_body_is_empty: { Args: { p: string }; Returns: boolean }
      mail_gap_check: { Args: never; Returns: number }
      mail_sender_client: { Args: { p_from: string }; Returns: string }
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
      notification_owner: {
        Args: { p_key: string }
        Returns: {
          name: string
          owned: boolean
          role: string
          slug: string
        }[]
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
      notify_error_key: {
        Args: { o: Database["public"]["Tables"]["notify_outbox"]["Row"] }
        Returns: string
      }
      notify_errors_sweep: { Args: never; Returns: number }
      notify_is_error: {
        Args: { o: Database["public"]["Tables"]["notify_outbox"]["Row"] }
        Returns: boolean
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
      notify_quiet_now: { Args: never; Returns: Json }
      notify_quiet_watchdog: { Args: never; Returns: Json }
      notify_route: {
        Args: {
          p_actions?: Json
          p_body?: string
          p_clear?: boolean
          p_deliver_at?: string
          p_group?: string
          p_level?: string
          p_live?: Json
          p_source?: string
          p_tag?: string
          p_title: string
          p_url?: string
        }
        Returns: string
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
      ops_cancel_long: {
        Args: { p_secs?: number; p_terminate?: boolean }
        Returns: Json
      }
      ops_db_hygiene: { Args: never; Returns: Json }
      ops_identity_audit: { Args: never; Returns: Json }
      ops_learn: { Args: never; Returns: Json }
      ops_watchdog_note: {
        Args: { p_action: string; p_detail?: Json; p_ok: boolean }
        Returns: Json
      }
      ops_watchdog_note_t: {
        Args: {
          p_action: string
          p_detail?: Json
          p_ok: boolean
          p_token: string
        }
        Returns: Json
      }
      ops_watchdog_report: {
        Args: { p_detail?: Json; p_source: string; p_state: string }
        Returns: Json
      }
      ops_watchdog_report_t: {
        Args: {
          p_detail?: Json
          p_source: string
          p_state: string
          p_token: string
        }
        Returns: Json
      }
      origin_ask: { Args: { p_id: string }; Returns: Json }
      origin_brief: { Args: { p_id: string }; Returns: Json }
      origin_clip: { Args: { n?: number; p: string }; Returns: string }
      origin_item: { Args: { p_id: string }; Returns: Json }
      origin_todo: { Args: { p_id: string }; Returns: Json }
      partner_ai_claim: {
        Args: { p_key: string; p_model?: string }
        Returns: Json
      }
      partner_ai_claim_cloud: { Args: never; Returns: Json }
      partner_ai_claim_core: { Args: never; Returns: Json }
      partner_ai_key_ok: { Args: { p_key: string }; Returns: boolean }
      partner_ai_watchdog: { Args: never; Returns: Json }
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
      partner_ai_write_cloud: {
        Args: {
          p_content: string
          p_done?: boolean
          p_error?: string
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
      partner_google_status: {
        Args: never
        Returns: {
          connected: boolean
          email: string
          last_ok_at: string
          needs_reconnect: boolean
        }[]
      }
      partner_google_vault_delete: {
        Args: { p_name: string }
        Returns: undefined
      }
      partner_google_vault_get: { Args: { p_name: string }; Returns: string }
      partner_google_vault_put: {
        Args: { p_name: string; p_secret: string }
        Returns: undefined
      }
      partner_mail_known: {
        Args: { p_ids: string[]; p_key: string; p_roster: string }
        Returns: string[]
      }
      partner_mail_targets: { Args: { p_key: string }; Returns: Json }
      partner_may_see_notify: {
        Args: {
          o: Database["public"]["Tables"]["notify_outbox"]["Row"]
          p_staff: string
        }
        Returns: boolean
      }
      partner_pipeline: { Args: never; Returns: Json }
      partner_report_error: {
        Args: { p_detail?: string; p_where: string }
        Returns: Json
      }
      partner_roster_name: { Args: never; Returns: string }
      partner_set_place: {
        Args: {
          p_label: string
          p_lat: number
          p_lon: number
          p_precise?: boolean
        }
        Returns: undefined
      }
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
      pi_bestly_ig_media: { Args: never; Returns: number }
      pi_bestly_ig_recent: { Args: never; Returns: number }
      pi_brand_ig_media: { Args: { p_brand: string }; Returns: number }
      pi_client_media_key: { Args: never; Returns: string }
      pi_hoku_pause_publishing: { Args: never; Returns: undefined }
      pi_hoku_prepost_check: { Args: never; Returns: Json }
      pi_http_result: { Args: { p_id: number }; Returns: Json }
      pi_job_report: {
        Args: {
          p_duration_ms?: number
          p_job: string
          p_ok: boolean
          p_summary: string
        }
        Returns: Json
      }
      pi_jobs_watch: { Args: never; Returns: number }
      pi_secret: { Args: { p_name: string }; Returns: string }
      pi_secret_get: { Args: { p_name: string }; Returns: string }
      pi_secret_put: {
        Args: { p_name: string; p_value: string }
        Returns: boolean
      }
      pi_spark_session: { Args: never; Returns: string }
      pi_spark_session_end: { Args: { p_token: string }; Returns: boolean }
      platform_specs: { Args: never; Returns: Json }
      playbook_guard: { Args: { p_rule: string }; Returns: string }
      post_audience_guess: { Args: { p_item: string }; Returns: string }
      post_is_crisis: { Args: { p_item: string }; Returns: boolean }
      post_offers_support: { Args: { p_text: string }; Returns: boolean }
      post_sells_product: { Args: { p_item: string }; Returns: string[] }
      post_visibility: {
        Args: { i: Database["public"]["Tables"]["approval_items"]["Row"] }
        Returns: string[]
      }
      posting_pause_clear: {
        Args: { p_brand?: string; p_by?: string }
        Returns: Json
      }
      posting_pause_set: {
        Args: {
          p_brand?: string
          p_by?: string
          p_hours?: number
          p_reason: string
        }
        Returns: Json
      }
      posting_pause_tick: { Args: never; Returns: Json }
      posting_paused: { Args: { p_brand?: string }; Returns: Json }
      process_user_reports: { Args: never; Returns: Json }
      product_channel: { Args: { c: string }; Returns: string }
      product_clip: { Args: { n: number; t: string }; Returns: string }
      product_n: {
        Args: { many?: string; n: number; one: string }
        Returns: string
      }
      product_status: { Args: never; Returns: Json }
      product_watch: { Args: never; Returns: Json }
      product_watch_safe: { Args: never; Returns: Json }
      product_when: { Args: { p_ts: string }; Returns: string }
      public_catalogue: {
        Args: never
        Returns: {
          brand: string
          description: string
          in_stock: boolean
          max_qty: number
          name: string
          net_content: string
          pool_on_hand: number
          pool_sku: string
          price_cents: number
          sku: string
          units_per_pack: number
        }[]
      }
      purge_expired_admin_auth: { Args: never; Returns: undefined }
      purge_expired_enrol_codes: { Args: never; Returns: undefined }
      purge_old_bestly_mail: { Args: never; Returns: undefined }
      push_service_key_ok: { Args: { p_key: string }; Returns: boolean }
      push_vapid_get: { Args: never; Returns: Json }
      push_vapid_init: {
        Args: { p_mailto: string; p_private: string; p_public: string }
        Returns: Json
      }
      push_vapid_public: { Args: never; Returns: string }
      push_web_send: {
        Args: {
          p_audience?: string
          p_body?: string
          p_severity?: string
          p_tag?: string
          p_title: string
          p_url?: string
          p_user_id?: string
        }
        Returns: number
      }
      re_intake_failed: {
        Args: { p_job_ref: string; p_note?: string; p_token: string }
        Returns: Json
      }
      re_intake_guard_watch: { Args: never; Returns: Json }
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
      re_listing_gate: { Args: { p_listing: string }; Returns: string }
      re_listing_put: {
        Args: { p_bundle: Json; p_token: string }
        Returns: Json
      }
      re_listing_reroute: { Args: { p_listing: string }; Returns: Json }
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
      recut_components_of: { Args: { p_text: string }; Returns: string[] }
      reminders_todo_sync: {
        Args: { p_known?: string[]; p_ops?: Json }
        Returns: Json
      }
      reorg_context: { Args: never; Returns: Json }
      reorg_farewell_get: { Args: { p_id: string }; Returns: Json }
      reorg_handover_view: { Args: { p_id: string }; Returns: Json }
      reorg_save: { Args: { p_moves: Json }; Returns: number }
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
      rg_apply_pace: { Args: never; Returns: Json }
      rg_archive_call: {
        Args: { p_archive?: boolean; p_id: string }
        Returns: undefined
      }
      rg_assign_openers: { Args: { p_n: number }; Returns: string[] }
      rg_ava_calls: {
        Args: never
        Returns: {
          at: string
          booked: boolean
          connected: boolean
          day: string
          dm: boolean
          duration_sec: number
          id: string
          outcome: string
          pitched: boolean
          transcript: Json
          wk: string
        }[]
      }
      rg_ava_kpis: { Args: { p_weeks?: number }; Returns: Json }
      rg_ava_review: { Args: never; Returns: Json }
      rg_business_days_between: {
        Args: { a: string; b: string; tz?: string }
        Returns: number
      }
      rg_call_board: {
        Args: { p_limit?: number }
        Returns: {
          attempt: number
          call_id: string
          callback_at: string
          calls: number
          company: string
          dm_name: string
          dm_title: string
          duration_sec: number
          ended_at: string
          has_transcript: boolean
          is_test: boolean
          lead_id: string
          meeting_email: string
          meeting_times: string
          notes: string
          opener_key: string
          outcome: string
          stage: string
          state: string
          summary: string
          timezone: string
          to_number: string
        }[]
      }
      rg_call_cost: {
        Args: {
          c: Database["public"]["Tables"]["rg_calls"]["Row"]
          s: Database["public"]["Tables"]["rg_settings"]["Row"]
        }
        Returns: number
      }
      rg_call_queue: {
        Args: { p_limit?: number }
        Returns: {
          attempt: number
          call_status: string
          company: string
          contact_name: string
          contact_title: string
          lead_id: string
          line_type: string
          local_time: string
          max_attempts: number
          next_call_at: string
          phone: string
          priority: number
          ready_now: boolean
          reason: string
          state: string
          timezone: string
          total: number
        }[]
      }
      rg_call_stats: { Args: never; Returns: Json }
      rg_caller_action: { Args: { p_action: string }; Returns: number }
      rg_claim_batch: {
        Args: { p_limit?: number }
        Returns: {
          additional_contacts: string | null
          call_attempts: number
          call_status: string
          category: string
          claimed_at: string | null
          company: string
          contacts: Json
          created_at: string
          dnc: boolean
          enrich_attempts: number
          enrich_error: string | null
          enrich_status: string
          enriched_at: string | null
          escalate: boolean
          footprint: string | null
          id: string
          last_called_at: string | null
          line_type: string
          line_type_checked_at: string | null
          next_call_at: string | null
          notes: string | null
          phone: string | null
          phone_candidates: Json
          phone_confidence: number | null
          phone_source: string | null
          phone_source_url: string | null
          pitch: string
          pitch_original: string | null
          pitch_source: string
          priority: number
          risk_tier: string
          roof_volume: string | null
          site_model: string | null
          state: string
          timezone: string
          updated_at: string
          website: string | null
          wikidata_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "rg_leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      rg_coach_notes: { Args: never; Returns: Json }
      rg_costs: { Args: never; Returns: Json }
      rg_daily_report: { Args: never; Returns: Json }
      rg_deal_add: {
        Args: {
          p_company: string
          p_monthly_cut?: number
          p_note?: string
          p_signed_on?: string
          p_sqft?: number
        }
        Returns: undefined
      }
      rg_deal_delete: { Args: { p_id: string }; Returns: undefined }
      rg_delete_call: { Args: { p_id: string }; Returns: undefined }
      rg_demo_call_cost: { Args: { p_call_id: string }; Returns: Json }
      rg_econ_set: { Args: { p: Json }; Returns: undefined }
      rg_followups_list: {
        Args: never
        Returns: {
          company: string
          contact_name: string
          due_at: string
          id: string
          is_test: boolean
          lead_id: string
          note: string
          reminded_at: string
          result_call_id: string
          status: string
          timezone: string
          to_number: string
        }[]
      }
      rg_followups_tick: { Args: never; Returns: Json }
      rg_import: { Args: { p_rows: Json; p_token: string }; Returns: number }
      rg_inbound_calls: { Args: { p_limit?: number }; Returns: Json }
      rg_key_put: { Args: { p_name: string; p_value: string }; Returns: string }
      rg_kick: { Args: never; Returns: number }
      rg_lead_calls: {
        Args: { p_lead: string }
        Returns: {
          attempt: number
          call_id: string
          callback_at: string
          dm_name: string
          dm_title: string
          duration_sec: number
          ended_at: string
          is_test: boolean
          meeting_email: string
          meeting_times: string
          notes: string
          opener_key: string
          outcome: string
          summary: string
          transcript: Json
        }[]
      }
      rg_lead_opener_vars: { Args: { p_lead: string }; Returns: Json }
      rg_live_calls: {
        Args: never
        Returns: {
          call_id: string
          company: string
          contact_name: string
          conversation_id: string
          is_test: boolean
          lead_id: string
          opener_key: string
          queued_at: string
          to_number: string
        }[]
      }
      rg_log_call: {
        Args: {
          p_callback_at?: string
          p_conversation_id: string
          p_dm_name?: string
          p_dm_reached?: boolean
          p_dm_title?: string
          p_duration_sec?: number
          p_kept_talking?: boolean
          p_lead_id: string
          p_meeting_email?: string
          p_meeting_times?: string
          p_notes?: string
          p_opener_key?: string
          p_outcome: string
          p_recording_url?: string
          p_status: string
          p_summary?: string
          p_to_number: string
          p_transcript?: Json
        }
        Returns: Json
      }
      rg_mark_read: { Args: { p_id: string }; Returns: undefined }
      rg_next_call_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempt: number
          category: string
          company: string
          contact_name: string
          contact_title: string
          lead_id: string
          phone: string
          pitch_angle: string
          state: string
          timezone: string
        }[]
      }
      rg_opener_scores: {
        Args: never
        Returns: {
          active: boolean
          book_rate: number
          booked: number
          calls: number
          kept_talking: number
          key: string
          label: string
          reached: number
          score: number
        }[]
      }
      rg_pip_close: {
        Args: { p_note?: string; p_status: string }
        Returns: undefined
      }
      rg_pip_open: {
        Args: { p_reason?: string; p_target?: number }
        Returns: string
      }
      rg_pip_open_internal: {
        Args: { p_reason: string; p_target?: number; p_trigger: string }
        Returns: string
      }
      rg_playbook_decide: { Args: never; Returns: Json }
      rg_record_call: {
        Args: {
          p_callback_at?: string
          p_conversation_id: string
          p_dm_name?: string
          p_dm_title?: string
          p_duration_sec?: number
          p_lead_id: string
          p_meeting_email?: string
          p_meeting_times?: string
          p_notes?: string
          p_outcome: string
          p_recording_url?: string
          p_status: string
          p_summary?: string
          p_to_number: string
          p_transcript?: Json
        }
        Returns: Json
      }
      rg_review_calc: { Args: never; Returns: Json }
      rg_review_tick: { Args: never; Returns: Json }
      rg_review_tick_safe: { Args: never; Returns: Json }
      rg_secret: { Args: { p_name: string }; Returns: string }
      rg_secret_put: {
        Args: { p_name: string; p_value: string }
        Returns: undefined
      }
      rg_secret_status: { Args: never; Returns: Json }
      rg_stage: {
        Args: {
          p_attempts: number
          p_call_status: string
          p_max: number
          p_outcome: string
        }
        Returns: string
      }
      rg_stats: { Args: never; Returns: Json }
      rg_watch: { Args: never; Returns: Json }
      rg_watch_calls: { Args: never; Returns: Json }
      rg_weekly_review: { Args: never; Returns: Json }
      run_maintenance_cron: { Args: never; Returns: Json }
      scout_auto_run: { Args: never; Returns: boolean }
      scout_auto_run_set: { Args: { p_on: boolean }; Returns: boolean }
      scout_cap_boost: {
        Args: { p_by?: string; p_extra?: number; p_reason?: string }
        Returns: Json
      }
      scout_daily_set: {
        Args: { p_id: string; p_status: string }
        Returns: Json
      }
      scout_digest: { Args: never; Returns: Json }
      scout_file_watchdog: { Args: never; Returns: Json }
      scout_files_prune: { Args: never; Returns: Json }
      scout_free_watch: { Args: never; Returns: Json }
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
      scout_paid_ai_set: { Args: { p_on: boolean }; Returns: boolean }
      scout_paid_apply: {
        Args: {
          p_by: string
          p_minutes: number
          p_on: boolean
          p_reason: string
        }
        Returns: Json
      }
      scout_paid_fns: { Args: never; Returns: string[] }
      scout_paid_spend: { Args: never; Returns: Json }
      scout_paid_state_ro: { Args: never; Returns: Json }
      scout_paid_tick: { Args: never; Returns: Json }
      scout_paid_watch: { Args: never; Returns: Json }
      scout_prefs: { Args: never; Returns: Json }
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
      security_recheck_tick: { Args: never; Returns: Json }
      security_recheck_watchdog: { Args: never; Returns: Json }
      security_run_finish: {
        Args: { p_failed?: boolean; p_run: string; p_summary?: string }
        Returns: Json
      }
      security_run_start: {
        Args: { p_inventory?: Json; p_trigger?: string }
        Returns: string
      }
      security_scan_pi: { Args: { p_run: string }; Returns: undefined }
      semver_key: { Args: { p: string }; Returns: number[] }
      sent_mail_watchdog: { Args: never; Returns: Json }
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
      social_connect_mint:
        | { Args: { p_by: string; p_client: string }; Returns: string }
        | {
            Args: { p_by: string; p_client: string; p_platform?: string }
            Returns: string
          }
      social_default_at: {
        Args: { p_brand: string; p_date: string }
        Returns: string
      }
      social_disconnect: {
        Args: { p_by: string; p_client: string; p_platform: string }
        Returns: Json
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
      social_engine_watch: { Args: never; Returns: Json }
      social_enqueue_item:
        | {
            Args: {
              p_actor: string
              p_at: string
              p_force?: boolean
              p_item: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_actor: string
              p_at: string
              p_force?: boolean
              p_item: string
              p_platform?: string
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
      staff_display: { Args: { p: string }; Returns: string }
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
      stripe_key_intake: {
        Args: { p_nonce: string; p_value: string }
        Returns: string
      }
      stripe_price_set: {
        Args: { p_name: string; p_value: string }
        Returns: string
      }
      stripe_secret: { Args: { p_name: string }; Returns: string }
      stripe_watchdog: { Args: { p_probe?: boolean }; Returns: Json }
      stripe_webhook_secret_set: { Args: { p_value: string }; Returns: string }
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
      studio_ask_decide: {
        Args: {
          p_ask: string
          p_decision: string
          p_note?: string
          p_token: string
        }
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
      studio_ask_note: {
        Args: {
          p_ask: string
          p_note: string
          p_parent?: string
          p_token: string
        }
        Returns: Json
      }
      studio_ask_note_delete: {
        Args: { p_review: string; p_token: string }
        Returns: Json
      }
      studio_ask_note_edit: {
        Args: { p_note: string; p_review: string; p_token: string }
        Returns: Json
      }
      studio_ask_pull: {
        Args: { p_ask: string; p_token: string }
        Returns: Json
      }
      studio_ask_send: {
        Args: { p_ask: string; p_force?: boolean; p_token: string }
        Returns: Json
      }
      studio_ask_signoff: { Args: { p_ask: string }; Returns: Json }
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
      studio_audience: {
        Args: { p_audience: string; p_item: string; p_token: string }
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
      studio_board_slim: {
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
      studio_build_key: { Args: never; Returns: string }
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
      studio_client_people: {
        Args: { p_slug: string; p_token: string }
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
      studio_feedback_override: {
        Args: {
          p_review: string
          p_token: string
          p_undo?: boolean
          p_why: string
        }
        Returns: Json
      }
      studio_feedback_triage: {
        Args: {
          p_action: string
          p_reply?: string
          p_review: string
          p_send?: boolean
          p_token: string
        }
        Returns: Json
      }
      studio_frames_check: { Args: never; Returns: Json }
      studio_heals_recent: { Args: { p_minutes?: number }; Returns: number }
      studio_history: {
        Args: { p_item: string; p_token: string }
        Returns: Json
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
      studio_inbox_act: {
        Args: {
          p_id: string
          p_kind: string
          p_label: string
          p_request_id?: string
          p_token: string
        }
        Returns: Json
      }
      studio_inbox_get: {
        Args: { p_id: string; p_token: string }
        Returns: Json
      }
      studio_inbox_list: {
        Args: { p_limit?: number; p_status?: string; p_token: string }
        Returns: Json
      }
      studio_inbox_set: {
        Args: { p_id: string; p_status: string; p_token: string }
        Returns: Json
      }
      studio_is_demo: {
        Args: { p_ctx: Json; p_slug: string; p_title: string }
        Returns: boolean
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
      studio_item_platforms: {
        Args: { p_item: string; p_platforms: string[]; p_token: string }
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
        Args: {
          p_date: string
          p_item: string
          p_time?: string
          p_token: string
        }
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
      studio_mail_key_ok: {
        Args: { p_key: string; p_name: string }
        Returns: boolean
      }
      studio_mail_next_uid: { Args: never; Returns: number }
      studio_mail_visible: {
        Args: { p_slug: string; p_staff: string }
        Returns: boolean
      }
      studio_mail_watch: { Args: never; Returns: Json }
      studio_mark_posted: {
        Args: {
          p_item: string
          p_note?: string
          p_on?: boolean
          p_token: string
        }
        Returns: Json
      }
      studio_member_note_call: {
        Args: {
          p_call: string
          p_note?: string
          p_review: string
          p_token: string
        }
        Returns: Json
      }
      studio_member_notes: {
        Args: { p_slug?: string; p_token: string }
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
      studio_move_to_posted: {
        Args: { p_item: string; p_on?: boolean; p_token: string }
        Returns: Json
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
      studio_origin_watch: { Args: never; Returns: Json }
      studio_origins: {
        Args: { p_client_slug: string; p_token: string }
        Returns: Json
      }
      studio_override_clear: {
        Args: { p_client?: string; p_token: string }
        Returns: Json
      }
      studio_override_for: { Args: { p_client: string }; Returns: Json }
      studio_override_get: {
        Args: { p_client: string; p_token: string }
        Returns: Json
      }
      studio_override_set: {
        Args: {
          p_client: string
          p_days: number
          p_reason: string
          p_token: string
        }
        Returns: Json
      }
      studio_passkey_remove: {
        Args: { p_passkey: string; p_token: string }
        Returns: Json
      }
      studio_person_code: {
        Args: {
          p_hours?: number
          p_person: string
          p_slug: string
          p_token: string
        }
        Returns: Json
      }
      studio_person_remove_passkeys: {
        Args: { p_person: string; p_slug: string; p_token: string }
        Returns: Json
      }
      studio_person_set: {
        Args: {
          p_patch: Json
          p_person: string
          p_slug: string
          p_token: string
        }
        Returns: Json
      }
      studio_ping: { Args: { p_token: string }; Returns: Json }
      studio_post_cancel: {
        Args: { p_item: string; p_platform: string; p_token: string }
        Returns: Json
      }
      studio_post_now: {
        Args: {
          p_item: string
          p_platforms?: string[]
          p_token: string
          p_when?: string
        }
        Returns: Json
      }
      studio_posting_gate: { Args: { p_item: string }; Returns: Json }
      studio_posting_set: {
        Args: { p_patch: Json; p_slug: string; p_token: string }
        Returns: Json
      }
      studio_posting_state: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
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
        Args: { p_force?: boolean; p_item: string; p_token: string }
        Returns: Json
      }
      studio_read_state: {
        Args: { p_client_slug: string; p_token: string }
        Returns: Json
      }
      studio_recut_batch_brief: {
        Args: { p_code: string; p_token: string }
        Returns: Json
      }
      studio_recut_batch_done: {
        Args: {
          p_cancel?: boolean
          p_code: string
          p_item?: string
          p_token: string
        }
        Returns: Json
      }
      studio_recut_check: { Args: never; Returns: Json }
      studio_recut_handoff: {
        Args: { p_items?: string[]; p_slug?: string; p_token: string }
        Returns: Json
      }
      studio_recut_plan: {
        Args: { p_slug?: string; p_token: string }
        Returns: Json
      }
      studio_recut_spec_set: {
        Args: {
          p_blocker?: string
          p_component: string
          p_drop?: boolean
          p_slug: string
          p_spec?: string
          p_token: string
        }
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
      studio_remind: {
        Args: { p_client: string; p_confirm?: boolean; p_token: string }
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
      studio_send_all: {
        Args: { p_client: string; p_confirm?: boolean; p_token: string }
        Returns: Json
      }
      studio_settings: { Args: { p_token: string }; Returns: Json }
      studio_setup_link_mint: { Args: { p_hours?: number }; Returns: string }
      studio_setup_link_ok: { Args: { p_sha: string }; Returns: boolean }
      studio_ship_sign_poll: { Args: { p_req: number }; Returns: Json }
      studio_ship_sign_upload: { Args: { p_path: string }; Returns: number }
      studio_signoff: { Args: { p_item: string }; Returns: Json }
      studio_social_connect_link: {
        Args: { p_platform?: string; p_slug: string; p_token: string }
        Returns: Json
      }
      studio_social_disconnect: {
        Args: { p_platform: string; p_slug: string; p_token: string }
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
      studio_sources: {
        Args: { p_item: string; p_token: string }
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
      studio_state_check: { Args: never; Returns: Json }
      studio_talk: {
        Args: { p_limit?: number; p_room?: string; p_token: string }
        Returns: Json
      }
      studio_theme_from_guide: {
        Args: { p_slug: string; p_token: string }
        Returns: Json
      }
      studio_tiktok_app_get: { Args: never; Returns: Json }
      studio_tiktok_app_set: {
        Args: { p_client_key: string; p_client_secret: string }
        Returns: Json
      }
      studio_tiktok_ready: { Args: never; Returns: boolean }
      studio_todo_upsert: {
        Args: {
          p_client: string
          p_detail?: string
          p_due?: string
          p_forward?: Json
          p_id?: string
          p_source?: Json
          p_status?: string
          p_title: string
          p_token: string
        }
        Returns: Json
      }
      studio_todos: {
        Args: { p_client: string; p_token: string }
        Returns: Json
      }
      studio_tool_sign: { Args: { p_path: string }; Returns: number }
      studio_touch_session: { Args: { p_token: string }; Returns: undefined }
      studio_trail: {
        Args: { p_id: string; p_kind: string; p_token: string }
        Returns: Json
      }
      studio_ui_contract_check: { Args: never; Returns: Json }
      studio_ui_contract_request: { Args: never; Returns: number }
      studio_unpromote: {
        Args: { p_force?: boolean; p_item: string; p_token: string }
        Returns: Json
      }
      studio_version_restore: {
        Args: {
          p_item: string
          p_media_url?: string
          p_token: string
          p_version?: number
        }
        Returns: Json
      }
      studio_versions: {
        Args: { p_item: string; p_token: string }
        Returns: Json
      }
      studio_view_as: {
        Args: { p_client: string; p_token: string }
        Returns: Json
      }
      studio_visibility: {
        Args: { p_client: string; p_token: string }
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
      supercharge_audit: { Args: never; Returns: Json }
      supercharge_audit_data: { Args: never; Returns: Json }
      supercharge_audit_settle: {
        Args: { p_on: boolean; p_rid: number }
        Returns: Json
      }
      supercharge_audit_tick: { Args: never; Returns: Json }
      supercharge_ingest: { Args: never; Returns: number }
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
      t_ended_long_ago: { Args: { p_at: string }; Returns: boolean }
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
          p_audience?: string
          p_dedupe?: string
          p_kind: string
          p_line: string
          p_many?: string
          p_payload?: Json
        }
        Returns: undefined
      }
      talk_team_room: { Args: never; Returns: string }
      team_assign_jobs: { Args: { p: Json }; Returns: number }
      team_discover: { Args: never; Returns: number }
      team_health: {
        Args: { p_at: string; p_ok: boolean; p_pulse: Json; p_status: string }
        Returns: string
      }
      team_is_admin: { Args: never; Returns: boolean }
      team_mood_cause: {
        Args: { p_runs_on: string; p_silent: boolean; p_text: string }
        Returns: string
      }
      team_mood_compute: {
        Args: never
        Returns: {
          cause: string
          complaint: string
          mood: string
          slug: string
          stats: Json
        }[]
      }
      team_mood_sweep: { Args: never; Returns: Json }
      team_mood_sweep_safe: { Args: never; Returns: Json }
      team_onboard: { Args: { p: Json }; Returns: number }
      team_one_on_one_add: {
        Args: { p_note: Json; p_slug: string }
        Returns: undefined
      }
      team_pulses: {
        Args: never
        Returns: {
          last_at: string
          last_ok: boolean
          slug: string
          summary: string
        }[]
      }
      team_role_apply: { Args: { p: Json }; Returns: number }
      team_roster_scan: { Args: { p_quiet?: boolean }; Returns: Json }
      team_roster_scan_safe: { Args: never; Returns: Json }
      team_roster_selfheal: { Args: never; Returns: Json }
      team_union_info: { Args: { p_cause: string }; Returns: Json }
      team_watch: { Args: never; Returns: Json }
      team_watch_ping: { Args: { p_token?: string }; Returns: Json }
      team_welcome_get: { Args: { p_slug: string }; Returns: Json }
      team_welcome_mark: {
        Args: {
          p_error?: string
          p_ok: boolean
          p_profile?: Json
          p_slug: string
        }
        Returns: undefined
      }
      team_welcome_sweep: { Args: never; Returns: number }
      tesla_access_watchdog: { Args: never; Returns: string }
      tesla_admin_command: { Args: { p_action: string }; Returns: Json }
      tesla_admin_job: { Args: { p_id: number }; Returns: Json }
      tesla_admin_set_enabled: { Args: { p_on: boolean }; Returns: undefined }
      tesla_app_access_parse: {
        Args: { m: Database["public"]["Tables"]["bestly_mail"]["Row"] }
        Returns: undefined
      }
      tesla_climate_autooff: { Args: never; Returns: number }
      tesla_climate_autooff_watchdog: { Args: never; Returns: undefined }
      tesla_climate_session: { Args: never; Returns: Json }
      tesla_data_watchdog: { Args: never; Returns: string }
      tesla_fleet_admin_state: { Args: never; Returns: Json }
      tesla_fleet_month: { Args: never; Returns: Json }
      tesla_fleet_secrets: { Args: never; Returns: Json }
      tesla_fleet_set_secret: { Args: { p_secret: string }; Returns: Json }
      tesla_fleet_spend: {
        Args: {
          p_admin?: boolean
          p_detail?: Json
          p_kind: string
          p_reservation?: number
        }
        Returns: boolean
      }
      tesla_fleet_store_tokens: {
        Args: { p_access: string; p_expires_at: string; p_refresh: string }
        Returns: undefined
      }
      tesla_fleet_token_scopes: { Args: never; Returns: Json }
      tesla_fresh_reading: { Args: never; Returns: boolean }
      tesla_guest_action: { Args: { a: string }; Returns: boolean }
      tesla_job_done: {
        Args: { p_id: number; p_ok: boolean; p_result: Json; p_state?: Json }
        Returns: undefined
      }
      tesla_key_admin: {
        Args: { p_action: string; p_reservation: number }
        Returns: Json
      }
      tesla_key_enqueue: {
        Args: { p_action: string; p_args?: Json; p_res: number }
        Returns: boolean
      }
      tesla_key_kind_ok: {
        Args: { p_airport: string; p_starts: string }
        Returns: boolean
      }
      tesla_keys_tick: { Args: never; Returns: Json }
      tesla_keys_watchdog: { Args: never; Returns: Json }
      tesla_refresh_tick: { Args: never; Returns: string }
      tesla_worker_alive_watch: { Args: never; Returns: Json }
      tesla_worker_claim: {
        Args: { p_token: string; p_version?: string }
        Returns: Json
      }
      tesla_worker_done: {
        Args: {
          p_id: number
          p_ok: boolean
          p_result: Json
          p_state?: Json
          p_token: string
        }
        Returns: undefined
      }
      tesla_worker_ok: { Args: { p_token: string }; Returns: boolean }
      tesla_worker_spend: {
        Args: {
          p_admin: boolean
          p_kind: string
          p_reservation: number
          p_token: string
        }
        Returns: boolean
      }
      tesla_worker_stage: {
        Args: { p_id: number; p_stage: string; p_token: string }
        Returns: undefined
      }
      tesla_worker_store_tokens: {
        Args: {
          p_access: string
          p_expires_at: string
          p_refresh: string
          p_token: string
        }
        Returns: undefined
      }
      tesla_worker_version_watchdog: { Args: never; Returns: Json }
      text_overlap: { Args: { a: string; b: string }; Returns: number }
      tezlab_admin_state: { Args: never; Returns: Json }
      tezlab_down: { Args: { p_error: string }; Returns: undefined }
      tezlab_job_claim: { Args: { p_id: number }; Returns: boolean }
      tezlab_job_fallback: {
        Args: { p_error: string; p_id: number }
        Returns: undefined
      }
      tezlab_job_get: { Args: { p_id: number }; Returns: Json }
      tezlab_job_stage: {
        Args: { p_id: number; p_stage: string }
        Returns: undefined
      }
      tezlab_ok: { Args: never; Returns: undefined }
      tezlab_only_action: { Args: { a: string }; Returns: boolean }
      tezlab_ready: { Args: never; Returns: boolean }
      tezlab_secrets: { Args: never; Returns: Json }
      tezlab_store_tokens: {
        Args: { p_access: string; p_expires_at: string; p_refresh: string }
        Returns: undefined
      }
      tezlab_up: { Args: never; Returns: boolean }
      tezlab_watchdog: { Args: never; Returns: Json }
      todo_check_claim: {
        Args: { p_n: number }
        Returns: {
          allow_close: boolean
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          result: Json | null
          run_id: string | null
          started_at: string | null
          status: string
          todo_id: string
          trigger: string
        }[]
        SetofOptions: {
          from: "*"
          to: "todo_check_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      todo_check_drain: { Args: never; Returns: Json }
      todo_check_feedback: {
        Args: { p_check: string; p_kind: string; p_note?: string }
        Returns: Json
      }
      todo_check_github_token: { Args: never; Returns: string }
      todo_check_job_done: {
        Args: { p_error: string; p_job: string; p_ok: boolean; p_result: Json }
        Returns: Json
      }
      todo_check_set_auto: { Args: { p_on: boolean }; Returns: Json }
      todo_check_tune: { Args: never; Returns: Json }
      todo_check_watchdog: { Args: never; Returns: Json }
      todo_evidence: {
        Args: { p_exclude?: string; p_since: string; p_terms: string[] }
        Returns: Json
      }
      todo_evidence_sent: {
        Args: { p_since: string; p_terms: string[] }
        Returns: Json
      }
      todo_link_label: { Args: { p_url: string }; Returns: string }
      todo_monitor_rules: { Args: { p_run: string }; Returns: Json }
      todo_owner_norm: { Args: { p_owner: string }; Returns: string }
      todo_owner_watchdog: { Args: never; Returns: Json }
      todo_set_owner: { Args: { p_id: string; p_owner: string }; Returns: Json }
      tomtom_key_put_once: { Args: { p_key: string }; Returns: string }
      trip_car_wash: { Args: { p_token: string }; Returns: Json }
      trip_car_wash_nav: { Args: { p_token: string }; Returns: Json }
      trip_changes_sync: { Args: never; Returns: Json }
      trip_changes_watchdog: { Args: never; Returns: Json }
      trip_charge_window_end: { Args: { p_res: number }; Returns: string }
      trip_charges_admin: { Args: { p_reservation: number }; Returns: Json }
      trip_charges_for: { Args: { p_res: number }; Returns: Json }
      trip_charges_health: { Args: never; Returns: undefined }
      trip_charges_refresh: { Args: { p_reservation: number }; Returns: Json }
      trip_charges_tick: { Args: never; Returns: Json }
      trip_dist_m: {
        Args: { lat1: number; lat2: number; lon1: number; lon2: number }
        Returns: number
      }
      trip_drive_attribution: {
        Args: { p_res: number }
        Returns: {
          basis: string
          drive_id: string
          driver_name: string
          ended_at: string
          from_name: string
          max_mph: number
          miles: number
          started_at: string
          to_name: string
        }[]
      }
      trip_guest_push_tick: { Args: never; Returns: Json }
      trip_health_admin: { Args: { p_run?: boolean }; Returns: Json }
      trip_health_agent: { Args: never; Returns: undefined }
      trip_health_expected_crons: {
        Args: never
        Returns: {
          command: string
          jobname: string
          max_gap: string
          schedule: string
        }[]
      }
      trip_health_run: { Args: never; Returns: Json }
      trip_health_set: {
        Args: {
          p_detail?: string
          p_heal_note?: string
          p_key: string
          p_label: string
          p_status: string
        }
        Returns: undefined
      }
      trip_health_web: {
        Args: { p_detail: string; p_status: string }
        Returns: undefined
      }
      trip_push_link: { Args: { p_token: string }; Returns: number }
      trip_range_check_for: { Args: { p_res: number }; Returns: Json }
      trip_receipt_data: {
        Args: { p_invoice?: string; p_token: string }
        Returns: Json
      }
      trip_return_detect: { Args: never; Returns: number }
      trip_returned_at: { Args: { p_res: number }; Returns: string }
      trip_supercharger_nav: {
        Args: { p_lat: number; p_lon: number; p_token: string }
        Returns: Json
      }
      trip_superchargers: { Args: { p_token: string }; Returns: Json }
      trip_ui_watchdog: { Args: never; Returns: Json }
      trip_unlock_start: { Args: { p_token: string }; Returns: Json }
      trip_valet_consent: {
        Args: { p_token: string; p_ua?: string; p_version: string }
        Returns: Json
      }
      trip_valet_state: { Args: { p_token: string }; Returns: Json }
      turo_breadcrumbs: { Args: never; Returns: Json }
      turo_driver_approvals_sync: { Args: never; Returns: number }
      turo_email_ts: { Args: { p: string }; Returns: string }
      turo_enrich_from_mail: { Args: never; Returns: number }
      turo_guest_funnel: { Args: { p_days?: number }; Returns: Json }
      turo_inbox_put: {
        Args: { p_items: Json; p_token: string }
        Returns: Json
      }
      turo_link_admin: {
        Args: { p_action?: string; p_reservation: number }
        Returns: Json
      }
      turo_link_body: { Args: { p_res: number }; Returns: string }
      turo_link_enqueue: { Args: never; Returns: number }
      turo_mail_time: { Args: { p: string }; Returns: string }
      turo_reader_fresh: { Args: { p_token: string }; Returns: boolean }
      turo_reader_note: {
        Args: {
          p_error?: string
          p_inbox?: boolean
          p_signed_in: boolean
          p_token: string
          p_trips?: boolean
          p_version?: string
        }
        Returns: Json
      }
      turo_reader_watchdog: { Args: never; Returns: Json }
      turo_reimbursements: {
        Args: never
        Returns: {
          charging: number
          paid: boolean
          paid_at: string
          requested: number
          requested_at: string
          reservation_id: number
        }[]
      }
      turo_sender_claim: {
        Args: { p_token: string; p_version?: string }
        Returns: Json
      }
      turo_sender_done: {
        Args: {
          p_error?: string
          p_ok: boolean
          p_res: number
          p_token: string
          p_verified?: boolean
        }
        Returns: undefined
      }
      turo_sender_note: {
        Args: { p_error?: string; p_ingest?: Json; p_token: string }
        Returns: undefined
      }
      turo_sender_watchdog: { Args: never; Returns: Json }
      turo_settings_set: {
        Args: { p_note?: string; p_paused?: boolean; p_reason?: string }
        Returns: Json
      }
      turo_trip_tags: { Args: { p_res: number }; Returns: Json }
      turo_trip_windows: {
        Args: never
        Returns: {
          ends_at: string
          guest: string
          reservation_id: number
          source: string
          starts_at: string
        }[]
      }
      turo_watchdog: { Args: never; Returns: Json }
      turo_widget: { Args: never; Returns: Json }
      upload_exists: { Args: { p_path: string }; Returns: boolean }
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
      vercel_bypass_secret: { Args: never; Returns: string }
      version_checkpoint: {
        Args: {
          p_item: string
          p_kind: string
          p_label?: string
          p_staff?: string
        }
        Returns: undefined
      }
      vesta_admin_status: { Args: never; Returns: Json }
      vesta_watch_secrets: { Args: never; Returns: Json }
      waitlist_admin: {
        Args: { _brand?: string; _limit?: number }
        Returns: Json
      }
      wall_admin_air: { Args: never; Returns: Json }
      wall_admin_command: { Args: { p_cmd: string }; Returns: Json }
      wall_admin_emoji_action: {
        Args: { p_action: string; p_id?: number }
        Returns: Json
      }
      wall_admin_emojis: { Args: never; Returns: Json }
      wall_admin_get: { Args: never; Returns: Json }
      wall_admin_packages: { Args: never; Returns: Json }
      wall_admin_power: { Args: { p_on: boolean }; Returns: Json }
      wall_admin_set: { Args: { p_patch: Json }; Returns: Json }
      wall_admin_sign_action: {
        Args: { p_action: string; p_id?: number }
        Returns: Json
      }
      wall_admin_signs: { Args: never; Returns: Json }
      wall_admin_voice: { Args: never; Returns: Json }
      wall_apply_patch: {
        Args: { p_patch: Json }
        Returns: {
          channel: string
          id: number
          power: Json
          pulled_at: string | null
          state: Json
          status: Json | null
          status_at: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "wall_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      wall_badge_email_gate: {
        Args: { p_email: string; p_token: string }
        Returns: Json
      }
      wall_clean_ledsign: { Args: { p: Json }; Returns: Json }
      wall_clean_patch: { Args: { p: Json }; Returns: Json }
      wall_clean_r4admin: { Args: { p: Json }; Returns: Json }
      wall_clean_r4sky: { Args: { p: Json }; Returns: Json }
      wall_clean_r4voice: { Args: { p: Json }; Returns: Json }
      wall_clean_toggles: { Args: { p: Json }; Returns: Json }
      wall_clean_tour: { Args: { p: Json }; Returns: Json }
      wall_clean_wake: { Args: { p: Json }; Returns: Json }
      wall_clean_widgets: { Args: { p: Json }; Returns: Json }
      wall_dnd_eval: { Args: { p_at?: string; p_dnd: Json }; Returns: Json }
      wall_dnd_now: { Args: never; Returns: Json }
      wall_emoji_claim: {
        Args: { p_emoji: string; p_token: string }
        Returns: Json
      }
      wall_emoji_drop_for_sig: {
        Args: { p_reason: string; p_sig: number }
        Returns: number
      }
      wall_emoji_json: {
        Args: { e: Database["public"]["Tables"]["wall_emojis"]["Row"] }
        Returns: Json
      }
      wall_emoji_key: { Args: { p: string }; Returns: string }
      wall_emoji_layout: { Args: { p_only_id?: number }; Returns: number }
      wall_emoji_restore_for_sig: { Args: { p_sig: number }; Returns: number }
      wall_emoji_taken: { Args: { p_token: string }; Returns: Json }
      wall_feed_set: {
        Args: { p_data: Json; p_error?: string; p_kind: string; p_meta?: Json }
        Returns: undefined
      }
      wall_feeds_build_mail: { Args: never; Returns: Json }
      wall_feeds_claude: { Args: never; Returns: Json }
      wall_feeds_energy_tick: { Args: never; Returns: Json }
      wall_feeds_refresh: { Args: never; Returns: Json }
      wall_feeds_turo: { Args: never; Returns: Json }
      wall_feeds_watch: { Args: never; Returns: Json }
      wall_file_drop_fetch: {
        Args: { p_name: string; p_token: string }
        Returns: string
      }
      wall_file_drop_get: {
        Args: { p_name: string; p_token: string }
        Returns: string
      }
      wall_file_drop_put: {
        Args: { p_body: string; p_name: string; p_token: string }
        Returns: Json
      }
      wall_file_drop_send: {
        Args: { p_body: string; p_name: string; p_token: string }
        Returns: Json
      }
      wall_geo_keys: { Args: never; Returns: string[] }
      wall_geo_label: {
        Args: { p_keys: string[]; p_new: Json; p_old: Json }
        Returns: string
      }
      wall_geo_of: { Args: { p_state: Json }; Returns: Json }
      wall_geometry_history_list: { Args: never; Returns: Json }
      wall_geometry_redo: { Args: never; Returns: Json }
      wall_geometry_undo: { Args: never; Returns: Json }
      wall_geometry_watchdog: { Args: never; Returns: Json }
      wall_ha_command: {
        Args: { p_cmd: string; p_token: string }
        Returns: Json
      }
      wall_ha_get: { Args: { p_token: string }; Returns: Json }
      wall_ha_patch: {
        Args: { p_inputs?: Json; p_patch: Json; p_token: string }
        Returns: Json
      }
      wall_ha_power: { Args: { p_on: boolean; p_token: string }; Returns: Json }
      wall_ha_resolve: {
        Args: { inputs: Json; s: Json; v: Json }
        Returns: Json
      }
      wall_mail_line: {
        Args: { p_sender: string; p_summary: string; p_what: string }
        Returns: string
      }
      wall_mail_pieces_done: { Args: { p_rows: Json }; Returns: Json }
      wall_mail_pieces_pending: { Args: never; Returns: Json }
      wall_next_la_ms: {
        Args: { p_after?: string; p_hm: string }
        Returns: number
      }
      wall_one_thing_get: { Args: { p_refresh?: boolean }; Returns: Json }
      wall_one_thing_tick: { Args: never; Returns: Json }
      wall_one_thing_watchdog: { Args: never; Returns: Json }
      wall_package_done: {
        Args: { p_done: boolean; p_id: number }
        Returns: Json
      }
      wall_package_key: { Args: { p: Json }; Returns: string }
      wall_packages_open: { Args: { p_items: Json }; Returns: Json }
      wall_pi_air_put: {
        Args: { p_data: Json; p_token: string }
        Returns: Json
      }
      wall_pi_alarm: {
        Args: { p_action: string; p_token: string; p_until?: number }
        Returns: Json
      }
      wall_pi_emojis: { Args: { p_token: string }; Returns: Json }
      wall_pi_feed_put: {
        Args: {
          p_data: Json
          p_error?: string
          p_kind: string
          p_token: string
        }
        Returns: Json
      }
      wall_pi_feeds: { Args: { p_token: string }; Returns: Json }
      wall_pi_handoff: { Args: { p_token: string }; Returns: Json }
      wall_pi_icloud: { Args: { p_token: string }; Returns: Json }
      wall_pi_key_resend: {
        Args: { p_reservation: number; p_token: string }
        Returns: Json
      }
      wall_pi_mail_label: {
        Args: { p_error?: string; p_rows: Json; p_token: string }
        Returns: Json
      }
      wall_pi_mail_put: {
        Args: { p_digests: Json; p_error?: string; p_token: string }
        Returns: Json
      }
      wall_pi_mail_redo: { Args: { p_token: string }; Returns: Json }
      wall_pi_news_helis: { Args: { p_token: string }; Returns: Json }
      wall_pi_nextcloud: { Args: { p_token: string }; Returns: Json }
      wall_pi_pull: {
        Args: { p_power_seq: number; p_token: string; p_version: number }
        Returns: Json
      }
      wall_pi_push: { Args: { p_status: Json; p_token: string }; Returns: Json }
      wall_pi_scout_items: { Args: { p_token: string }; Returns: Json }
      wall_pi_signs: { Args: { p_token: string }; Returns: Json }
      wall_pi_snapshot: { Args: { p_token: string }; Returns: Json }
      wall_pi_trips: { Args: { p_token: string }; Returns: Json }
      wall_pi_vision_keys: { Args: { p_token: string }; Returns: Json }
      wall_quick_get: { Args: { p_token: string }; Returns: Json }
      wall_quick_set: {
        Args: { p_key: string; p_token: string; p_value: Json }
        Returns: Json
      }
      wall_r4admin_watchdog: { Args: never; Returns: Json }
      wall_r4w2_watch: { Args: never; Returns: Json }
      wall_sig_broadcast: {
        Args: { p_event: string; p_payload: Json }
        Returns: undefined
      }
      wall_sig_cells: {
        Args: { p_n: number }
        Returns: {
          cell_h: number
          ch: number
          cw: number
          cx: number
          cy: number
        }[]
      }
      wall_sig_json: {
        Args: { s: Database["public"]["Tables"]["wall_signatures"]["Row"] }
        Returns: Json
      }
      wall_sig_times_ok: {
        Args: { p_strokes: Json; p_times: Json }
        Returns: boolean
      }
      wall_sign: {
        Args: {
          p_aspect: number
          p_color: string
          p_device: string
          p_name: string
          p_strokes: Json
          p_times?: Json
        }
        Returns: Json
      }
      wall_sign_check: { Args: { p_token: string }; Returns: Json }
      wall_sign_open: {
        Args: { p_code: string; p_device?: string }
        Returns: Json
      }
      wall_sign_reset_keep: { Args: { p_keep: number }; Returns: Json }
      wall_sign_tap: {
        Args: {
          p_aspect: number
          p_color: string
          p_device: string
          p_name: string
          p_strokes: Json
          p_times?: Json
          p_token: string
        }
        Returns: Json
      }
      wall_sign_watchdog: { Args: never; Returns: Json }
      wall_sky_log_prune: { Args: never; Returns: undefined }
      wall_sky_secret_intake: {
        Args: { p_nonce: string; p_secrets: Json }
        Returns: Json
      }
      wall_today: { Args: never; Returns: Json }
      wall_turo_calendar: { Args: { p_days?: number }; Returns: Json }
      wall_turo_notice: {
        Args: {
          p_eye: string
          p_kind: string
          p_res?: number
          p_text?: string
          p_title: string
        }
        Returns: undefined
      }
      wall_turo_ping: {
        Args: { p_key: string; p_text?: string }
        Returns: Json
      }
      wall_turo_ping_kind: { Args: { t: string }; Returns: string }
      wall_turo_trip_cancelled: {
        Args: {
          p_ends: string
          p_first: string
          p_res: number
          p_starts: string
        }
        Returns: undefined
      }
      watchdog_group: { Args: { p_job: string }; Returns: string }
      watchdog_name: { Args: { p_job: string }; Returns: string }
      web_events_prune: { Args: never; Returns: undefined }
      web_events_rollup: { Args: never; Returns: undefined }
      window_signal_note: { Args: never; Returns: string }
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

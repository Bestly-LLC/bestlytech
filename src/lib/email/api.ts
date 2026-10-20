// Data + edge-function access for the Email Builder. One interface (EmailApi) so the admin page uses Supabase and
// the offline preview (src/pages/dev/EmailHarness.tsx) can plug in canned data without a login or a database.
import { supabase } from "@/integrations/supabase/client";
import { resolveKit, type Block, type EmailDoc, type Kit } from "./render";
import { resolvedSeedKits } from "./seedKits";

export interface LibraryRow {
  id: string;
  brand_kit: string;
  title: string;
  subject: string;
  preheader: string | null;
  blocks: Block[];
  html: string;
  text_body: string;
  source: "template" | "built";
  template_slug: string | null;
  brief: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  status: "draft" | "sent";
  created_at: string;
  updated_at: string;
  /** Exact send time, stamped from email_send_log when the column exists. */
  sent_at?: string | null;
}

export interface GenResult { ok: boolean; doc?: EmailDoc; warnings?: string[]; model?: string; provider?: string; attempts?: number; error?: string; detail?: string }
export interface SendResult { ok: boolean; id?: string | null; error?: string; changed?: boolean; detail?: string }
export interface ContactHit { name: string | null; email: string; source: "client" | "icloud" | "recent"; detail: string | null }
export interface VersionRow { id: number; version: number; subject: string | null; blocks: Block[] | null; html: string | null; created_at: string }

export interface EmailApi {
  /** false when the email_* tables are not in the database yet (migration not applied): the page then runs on bundled kits and cannot save. */
  dbReady: boolean;
  kits: Kit[];
  library: LibraryRow[];
  reload: () => Promise<void>;
  save: (row: Partial<LibraryRow> & { brand_kit: string; title: string }) => Promise<LibraryRow>;
  remove: (id: string) => Promise<void>;
  versions: (id: string) => Promise<VersionRow[]>;
  generate: (body: { kit: string; request: string; recipient_name?: string; recipient_email?: string; subject_hint?: string }) => Promise<GenResult>;
  revise: (body: { kit: string; doc: EmailDoc; instruction: string }) => Promise<GenResult>;
  makeImage: (kit: string, prompt: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  exportEml: (i: { html: string; text: string; subject: string; to?: string }) => Promise<{ ok: boolean; eml?: string; inlined?: number; skipped?: string[]; error?: string }>;
  send: (i: { library_id: string; to: string; to_name?: string; subject: string; html_sha: string; attempt: string }) => Promise<SendResult>;
  kitFromClient?: (slug: string) => Promise<string>;
  /** Type-ahead for the To fields: clients, iCloud contacts and recent recipients, already ranked. */
  suggestContacts?: (q: string) => Promise<ContactHit[]>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

async function invoke<T>(fn: string, body: unknown): Promise<T> {
  const { data, error } = await sb.functions.invoke(fn, { body });
  if (error) {
    // supabase-js hides the body of non-2xx answers; read it so the person sees our sentence, not "Edge Function returned a non-2xx".
    let msg = error.message as string;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; return { ok: false, error: msg, ...(j ?? {}) } as T; } catch { /* keep generic */ }
    return { ok: false, error: msg } as T;
  }
  return data as T;
}

export async function loadEmailData(): Promise<{ dbReady: boolean; kits: Kit[]; library: LibraryRow[] }> {
  const [k, l] = await Promise.all([
    sb.from("email_brand_kits").select("*").eq("active", true).order("sort", { ascending: true }),
    sb.from("email_library").select("*").order("updated_at", { ascending: false }).limit(300),
  ]);
  if (k.error) return { dbReady: false, kits: resolvedSeedKits(), library: [] };
  if (!k.data?.length) return { dbReady: true, kits: resolvedSeedKits(), library: (l.data ?? []) as LibraryRow[] };
  const rows = Object.fromEntries((k.data as Kit[]).map((r) => [r.slug, r])) as Record<string, Kit & { extends?: string | null }>;
  const kits = (k.data as (Kit & { extends?: string | null })[]).map((r) => resolveKit(r, rows));
  return { dbReady: !l.error, kits, library: (l.data ?? []) as LibraryRow[] };
}

export function createEmailApi(state: { dbReady: boolean; kits: Kit[]; library: LibraryRow[] }, reload: () => Promise<void>): EmailApi {
  return {
    ...state,
    reload,
    async save(row) {
      const clean = { ...row } as Record<string, unknown>;
      delete clean.created_at; delete clean.updated_at; delete clean.sent_at;
      const q = row.id ? sb.from("email_library").update(clean).eq("id", row.id) : sb.from("email_library").insert(clean);
      const { data, error } = await q.select("*").single();
      if (error) throw new Error(error.message);
      return data as LibraryRow;
    },
    async remove(id) {
      const { error } = await sb.from("email_library").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    async versions(id) {
      const { data } = await sb.from("email_library_versions").select("id, version, subject, blocks, html, created_at").eq("library_id", id).order("version", { ascending: false }).limit(20);
      return (data ?? []) as VersionRow[];
    },
    generate: (body) => invoke<GenResult>("email-builder", { op: "generate", ...body }),
    revise: (body) => invoke<GenResult>("email-builder", { op: "revise", ...body }),
    makeImage: (kit, prompt) => invoke("email-builder", { op: "image", kit, prompt }),
    exportEml: (i) => invoke("email-builder", { op: "export_eml", ...i }),
    send: (i) => invoke<SendResult>("email-builder-send", i),
    async suggestContacts(q) {
      try {
        const { data, error } = await sb.rpc("email_contact_suggest", { p_q: q, p_limit: 8 });
        if (error || !Array.isArray(data)) return [];
        return data as ContactHit[];
      } catch { return []; }
    },
    async kitFromClient(slug) {
      const { data, error } = await sb.rpc("email_kit_for_client", { p_slug: slug });
      if (error) throw new Error(error.message);
      return data as string;
    },
  };
}

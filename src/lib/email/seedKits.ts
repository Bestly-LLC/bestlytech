// Bundled copy of the seed brand kits (scripts/email-builder/kits.mjs). The admin page reads kits from
// public.email_brand_kits; this copy is only the offline preview, the tests, and the fallback when the
// migration has not been applied yet.
import { KITS } from "../../../scripts/email-builder/kits.mjs";
import { resolveKit, type Kit } from "../../../supabase/functions/_shared/email-render.ts";

type Row = Kit & { extends?: string | null };

export function resolvedSeedKits(): Kit[] {
  const rows = Object.fromEntries((KITS as Row[]).map((k) => [k.slug, k])) as Record<string, Row>;
  return (KITS as Row[]).map((k) => resolveKit(k, rows));
}

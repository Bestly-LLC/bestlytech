import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "cloud-brand-assets";
const ALLOWED_TYPES = ["logo","icon","mark"] as const;
const MAX_BYTES = 5 * 1024 * 1024;
const MIME_EXT: Record<string,string> = { "image/png":"png", "image/jpeg":"jpg", "image/svg+xml":"svg", "image/webp":"webp" };

function ok(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function bad(reason: string, status = 400) { return new Response(JSON.stringify({ ok: false, error: reason }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad("method not allowed", 405);

  const ct = req.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")) return bad("multipart/form-data required");

  let form: FormData;
  try { form = await req.formData(); } catch { return bad("invalid form data"); }

  const token = String(form.get("token") || "");
  const assetType = String(form.get("asset_type") || "");
  const file = form.get("file");

  if (!token || token.length < 16) return bad("token required");
  if (!ALLOWED_TYPES.includes(assetType as any)) return bad("asset_type must be logo|icon|mark");
  if (!(file instanceof File)) return bad("file required");
  if (file.size > MAX_BYTES) return bad("file too large (max 5 MB)");
  const ext = MIME_EXT[file.type];
  if (!ext) return bad(`unsupported mime: ${file.type}`);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);
  const { data: deal, error: lookupErr } = await sb.from("cloud_deals").select("id, intake_submitted_at").eq("intake_token", token).maybeSingle();
  if (lookupErr) return bad("could not load deal", 500);
  if (!deal) return bad("not found", 404);
  if (deal.intake_submitted_at) return bad("intake already submitted", 409);

  const path = `${deal.id}/${assetType}.${ext}`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type, cacheControl: "60" });
  if (upErr) { console.error("storage upload error", upErr); return bad("upload failed", 500); }

  const { data: publicData } = sb.storage.from(BUCKET).getPublicUrl(path);
  return ok({ ok: true, url: publicData.publicUrl, path });
});

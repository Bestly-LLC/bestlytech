// family-photo — streams one card photo to the Family Cookbook app. Owner: Basil.
// GET/POST with the session token (header x-family-token, or ?t= for the rare <img> case) and the photo id (?p=).
// The visibility rule lives in SQL (family_photo_path): Mom can never open a photo of Jared's or Mariah's card.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB, { auth: { persistSession: false } });
const ORIGINS = new Set(["https://www.bestly.tech", "https://bestly.tech", "http://localhost:4173", "http://localhost:5173", "http://127.0.0.1:4173"]);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(req.headers.get("origin") ?? "") ? req.headers.get("origin")! : "https://www.bestly.tech",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-family-token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin",
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  const url = new URL(req.url);
  const token = req.headers.get("x-family-token") ?? url.searchParams.get("t") ?? "";
  const photo = url.searchParams.get("p") ?? "";
  const none = () => new Response("not found", { status: 404, headers: cors(req) });
  if (token.length < 40 || !/^[0-9a-f-]{36}$/i.test(photo)) return none();
  const { data: path, error } = await db.rpc("family_photo_path", { p_token: token, p_photo: photo });
  if (error || !path) return none();   // not signed in, not yours to see, and not there all look the same
  const dl = await db.storage.from("family-cards").download(String(path));
  if (dl.error || !dl.data) return none();
  return new Response(dl.data, { headers: { "Content-Type": dl.data.type || "image/jpeg", "Cache-Control": "private, max-age=3600", ...cors(req) } });
});

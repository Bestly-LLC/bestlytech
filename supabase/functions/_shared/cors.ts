/**
 * CORS headers for edge functions called from bestly.tech.
 *
 * Import with:
 *   import { corsHeaders } from "../_shared/cors.ts";
 *
 * Most functions can use `corsHeaders` as-is. Functions that accept extra
 * request headers (x-shop-key, x-worker-key, ...) or extra methods build on it:
 *
 *   import { corsWith } from "../_shared/cors.ts";
 *   const cors = corsWith({ headers: "authorization, x-client-info, apikey, content-type, x-shop-key" });
 */

/** The standard set: any origin, supabase-js defaults, POST + preflight. */
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Standard CORS headers with this function's own allowed headers and/or
 * methods. Anything not passed falls back to the standard set.
 */
export function corsWith(opts: { headers?: string; methods?: string } = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": opts.headers ?? corsHeaders["Access-Control-Allow-Headers"],
    "Access-Control-Allow-Methods": opts.methods ?? corsHeaders["Access-Control-Allow-Methods"],
  };
}

// The renderer lives in supabase/functions/_shared/email-render.ts so the admin page and the edge functions run
// the exact same code. Import from here in the app.
export * from "../../../supabase/functions/_shared/email-render.ts";

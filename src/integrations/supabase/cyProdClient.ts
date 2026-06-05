// CY-ADMIN-01: Cookie Yeti PRODUCTION Supabase client.
//
// The Cookie Yeti apps/extensions read+write a *separate* Supabase project
// (keowunrx..., Lovable-managed) from this website's project (rcqfq...).
// The admin pages were historically querying the website project, whose CY
// tables are empty twins — so the dashboard showed zeros and, worse,
// "grant access" wrote rows the app never reads.
//
// This client uses the same public anon key that ships inside the iOS app
// and browser extensions (public by design). RLS on the production project
// governs what it can see; metrics on RLS-restricted tables
// (granted_access inserts, activation_codes, dismissal_reports) may be
// incomplete until a service-role edge function is added. See CYDashboard.
import { createClient } from "@supabase/supabase-js";

const CY_PROD_URL = "https://keowunrxpxlbgebujbao.supabase.co";
const CY_PROD_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtlb3d1bnJ4cHhsYmdlYnVqYmFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4NzY0NjIsImV4cCI6MjA4MDQ1MjQ2Mn0.2hC6BQ5getadBcUPXITXC-phLxyVrodc5IiYEu3vYhg";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cyProd = createClient<any>(CY_PROD_URL, CY_PROD_ANON_KEY, {
  auth: { persistSession: false },
});



# Replace Bestly Logo Across All Locations

## What
Replace the current `bestly-logo.png` with the new uploaded logo (navy swoosh icon, transparent background) everywhere it's used — frontend components, admin login, email templates, and the shared email template utility.

## Files to Update

### 1. Replace the asset file
- Copy `user-uploads://bestly-logo-C9t3tYt5_Background_Removed.png` to `src/assets/bestly-logo.png` (overwrites existing)

### 2. Upload to storage for email templates
- Upload the new logo to the `email-assets` storage bucket as `bestly-logo.png`, replacing the existing one — this updates the URL used by all 6 auth email templates automatically (no template file edits needed since the URL stays the same)

### 3. Update the shared email template utility
- `supabase/functions/_shared/email-template.ts` — update `LOGO_URL` to point to the storage bucket URL instead of the published site asset (which has a Vite hash)

### 4. Redeploy edge functions
- Deploy `auth-email-hook` so the updated storage asset is served in auth emails

### Frontend files that use `bestlyLogo` import (no code changes needed — the import path stays the same, just the file content changes):
- `src/components/layout/Header.tsx`
- `src/components/layout/Footer.tsx`
- `src/pages/admin/AdminLogin.tsx`
- `src/pages/PressKit.tsx`


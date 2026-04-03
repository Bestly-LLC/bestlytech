

# Multi-Passkey & Security Key Support

## What Changes

The backend already supports multiple passkeys per user. The changes are primarily UI (Security dialog) and a small edge function tweak.

### 1. Update Security Dialog UI (`src/components/admin/ChangePasswordDialog.tsx`)

Replace the current single-passkey toggle with a list view:
- Fetch all `passkey_credentials` rows for the user (not just count)
- Display each passkey as a row showing: device type icon, device type label (e.g. "Platform — registered Mar 25"), and individual "Remove" button
- Add a "Register Passkey" button and a "Register Security Key" button below the list (always visible, not hidden when one exists)
- The `passkey_credentials` table already has `device_type`, `created_at`, and `credential_id` columns — use those for display

### 2. Add security key support in registration

Two changes:
- **UI**: When "Register Security Key" is clicked, pass `keyType: "cross-platform"` to the edge function
- **Edge function** (`supabase/functions/webauthn-register/index.ts`): Read an optional `keyType` field from the request body. If `keyType === "cross-platform"`, set `authenticatorSelection.authenticatorAttachment` to `"cross-platform"` instead of `"platform"`. This allows USB/NFC security keys like YubiKey.

### 3. Individual passkey deletion

Change the delete handler to accept a specific `credential_id` and delete only that row, instead of deleting all passkeys for the user.

### 4. Add `device_name` column (optional label)

Add a nullable `device_name` text column to `passkey_credentials` so users can label their keys (e.g. "MacBook Pro", "YubiKey 5"). Auto-populate with the `authenticatorAttachment` value on registration. Users won't edit it for now — just auto-labels like "Platform Passkey" or "Security Key".

## Files Modified
- `src/components/admin/ChangePasswordDialog.tsx` — List all passkeys, add per-key remove, add two register buttons
- `supabase/functions/webauthn-register/index.ts` — Accept `keyType` param, adjust `authenticatorSelection`
- Database migration — Add `device_name` column to `passkey_credentials`

## Technical Details
- The `excludeCredentials` array already sends existing credential IDs to prevent duplicate registrations of the same authenticator
- `passkey_credentials` has no unique constraint on `user_id`, so multiple rows per user already work
- RLS allows authenticated users to SELECT and DELETE their own rows
- The `webauthn-authenticate` function already queries all credentials for a user and tries each one, so multi-passkey login works without changes


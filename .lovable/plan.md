

## Supabase Push Token Fix - Edge Function Implementation

### Overview
Implement a secure Edge Function (`upsert-device-token`) that handles iOS push token registration while bypassing RLS using the service role key. This resolves the "new row violates row-level security policy" error that occurs when the iOS client tries to directly insert into the `device_tokens` table.

---

### Problem Being Solved

The iOS app currently fails to register push tokens because:
1. The `device_tokens` table has RLS enabled (or doesn't exist yet)
2. The client is trying to directly insert rows without proper RLS policies
3. We need a secure server-side solution that bypasses RLS using the service role

---

### What We'll Build

#### 1. Database Table: `device_tokens`

Create the table with proper structure and constraints:

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | uuid | Primary key, auto-generated |
| `user_id` | uuid | Not null, references auth.users(id), unique, cascade delete |
| `device_token` | text | Not null, unique |
| `platform` | text | Not null, default 'ios' |
| `created_at` | timestamptz | Not null, default now() |
| `updated_at` | timestamptz | Not null, default now() |

**RLS Configuration:**
- RLS enabled (locked down)
- No public insert/update/delete policies (edge function uses service role)
- Optional read policy for authenticated users to read their own token

---

#### 2. Edge Function: `upsert-device-token`

**Endpoint behavior:**

```text
POST /functions/v1/upsert-device-token
Authorization: Bearer <user_jwt>
Content-Type: application/json

Body: { "device_token": "<apns_token>", "platform": "ios" }
```

**Function flow:**

```text
+----------------------------------+
|     1. Parse JSON body           |
|  { device_token, platform }      |
+----------------------------------+
            |
            v
+----------------------------------+
|   2. Validate Authorization      |
|  Extract JWT, call getClaims()   |
+----------------------------------+
            |
     [No user?] --> Return 401
            |
            v
+----------------------------------+
|   3. Validate device_token       |
|  Non-empty, reasonable length    |
+----------------------------------+
            |
     [Invalid?] --> Return 400
            |
            v
+----------------------------------+
|  4. Create service role client   |
|  (bypasses RLS)                  |
+----------------------------------+
            |
            v
+----------------------------------+
|  5. Delete existing rows         |
|  - Where user_id = user.id       |
|  - Where device_token = token    |
+----------------------------------+
            |
            v
+----------------------------------+
|  6. Insert new row               |
|  { user_id, device_token,        |
|    platform, updated_at: now() } |
+----------------------------------+
            |
            v
+----------------------------------+
|  7. Return { ok: true }          |
+----------------------------------+
```

**Security features:**
- JWT validation using `getClaims()` (not `getUser()` for performance)
- Service role client for database operations (bypasses RLS safely)
- Input validation and sanitization
- CORS headers for web compatibility

---

### Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/[timestamp].sql` | Create `device_tokens` table with RLS |
| `supabase/functions/upsert-device-token/index.ts` | New edge function |
| `supabase/config.toml` | Add function config with `verify_jwt = false` |

---

### Technical Details

**Database Migration SQL:**
```sql
-- Create device_tokens table
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_token text NOT NULL,
  platform text NOT NULL DEFAULT 'ios',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraints
ALTER TABLE public.device_tokens 
  ADD CONSTRAINT device_tokens_user_id_key UNIQUE (user_id);
ALTER TABLE public.device_tokens 
  ADD CONSTRAINT device_tokens_device_token_key UNIQUE (device_token);

-- Enable RLS
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- Users can read their own token (optional, for client queries)
CREATE POLICY "Users can read own device token"
  ON public.device_tokens FOR SELECT
  USING (auth.uid() = user_id);

-- Service role handles all writes (no public insert/update/delete)
CREATE POLICY "Service role can manage all tokens"
  ON public.device_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_device_tokens_updated_at
  BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id 
  ON public.device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_device_token 
  ON public.device_tokens(device_token);
```

**Edge Function Pattern:**
```typescript
// Key implementation details:

// 1. Auth check using getClaims() (faster than getUser())
const token = authHeader.replace('Bearer ', '');
const { data, error } = await supabase.auth.getClaims(token);
if (error || !data?.claims) {
  return Response(401, { ok: false, error: "Unauthorized" });
}
const userId = data.claims.sub;

// 2. Service role client for DB operations
const serviceClient = createClient(
  Deno.env.get("SUPABASE_URL"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
);

// 3. Delete existing + insert new (upsert pattern)
await serviceClient.from("device_tokens")
  .delete()
  .or(`user_id.eq.${userId},device_token.eq.${deviceToken}`);

await serviceClient.from("device_tokens")
  .insert({ user_id: userId, device_token, platform });
```

**Config.toml Addition:**
```toml
[functions.upsert-device-token]
verify_jwt = false
```

---

### Environment Variables

The function will use these existing secrets (already configured):
- `SUPABASE_URL` - Available automatically
- `SUPABASE_ANON_KEY` - Available automatically  
- `SUPABASE_SERVICE_ROLE_KEY` - Available automatically

No new secrets need to be added.

---

### iOS Client Usage

The iOS app should call:
```swift
try await supabase.functions.invoke(
  "upsert-device-token",
  options: FunctionInvokeOptions(
    body: ["device_token": apnsToken, "platform": "ios"]
  )
)
```

The JWT is automatically included in the Authorization header by the Supabase client.

---

### Testing Steps

After deployment, verify the function works:

1. **Check table exists**: Query `device_tokens` table in the database
2. **Test via curl or the iOS app**:
   - Authenticate as a user
   - Call the function with a test device token
   - Verify row is inserted
3. **Test upsert behavior**:
   - Call again with same user, new token
   - Verify only one row exists for that user
4. **Test duplicate token handling**:
   - Try registering same token for different user
   - Should delete old row, insert new

---

### Error Responses

| Status | Response | Cause |
|--------|----------|-------|
| 200 | `{ ok: true }` | Success |
| 400 | `{ ok: false, error: "..." }` | Missing/invalid device_token |
| 401 | `{ ok: false, error: "Unauthorized" }` | Missing or invalid JWT |
| 405 | `{ ok: false, error: "Method not allowed" }` | Non-POST request |
| 500 | `{ ok: false, error: "..." }` | Database or server error |


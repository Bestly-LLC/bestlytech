

# AI Pattern Generator — Full Implementation Plan

Three-part change: database migration, new edge function, and admin UI overhaul.

---

## Part 1: SQL Migration

Run a single migration that:

1. **Adds columns to `missed_banner_reports`**: `banner_html TEXT`, `page_url TEXT`, `ai_processed_at TIMESTAMPTZ`, `ai_attempts INTEGER NOT NULL DEFAULT 0`, `cmp_fingerprint TEXT DEFAULT 'unknown'`
2. **Creates `ai_generation_log` table** with identity PK, indexes on `created_at DESC` and `domain`, RLS (anon read, service_role all)
3. **Creates 3 RPC functions**:
   - `report_missed_banner_with_html(_domain, _page_url, _banner_html, _cmp_fingerprint)` — upserts into `missed_banner_reports` with HTML truncated to 5000 chars, granted to anon
   - `get_ai_generation_candidates(_limit)` — returns unresolved reports not AI-processed in last 24h with <3 attempts, prioritizing those with HTML, granted to service_role
   - `mark_ai_processed(_domain, _resolved)` — updates `ai_processed_at`, increments `ai_attempts`, optionally resolves, granted to service_role
4. **Note**: `cookie_patterns` already has a `source` column (default `'community'`), so the `ALTER TABLE ADD COLUMN IF NOT EXISTS source` is harmless/no-op

---

## Part 2: Edge Function `ai-generate-pattern`

New file: `supabase/functions/ai-generate-pattern/index.ts`

- **Config**: `verify_jwt = false` in `config.toml`
- **Flow**:
  1. Create service-role Supabase client
  2. Call `get_ai_generation_candidates(5)` via RPC
  3. For each candidate:
     - If no `banner_html` → log as `skipped_no_html`, call `mark_ai_processed(domain, false)`
     - If has HTML → POST to `https://api.anthropic.com/v1/messages` with `ANTHROPIC_API_KEY`, model `claude-sonnet-4-20250514`
     - Prompt: analyze cookie banner HTML, return JSON `{selector, action, confidence}`, prefer reject/decline buttons
     - On success: insert into `cookie_patterns` (confidence capped at 0.6, source = `ai_generated`), log success to `ai_generation_log`, call `mark_ai_processed(domain, true)`
     - On failure: log error to `ai_generation_log`, call `mark_ai_processed(domain, false)`
  4. Return JSON summary
- **Secret needed**: `ANTHROPIC_API_KEY` — will use `add_secret` tool to request it

---

## Part 3: Admin UI — `CommunityLearning.tsx`

### Tab rename
- Tab trigger: `"Issues & Fixer"` → `"AI Pattern Generator"` with `Brain` icon instead of `AlertTriangle`

### Header card rename
- `"Pattern Issues & AI Fixer"` → `"AI Pattern Generator"`
- Button: `"Run AI Fixer"` → `"Run AI Generator"`
- Schedule text updated to reflect AI generation
- `handleRunFixer` → calls `ai-generate-pattern` edge function instead of `run-pattern-maintenance`

### Replace issues table content with two sections

**Section A: "Pending Candidates"**
- Query `missed_banner_reports` where `resolved = false`, ordered by `report_count DESC`
- Columns: Domain, Reports, Has HTML (yes/no badge), CMP Type, Last Reported, AI Attempts
- New state: `candidates` fetched in `fetchAll`

**Section B: "AI Generation Log"**
- Query `ai_generation_log` ordered by `created_at DESC`, limit 50
- Columns: Timestamp (formatted), Domain, Status (color badge: green/red/gray), Selector (monospace, truncated), Action, Confidence (%), AI Model
- New state: `aiGenLog` fetched in `fetchAll`

### Stats card update
- Add 5th stat card: "AI Generated" — count of `cookie_patterns` where `source = 'ai_generated'`
- Fetched via a simple `.select("id", { count: "exact" }).eq("source", "ai_generated")` in `fetchAll`

### Cleanup
- Remove old `fixLog`, `fixActionMap`, `fixedPatterns`, `fixedDomains` state/memos (no longer needed for this tab)
- Keep `AiFixerIndicator` and `DomainAiBadge` for the other tabs (Recent, Domains) as they still reference `pattern_fix_log`
- Remove the collapsible "Latest Fix Results" panel — replaced by the Generation Log section
- Post-run results now shown inline in the Generation Log (latest entries appear at top after refresh)

### Collapsible post-run panel
- After clicking "Run AI Generator", show a collapsible results panel similar to the old one but showing the AI generation summary (processed/generated/skipped/failed counts) returned by the edge function

---

## Files Changed

| File | Change |
|------|--------|
| SQL migration | Add columns to `missed_banner_reports`, create `ai_generation_log`, create 3 RPC functions |
| `supabase/config.toml` | Add `[functions.ai-generate-pattern]` with `verify_jwt = false` |
| `supabase/functions/ai-generate-pattern/index.ts` | New edge function |
| `src/pages/admin/CommunityLearning.tsx` | Rename tab, replace issues content with candidates + generation log, update button handler, add AI Generated stat card |

## Prerequisites
- Will need to request `ANTHROPIC_API_KEY` secret from the user before the edge function can work


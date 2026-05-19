# bestlytech Constitution

> ⚠️ **STATUS: RETIRED 2026-05-01.** This Supabase project was superseded by
> Supabase project `rcqfqhguwpmaarseifqg`, managed via a separate `bestlytech`
> codebase and a Cowork agent. Edge functions in this project respond with
> kill-switch stubs; scheduled jobs are unscheduled. Data remains queryable
> for historical reference only.

This constitution governs work on this **retired** repo. The default answer
for "should I do X here?" is **no**. Use the successor codebase instead.

---

## Core Principles

### I. Do not deploy from this repo (NON-NEGOTIABLE)
- No new edge function deployments.
- No new scheduled jobs.
- No DNS, Vercel, or Supabase config changes that affect production traffic.
- `publish-*.command` scripts in the root are historical artifacts. **Do not
  run them.** If you must read one, treat it as documentation, not a recipe.

### II. Read-only is the default mode
- Historical SQL inspections against the legacy Supabase project are allowed
  via Supabase MCP read tools.
- Documenting how the legacy system worked (for migration notes, runbooks, or
  ADRs in the successor repo) is encouraged.
- Pulling logs, exports, or screenshots out of this repo is fine.

### III. If a one-off backfill or fix is genuinely required
- It must be authored as a single, reversible migration with explicit
  rollback steps documented in the PR.
- Approval from the repo owner is required in writing before execution.
- Capture the rationale in `RETIRED.md` so the next person knows why an
  exception was granted.

### IV. New feature work belongs in the successor repo, not here
- If spec-kit produces a `/speckit-specify` for a new feature in this repo,
  the first step of the plan is "stop and re-run in the successor repo."

---

## Architectural Snapshot (for reference)

- **Stack at retirement:** Vite + React + TS + shadcn/ui + Supabase, deployed
  to Vercel.
- **Lovable-managed origin:** project ID `ed0c0574-bb6b-4329-a302-0a593b9ac3c1`.
- **Numerous `publish-*.command` scripts:** v1 → v8 release commands.
  Do not invoke.
- See `RETIRED.md` and `docs/` for the full retirement story.

## Spec-Kit Workflow

- `/speckit-specify` is permitted only for documentation tasks (e.g., writing
  a migration ADR, exporting data, or building a historical comparison).
- `/speckit-plan` for any feature in this repo must include a "why not the
  successor repo?" justification, or the plan is invalid.
- `/speckit-implement` is disabled in spirit. Run it manually only after
  written approval.

---

## Governance

Retirement supersedes any other practice in this file. Amend only to record
new exceptions or to update the successor-repo pointer.

**Version**: 1.0.0-retired | **Ratified**: 2026-05-19 | **Last Amended**: 2026-05-19

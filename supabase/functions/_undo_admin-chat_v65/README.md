Phase 2 (2026-10-10) undo copies: the edge functions exactly as deployed before (admin-chat v65, scout-daily v17, bestly-git v12 minus the
v8 search action). These folders start with "_" so the Supabase CLI never deploys them as functions, and they sit at the same depth as the
real functions so their "../_shared/..." imports resolve. To roll back, copy the undo file over the live source and deploy from the Mac
(the repo is private, so a raw-URL shim no longer works):
  cp supabase/functions/_undo_admin-chat_v65/index.ts supabase/functions/admin-chat/index.ts && supabase functions deploy admin-chat --project-ref rcqfqhguwpmaarseifqg --use-api --no-verify-jwt
(_shared/free-llm.ts only gained exports, so the old files run against the new one.)

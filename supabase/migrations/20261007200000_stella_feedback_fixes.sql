-- 2026-10-07 evening: Jared's first-look feedback on Stella + Mae.
--   1. Auto-post plain 5-star replies now — this was already decided, the switch was just left off from the build.
--   2. Backlog reviews (the 69 historical ones Stella backfilled before she was live) are locked: Approve & post
--      only, no notes box, no redraft, no hand-editing the words. Marked with is_backlog so the Reviews tab can
--      tell a backlog review apart from one Stella drafted live.
alter table public.turo_reviews add column if not exists is_backlog boolean not null default false;
update public.turo_reviews set is_backlog = true where is_backlog = false;

update public.reputation_settings set auto_post_5star = true, updated_at = now() where id;

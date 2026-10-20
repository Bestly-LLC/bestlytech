-- trg_social_posted_to_item writes a notify_outbox row of kind 'tiktok_draft' whenever a TikTok row reaches in_drafts, but the kind was never
-- registered, so trg_notify_outbox_studio_only rejected it and the status update to in_drafts failed (row stuck in 'posting', publish_id lost,
-- tiktok-inbox ignores the update error). Found 2026-10-20 on the first Minute News Daily clip. Registering the kind is the fix the guard asks for.
insert into public.notify_kinds (kind, what)
select 'tiktok_draft', 'A client video reached their TikTok drafts (Studio TikTok inbox mode); logged on their board when the draft lands'
 where not exists (select 1 from public.notify_kinds where kind = 'tiktok_draft');

-- 2026-09-24 data fix (applied live): ~156 Talk outbox rows queued while talk_outbox_take() was broken were marked
-- as handled instead of being sent hours late. Nothing was sent.
update public.talk_outbox set sent_at = now(),
       error = 'held: queued during talk_outbox_take bug (2026-09-24), not sent'
 where sent_at is null and created_at < now() - interval '2 hours';

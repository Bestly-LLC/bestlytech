-- Cookie Yeti stuck since Nov 1: social-render's queue_next rendered a whole 4-card carousel in one call, hit the edge
-- runtime's ~2 s CPU cap ("CPU Time exceeded", HTTP 546) every night, saved nothing, and the same row blocked every post
-- behind it. social-render v15 renders ONE missing card per call and says "rendering k/n (resumes)" (status 202).
-- This picks it back up: every 5 minutes, for a brand whose newest bank run (last 20 h) is partial or never answered,
-- call queue_next again. At most 24 calls per brand per 20 h, so a card that can never render cannot loop forever.
create or replace function public.social_bank_resume()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare b record; l record; n int; k int := 0; rid bigint;
begin
  -- a call that crashed (546 / CPU) never writes back; close those rows so the log says what happened
  update social_bank_log set status = 546, note = 'no answer (render crashed or timed out)', finished_at = now()
   where status is null and at < now() - interval '10 minutes';
  for b in select s.brand from social_brand_settings s where s.enabled loop
    select * into l from social_bank_log where brand = b.brand and at > now() - interval '20 hours' order by id desc limit 1;
    continue when l.id is null;
    continue when not (coalesce(l.note, '') like 'rendering %' or l.status = 546);
    select count(*) into n from social_bank_log where brand = b.brand and at > now() - interval '20 hours';
    continue when n >= 24;
    rid := public.invoke_edge_function('social-render', jsonb_build_object('action', 'queue_next', 'brand', b.brand), 150000);
    insert into social_bank_log (brand, request_id) values (b.brand, rid);
    k := k + 1;
  end loop;
  return k;
end $$;
revoke all on function public.social_bank_resume() from public, anon, authenticated;

select cron.schedule('social-bank-resume', '*/5 * * * *', 'select public.social_bank_resume()');

-- Coach backfill: Jared wants every past call reviewed, test calls included.
-- coach_next only looks back 14 days and the Coach skips tests where nobody played along.
-- coach_backfill_list returns the calls that still have no scored review (none yet, or "skipped"), any age,
-- same row shape as coach_next, so ava-coach's {op:"backfill"} can score them with a "score it anyway" note.
-- p_include_deleted: also calls Jared removed from the list (they stay hidden in the UI; the review only feeds the Coach).

create or replace function public.coach_backfill_list(p_source text, p_limit integer default 6, p_include_deleted boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_source = 'roofguard' then
    return (select coalesce(jsonb_agg(to_jsonb(q)), '[]') from (
      select c.id, c.call_no, c.direction, c.outcome, c.opener_key, c.dm_reached, c.kept_talking, c.is_test, c.duration_sec,
             c.summary, c.notes, c.playbook_arms, l.company, l.category,
             left(coach_transcript(c.transcript), 9000) transcript
        from rg_calls c left join rg_leads l on l.id = c.lead_id
        left join rg_call_reviews r on r.call_id = c.id
       where (p_include_deleted or c.deleted_at is null)
         and c.transcript is not null and jsonb_array_length(c.transcript) > 2
         and (r.call_id is null or r.status = 'skipped' or (r.status = 'failed' and r.tries < 5))
       order by coalesce(c.ended_at, c.updated_at) asc limit p_limit) q);
  elsif p_source = 'ava' then
    return (select coalesce(jsonb_agg(to_jsonb(q)), '[]') from (
      select c.id, c.call_no, c.direction, c.purpose, c.caller_name, c.summary, c.message, c.urgent, c.callback_wanted,
             c.forwarded, c.is_spam, c.duration_sec, left(coach_transcript(c.transcript), 9000) transcript
        from ava_calls c left join ava_call_reviews r on r.call_id = c.id
       where (p_include_deleted or c.deleted_at is null)
         and c.transcript is not null and jsonb_array_length(c.transcript) > 2
         and (r.call_id is null or r.status = 'skipped' or (r.status = 'failed' and r.tries < 5))
       order by coalesce(c.ended_at, c.created_at) asc limit p_limit) q);
  end if;
  raise exception 'source must be roofguard or ava';
end $function$;

revoke all on function public.coach_backfill_list(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.coach_backfill_list(text, integer, boolean) to service_role;

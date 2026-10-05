-- Coach backfill, part 2: a call the Coach still skips after the "score it anyway" pass (truly nothing said) stays skipped,
-- so the backfill list doesn't hand it back forever. A skipped review that was already retried once (tries >= 2) is final.

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
         and (r.call_id is null or (r.status = 'skipped' and r.tries < 2) or (r.status = 'failed' and r.tries < 5))
       order by coalesce(c.ended_at, c.updated_at) asc limit p_limit) q);
  elsif p_source = 'ava' then
    return (select coalesce(jsonb_agg(to_jsonb(q)), '[]') from (
      select c.id, c.call_no, c.direction, c.purpose, c.caller_name, c.summary, c.message, c.urgent, c.callback_wanted,
             c.forwarded, c.is_spam, c.duration_sec, left(coach_transcript(c.transcript), 9000) transcript
        from ava_calls c left join ava_call_reviews r on r.call_id = c.id
       where (p_include_deleted or c.deleted_at is null)
         and c.transcript is not null and jsonb_array_length(c.transcript) > 2
         and (r.call_id is null or (r.status = 'skipped' and r.tries < 2) or (r.status = 'failed' and r.tries < 5))
       order by coalesce(c.ended_at, c.created_at) asc limit p_limit) q);
  end if;
  raise exception 'source must be roofguard or ava';
end $function$;


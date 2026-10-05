-- Ava answers both lines, part 2b (Spark, 2026-10-04): helper that records a leak incident (stored as code_leak + leak = true)
-- and alerts Scout (high severity). Returns false when the call's leak was already logged.
create or replace function public.ava_leak_log(p_source text, p_call_id uuid, p_call_no bigint, p_excerpt text, p_llm text)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid; v_flag boolean; v_url text := case when p_source = 'roofguard' then 'https://bestly.tech/admin/roofguard' else 'https://bestly.tech/admin/ava' end;
  v_who text := case when p_source = 'roofguard' then 'RoofGuard Ava' else 'Ava' end;
begin
  select id, leak into v_id, v_flag from ava_reply_incidents where call_id = p_call_id and kind = 'code_leak';
  if v_id is null then
    insert into ava_reply_incidents (source, call_id, call_no, kind, leak, excerpt, llm, healed)
    values (p_source, p_call_id, p_call_no, 'code_leak', true, p_excerpt, p_llm, 'alerted, queued as a must-fix review item');
  elsif not v_flag then
    update ava_reply_incidents set leak = true, healed = coalesce(healed || '; ', '') || 'alerted, queued as a must-fix review item' where id = v_id;
  else
    return false;
  end if;
  perform scout_notify(v_who || ' may have shared something sensitive on call #' || coalesce(p_call_no::text, '?'),
    'She said: "' || left(p_excerpt, 140) || '". Queued as a must-fix item for her next review.', 'warning', true, v_url,
    'ava-leak-' || p_call_id::text);
  return true;
end $function$;
revoke execute on function public.ava_leak_log(text, uuid, bigint, text, text) from public, anon, authenticated;

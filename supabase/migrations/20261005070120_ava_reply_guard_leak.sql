-- Ava answers both lines, part 2c (Spark, 2026-10-04): the reply guard calls ava_leak_log for a "leak" hit.
create or replace function public.ava_reply_guard(p_source text, p_call_id uuid, p_call_no bigint, p_transcript jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_llm text; v_chain text[]; v_next text; v_healed text; v_new boolean;
  v_url text := case when p_source = 'roofguard' then 'https://bestly.tech/admin/roofguard' else 'https://bestly.tech/admin/ava' end;
  v_who text := case when p_source = 'roofguard' then 'RoofGuard Ava' else 'Ava' end;
begin
  if p_source = 'roofguard' then select llm, llm_fallbacks into v_llm, v_chain from rg_settings where id;
  else select llm, llm_fallbacks into v_llm, v_chain from ava_settings limit 1; end if;

  -- order by kind: code_leak is handled before leak, so a call that did both keeps its model switch
  for r in select distinct on (s.kind) s.kind, s.excerpt from ava_reply_scan(p_transcript) s order by s.kind loop
    v_healed := null; v_new := null;

    if r.kind = 'leak' then
      perform ava_leak_log(p_source, p_call_id, p_call_no, r.excerpt, v_llm);
      continue;
    end if;

    insert into ava_reply_incidents (source, call_id, call_no, kind, excerpt, llm)
    values (p_source, p_call_id, p_call_no, r.kind, r.excerpt, v_llm)
    on conflict (call_id, kind) do nothing
    returning true into v_new;
    continue when v_new is null;    -- already handled

    if r.kind = 'code_leak' then
      -- self-heal: move to the next model in the chain that isn't the one that leaked, and re-run setup
      select m into v_next from unnest(v_chain) with ordinality u(m, i)
       where m is distinct from v_llm
         and m not in (select llm from ava_reply_incidents where kind = 'code_leak' and not leak and source = p_source and llm is not null and created_at > now() - interval '7 days')
       order by i limit 1;
      if v_next is not null then
        if p_source = 'roofguard' then
          update rg_settings set llm = v_next where id;
          perform invoke_edge_function('roofguard-caller', '{"action":"setup"}'::jsonb, 120000);
        else
          update ava_settings set llm = v_next where id;
          perform invoke_edge_function('ava-assistant', '{"action":"setup"}'::jsonb, 120000);
        end if;
        v_healed := 'switched ' || coalesce(v_llm, '?') || ' → ' || v_next;
      else
        v_healed := 'no safe model left in the chain; needs a look';
      end if;
      update ava_reply_incidents set healed = v_healed where call_id = p_call_id and kind = r.kind;
      perform scout_notify(v_who || ' spoke code on call #' || coalesce(p_call_no::text, '?'),
        'She said: "' || left(r.excerpt, 140) || '". Guard ' || v_healed || '.', 'high', true, v_url,
        'ava-reply-guard-' || p_call_id::text);
    elsif r.kind = 'no_hangup' then
      perform scout_notify(v_who || ' didn''t hang up on call #' || coalesce(p_call_no::text, '?'),
        'She said goodbye but the line stayed open. Logged for her next review.', 'medium', false, v_url,
        'ava-reply-guard-hangup-' || p_call_id::text);
    end if;
  end loop;
exception when others then
  -- the guard must never break call logging
  raise warning 'ava_reply_guard failed: %', sqlerrm;
end $function$;

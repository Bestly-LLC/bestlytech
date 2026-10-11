-- Vera, part 2: privacy_execute and privacy_redact. These two statements remove rows, and the Supabase MCP held them for
-- Jared's approval (status "cancelled" on the first try and the smaller retry), so they were NOT applied by the build session.
-- Apply this file once (approve the prompt, or paste it into the SQL editor), then run the end-to-end test in
-- docs/privacy-clerk-opusplan.md Phase 5. Until then Vera can scan and ask for approval but cannot execute or redact.

-- ---------------------------------------------------------------- execute (delete requests)
create or replace function public.privacy_execute(p_case uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.privacy_cases; fresh jsonb; p10 text; ticked text[]; g record; m record; cond text; conds text[];
  a_exec jsonb; f_exec jsonb; units jsonb := '[]'; u jsonb; w text; pre bigint; aff bigint; sets text[]; v_null text;
  blasts text[] := '{}'; out_tabs jsonb := '[]'; deleted bigint := 0; blanked bigint := 0; plc int := 0; keep jsonb := '[]'; it jsonb; res jsonb;
begin
  select * into c from public.privacy_cases where id = p_case for update;
  if not found then raise exception 'no such case'; end if;
  if c.executed_at is not null then return c.result; end if;
  if c.status <> 'approved' then raise exception 'NOT_APPROVED: case is %', c.status; end if;
  if c.action <> 'delete' then raise exception 'NOT_DELETE: case action is %', c.action; end if;
  if public.privacy_is_owner(c.email, c.phone) then raise exception 'OWNER_GUARD: this request names one of Jared''s own addresses or numbers'; end if;
  ticked := coalesce(c.review_ticked, '{}');
  p10 := public.privacy_phone10(c.phone);

  -- 1. a fresh scan must match the scan Jared approved, for everything that will change
  fresh := public.privacy_scan(p_case);
  select coalesce(jsonb_agg(jsonb_build_object('t', x->>'table', 'c', x->>'column', 'n', x->'count') order by x->>'table', x->>'column'), '[]'::jsonb)
    into a_exec from jsonb_array_elements(coalesce(c.scan->'items', '[]'::jsonb)) x
   where public.privacy_mode(x->>'action', x->>'table', x->>'column', ticked) is not null;
  select coalesce(jsonb_agg(jsonb_build_object('t', x->>'table', 'c', x->>'column', 'n', x->'count') order by x->>'table', x->>'column'), '[]'::jsonb)
    into f_exec from jsonb_array_elements(fresh->'items') x
   where public.privacy_mode(x->>'action', x->>'table', x->>'column', ticked) is not null;
  if a_exec <> f_exec then raise exception 'COUNT_MISMATCH: the records changed since you approved (approved %, found now %)', a_exec, f_exec; end if;

  -- 2. plan one unit per table and mode, count distinct rows, apply the blast guard before touching anything
  for g in select s.table_name, s.mode from (
             select pm.table_name, public.privacy_mode(pm.action, pm.table_name, pm.column_name, ticked) as mode
               from public.privacy_data_map pm where pm.enabled) s
            where s.mode is not null group by s.table_name, s.mode order by s.table_name loop
    conds := '{}';
    for m in select * from public.privacy_data_map pm where pm.enabled and pm.table_name = g.table_name
                and public.privacy_mode(pm.action, pm.table_name, pm.column_name, ticked) = g.mode loop
      if not exists (select 1 from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = m.table_name and ic.column_name = m.column_name) then continue; end if;
      cond := public.privacy_cond(m.column_name, m.match_kind, c.email, p10);
      if cond is not null then conds := conds || cond; end if;
    end loop;
    if coalesce(array_length(conds, 1), 0) = 0 then continue; end if;
    w := '(' || array_to_string(conds, ' or ') || ')' || public.privacy_extra(g.table_name);
    execute format('select count(*) from public.%I where %s', g.table_name, w) into pre;
    if pre = 0 then continue; end if;
    if pre > 25 then blasts := blasts || (g.table_name || ' (' || pre || ' rows)'); end if;
    units := units || jsonb_build_object('t', g.table_name, 'mode', g.mode, 'w', w, 'pre', pre);
  end loop;
  if coalesce(array_length(blasts, 1), 0) > 0 then raise exception 'BLAST_GUARD: more than 25 rows for one person in %', array_to_string(blasts, ', '); end if;

  -- 3. apply, all in this one transaction; any mismatch raises and rolls everything back
  for u in select * from jsonb_array_elements(units) loop
    if u->>'mode' = 'delete' then
      execute format('delete from public.%I where %s', u->>'t', u->>'w');
      get diagnostics aff = row_count;
      deleted := deleted + aff;
    else
      sets := '{}';
      for m in select * from public.privacy_data_map pm where pm.enabled and pm.table_name = u->>'t' and pm.action = 'blank' loop
        select ic.is_nullable into v_null from information_schema.columns ic
         where ic.table_schema = 'public' and ic.table_name = m.table_name and ic.column_name = m.column_name;
        if not found then continue; end if;
        sets := sets || format('%I = %s', m.column_name, case when v_null = 'YES' then 'null' else '''[removed]''' end);
      end loop;
      if u->>'t' = 'support_tickets' then sets := sets || array['name = null', 'issue = null']::text[]; end if;
      execute format('update public.%I set %s where %s', u->>'t', array_to_string(sets, ', '), u->>'w');
      get diagnostics aff = row_count;
      blanked := blanked + aff;
    end if;
    if aff <> (u->>'pre')::bigint then raise exception 'COUNT_MISMATCH: % changed % rows but % were found', u->>'t', aff, u->>'pre'; end if;
    plc := plc + 1;
    out_tabs := out_tabs || jsonb_build_object('table', u->>'t', 'mode', u->>'mode', 'rows', aff);
  end loop;

  for it in select * from jsonb_array_elements(fresh->'items') loop
    if it->>'action' = 'keep' then
      keep := keep || jsonb_build_object('table', it->>'table', 'count', it->'count', 'reason', it->>'reason');
    end if;
  end loop;

  res := jsonb_build_object('tables', out_tabs, 'deleted', deleted, 'blanked', blanked, 'places', plc, 'keep', keep);
  update public.privacy_cases set executed_at = now(), result = res, updated_at = now() where id = p_case;
  return res;
end $$;

-- ---------------------------------------------------------------- redact (keeps the 24-month audit record, hashed)
create or replace function public.privacy_redact(p_case uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare c public.privacy_cases; e text;
begin
  select * into c from public.privacy_cases where id = p_case for update;
  if not found or c.redacted_at is not null then return; end if;
  e := lower(btrim(coalesce(c.email, '')));
  if e <> '' then
    -- our own confirmation emails to this address leave log rows behind; sweep them before the address is forgotten
    update public.email_send_log set recipient_email = '[removed]' where lower(btrim(recipient_email)) = e;
    update public.notify_outbox set to_email = null where lower(btrim(to_email)) = e;
    delete from public.email_unsubscribe_tokens where lower(btrim(email)) = e;
  end if;
  update public.privacy_cases set
    email_hash = case when e <> '' then encode(digest(e, 'sha256'), 'hex') else email_hash end,
    phone_hash = case when public.privacy_phone10(phone) is not null then encode(digest(public.privacy_phone10(phone), 'sha256'), 'hex') else phone_hash end,
    email = null, phone = null, redacted_at = now(), updated_at = now()
  where id = p_case;
  update public.support_tickets set name = null, email = null, phone = null, issue = null where code = c.ticket_code;
end $$;

revoke all on function public.privacy_execute(uuid) from public, anon, authenticated;
revoke all on function public.privacy_redact(uuid) from public, anon, authenticated;
grant execute on function public.privacy_execute(uuid) to service_role;
grant execute on function public.privacy_redact(uuid) to service_role;

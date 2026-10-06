-- fix: text[] || 'literal' is read as an array literal; use array_append (claims_sync_put from 20261006230000)
create or replace function public.claims_sync_put(p_token text, p_case uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c claim_cases; v_next text := nullif(p_data->>'next_action', ''); v_dl timestamptz; v_changed text[] := '{}';
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  select * into c from claim_cases where id = p_case for update;
  if c.id is null then return jsonb_build_object('ok', false); end if;
  v_dl := case when nullif(p_data->>'deadline', '') is null then c.turo_deadline else ((p_data->>'deadline')::timestamp at time zone 'America/Los_Angeles') end;
  if v_next is not null and v_next is distinct from c.turo_next_action then v_changed := array_append(v_changed, 'next_action'); end if;
  if p_data->'guest_response' is not null and p_data->'guest_response' <> 'null'::jsonb and p_data->'guest_response' is distinct from c.guest_response then v_changed := array_append(v_changed, 'guest_response'); end if;
  if p_data->'invoice' is not null and p_data->'invoice' <> 'null'::jsonb and p_data->'invoice' is distinct from c.turo_invoice then v_changed := array_append(v_changed, 'invoice'); end if;
  update claim_cases set
    turo_status = coalesce(nullif(p_data->>'status', ''), turo_status),
    turo_next_action = coalesce(v_next, turo_next_action),
    turo_deadline = v_dl,
    invoice_max = coalesce((p_data->>'invoice_max')::numeric, invoice_max),
    host_responsibility = coalesce((p_data->>'host_deductible')::numeric, host_responsibility),
    guest_max = coalesce((p_data->>'guest_max')::numeric, guest_max),
    turo_invoice = case when p_data->'invoice' is null or p_data->'invoice' = 'null'::jsonb then turo_invoice else p_data->'invoice' end,
    guest_response = case when p_data->'guest_response' is null or p_data->'guest_response' = 'null'::jsonb then guest_response else p_data->'guest_response' end,
    damage_report = case when p_data->'damage_report' is null or p_data->'damage_report' = 'null'::jsonb then damage_report else p_data->'damage_report' end,
    synced_at = now(),
    needs_work = needs_work or cardinality(v_changed) > 0 or c.synced_at is null,
    work_reason = case when cardinality(v_changed) > 0 then 'Turo changed: ' || array_to_string(v_changed, ', ') else work_reason end,
    updated_at = now()
  where id = p_case;
  if cardinality(v_changed) > 0 then
    insert into claim_events (case_id, reservation_id, kind, title, detail)
      values (p_case, c.reservation_id, 'turo', case when 'next_action' = any(v_changed) then 'Turo now says: ' || v_next else 'Turo updated the claim' end,
              jsonb_build_object('changed', v_changed, 'next_action', v_next));
  end if;
  return jsonb_build_object('ok', true, 'changed', v_changed);
end $$;

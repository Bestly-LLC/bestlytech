-- Tinker v3 fixer, part 2: the Pi answered (docs/ha-fixer-opusplan.md).
-- ------------------------------------------------------------------ 2. the Pi answered
create or replace function public.ha_fixer_on_command() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  f public.ha_fixes;
  v_id uuid;
  v_err text;
  v_title text;
  v_done boolean := (new.status = 'done');
  v_undo jsonb;
  v_restart text;
  v_old boolean;
begin
  -- the list of automations came back: the edge function turns it into the readable list
  if new.action = 'inventory' then
    begin
      perform public.invoke_edge_function('ha-fixer', jsonb_build_object('op', 'continue', 'inventory_cmd', new.id), 120000);
    exception when others then null; end;   -- the watch picks it up within 5 minutes
    return new;
  end if;

  begin v_id := (new.payload ->> 'fix_id')::uuid; exception when others then return new; end;
  select * into f from public.ha_fixes where id = v_id for update;
  if not found then return new; end if;
  if f.command_id is distinct from new.id then return new; end if;   -- only the command this row waits on counts

  v_title := coalesce(f.culprit ->> 'name', left(f.question, 60));
  v_err := case when new.status = 'expired' then 'Your Pi did not pick this up in time, so nothing was changed.'
                else left(coalesce(nullif(trim(new.error), ''), 'Home Assistant did not say why.'), 600) end;
  v_old := (coalesce(new.error, '') ilike '%unknown homeassistant action%' or coalesce(new.error, '') ilike '%not an allowed command%');

  begin
    if new.action = 'evidence' then
      if v_done then
        update public.ha_fixes set status = 'analyzing', evidence_cmd = new.id, error = null, needs_agent_update = false where id = f.id;
        begin
          perform public.invoke_edge_function('ha-fixer', jsonb_build_object('op', 'continue', 'id', f.id), 120000);
        exception when others then null; end;   -- the watch picks it up within 5 minutes
      else
        update public.ha_fixes set status = 'failed', needs_agent_update = v_old,
          error = case when v_old then 'Your Pi needs the newest Home Hub update before Tinker can look into this. Tinker asks it to update on its own.'
                       else 'I could not read what Home Assistant recorded. ' || v_err end where id = f.id;
        if not v_old then
          perform public.tinker_notify('Tinker: I could not look into a problem', v_err, 'warning', '/admin/home-hub/automations', 'tinker.fixread-failed.' || f.id);
        end if;
      end if;

    elsif f.status = 'applying' and new.action in ('item_edit', 'package_patch', 'toggle_automation') then
      if v_done then
        v_undo := case new.action
          when 'item_edit' then jsonb_build_object('action', 'item_edit', 'payload', jsonb_build_object(
              'domain', f.fix ->> 'domain', 'id', f.fix ->> 'id', 'config', new.result -> 'prev_config', 'expect_hash', new.result ->> 'new_hash'))
          when 'package_patch' then jsonb_build_object('action', 'package_restore', 'payload', jsonb_build_object(
              'name', f.fix ->> 'name', 'backup', new.result ->> 'backup', 'expect_sha256', new.result ->> 'new_sha256', 'reload_keys', coalesce(new.result -> 'reload_keys', '[]'::jsonb)))
          else jsonb_build_object('action', 'toggle_automation', 'payload', jsonb_build_object('automation_id', f.fix ->> 'entity_id', 'enabled', true))
        end;
        v_restart := case when jsonb_typeof(new.result -> 'restart_needed') = 'array' and jsonb_array_length(new.result -> 'restart_needed') > 0
                          then 'Saved. ' || (select string_agg(x, ', ') from jsonb_array_elements_text(new.result -> 'restart_needed') x) ||
                               ' only takes effect after Home Assistant restarts. Tinker never restarts it for you.' else null end;
        update public.ha_fixes set status = 'applied', applied_at = now(), undone_at = null, error = null, undo = v_undo, restart_note = v_restart where id = f.id;
        perform public.tinker_notify('Tinker: ' || v_title || ' is fixed', 'The change is live in Home Assistant. Undo is on the Automation Maker page.',
                                     'success', '/admin/home-hub/automations', 'tinker.fixed.' || f.id);
      else
        update public.ha_fixes set status = 'proposed', error = 'Nothing was changed. ' || v_err where id = f.id;
        perform public.tinker_notify('Tinker: I could not apply a fix to ' || v_title, v_err, 'warning',
                                     '/admin/home-hub/automations', 'tinker.fix-failed.' || f.id || '.' || new.id);
      end if;

    elsif f.status = 'undoing' and new.action in ('item_edit', 'package_restore', 'toggle_automation') then
      if v_done then
        update public.ha_fixes set status = 'undone', undone_at = now(), error = null, restart_note = null where id = f.id;
        perform public.tinker_notify('Tinker: the fix to ' || v_title || ' is undone', 'Home Assistant is back to how it was before.',
                                     'success', '/admin/home-hub/automations', 'tinker.fix-undone.' || f.id);
      else
        update public.ha_fixes set status = 'applied', error = 'The undo did not work. ' || v_err where id = f.id;
        perform public.tinker_notify('Tinker: I could not undo the fix to ' || v_title, v_err, 'warning',
                                     '/admin/home-hub/automations', 'tinker.fix-undo-failed.' || f.id || '.' || new.id);
      end if;
    end if;
  exception when others then
    null;   -- never block the Pi's update; the watch catches a row that stays stuck
  end;
  return new;
end $$;
revoke all on function public.ha_fixer_on_command() from public, anon, authenticated;

create or replace trigger ha_fixer_on_command after update on public.home_hub_commands
  for each row
  when (new.requested_by = 'ha-fixer' and new.status in ('done', 'failed', 'expired') and old.status is distinct from new.status)
  execute function public.ha_fixer_on_command();


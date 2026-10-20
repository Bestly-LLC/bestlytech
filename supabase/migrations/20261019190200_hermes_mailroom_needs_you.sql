-- Hermes, Mail Clerk (2026-10-19, Jared) -- part 3 of 4: Needs you rows and the interrupt rule

-- Needs you + interrupt rule -------------------------------------------------------------------------------------------------
-- Patched in place (not re-typed) so any later change to these two functions is kept. Fails loudly if their shape moved.
do $patch$
declare d text; a1 text; a2 text;
begin
  -- 1. interrupt_class: Hermes' money / government / legal asks are interrupt kinds. Everything else Hermes says is held for the recap.
  select pg_get_functiondef('public.interrupt_class(text,text,text,text)'::regprocedure) into d;
  if position('hermes_rule' in d) = 0 then
    a1 := '  if ti ~ ''^(your day';
    if position(a1 in d) = 0 then raise exception 'interrupt_class changed shape; patch the Hermes rule by hand'; end if;
    d := replace(d, a1, E'  -- hermes_rule: checks and bills are money; government and legal notices are a person-level ask\n'
      || E'  if s = ''hermes'' and ti ~ ''^hermes: (check|bill) '' then return ''money''; end if;\n'
      || E'  if s = ''hermes'' and ti ~ ''^hermes: (government|legal) '' then return ''person''; end if;\n' || a1);
    execute d;
  end if;

  -- 2. admin_today_rows: the Needs you list gets Hermes' three kinds of row.
  select pg_get_functiondef('public.admin_today_rows()'::regprocedure) into d;
  if position('hermes:login' in d) = 0 then
    a2 := E'  union all\n  select ''debrief:'' || d.id::text';
    if position(a2 in d) = 0 then raise exception 'admin_today_rows changed shape; add the Hermes rows by hand'; end if;
    d := replace(d, a2, $h$
  union all
  select 'hermes:login', 'Hermes', 'warning',
         case s.cred_state when 'rejected' then 'Hermes: iPostal1 refused the login. Re-enter it' else 'Hermes: Add the iPostal1 login' end,
         case s.cred_state when 'rejected' then 'iPostal1 said no to the saved email or password. Until it is fixed Hermes can read alerts but cannot open or scan anything.'
              else 'Hermes reads the alert emails on its own. Opening, scanning or depositing needs this login, saved once in Vault.' end,
         'Add login', '/admin/security#ipostal1', coalesce(s.cred_saved_at, s.baseline_at), 1, 2, 'hermes_state', 'login',
         'Hermes cannot open mail at iPostal1 without a saved login', s.cred_state || coalesce(s.cred_saved_at::text, ''), 'person'::text
    from hermes_state s where s.enabled and s.cred_state in ('missing', 'rejected')
  union all
  select 'hermes:act:' || a.id::text, 'Hermes', case when i.mail_type in ('check', 'bill', 'government', 'legal') then 'warning' else 'info' end,
         public.hermes_ask_title(i.mail_type, a.action, public.hermes_name(i.sender, 60)),
         coalesce(a.reason, '') || '. iPostal1 may charge for this. Nothing happens until you tap Approve.',
         'Approve', '/admin/team?hermes=' || a.id::text, a.proposed_at, 1,
         case when i.mail_type in ('check', 'bill') then 1 else 2 end, 'hermes_actions', a.id::text,
         'Hermes is waiting for your tap before it spends anything at iPostal1', a.id::text || ':' || a.status,
         (case when i.mail_type in ('check', 'bill') then 'money' else 'person' end)::text
    from hermes_actions a join hermes_items i on i.id = a.item_id
    cross join hermes_state s
   where a.status = 'proposed' and a.proposed_at > now() - interval '14 days' and s.enabled and s.cred_state in ('saved', 'working', 'trouble')
  union all
  select 'hermes:fail:' || a.id::text, 'Hermes', 'warning',
         'Hermes: Could not confirm the ' || case a.action when 'scan' then 'scan' when 'deposit_check' then 'check deposit' else a.action end
           || ' for ' || public.hermes_name(i.sender, 60) || '. Check iPostal1',
         coalesce(a.error, 'The result was not confirmed.') || ' Hermes will not try again on its own because a click may have happened.',
         'Open Team', '/admin/team?hermes=' || a.id::text, a.finished_at, 1, 2, 'hermes_actions', a.id::text,
         'a paid iPostal1 action ended without a confirmed result', a.id::text || ':failed', 'person'::text
    from hermes_actions a join hermes_items i on i.id = a.item_id
   where a.status = 'failed' and a.finished_at > now() - interval '3 days' and not i.is_test
$h$ || a2);
    execute d;
  end if;
end
$patch$;


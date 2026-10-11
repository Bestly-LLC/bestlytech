-- Hunter: tell Jared the moment TypeSafe lets him in, and keep quiet once a Jev key is saved.
-- Reads mail Mail Bridge already copies into bestly_mail (iCloud + jared@bestly.tech). No AI, no new mail login.
-- Fires once per message (keyed on bestly_mail.id). Stops on its own when vault has jev_api_key.

create table if not exists public.hunter_jev_mail_seen (
  mail_id uuid primary key,
  seen_at timestamptz not null default now()
);
alter table public.hunter_jev_mail_seen enable row level security;

create or replace function public.hunter_jev_mail_watch()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare r record; n int := 0;
begin
  -- Job is done once a key is in the vault.
  if exists (select 1 from vault.secrets where name = 'jev_api_key') then return 0; end if;

  for r in
    select m.id, m.mailbox, m.from_addr, m.subject
      from bestly_mail m
     where m.ingested_at > now() - interval '3 days'
       and (m.from_addr ilike '%@typesafe.ai' or m.from_addr ilike '%.typesafe.ai' or m.from_name ilike 'typesafe%')
       and not exists (select 1 from hunter_jev_mail_seen s where s.mail_id = m.id)
     order by m.sent_at
  loop
    insert into hunter_jev_mail_seen(mail_id) values (r.id) on conflict do nothing;
    perform notify_route(
      p_title  := 'Hunter: TypeSafe emailed you',
      p_body   := format('"%s" in %s. If it has your Jev key, paste it on the Jev card and tap Score one lead. -- Hunter', left(coalesce(r.subject, '(no subject)'), 120), r.mailbox),
      p_level  := 'success',
      p_source := 'Hunter',
      p_url    := 'https://bestly.tech/admin/leads/hunter',
      p_tag    := 'hunter-jev-mail');
    n := n + 1;
  end loop;

  return n;
end $$;

revoke all on function public.hunter_jev_mail_watch() from public, anon, authenticated;

select cron.schedule('hunter-jev-mail', '*/10 * * * *', 'select public.hunter_jev_mail_watch()');

-- Hunter owns the new job.
update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', coalesce(pulse->'also', '[]'::jsonb) || '["hunter-jev-mail"]'::jsonb)
 where slug = 'hunter' and not (coalesce(pulse->'also', '[]'::jsonb) ? 'hunter-jev-mail');

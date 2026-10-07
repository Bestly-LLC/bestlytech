-- Ava voice audit (2026-10-06). Jared picked Sapphire, but Ava's saved voice was Callie and nothing recorded when or how it
-- changed: the quick switcher (ava-voices) wrote history, the full Voice section (ava-assistant voice_use) did not.
--   ava_voice_history.via   which picker made the change ('switcher' | 'voice section'); both write it now.
--   ava_voice_changes       every change to ava_settings.voice_id / rg_settings.voice_id, whatever made it (trigger).

alter table public.ava_voice_history add column if not exists via text;

create table if not exists public.ava_voice_changes (
  id bigint generated always as identity primary key,
  source text not null,
  old_voice text,
  new_voice text,
  changed_at timestamptz not null default now(),
  db_role text default current_user,
  app text default current_setting('application_name', true)
);
alter table public.ava_voice_changes enable row level security;
drop policy if exists "admins read voice changes" on public.ava_voice_changes;
create policy "admins read voice changes" on public.ava_voice_changes for select to authenticated using (has_role(auth.uid(), 'admin'));

create or replace function public.ava_voice_change_log() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.voice_id is distinct from old.voice_id then
    insert into ava_voice_changes (source, old_voice, new_voice) values (case when tg_table_name = 'rg_settings' then 'rg' else 'ava' end, old.voice_id, new.voice_id);
  end if;
  return new;
end $$;
revoke all on function public.ava_voice_change_log() from anon, authenticated, public;

drop trigger if exists ava_voice_change_log on public.ava_settings;
create trigger ava_voice_change_log after update of voice_id on public.ava_settings for each row execute function public.ava_voice_change_log();
drop trigger if exists ava_voice_change_log on public.rg_settings;
create trigger ava_voice_change_log after update of voice_id on public.rg_settings for each row execute function public.ava_voice_change_log();

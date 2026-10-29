-- Family Cookbook, part 7: who may call what, and the Ares allowlist.
-- The page has no Supabase login, so the 16 public RPCs are callable by the publishable key and check the cookbook session token themselves.
-- family_photo_path, family_paid_state and the _family_* helpers are service role only (edge functions, Basil).
-- (An earlier draft also had family_pair_create / family_pair_redeem, a "sign in on another device" code; they were dropped before shipping.)
do $$
declare f text;
begin
  foreach f in array array[
    'family_me(text)','family_logout(text)','family_recipes(text)','family_recipe(text,integer)',
    'family_review_list(text)','family_deleted_list(text)','family_captures(text)',
    'family_delete(text,integer)','family_restore(text,integer)','family_edit(text,integer,text,text)',
    'family_approve(text,integer,jsonb,text)','family_set_notes(text,integer,text)',
    'family_log_cook(text,integer,text,text,numeric,boolean)',
    'family_capture_discard(text,uuid)','family_capture_retry(text,uuid)',
    'family_capture_save(text,uuid,jsonb,text,boolean)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'family_photo_path(text,uuid)','family_paid_state()','_family_me(text)','_family_need(text)',
    '_family_get(public.family_members,integer,boolean)','_family_row(public.pantry_recipes)',
    '_family_note_added(text)','_family_unique_name(text)','_family_unique_slug(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

insert into public.security_public_rpcs (fn, why)
select x, 'Family Cookbook at bestly.tech/cookbook: the page calls this with its own session token (not a Supabase login); the function checks the token and the family visibility rules itself.'
from unnest(array[
  'family_me','family_logout','family_recipes','family_recipe','family_review_list','family_deleted_list',
  'family_captures','family_delete','family_restore','family_edit','family_approve','family_set_notes',
  'family_log_cook','family_capture_discard','family_capture_retry','family_capture_save'
]) as x
on conflict (fn) do nothing;

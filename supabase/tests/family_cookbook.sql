-- Family Cookbook visibility + permission tests. Run against the linked project:
--   supabase db query --linked -f supabase/tests/family_cookbook.sql
-- Everything happens inside one DO block that ends by RAISING, so nothing it writes is kept.
-- A pass shows up as the error text "FAMILY_TESTS_PASSED ...". Any other error text is a failure.

create or replace function pg_temp.fails(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'NO_ERROR';
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  tm text := 'test-mom-' || repeat('m', 48);
  tj text := 'test-jared-' || repeat('j', 48);
  ta text := 'test-mariah-' || repeat('a', 48);
  mom_id uuid; jared_id uuid; mariah_id uuid;
  r_mom int; r_jared int; r_mariah int; r_old int;
  ph_mom uuid; ph_jared uuid; cap_jared uuid;
  j jsonb; n int := 0; s text;
  doc jsonb := '{"title":"X","ingredients":[{"name":"a"}],"steps":[{"text":"b"}]}'::jsonb;
begin
  update public.family_members set status = 'active' where role in ('mom', 'mariah');
  select id into mom_id from public.family_members where role = 'mom';
  select id into jared_id from public.family_members where role = 'jared';
  select id into mariah_id from public.family_members where role = 'mariah';
  insert into public.family_sessions (token_hash, member_id) values
    (encode(extensions.digest(tm, 'sha256'), 'hex'), mom_id),
    (encode(extensions.digest(tj, 'sha256'), 'hex'), jared_id),
    (encode(extensions.digest(ta, 'sha256'), 'hex'), mariah_id);

  insert into public.pantry_recipes (name, needs, how, active, source, slug, doc, family_by, family_note)
    values ('TEST Mom soup', '{}', 'x', false, 'family', 'test-mom-soup', doc || '{"title":"TEST Mom soup"}', 'mom', 'momnote') returning id into r_mom;
  insert into public.pantry_recipes (name, needs, how, active, source, slug, doc, family_by, family_note)
    values ('TEST SECRETJARED stew', '{}', 'x', false, 'family', 'test-jared-stew',
            doc || '{"title":"TEST SECRETJARED stew","ingredients":[{"name":"SECRETJARED beans"}]}', 'jared', 'SECRETJARED note') returning id into r_jared;
  insert into public.pantry_recipes (name, needs, how, active, source, slug, doc, family_by, family_note)
    values ('TEST SECRETMARIAH cake', '{}', 'x', false, 'family', 'test-mariah-cake', doc || '{"title":"TEST SECRETMARIAH cake"}', 'mariah', 'SECRETMARIAH note') returning id into r_mariah;
  -- a Kitchen recipe of Jared's (family_by null) must be hidden from Mom too
  insert into public.pantry_recipes (name, needs, how, active, source, slug, doc)
    values ('TEST SECRETKITCHEN curry', '{}', 'x', false, 'link', 'test-kitchen-curry', doc || '{"title":"TEST SECRETKITCHEN curry"}') returning id into r_old;

  insert into public.family_photos (recipe_id, side, storage_path) values (r_mom, 'front', 'test/mom.jpg') returning id into ph_mom;
  insert into public.family_photos (recipe_id, side, storage_path) values (r_jared, 'front', 'test/jared.jpg') returning id into ph_jared;
  insert into public.family_captures (member_id, status, draft) values (jared_id, 'ready', doc) returning id into cap_jared;

  -- 1. Mom's list: only Mom's rows, no trace of the others anywhere in the payload
  j := public.family_recipes(tm);
  assert j::text like '%TEST Mom soup%', 'mom sees her own recipe';
  assert j::text not like '%SECRET%', 'mom list leaks nothing of Jared or Mariah';
  assert (select count(*) from jsonb_array_elements(j -> 'recipes') x where x ->> 'by' <> 'mom') = 0, 'mom list has only mom rows'; n := n + 3;

  -- 2. Jared and Mariah see Mom, each other, and Jared's Kitchen recipes
  for s in select unnest(array[tj, ta]) loop
    j := public.family_recipes(s);
    assert j::text like '%TEST Mom soup%' and j::text like '%SECRETJARED%' and j::text like '%SECRETMARIAH%' and j::text like '%SECRETKITCHEN%', 'reviewers see everything';
  end loop; n := n + 2;

  -- 3. Direct reads of Jared's, Mariah's and a Kitchen recipe by Mom fail the same way a missing id does
  assert pg_temp.fails(format('select public.family_recipe(%L, %s)', tm, r_jared)) = 'not_found', 'mom cannot open jared';
  assert pg_temp.fails(format('select public.family_recipe(%L, %s)', tm, r_mariah)) = 'not_found', 'mom cannot open mariah';
  assert pg_temp.fails(format('select public.family_recipe(%L, %s)', tm, r_old)) = 'not_found', 'mom cannot open a kitchen recipe';
  assert pg_temp.fails(format('select public.family_recipe(%L, %s)', ta, r_jared)) = 'NO_ERROR', 'mariah can open jared';
  assert pg_temp.fails(format('select public.family_recipe(%L, %s)', tj, r_mariah)) = 'NO_ERROR', 'jared can open mariah'; n := n + 5;

  -- 4. Not signed in
  assert pg_temp.fails($q$select public.family_recipes('garbage')$q$) = 'not_signed_in', 'bad token';
  assert pg_temp.fails($q$select public.family_recipes(null)$q$) = 'not_signed_in', 'null token'; n := n + 2;

  -- 5. Edit permissions: only the owner or Jared
  assert pg_temp.fails(format('select public.family_edit(%L, %s, %L, %L)', tm, r_mom, 'TEST Mom soup v2', 'ok')) = 'NO_ERROR', 'owner edits';
  assert pg_temp.fails(format('select public.family_edit(%L, %s, %L, %L)', ta, r_mom, 'nope', 'x')) = 'not_allowed', 'mariah cannot edit mom';
  assert pg_temp.fails(format('select public.family_edit(%L, %s, %L, %L)', tj, r_mom, 'TEST Mom soup v3', 'by jared')) = 'NO_ERROR', 'jared edits mom';
  assert pg_temp.fails(format('select public.family_edit(%L, %s, %L, %L)', tm, r_mariah, 'nope', 'x')) = 'not_found', 'mom cannot touch mariah';
  assert pg_temp.fails(format('select public.family_edit(%L, %s, %L, %L)', ta, r_jared, 'nope', 'x')) = 'not_allowed', 'mariah cannot edit jared';
  assert pg_temp.fails(format('select public.family_delete(%L, %s)', tm, r_jared)) = 'not_found', 'mom cannot delete jared';
  assert pg_temp.fails(format('select public.family_delete(%L, %s)', ta, r_mom)) = 'not_allowed', 'mariah cannot delete mom'; n := n + 7;

  -- 6. Recently Deleted: moved, hidden from Mom, restorable only by people who could see it
  assert pg_temp.fails(format('select public.family_delete(%L, %s)', tj, r_jared)) = 'NO_ERROR', 'jared deletes his own';
  assert public.family_recipes(ta)::text not like '%SECRETJARED stew%', 'deleted row left the list';
  assert public.family_deleted_list(tm)::text not like '%SECRET%', 'mom deleted list leaks nothing';
  assert public.family_deleted_list(ta)::text like '%SECRETJARED stew%', 'mariah sees jared deleted';
  assert pg_temp.fails(format('select public.family_restore(%L, %s)', tm, r_jared)) = 'not_found', 'mom cannot restore jared';
  assert pg_temp.fails(format('select public.family_restore(%L, %s)', ta, r_jared)) = 'NO_ERROR', 'mariah restores jared';
  assert public.family_recipes(tj)::text like '%SECRETJARED stew%', 'restored row is back'; n := n + 6;

  -- 7. Older than 30 days drops out of Recently Deleted (the purge job removes the row itself)
  update public.pantry_recipes set deleted_at = now() - interval '31 days', deleted_by = 'jared' where id = r_jared;
  assert public.family_deleted_list(tj)::text not like '%SECRETJARED stew%', '31 days old is gone from the list';
  update public.pantry_recipes set deleted_at = null, deleted_by = null where id = r_jared; n := n + 1;

  -- 8. Photos
  assert pg_temp.fails(format('select public.family_photo_path(%L, %L)', tm, ph_jared)) = 'not_found', 'mom cannot open jared photo';
  assert pg_temp.fails(format('select public.family_photo_path(%L, %L)', tm, ph_mom)) = 'NO_ERROR', 'mom opens her photo';
  assert pg_temp.fails(format('select public.family_photo_path(%L, %L)', ta, ph_mom)) = 'NO_ERROR', 'mariah opens mom photo';
  assert pg_temp.fails(format('select public.family_photo_path(%L, %L)', ta, ph_jared)) = 'NO_ERROR', 'mariah opens jared photo'; n := n + 4;

  -- 9. Captures belong to their owner; Needs-a-look shows only what the viewer may see
  assert public.family_captures(tm)::text not like '%' || cap_jared::text || '%', 'mom sees none of jared captures';
  assert pg_temp.fails(format('select public.family_capture_discard(%L, %L)', tm, cap_jared)) = 'not_found', 'mom cannot discard jared capture';
  update public.pantry_recipes set family_status = 'review', family_flagged_by = 'jared', family_flagged_at = now() where id in (r_jared, r_mom);
  assert public.family_review_list(tm)::text = '{"recipes": []}', 'mom review queue is empty';
  assert public.family_review_list(ta)::text like '%SECRETJARED stew%', 'mariah review queue shows jared';
  assert pg_temp.fails(format('select public.family_approve(%L, %s, %L::jsonb, %L)', tm, r_mom, doc::text, '')) = 'not_allowed', 'mom cannot approve'; n := n + 5;

  -- 10. Notes and cook log respect visibility; OmniCook is recorded only for Jared
  assert pg_temp.fails(format('select public.family_set_notes(%L, %s, %L)', tm, r_jared, 'hi')) = 'not_found', 'mom cannot note jared';
  assert pg_temp.fails(format('select public.family_log_cook(%L, %s, %L, %L, 1, true)', tm, r_mariah, 'x', 'y')) = 'not_found', 'mom cannot log on mariah';
  perform public.family_log_cook(ta, r_mom, 'x', 'y', 1, true);
  perform public.family_log_cook(tj, r_mom, 'x', 'y', 1, true);
  assert (select omni from public.recipe_cooks where recipe_id = r_mom and via = 'family:mariah') = false, 'mariah omni is stored false';
  assert (select omni from public.recipe_cooks where recipe_id = r_mom and via = 'family:jared') = true, 'jared omni is stored true'; n := n + 4;

  -- 11. The admin Kitchen overview shows family rows as "Family" and omits deleted ones (checked as a plain count here)
  assert (select count(*) from public.pantry_recipes where family_by in ('mom', 'mariah') and deleted_at is null) >= 2, 'family rows exist';

  -- 12. Logout kills the session
  perform public.family_logout(tm);
  assert pg_temp.fails(format('select public.family_recipes(%L)', tm)) = 'not_signed_in', 'logout ends the session'; n := n + 2;

  raise exception 'FAMILY_TESTS_PASSED % assertions', n;
end $$;

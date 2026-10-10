-- RoofGuard's caller is now Reese (personal Ava keeps her name). Only user-visible text changes:
-- no tables, columns, RPCs or components are renamed. Idempotent: safe to re-run.
-- Applied live on 2026-10-10 (function bodies one at a time, data rows below); this file records it.

-- 1. SQL function bodies that said "RoofGuard Ava" -> "Reese" (notification titles and bodies)
do $$
declare r record; def text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ilike '%RoofGuard Ava%'
  loop
    def := pg_get_functiondef(r.oid);
    def := replace(replace(def, 'RoofGuard Ava''s', 'Reese''s'), 'RoofGuard Ava', 'Reese');
    execute def;
  end loop;
end $$;

-- 2. Stored openers and shareable knowledge for the RoofGuard line
update public.rg_openers set script = replace(script, 'Ava', 'Reese') where script like '%Ava%';
update public.ava_knowledge set fact = replace(fact, 'Ava', 'Reese'), topic = replace(topic, 'Ava', 'Reese')
  where scope = 'roofguard' and (fact like '%Ava%' or topic like '%Ava%');

-- 3. Team cards
update public.bestly_agents set name = 'Reese' where slug = 'roofguard-caller' and name <> 'Reese';
update public.bestly_agents set what_it_does = replace(replace(what_it_does, 'RoofGuard Ava''s', 'Reese''s'), 'RoofGuard Ava', 'Reese')
  where what_it_does like '%RoofGuard Ava%';

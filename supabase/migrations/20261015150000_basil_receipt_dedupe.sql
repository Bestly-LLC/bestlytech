-- Basil: receipts update existing pantry rows instead of adding twins (Oct 14 2026, Jared said "dedupe").
-- Bug: the Costco Same-Day receipt (order 21417337430475044) landed ~6:45 PM and pantry_ingest_receipt added all 10
-- items again next to the rows seeded from the order page, because it only skipped exact same-name rows
-- ("Kirkland Olive Oil" vs "Kirkland olive oil"). Applied live via MCP; this file is the record.
--  * pantry_tokens(): significant words (no brand filler, sizes or plurals).
--  * pantry_find_existing(): the row a receipt line most likely is: 3 of 4 words in common (a shared brand alone,
--    like "Bob's Red Mill", is not enough), and a one-word item ("Rice") only matches short lines.
--    Tested on the 10 real pairs plus eggs, chocolate chips, whole grain flour (match) and arrowroot, cheddar (new).
--  * pantry_ingest_receipt(): a matching line updates that row (out/low -> arriving, fills use_by) instead of inserting.
--  * Data fix (run once, live): the 10 receipt twins were deleted after logging each row to pantry_events
--    (source basil, action remove, snapshot = the full row) so any of them can be restored.

CREATE OR REPLACE FUNCTION public.pantry_tokens(p text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(array_agg(distinct case when t ~ 'ies$' then regexp_replace(t, 'ies$', 'y')
                        when t ~ '(ses|xes|ches|shes|oes)$' then regexp_replace(t, 'es$', '')
                        when t ~ '[^s]s$' then regexp_replace(t, 's$', '') else t end), '{}')
  from unnest(string_to_array(pantry_norm(p), ' ')) t
  where length(t) > 1 and t !~ '^\d' and t not in ('the','and','of','with','for','in','a','an','kirkland','signature','organic','count','ct','oz','lb','lbs','pack','pk','fl','each','100','brand')
$function$;

CREATE OR REPLACE FUNCTION public.pantry_find_existing(p_name text)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select i.id from pantry_items i
  cross join lateral (select pantry_tokens(p_name) a, pantry_tokens(i.name) b) t
  cross join lateral (select cardinality(array(select unnest(t.a) intersect select unnest(t.b))) hit,
                             least(cardinality(t.a), cardinality(t.b)) small) s
  -- 3 of 4 words in common (a shared brand alone, like "Bob's Red Mill", is not enough)
  where s.small > 0 and s.hit >= least(2, s.small) and s.hit::numeric / s.small >= 0.75
    and (cardinality(t.b) >= 2 or cardinality(t.a) <= 3)   -- a one-word item ("Rice") only matches short lines
  order by s.hit::numeric / s.small desc, s.hit desc, i.added_at
  limit 1
$function$;

revoke all on function public.pantry_find_existing(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pantry_ingest_receipt(p_mail_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m record; lines text[]; i int; n int := 0; v_ref text; v_raw text; v_name text; v_qtyline text;
  v_qty numeric; v_unit text; v_loc text; v_useby date; v_soon boolean; v_match uuid; u int := 0;
begin
  if exists (select 1 from pantry_receipts where mail_id = p_mail_id and ok) then
    return jsonb_build_object('ok', true, 'skipped', 'already ingested');
  end if;
  select * into m from bestly_mail where id = p_mail_id;
  if m.id is null then return jsonb_build_object('ok', false, 'error', 'mail not found'); end if;
  v_ref := substring(m.body_text from 'Order ID:\s*#\s*(\d+)');
  select array_agg(btrim(x) order by o) into lines
    from unnest(regexp_split_to_array(replace(coalesce(m.body_text,''), E'\r', ''), E'\n')) with ordinality t(x, o)
   where btrim(x) <> '';
  if lines is null then raise exception 'empty receipt'; end if;
  for i in 2 .. coalesce(array_length(lines, 1), 0) - 2 loop
    continue when lines[i] <> 'x' or lines[i+2] !~* '^item \d+';
    v_qtyline := lines[i-1]; v_raw := replace(lines[i+1], '&amp;', '&');
    continue when v_raw ~* '(capsule|tablet|softgel|vitamin|supplement|nmn|detergent|paper towel|toilet|tissue|trash bag|soap|shampoo|batter(y|ies)|diaper|wipes)';
    v_name := regexp_replace(v_raw, ',\s*[\d.]+\s*(-?\s*count|ct|fl oz|oz|lbs?|l|ml|g|kg|-?\s*pack|pk)\y.*$', '', 'i');
    v_name := btrim(regexp_replace(v_name, '^kirkland signature,?\s*', 'Kirkland ', 'i'));
    v_qty := nullif(substring(v_qtyline from '^([\d.]+)'), '')::numeric;
    v_unit := case when v_qtyline ~* 'lb' then 'lb' else 'each' end;
    v_loc := case
      when v_raw ~* '(frozen|brazi bites|ice cream|popsicle)' then 'freezer'
      when v_raw ~* '(rotisserie|chili|nectar|juice|milk|yogurt|cheese|egg|butter|salad|berr|hummus|salsa|chicken|beef|pork|salmon|shrimp|lettuce|spinach|avocado|grape|apple|tortilla)' then 'fridge'
      else 'pantry' end;
    v_soon := v_raw ~* '(rotisserie|prepared|chili|salad|berries|avocado|spinach|lettuce)';
    v_useby := case when v_raw ~* 'rotisserie' then current_date + 3 when v_soon then current_date + 4 end;
    -- Same thing already on the list (seeded or bought before, different wording): update it, don't add a twin.
    v_match := pantry_find_existing(v_name);
    if v_match is not null then
      update pantry_items set status = case when status in ('out', 'low') then 'arriving' else status end,
             use_by = coalesce(use_by, v_useby), use_soon = use_soon or v_soon
       where id = v_match;
      u := u + 1;
    elsif not exists (select 1 from pantry_items where source = 'costco ' || coalesce(v_ref, p_mail_id::text) and name = v_name) then
      insert into pantry_items (name, category, location, qty, unit, status, use_soon, use_by, source, notes)
      values (v_name, 'groceries', v_loc, v_qty, v_unit, 'arriving', v_soon, v_useby,
              'costco ' || coalesce(v_ref, p_mail_id::text), 'auto-added by Basil from receipt');
      n := n + 1;
    end if;
  end loop;
  insert into pantry_receipts (mail_id, order_ref, items, ok, error) values (p_mail_id, v_ref, n, true, null)
  on conflict (mail_id) do update set items = excluded.items, ok = true, error = null, at = now();
  return jsonb_build_object('ok', true, 'order', v_ref, 'added', n, 'matched', u);
exception when others then
  insert into pantry_receipts (mail_id, ok, error) values (p_mail_id, false, left(sqlerrm, 300))
  on conflict (mail_id) do update set ok = false, error = excluded.error, at = now();
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $function$;

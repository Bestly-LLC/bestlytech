-- Security audit finding supa:Bestly:advisor:function_search_path (open 1 night, 2026-10-15):
-- Supabase advisor lint function_search_path_mutable flagged 3 public functions with no fixed search_path:
--   pantry_is_grocery_mail(text, text)   sql, immutable  - pure regex, no table or schema references
--   pantry_items_touch()                 plpgsql trigger - sets new.updated_at := now(), no schema references
--   studio_title_overlap(text, text)     sql, immutable  - regexp_split_to_table / lower / length only (pg_catalog)
-- None is SECURITY DEFINER, none is owned by an extension, none touches vault / auth / extensions,
-- so pinning the path to "public, pg_temp" cannot change what they resolve. pg_catalog is always searched first.
--
-- UNDO (restores the previous, mutable behaviour):
--   alter function public.pantry_is_grocery_mail(text, text) reset search_path;
--   alter function public.pantry_items_touch() reset search_path;
--   alter function public.studio_title_overlap(text, text) reset search_path;

alter function public.pantry_is_grocery_mail(p_from text, p_subject text) set search_path = public, pg_temp;
alter function public.pantry_items_touch() set search_path = public, pg_temp;
alter function public.studio_title_overlap(p_a text, p_b text) set search_path = public, pg_temp;

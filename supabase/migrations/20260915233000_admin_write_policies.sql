-- Fix: admin actions that "succeeded" but changed nothing.
-- With RLS on and no matching policy, PostgREST returns success with 0 rows affected, so the UI
-- showed "Deleted" while the row stayed. Audited every admin write in src/ against pg_policy on
-- 2026-09-15; these three were the gaps.

-- /admin/submissions: Delete (list + detail). Child rows cascade via FK.
create policy "Admin can delete intakes" on public.seller_intakes
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- Cookie Yeti > Community: clearing the AI generation log.
create policy "Admin can delete ai_generation_log" on public.ai_generation_log
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- Cookie Yeti > Community + Manual pattern form: approve / edit / remove patterns.
grant insert, update, delete on public.cookie_patterns to authenticated;
create policy "Admin can insert cookie patterns" on public.cookie_patterns
  for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "Admin can update cookie patterns" on public.cookie_patterns
  for update to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "Admin can delete cookie patterns" on public.cookie_patterns
  for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

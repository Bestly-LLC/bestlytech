-- /admin/roofguard showed "permission denied for table rg_leads": this project does not auto-grant
-- new tables to authenticated. RLS (has_role admin) still gates every row. (Spark, 2026-10-03)
grant select, update on public.rg_leads to authenticated;
grant select on public.rg_enrich_runs to authenticated;
grant select, insert, update on public.rg_pitch_templates to authenticated;

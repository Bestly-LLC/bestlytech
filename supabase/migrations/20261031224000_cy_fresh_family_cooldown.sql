-- cy_fresh (Centering YOU weekly corner graphics + name cards, Pi job on Hestia) failed every run since 2026-10-29 with
-- P0001 "stale design (same style family (disc) used in 2026-W42 (family cooldown 2 weeks))".
-- Root cause: studio_design_stale_reason gained the family-first rest on 2026-10-12, the Pi's local stale check
-- (cy-kit/fresh/designs.py stale_local) never did, so it drew a family the database then refused.
-- The Pi copy now applies the same rule (scripts/pi-wave-b/cy_fresh/designs.py). The corner design space has only
-- 4 families (arch, block, disc, organic); a 2-week family rest leaves nothing to draw every third week, so this
-- client rests families 1 week (the batch itself still spreads families as far as the free pool allows).
insert into public.studio_design_settings (client_slug, key, value, note, updated_at)
values ('centering-you', 'family_cooldown_weeks', 1,
        '2026-10-31: corner graphics have 4 style families; a 2-week rest leaves no family free every third week. 1 week alternates cleanly.',
        now())
on conflict (client_slug, key) do update set value = excluded.value, note = excluded.note, updated_at = now();

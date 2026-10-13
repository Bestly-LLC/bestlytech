-- Montage re-cut fix (2026-10-12): Spark owns the two new Montage alert prefixes (both info, never a push).
insert into public.notification_owners (prefix, agent_slug, note) values
  ('montage.recut', 'spark', 'A re-cut was stopped because its copy came back (nearly) unchanged twice; info, no push. 2026-10-12'),
  ('montage.graphics', 'spark', 'A video was drawn as plain cards because the motion-graphics render failed; info, no push. 2026-10-12')
on conflict (prefix) do nothing;

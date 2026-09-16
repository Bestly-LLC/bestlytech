-- Cookie Yeti guided fixes: Jared walks the robot browser through a banner in the admin
-- (cy-guide). A one-click fix is a normal pattern. A multi-screen fix ("Manage options"
-- then "Reject all") is stored in order in `steps`; the row's selector/action_type are the
-- final click, so extensions that don't know `steps` simply ignore it.
alter table public.cookie_patterns
  add column if not exists steps jsonb;

comment on column public.cookie_patterns.steps is
  'Ordered clicks for multi-screen banners: [{"selector": "...", "action": "next|accept|reject|necessary|save|close"}]. NULL for one-click patterns. Recorded by cy-guide and robot-tested before saving.';

alter table public.cookie_patterns
  drop constraint if exists cookie_patterns_steps_shape;
alter table public.cookie_patterns
  add constraint cookie_patterns_steps_shape
  check (steps is null or (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 2 and 6));

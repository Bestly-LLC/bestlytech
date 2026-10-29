-- Local alerts: projector (beige wall) palette, Jared approved 2026-10-29 10:58 AM.
-- A projector can only add light, so the wall's beige shows through anything dark. Colors move away from
-- the wall's own hue (yellow and tan melted into it) and get brighter (purple and indigo dimmed).
-- One registry feeds both the projector wall sky and the /admin Sky map, so parity holds.
-- Undo: the previous colors are in the comment at the bottom.
update public.citizen_categories c set color = v.color
from (values
  ('fire_medical', '#FF2D2D'),
  ('police',       '#2F8CFF'),
  ('sheriff_city', '#00D9FF'),
  ('earthquake',   '#FF3DE0'),
  ('wildfire',     '#FF6A00'),
  ('power',        '#9BFF1F'),
  ('closures',     '#FF5C9A'),
  ('transit',      '#00FF8C'),
  ('weather',      '#9B7BFF'),
  ('traffic',      '#FFFFFF')
) as v(id, color)
where c.id = v.id;

-- Previous (v2, 2026-10-28): fire_medical #FF453A, police #0A84FF, sheriff_city #64D2FF, earthquake #BF5AF2,
-- wildfire #FF9F0A, power #FFD60A, closures #FF375F, transit #30D158, weather #7D7AFF, traffic #AC8E68.

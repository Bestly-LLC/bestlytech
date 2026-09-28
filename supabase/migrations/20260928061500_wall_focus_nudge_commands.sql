-- Admin > Wall > Projector: sign-wall focus nudge (W4, 2026-09-27). The Pi moves the lens one manual-focus step
-- and remembers the total, re-applied after every Focus tap and 10 min after each wake.
CREATE OR REPLACE FUNCTION public.wall_admin_command(p_cmd text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare w public.wall_state;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_cmd not in ('focus','focus_left','focus_right','relaunch','airplay_restart') then raise exception 'unknown command'; end if;
  update wall_state set power = jsonb_build_object('cmd', p_cmd, 'seq', coalesce((power->>'seq')::int, 0) + 1, 'at', now()),
                        updated_at = now()
   where id = 1 returning * into w;
  return w.power;
end $function$;

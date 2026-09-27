-- Sign the wall v3 (2026-09-27): NFC coaster gate, signing sessions, emoji graffiti, badge email gate, Scout watchdog.
-- Guests reach bestly.tech/sign/<code> from an NFC coaster. The code opens a 20-minute signing session.
-- The old bare /sign link keeps working until wall_sign_config.legacy_until (7 days), then switches off by itself.

-- ---------- tables (RLS on, no policies: RPC-only) ----------
create table if not exists public.wall_sign_tags (
  code text primary key check (code ~ '^[a-z0-9]{3,12}$'),
  label text,
  active boolean not null default true,
  taps int not null default 0,
  last_tap_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.wall_sign_tags enable row level security;

create table if not exists public.wall_sign_config (
  id int primary key default 1 check (id = 1),
  legacy_until timestamptz not null,
  session_minutes int not null default 20,
  -- wing geometry Scout uses to place emojis (wing px, 1000 x 980). Keep in sync with wall.html sigLayout / WING_AVOID.
  layout jsonb not null default '{"w":1000,"h":980,"top":160,"left":30,"right":974,"bottom":960,
     "avoid":[[720,160,1000,480],[420,490,770,770],[700,780,1000,980],[280,0,1000,150]]}'::jsonb,
  emoji_layout_h int
);
alter table public.wall_sign_config enable row level security;
insert into public.wall_sign_config (id, legacy_until)
values (1, timestamptz '2026-10-04 23:59:00 America/Los_Angeles')
on conflict (id) do nothing;

create table if not exists public.wall_sign_sessions (
  token text primary key,
  tag text not null,
  device text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  signature_ids bigint[] not null default '{}',
  emoji_id bigint,
  emails int not null default 0
);
alter table public.wall_sign_sessions enable row level security;
create index if not exists wall_sign_sessions_created on public.wall_sign_sessions (created_at);

create table if not exists public.wall_sign_misses (
  id bigserial primary key,
  at timestamptz not null default now(),
  code text,
  device text,
  reason text
);
alter table public.wall_sign_misses enable row level security;
create index if not exists wall_sign_misses_at on public.wall_sign_misses (at);

create table if not exists public.wall_emojis (
  id bigserial primary key,
  emoji text not null unique,
  emoji_key text not null unique,
  x real not null check (x between 0 and 1),
  y real not null check (y between 0 and 1),
  size real not null default 0.05 check (size between 0.01 and 0.2),
  created_at timestamptz not null default now(),
  placed_by text not null default 'scout',
  signature_id bigint references public.wall_signatures(id) on delete set null
);
alter table public.wall_emojis enable row level security;

-- ---------- emoji validation: one emoji (incl. flags, keycaps, ZWJ sequences) -> uniqueness key ----------
-- Key drops FE0E/FE0F and skin tones, so 👍 and 👍🏽 count as the same emoji. Returns null when it isn't exactly one emoji.
create or replace function public.wall_emoji_key(p text)
returns text language plpgsql immutable set search_path = public as $$
declare s text := btrim(coalesce(p, '')); n int; i int; c int; k text := ''; bases int := 0; zwj int := 0; ri int := 0; keycap boolean;
begin
  n := char_length(s);
  if n < 1 or n > 16 then return null; end if;
  keycap := position(chr(8419) in s) > 0;
  for i in 1..n loop
    c := ascii(substr(s, i, 1));
    if c in (65038, 65039) or c between 127995 and 127999 then continue;          -- variation selectors, skin tones
    elsif c = 8205 then zwj := zwj + 1; k := k || chr(c);                           -- ZWJ
    elsif c = 8419 or c between 917536 and 917631 then k := k || chr(c);            -- keycap, tag chars
    elsif c between 127462 and 127487 then ri := ri + 1; k := k || chr(c);          -- regional indicators (flags)
    elsif c in (35, 42) or c between 48 and 57 then
      if not keycap then return null; end if; bases := bases + 1; k := k || chr(c);
    elsif c in (169, 174, 8252, 8265, 8482, 8505, 9410, 12336, 12349, 12951, 12953)
       or c between 8596 and 8618 or c between 8986 and 9215 or c between 9642 and 10175
       or c between 10548 and 10549 or c between 11013 and 11093 or c between 126976 and 129791 then
      bases := bases + 1; k := k || chr(c);
    else
      return null;
    end if;
  end loop;
  if ri > 0 then
    return case when ri = 2 and bases = 0 and zwj = 0 then k end;
  end if;
  if bases < 1 or bases <> zwj + 1 then return null; end if;
  return k;
end $$;

-- ---------- signature grid (port of wall.html sigLayout) ----------
create or replace function public.wall_sig_cells(p_n int)
returns table (cx real, cy real, cw real, ch real, cell_h int)
language plpgsql stable set search_path = public as $$
declare L jsonb; top int; lft int; rgt int; bot int; h int; w int; gx int; gy int; cols int; x0 numeric; y int; c int; x numeric;
        cnt int; av jsonb; hit boolean; hs int[] := array[200,172,150,130,113,98,86,75,66,58,51,45,40];
begin
  select layout into L from wall_sign_config where id = 1;
  top := (L->>'top')::int; lft := (L->>'left')::int; rgt := (L->>'right')::int; bot := (L->>'bottom')::int;
  if p_n <= 0 then return; end if;
  foreach h in array hs loop
    w := round(h * 2.45); gx := round(h * .18); gy := round(h * .14);
    cols := greatest(1, floor((rgt - lft + gx)::numeric / (w + gx))::int);
    x0 := lft + ((rgt - lft) - (cols * w + (cols - 1) * gx)) / 2.0;
    cnt := 0; y := top;
    while y + h <= bot loop
      for c in 0..cols - 1 loop
        x := x0 + c * (w + gx); hit := false;
        for av in select * from jsonb_array_elements(L->'avoid') loop
          if x < (av->>2)::numeric and x + w > (av->>0)::numeric and y < (av->>3)::numeric and y + h > (av->>1)::numeric then hit := true; exit; end if;
        end loop;
        if not hit then cnt := cnt + 1; end if;
      end loop;
      y := y + h + gy;
    end loop;
    if cnt >= p_n or h = 40 then
      -- second pass: emit the first p_n cells
      cnt := 0; y := top;
      while y + h <= bot and cnt < p_n loop
        for c in 0..cols - 1 loop
          exit when cnt >= p_n;
          x := x0 + c * (w + gx); hit := false;
          for av in select * from jsonb_array_elements(L->'avoid') loop
            if x < (av->>2)::numeric and x + w > (av->>0)::numeric and y < (av->>3)::numeric and y + h > (av->>1)::numeric then hit := true; exit; end if;
          end loop;
          if not hit then cnt := cnt + 1; cx := x; cy := y; cw := w; ch := h; cell_h := h; return next; end if;
        end loop;
        y := y + h + gy;
      end loop;
      return;
    end if;
  end loop;
end $$;

-- ---------- Scout places emojis: away from signatures, the neon sign / QR / title, and other emojis ----------
-- x, y = emoji center as a fraction of the wing (1000 x 980); size = emoji font size as a fraction of wing width.
create or replace function public.wall_emoji_layout(p_only_id bigint default null)
returns int language plpgsql security definer set search_path = public as $$
declare L jsonb; W numeric; H numeric; lft numeric; rgt numeric; bot numeric; n int; cells real[][] := '{}'; av real[][] := '{}';
        placed real[][] := '{}'; e record; cand_x numeric; cand_y numeric; r numeric; best numeric; best_x numeric; best_y numeric; score numeric;
        cost numeric; dmin numeric; ox numeric; oy numeric; i int; j int; gx int; gy int; step int := 46; seed bigint; moved int := 0; hbucket int;
        a0 numeric; a1 numeric; b0 numeric; b1 numeric;
begin
  select layout into L from wall_sign_config where id = 1;
  W := (L->>'w')::numeric; H := (L->>'h')::numeric; lft := 18; rgt := W - 18; bot := H - 18;
  select least(60, count(*))::int into n from wall_signatures where not hidden;
  select coalesce(array_agg(array[cx, cy, cx + cw, cy + ch]), '{}'), max(cell_h) into cells, hbucket from wall_sig_cells(n);
  select coalesce(array_agg(array[(v->>0)::real, (v->>1)::real, (v->>2)::real, (v->>3)::real]), '{}') into av
    from jsonb_array_elements(L->'avoid') v;
  if p_only_id is not null then
    select coalesce(array_agg(array[x * W, y * H, size * W / 2]), '{}') into placed from wall_emojis where id <> p_only_id;
  end if;
  for e in select * from wall_emojis where p_only_id is null or id = p_only_id order by id loop
    seed := abs(hashtext(e.emoji_key || e.id::text));
    r := e.size * W / 2 + 6;
    best := -1e12; best_x := W / 2; best_y := H / 2;
    for gx in 0..floor((rgt - lft) / step)::int loop
      for gy in 0..floor((bot - 18) / step)::int loop
        cand_x := lft + r + gx * step + ((seed + gx * 7919 + gy * 104729) % 17) - 8;
        cand_y := 18 + r + gy * step + ((seed / 7 + gx * 104729 + gy * 7919) % 17) - 8;
        continue when cand_x + r > rgt or cand_y + r > bot;
        cost := 0;
        for i in 1..coalesce(array_length(av, 1), 0) loop
          a0 := greatest(cand_x - r, av[i][1]); a1 := least(cand_x + r, av[i][3]);
          b0 := greatest(cand_y - r, av[i][2]); b1 := least(cand_y + r, av[i][4]);
          if a1 > a0 and b1 > b0 then cost := cost + 20 * (a1 - a0) * (b1 - b0) / (4 * r * r); end if;
        end loop;
        for i in 1..coalesce(array_length(cells, 1), 0) loop
          a0 := greatest(cand_x - r, cells[i][1]); a1 := least(cand_x + r, cells[i][3]);
          b0 := greatest(cand_y - r, cells[i][2]); b1 := least(cand_y + r, cells[i][4]);
          if a1 > a0 and b1 > b0 then cost := cost + 3 * (a1 - a0) * (b1 - b0) / (4 * r * r); end if;
        end loop;
        dmin := 320;
        for j in 1..coalesce(array_length(placed, 1), 0) loop
          ox := cand_x - placed[j][1]; oy := cand_y - placed[j][2];
          dmin := least(dmin, sqrt(ox * ox + oy * oy) - placed[j][3] - r);
        end loop;
        score := dmin - cost * 1000 + ((seed + gx * 31 + gy * 17) % 9);
        if dmin < 0 then score := score + dmin * 20; end if;
        if score > best then best := score; best_x := cand_x; best_y := cand_y; end if;
      end loop;
    end loop;
    update wall_emojis set x = greatest(0, least(1, best_x / W)), y = greatest(0, least(1, best_y / H)), placed_by = 'scout' where id = e.id;
    placed := placed || array[array[best_x, best_y, e.size * W / 2]::real[]];
    moved := moved + 1;
  end loop;
  if p_only_id is null then update wall_sign_config set emoji_layout_h = hbucket where id = 1; end if;
  return moved;
end $$;

create or replace function public.wall_emoji_json(e public.wall_emojis)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('id', e.id, 'emoji', e.emoji, 'x', round(e.x::numeric, 4), 'y', round(e.y::numeric, 4),
                            'size', round(e.size::numeric, 4), 'at', e.created_at, 'by', e.placed_by)
$$;

-- ---------- guest session RPCs ----------
create or replace function public.wall_sign_open(p_code text, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg wall_sign_config; v_code text := lower(btrim(coalesce(p_code, ''))); t wall_sign_tags; tok text; v_tag text; v_exp timestamptz;
        v_dev text := left(coalesce(p_device, ''), 64);
begin
  select * into cfg from wall_sign_config where id = 1;
  if (select count(*) from wall_sign_sessions where created_at > now() - interval '1 minute') >= 40 then
    raise exception 'slow down a sec';
  end if;
  if v_code <> '' then
    if (select count(*) from wall_sign_misses where at > now() - interval '10 minutes' and reason = 'bad_code') >= 40 then
      return jsonb_build_object('ok', false, 'reason', 'tap');     -- brute-force brake
    end if;
    select * into t from wall_sign_tags where code = v_code and active;
    if t.code is null then
      insert into wall_sign_misses (code, device, reason) values (left(v_code, 16), nullif(v_dev, ''), 'bad_code');
      return jsonb_build_object('ok', false, 'reason', 'tap');
    end if;
    update wall_sign_tags set taps = taps + 1, last_tap_at = now() where code = t.code;
    v_tag := t.code;
  elsif now() < cfg.legacy_until then
    v_tag := 'legacy';
  else
    insert into wall_sign_misses (code, device, reason) values (null, nullif(v_dev, ''), 'legacy_off');
    return jsonb_build_object('ok', false, 'reason', 'tap');
  end if;
  tok := replace(gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(mins => cfg.session_minutes);
  insert into wall_sign_sessions (token, tag, device, expires_at) values (tok, v_tag, nullif(v_dev, ''), v_exp);
  return jsonb_build_object('ok', true, 'token', tok, 'expires_at', v_exp, 'legacy', v_tag = 'legacy',
                            'legacy_until', case when v_tag = 'legacy' then cfg.legacy_until end);
end $$;

create or replace function public.wall_sign_check(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s wall_sign_sessions; cfg wall_sign_config;
begin
  select * into s from wall_sign_sessions where token = p_token;
  if s.token is null or s.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select * into cfg from wall_sign_config where id = 1;
  return jsonb_build_object('ok', true, 'expires_at', s.expires_at, 'legacy', s.tag = 'legacy',
    'legacy_until', case when s.tag = 'legacy' then cfg.legacy_until end,
    'signed', coalesce(array_length(s.signature_ids, 1), 0),
    'emoji', (select emoji from wall_emojis where id = s.emoji_id));
end $$;

create or replace function public.wall_sign_tap(p_token text, p_name text, p_strokes jsonb, p_color text, p_aspect real, p_device text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s wall_sign_sessions; res jsonb;
begin
  select * into s from wall_sign_sessions where token = p_token for update;
  if s.token is null or s.expires_at < now() then raise exception 'tap a coaster again'; end if;
  if coalesce(array_length(s.signature_ids, 1), 0) >= 3 then raise exception 'that''s plenty for one tap'; end if;
  res := wall_sign(p_name, p_strokes, p_color, p_aspect, p_device);
  update wall_sign_sessions set signature_ids = signature_ids || (res->>'id')::bigint where token = p_token;
  return res || jsonb_build_object('badge_no', (res->>'id')::bigint);
end $$;

-- the bare signing RPC is now only reachable through a coaster session
revoke execute on function public.wall_sign(text, jsonb, text, real, text) from public, anon, authenticated;

create or replace function public.wall_emoji_taken(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from wall_sign_sessions where token = p_token and expires_at > now()) then
    raise exception 'tap a coaster again';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('emoji', emoji, 'key', emoji_key) order by id) from wall_emojis), '[]'::jsonb);
end $$;

create or replace function public.wall_emoji_claim(p_token text, p_emoji text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s wall_sign_sessions; k text; e wall_emojis; v text := btrim(coalesce(p_emoji, '')); sz real;
begin
  select * into s from wall_sign_sessions where token = p_token for update;
  if s.token is null or s.expires_at < now() then raise exception 'tap a coaster again'; end if;
  if coalesce(array_length(s.signature_ids, 1), 0) = 0 then return jsonb_build_object('ok', false, 'reason', 'sign_first'); end if;
  if s.emoji_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already', 'emoji', (select wall_emoji_json(x) from wall_emojis x where id = s.emoji_id));
  end if;
  k := wall_emoji_key(v);
  if k is null then return jsonb_build_object('ok', false, 'reason', 'not_emoji'); end if;
  if exists (select 1 from wall_emojis where emoji_key = k or emoji = v) then
    return jsonb_build_object('ok', false, 'reason', 'taken',
      'taken', coalesce((select jsonb_agg(emoji order by id) from wall_emojis), '[]'::jsonb));
  end if;
  if (select count(*) from wall_emojis where created_at > now() - interval '1 minute') >= 20 then raise exception 'slow down a sec'; end if;
  sz := 0.04 + (abs(hashtext(k)) % 21) / 1000.0;
  insert into wall_emojis (emoji, emoji_key, x, y, size, signature_id)
  values (v, k, 0.5, 0.5, sz, s.signature_ids[array_length(s.signature_ids, 1)])
  on conflict do nothing returning * into e;
  if e.id is null then
    return jsonb_build_object('ok', false, 'reason', 'taken',
      'taken', coalesce((select jsonb_agg(emoji order by id) from wall_emojis), '[]'::jsonb));
  end if;
  perform wall_emoji_layout(e.id);
  select * into e from wall_emojis where id = e.id;
  update wall_sign_sessions set emoji_id = e.id where token = p_token;
  perform wall_sig_broadcast('emoji', jsonb_build_object('emoji', wall_emoji_json(e)));
  return jsonb_build_object('ok', true, 'emoji', wall_emoji_json(e),
    'ping', (select 'wallsign-' || left(md5('wall-' || channel || ':sign'), 20) from wall_state where id = 1));
end $$;

-- ---------- Pi + admin ----------
create or replace function public.wall_pi_emojis(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return jsonb_build_object('at', now(),
    'emojis', coalesce((select jsonb_agg(wall_emoji_json(e) order by e.id) from wall_emojis e), '[]'::jsonb));
end $$;

create or replace function public.wall_admin_emojis()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'emojis', coalesce((select jsonb_agg(wall_emoji_json(e) order by e.id desc) from wall_emojis e), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'label', label, 'active', active, 'taps', taps,
                        'last_tap_at', last_tap_at, 'url', 'bestly.tech/sign/' || code) order by label) from wall_sign_tags), '[]'::jsonb),
    'legacy_until', (select legacy_until from wall_sign_config where id = 1));
end $$;

create or replace function public.wall_admin_emoji_action(p_action text, p_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_action = 'delete' then delete from wall_emojis where id = p_id;
  elsif p_action = 'clear' then delete from wall_emojis where true;
  elsif p_action = 'relayout' then n := wall_emoji_layout(null);
  else raise exception 'unknown action'; end if;
  perform wall_sig_broadcast('emojis_changed', jsonb_build_object('at', now()));
  return jsonb_build_object('ok', true, 'moved', n);
end $$;

-- ---------- badge email gate (service role only; called by the wall-badge-email edge function) ----------
create or replace function public.wall_badge_email_gate(p_token text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s wall_sign_sessions;
begin
  select * into s from wall_sign_sessions where token = p_token for update;
  if s.token is null or s.expires_at < now() - interval '40 minutes' then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if coalesce(array_length(s.signature_ids, 1), 0) = 0 then return jsonb_build_object('ok', false, 'reason', 'sign_first'); end if;
  if s.emails >= 2 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  if p_email !~* '^[^@\s<>]{1,64}@[^@\s<>]{1,190}\.[a-z]{2,24}$' then return jsonb_build_object('ok', false, 'reason', 'bad_email'); end if;
  if (select count(*) from email_send_log where template_name = 'wall-badge' and created_at > now() - interval '1 hour') >= 40 then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  update wall_sign_sessions set emails = emails + 1 where token = p_token;
  return jsonb_build_object('ok', true, 'signature_id', s.signature_ids[array_length(s.signature_ids, 1)]);
end $$;

-- ---------- Scout watchdog ----------
create or replace function public.wall_sign_watchdog()
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg wall_sign_config; fails int; last_fail timestamptz; last_ok timestamptz; legacy_recent int; legacy_off int; tags int; n int; h int; moved int := 0;
begin
  select * into cfg from wall_sign_config where id = 1;

  -- 1. badge emails failing
  select count(*) filter (where status = 'failed'), max(created_at) filter (where status = 'failed'), max(created_at) filter (where status = 'sent')
    into fails, last_fail, last_ok
    from email_send_log where template_name = 'wall-badge' and created_at > now() - interval '3 hours';
  if fails > 0 and (last_ok is null or last_ok < last_fail) then
    perform bestly_raise('wall-badge-email', 'problem', 'warning', 'Wall badge emails are failing',
      fails || ' badge email(s) failed in the last 3 hours. Guests can still save the badge to their phone.', 'wall');
  else
    perform bestly_raise('wall-badge-email', 'resolved', 'info', 'Wall badge emails are working again', null, 'wall');
  end if;

  -- 2. coasters still on the old link near / after the switch-off
  select count(*) into legacy_recent from wall_sign_sessions where tag = 'legacy' and created_at > now() - interval '3 days';
  select count(*) into legacy_off from wall_sign_misses where reason = 'legacy_off' and at > now() - interval '1 day';
  if (now() > cfg.legacy_until - interval '2 days' and now() < cfg.legacy_until and legacy_recent > 0) or legacy_off > 0 then
    perform bestly_raise('wall-sign-legacy', 'problem', 'info', 'A coaster still has the old sign link',
      case when legacy_off > 0 then legacy_off || ' tap(s) on the old link in the last day got the "tap a coaster" screen.'
           else 'The old bestly.tech/sign link stops working ' || to_char(cfg.legacy_until at time zone 'America/Los_Angeles', 'Mon FMDD "at" FMHH12:MI AM') || '.' end,
      'wall', 'Rewrite each coaster with its own link in NFC Tools (list in admin, Sign the wall).');
  else
    perform bestly_raise('wall-sign-legacy', 'resolved', 'info', 'Coasters are on the new links', null, 'wall');
  end if;

  -- 3. no working coaster codes = nobody can sign
  select count(*) into tags from wall_sign_tags where active;
  if tags = 0 and now() > cfg.legacy_until then
    perform bestly_raise('wall-sign-tags', 'problem', 'warning', 'No coaster links are active', 'Nobody can sign the wall right now.', 'wall',
      'Turn a coaster link back on in admin.');
  else
    perform bestly_raise('wall-sign-tags', 'resolved', 'info', 'Coaster links are active', null, 'wall');
  end if;

  -- 4. self-heal: when the signature grid shrinks, Scout re-places every emoji so none sits on a signature
  select least(60, count(*))::int into n from wall_signatures where not hidden;
  select max(cell_h) into h from wall_sig_cells(n);
  if exists (select 1 from wall_emojis) and h is distinct from cfg.emoji_layout_h then
    moved := wall_emoji_layout(null);
    perform wall_sig_broadcast('emojis_changed', jsonb_build_object('at', now()));
  elsif h is distinct from cfg.emoji_layout_h then
    update wall_sign_config set emoji_layout_h = h where id = 1;
  end if;

  -- 5. tidy
  delete from wall_sign_sessions where expires_at < now() - interval '3 days';
  delete from wall_sign_misses where at < now() - interval '7 days';
  return jsonb_build_object('ok', true, 'badge_fails', fails, 'legacy_recent', legacy_recent, 'legacy_off', legacy_off, 'tags', tags, 'relayout', moved);
end $$;

-- ---------- grants ----------
revoke all on function public.wall_emoji_layout(bigint) from public, anon, authenticated;
revoke all on function public.wall_badge_email_gate(text, text) from public, anon, authenticated;
revoke all on function public.wall_sign_watchdog() from public, anon, authenticated;
revoke all on function public.wall_sig_cells(int) from public, anon, authenticated;
grant execute on function public.wall_sign_open(text, text) to anon, authenticated;
grant execute on function public.wall_sign_check(text) to anon, authenticated;
grant execute on function public.wall_sign_tap(text, text, jsonb, text, real, text) to anon, authenticated;
grant execute on function public.wall_emoji_taken(text) to anon, authenticated;
grant execute on function public.wall_emoji_claim(text, text) to anon, authenticated;
grant execute on function public.wall_pi_emojis(text) to anon, authenticated;
grant execute on function public.wall_admin_emojis() to authenticated;
grant execute on function public.wall_admin_emoji_action(text, bigint) to authenticated;
grant execute on function public.wall_badge_email_gate(text, text) to service_role;

-- ---------- coaster codes: 6 coasters + 1 spare, random 4-char codes (no look-alike characters) ----------
do $$
declare i int; c text; lbl text;
begin
  if exists (select 1 from public.wall_sign_tags) then return; end if;
  for i in 1..7 loop
    lbl := case when i <= 6 then 'Coaster ' || i else 'Spare' end;
    loop
      select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '') into c from generate_series(1, 4);
      exit when not exists (select 1 from public.wall_sign_tags where code = c);
    end loop;
    insert into public.wall_sign_tags (code, label) values (c, lbl);
  end loop;
end $$;

-- Scout checks every 10 minutes
select cron.unschedule(jobid) from cron.job where jobname = 'wall-sign-watchdog';
select cron.schedule('wall-sign-watchdog', '4-59/10 * * * *', 'select public.wall_sign_watchdog()');

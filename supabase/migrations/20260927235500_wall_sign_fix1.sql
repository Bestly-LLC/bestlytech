-- Sign the wall v3 fix 1: emoji_claim alias clash (column x), Scout keeps emojis off the wing edges.
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
        dmin := 400;
        for j in 1..coalesce(array_length(placed, 1), 0) loop
          ox := cand_x - placed[j][1]; oy := cand_y - placed[j][2];
          dmin := least(dmin, sqrt(ox * ox + oy * oy) - placed[j][3] - r);
        end loop;
        score := dmin - cost * 1000 + ((seed + gx * 31 + gy * 17) % 9)
                 - 3 * greatest(0, 80 - least(cand_x - r, W - cand_x - r, cand_y - r, H - cand_y - r));   -- keep off the wing edges
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

create or replace function public.wall_emoji_claim(p_token text, p_emoji text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s wall_sign_sessions; k text; e wall_emojis; v text := btrim(coalesce(p_emoji, '')); sz real;
begin
  select * into s from wall_sign_sessions where token = p_token for update;
  if s.token is null or s.expires_at < now() then raise exception 'tap a coaster again'; end if;
  if coalesce(array_length(s.signature_ids, 1), 0) = 0 then return jsonb_build_object('ok', false, 'reason', 'sign_first'); end if;
  if s.emoji_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already', 'emoji', (select wall_emoji_json(we) from wall_emojis we where we.id = s.emoji_id));
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

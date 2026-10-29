-- Recipes tab (Home Hub > Kitchen > Recipes), owned by Basil. Jared approved the preview Oct 28 2026 ("ship it").
-- Extends pantry_recipes (no parallel table) and follows the Kitchen page's access pattern: RLS on, no table
-- policies for writes, every read/write goes through admin-guarded SECURITY DEFINER RPCs (has_role(auth.uid(),'admin')).
-- Only the three tables the page listens to over Realtime get an admin SELECT policy.
--
--   pantry_recipes  + slug, doc (structured recipe, jsonb), category, photo_path, source_url, favorite, updated_at
--   recipe_notes / recipe_cooks            notes and the cook log
--   recipe_ferments                        tepache-style ferment tracker (reminders: basil_ferment_reminders)
--   recipe_handoff                         "Send to iPad" (iPhone writes, iPad listens)
--   recipe_commands + recipe_cook_session  "Hey Scout, next" while cook mode is open
--   recipe_timers                          cook-mode timers, mirrored so a closed tab still gets announced
--   recipe_settings                        Home Assistant toggles (persisted, not UI-only)
--   recipe_parse_jobs                      snap-to-save reads (free AI only, edge function recipe-parse)
--   pantry_groceries                       "Add missing to groceries"

alter table public.pantry_recipes
  add column if not exists slug text,
  add column if not exists doc jsonb,
  add column if not exists category text,
  add column if not exists photo_path text,
  add column if not exists source_url text,
  add column if not exists favorite boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();
create unique index if not exists pantry_recipes_slug_uidx on public.pantry_recipes (slug) where slug is not null;

-- (A one-row probe table, zz_recipes_probe, was created while checking what the migration tool allows. It has the exact
-- shape recipe_notes needs, so it is renamed into place instead of being left behind. A fresh database skips this.)
do $$ begin
  if to_regclass('public.zz_recipes_probe') is not null and to_regclass('public.recipe_notes') is null then
    alter table public.zz_recipes_probe rename to recipe_notes;
    alter table public.recipe_notes rename column id to recipe_id;
  end if;
end $$;
create table if not exists public.recipe_notes (
  recipe_id int primary key references public.pantry_recipes (id) on delete cascade,
  body text not null default '' check (length(body) <= 8000),
  updated_at timestamptz not null default now()
);

alter table public.recipe_notes
  add column if not exists body text not null default '',
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.recipe_cooks (
  id bigint generated always as identity primary key,
  recipe_id int not null references public.pantry_recipes (id) on delete cascade,
  cooked_at timestamptz not null default now(),
  factor numeric,
  summary text check (length(summary) <= 200),
  note text check (length(note) <= 1000),
  omni boolean not null default false,
  via text not null default 'ui'
);
create index if not exists recipe_cooks_recipe_idx on public.recipe_cooks (recipe_id, cooked_at desc);

create table if not exists public.recipe_ferments (
  id uuid primary key default gen_random_uuid(),
  recipe_id int not null references public.pantry_recipes (id) on delete cascade,
  started_at timestamptz not null default now(),
  state text not null default 'fermenting' check (state in ('fermenting', 'bottled', 'done')),
  tasted_on date,
  bottled_at timestamptz,
  burped_on date,
  last_taste_reminder date,
  last_burp_reminder date,
  drink_by_notified date,
  finished_at timestamptz
);
create index if not exists recipe_ferments_state_idx on public.recipe_ferments (state);

create table if not exists public.recipe_handoff (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'cook' check (kind in ('cook', 'link')),
  recipe_id int references public.pantry_recipes (id) on delete set null,
  title text check (length(title) <= 200),
  url text check (length(url) <= 2000),
  source text not null default 'iPhone' check (length(source) <= 30),
  status text not null default 'pending' check (status in ('pending', 'opened', 'dismissed', 'expired')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
create index if not exists recipe_handoff_pending_idx on public.recipe_handoff (status, created_at);

create table if not exists public.recipe_commands (
  id bigint generated always as identity primary key,
  action text not null check (action in ('next', 'back', 'repeat', 'start_timer', 'stop_timer')),
  said text,
  status text not null default 'new' check (status in ('new', 'done', 'expired')),
  created_at timestamptz not null default now()
);

create table if not exists public.recipe_cook_session (
  id int primary key default 1 check (id = 1),
  recipe_id int references public.pantry_recipes (id) on delete set null,
  step int,
  active_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.recipe_timers (
  id uuid primary key default gen_random_uuid(),
  recipe_id int references public.pantry_recipes (id) on delete set null,
  label text not null check (length(label) <= 120),
  total_sec int not null check (total_sec between 1 and 172800),
  ends_at timestamptz not null,
  status text not null default 'running' check (status in ('running', 'done', 'stopped')),
  fired_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recipe_timers_running_idx on public.recipe_timers (status, ends_at);

create table if not exists public.recipe_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.recipe_parse_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('photo', 'link')),
  source text not null check (length(source) <= 2000),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  result jsonb,
  error text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recipe_parse_jobs_status_idx on public.recipe_parse_jobs (status, updated_at);

create table if not exists public.pantry_groceries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  recipe_id int references public.pantry_recipes (id) on delete set null,
  recipe_title text,
  status text not null default 'open' check (status in ('open', 'done')),
  added_at timestamptz not null default now(),
  done_at timestamptz
);
create unique index if not exists pantry_groceries_open_uidx on public.pantry_groceries (lower(name)) where status = 'open';

alter table public.recipe_notes enable row level security;
alter table public.recipe_cooks enable row level security;
alter table public.recipe_ferments enable row level security;
alter table public.recipe_handoff enable row level security;
alter table public.recipe_commands enable row level security;
alter table public.recipe_cook_session enable row level security;
alter table public.recipe_timers enable row level security;
alter table public.recipe_settings enable row level security;
alter table public.recipe_parse_jobs enable row level security;
alter table public.pantry_groceries enable row level security;

-- Realtime needs a SELECT policy to deliver rows. Writes still go through the RPCs below.
do $$ begin
  begin create policy recipe_handoff_admin_read on public.recipe_handoff for select to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end;
  begin create policy recipe_commands_admin_read on public.recipe_commands for select to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end;
  begin create policy recipe_parse_jobs_admin_read on public.recipe_parse_jobs for select to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end;
end $$;

do $$ begin
  begin alter publication supabase_realtime add table public.recipe_handoff; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.recipe_commands; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.recipe_parse_jobs; exception when duplicate_object then null; end;
end $$;

insert into public.recipe_settings (key, value)
values ('ha', '{"speaker": true, "timer_push": true, "kitchen_auto": true, "voice": true}'::jsonb)
on conflict (key) do nothing;
insert into public.recipe_cook_session (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------------------------------------------
-- Pantry match. pantry_find_existing() is the receipt de-duper: it is deliberately loose ("vanilla" matches
-- "Orgain protein powder (vanilla)"), which is wrong for a recipe. This uses the same normalizer (pantry_tokens)
-- but needs every ingredient word in the item name and at most one extra word, and tries "X or Y" in order.
-- ------------------------------------------------------------------------------------------------
create or replace function public.recipe_name_alts(p_name text)
returns text[] language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_agg(a) filter (where length(a) > 1), '{}'::text[])
  from (
    select btrim(regexp_replace(regexp_replace(regexp_replace(
             regexp_replace(alt, 'garlic cloves?', 'garlic', 'g'),
             '\m(fresh|finely|grated|softened|packed|large|small|medium|ripe|full-fat|high-protein|neutral|instant|active|dry|fine|sea|whole|minced|peeled|zested|filtered|non-chlorinated|dark|light|good|quality|optional)\M', ' ', 'g'),
             '[^a-z0-9 -]+', ' ', 'g'), '\s+', ' ', 'g')) a
    from unnest(string_to_array(
      regexp_replace(split_part(regexp_replace(lower(coalesce(p_name, '')), '\([^)]*\)', ' ', 'g'), ',', 1), '\s+or\s+', '|', 'g'), '|')) alt
  ) s
$$;

create or replace function public.recipe_match_item(p_name text)
returns uuid language plpgsql stable set search_path = public, pg_temp as $$
declare alt text; a text[]; r uuid;
begin
  foreach alt in array public.recipe_name_alts(p_name) loop
    a := public.pantry_tokens(alt);
    if cardinality(a) = 0 then continue; end if;
    select i.id into r
      from public.pantry_items i
      cross join lateral (select public.pantry_tokens(i.name) b) t
     where cardinality(t.b) > 0 and a <@ t.b and cardinality(t.b) <= cardinality(a) + 1
     order by (i.status in ('have', 'low', 'arriving')) desc, cardinality(t.b), i.use_soon desc, i.added_at
     limit 1;
    if r is not null then return r; end if;
  end loop;
  return null;
end $$;

create or replace function public.recipe_pantry_map(p_doc jsonb)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(i ->> 'id',
           case when m.id is null then 'null'::jsonb
                else jsonb_build_object('item_id', m.id, 'item', m.name, 'status', m.status, 'qty', m.qty, 'unit', m.unit) end), '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_doc -> 'ingredients', '[]'::jsonb)) i
  left join lateral (select p.* from public.pantry_items p where p.id = public.recipe_match_item(i ->> 'name')) m on true
$$;

create or replace function public.recipe_slug(p_text text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select left(coalesce(nullif(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'recipe'), 60)
$$;

-- ------------------------------------------------------------------------------------------------
-- Settings
-- ------------------------------------------------------------------------------------------------
create or replace function public.recipes_settings_get()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return coalesce((select value from public.recipe_settings where key = 'ha'),
                  '{"speaker": true, "timer_push": true, "kitchen_auto": true, "voice": true}'::jsonb);
end $$;

create or replace function public.recipes_settings_set(p_key text, p_value boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_key not in ('speaker', 'timer_push', 'kitchen_auto', 'voice') then raise exception 'unknown setting'; end if;
  insert into public.recipe_settings (key, value) values ('ha', jsonb_build_object(p_key, p_value))
  on conflict (key) do update set value = public.recipe_settings.value || jsonb_build_object(p_key, p_value), updated_at = now();
  return (select value from public.recipe_settings where key = 'ha');
end $$;

-- ------------------------------------------------------------------------------------------------
-- The Recipes tab in one call
-- ------------------------------------------------------------------------------------------------
create or replace function public.recipes_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'recipes', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'slug', r.slug, 'name', r.name, 'doc', r.doc, 'photo_path', r.photo_path, 'source', r.source,
          'source_url', r.source_url, 'created_at', r.created_at, 'favorite', r.favorite,
          'pantry', public.recipe_pantry_map(r.doc), 'notes', coalesce(n.body, ''),
          'cooks', coalesce((select jsonb_agg(to_jsonb(c) order by c.cooked_at desc)
                               from (select id, cooked_at, factor, summary, note, omni from public.recipe_cooks
                                      where recipe_id = r.id order by cooked_at desc limit 8) c), '[]'::jsonb))
        order by r.created_at, r.id)
        from public.pantry_recipes r left join public.recipe_notes n on n.recipe_id = r.id
       where r.doc is not null), '[]'::jsonb),
    'legacy', coalesce((
      select jsonb_agg(jsonb_build_object('name', r.name, 'how', r.how, 'minutes', r.minutes, 'serves', r.serves,
                                          'source', r.source, 'omni', r.omni_steps is not null) order by r.created_at desc)
        from public.pantry_recipes r where r.doc is null and r.active), '[]'::jsonb),
    'ferments', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.started_at desc)
        from public.recipe_ferments f where f.state <> 'done' or f.finished_at > now() - interval '2 days'), '[]'::jsonb),
    'groceries', coalesce((select jsonb_agg(to_jsonb(g) order by g.added_at) from public.pantry_groceries g where g.status = 'open'), '[]'::jsonb),
    'settings', public.recipes_settings_get(),
    'now', now());
end $$;

-- ------------------------------------------------------------------------------------------------
-- Save / edit
-- ------------------------------------------------------------------------------------------------
create or replace function public.recipe_save(p_doc jsonb, p_source text default 'saved', p_source_url text default null, p_photo_path text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_title text; v_slug text; v_base text; v_name text; v_n int := 1; v_id int; v_how text;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if jsonb_typeof(p_doc) <> 'object' or jsonb_typeof(p_doc -> 'ingredients') <> 'array' or jsonb_typeof(p_doc -> 'steps') <> 'array' then
    raise exception 'that does not look like a recipe';
  end if;
  v_title := btrim(coalesce(p_doc ->> 'title', ''));
  if v_title = '' then raise exception 'the recipe needs a title'; end if;
  if jsonb_array_length(p_doc -> 'steps') = 0 or jsonb_array_length(p_doc -> 'ingredients') = 0 then raise exception 'the recipe needs ingredients and steps'; end if;
  v_base := public.recipe_slug(coalesce(nullif(p_doc ->> 'id', ''), v_title));
  v_slug := v_base; v_name := v_title;
  while exists (select 1 from public.pantry_recipes where slug = v_slug or name = v_name) loop
    v_n := v_n + 1; v_slug := v_base || '-' || v_n; v_name := v_title || ' (' || v_n || ')';
  end loop;
  v_how := left(coalesce(nullif(p_doc ->> 'blurb', ''), p_doc -> 'steps' -> 0 ->> 'text', v_title), 300);
  insert into public.pantry_recipes (name, needs, how, active, serves, minutes, source, slug, doc, category, photo_path, source_url)
  values (v_name, '{}', v_how, false,
          nullif(p_doc #>> '{yield,amount}', '')::numeric::int, nullif(p_doc #>> '{time,total_min}', '')::int,
          left(coalesce(nullif(p_source, ''), 'saved'), 40), v_slug, jsonb_set(p_doc, '{id}', to_jsonb(v_slug)),
          nullif(p_doc ->> 'category', ''), nullif(p_photo_path, ''), nullif(p_source_url, ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'name', v_name);
end $$;

create or replace function public.recipe_photo_set(p_id int, p_path text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_path is not null and p_path !~ '^recipes/[A-Za-z0-9._/-]{1,200}$' then raise exception 'bad photo path'; end if;
  update public.pantry_recipes set photo_path = p_path, updated_at = now() where id = p_id and doc is not null;
  if not found then raise exception 'recipe not found'; end if;
end $$;

create or replace function public.recipe_notes_set(p_id int, p_body text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  insert into public.recipe_notes (recipe_id, body) values (p_id, left(coalesce(p_body, ''), 8000))
  on conflict (recipe_id) do update set body = excluded.body, updated_at = now();
end $$;

create or replace function public.recipe_cook_log(p_id int, p_factor numeric, p_summary text, p_note text, p_omni boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.recipe_cooks;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  insert into public.recipe_cooks (recipe_id, factor, summary, note, omni)
  values (p_id, p_factor, left(nullif(btrim(p_summary), ''), 200), left(nullif(btrim(p_note), ''), 1000), coalesce(p_omni, false))
  returning * into r;
  return jsonb_build_object('id', r.id, 'cooked_at', r.cooked_at, 'factor', r.factor, 'summary', r.summary, 'note', r.note, 'omni', r.omni);
end $$;

-- ------------------------------------------------------------------------------------------------
-- Groceries
-- ------------------------------------------------------------------------------------------------
create or replace function public.recipe_groceries_add(p_recipe_id int, p_names text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n text; v_added int := 0; v_title text;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select name into v_title from public.pantry_recipes where id = p_recipe_id;
  foreach n in array coalesce(p_names, '{}') loop
    n := left(btrim(n), 120);
    if n = '' then continue; end if;
    insert into public.pantry_groceries (name, recipe_id, recipe_title) values (n, p_recipe_id, v_title)
    on conflict (lower(name)) where status = 'open' do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;
  return jsonb_build_object('added', v_added, 'open', (select count(*) from public.pantry_groceries where status = 'open'));
end $$;

create or replace function public.pantry_groceries_set(p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update public.pantry_groceries set status = case when p_done then 'done' else 'open' end,
         done_at = case when p_done then now() end where id = p_id;
end $$;

-- ------------------------------------------------------------------------------------------------
-- Ferments (reminders come from basil_ferment_reminders(), called by basil_tick)
-- ------------------------------------------------------------------------------------------------
create or replace function public.recipe_ferment_start(p_recipe_id int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if not exists (select 1 from public.pantry_recipes where id = p_recipe_id and doc -> 'ferment' is not null) then raise exception 'this recipe has no ferment plan'; end if;
  select id into v_id from public.recipe_ferments where recipe_id = p_recipe_id and state = 'fermenting' and started_at > now() - interval '30 minutes' limit 1;
  if v_id is null then
    insert into public.recipe_ferments (recipe_id) values (p_recipe_id) returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.recipe_ferment_step(p_id uuid, p_step text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_step = 'taste' then
    update public.recipe_ferments set tasted_on = case when tasted_on = v_today then null else v_today end where id = p_id and state = 'fermenting';
  elsif p_step = 'bottle' then
    update public.recipe_ferments set state = 'bottled', bottled_at = now(), burped_on = null, last_burp_reminder = null where id = p_id and state = 'fermenting';
  elsif p_step = 'burp' then
    update public.recipe_ferments set burped_on = case when burped_on = v_today then null else v_today end where id = p_id and state = 'bottled';
  elsif p_step = 'finish' then
    update public.recipe_ferments set state = 'done', finished_at = now() where id = p_id and state <> 'done';
  else raise exception 'unknown ferment step';
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------
-- Handoff: iPhone "Send to iPad"
-- ------------------------------------------------------------------------------------------------
create or replace function public.recipe_handoff_send(p_kind text, p_recipe_id int, p_url text, p_source text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_title text;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_kind not in ('cook', 'link') then raise exception 'bad handoff kind'; end if;
  if p_kind = 'cook' then
    select name into v_title from public.pantry_recipes where id = p_recipe_id and doc is not null;
    if v_title is null then raise exception 'recipe not found'; end if;
  elsif p_url is null or p_url !~* '^https?://\S+$' then raise exception 'that does not look like a link';
  end if;
  update public.recipe_handoff set status = 'expired', handled_at = now() where status = 'pending';
  insert into public.recipe_handoff (kind, recipe_id, title, url, source)
  values (p_kind, case when p_kind = 'cook' then p_recipe_id end, v_title, case when p_kind = 'link' then left(p_url, 2000) end, left(coalesce(nullif(p_source, ''), 'iPhone'), 30))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.recipe_handoff_resolve(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_status not in ('opened', 'dismissed') then raise exception 'bad status'; end if;
  update public.recipe_handoff set status = p_status, handled_at = now() where id = p_id and status = 'pending';
end $$;

-- ------------------------------------------------------------------------------------------------
-- Voice: cook mode pings while it is open; basil_voice only listens for next/back while that is true.
-- ------------------------------------------------------------------------------------------------
create or replace function public.recipe_cook_ping(p_recipe_id int, p_step int, p_active boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  insert into public.recipe_cook_session (id, recipe_id, step, active_until)
  values (1, p_recipe_id, p_step, case when p_active then now() + interval '90 seconds' else now() end)
  on conflict (id) do update set recipe_id = excluded.recipe_id, step = excluded.step, active_until = excluded.active_until, updated_at = now();
end $$;

create or replace function public.recipe_command_done(p_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update public.recipe_commands set status = 'done' where id = p_id and status = 'new';
end $$;

-- ------------------------------------------------------------------------------------------------
-- Timers: the page runs them, the database remembers them. When one ends (the page calls recipe_timer_done at 0:00,
-- or the minute job finds it late because the tab went to sleep) Basil announces it once.
-- ------------------------------------------------------------------------------------------------
create or replace function public.recipe_timer_fire(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.recipe_timers; s jsonb; v_title text;
begin
  update public.recipe_timers set status = 'done', fired_at = now() where id = p_id and status = 'running' returning * into t;
  if t.id is null then return false; end if;
  s := coalesce((select value from public.recipe_settings where key = 'ha'), '{}'::jsonb);
  select name into v_title from public.pantry_recipes where id = t.recipe_id;
  if coalesce((s ->> 'speaker')::boolean, true) then
    insert into public.home_hub_commands (target, action, payload, requested_by)
    values ('homeassistant', 'announce',
            jsonb_build_object('message', left('Your ' || t.label || ' timer is done.', 400), 'title', 'Basil', 'speak', true, 'critical_push', false),
            'basil-recipes');
  end if;
  if coalesce((s ->> 'timer_push')::boolean, true) then
    perform set_config('bestly.from', 'basil', true);
    perform public.bestly_ntfy('Timer done', t.label || coalesce(' (' || v_title || ')', '') || ' is ready.', 3, array['basil']);
    perform set_config('bestly.from', '', true);
  end if;
  return true;
end $$;

create or replace function public.recipe_timer_start(p_recipe_id int, p_label text, p_sec int)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  insert into public.recipe_timers (recipe_id, label, total_sec, ends_at)
  values (p_recipe_id, left(coalesce(nullif(btrim(p_label), ''), 'Kitchen'), 120), greatest(1, least(p_sec, 172800)), now() + make_interval(secs => greatest(1, least(p_sec, 172800))))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.recipe_timer_adjust(p_id uuid, p_add_sec int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update public.recipe_timers
     set ends_at = greatest(now() + interval '1 second', ends_at + make_interval(secs => p_add_sec)),
         total_sec = least(172800, greatest(1, total_sec + p_add_sec)), status = 'running', fired_at = null
   where id = p_id;
end $$;

create or replace function public.recipe_timer_stop(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update public.recipe_timers set status = 'stopped' where id = p_id and status = 'running';
end $$;

create or replace function public.recipe_timer_done(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return public.recipe_timer_fire(p_id);
end $$;

create or replace function public.recipe_timers_due()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select id from public.recipe_timers where status = 'running' and ends_at < now() - interval '15 seconds' loop
    if public.recipe_timer_fire(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------------------------------------
-- Snap to save: a job per photo or link. The edge function recipe-parse (free AI only) fills in result.
-- ------------------------------------------------------------------------------------------------
create or replace function public.recipe_parse_enqueue(p_kind text, p_source text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_kind = 'photo' and p_source !~ '^recipes/parse/[A-Za-z0-9._-]{1,120}$' then raise exception 'bad photo path'; end if;
  if p_kind = 'link' and p_source !~* '^https://\S+$' then raise exception 'Paste a full https link.'; end if;
  insert into public.recipe_parse_jobs (kind, source) values (p_kind, p_source) returning id into v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------------------------------------------
-- Grants: the admin page calls these as an authenticated user; the guards inside check has_role.
-- Internal helpers stay service-role only.
-- ------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'recipes_settings_get()', 'recipes_settings_set(text,boolean)', 'recipes_overview()', 'recipe_save(jsonb,text,text,text)',
    'recipe_photo_set(int,text)', 'recipe_notes_set(int,text)', 'recipe_cook_log(int,numeric,text,text,boolean)',
    'recipe_groceries_add(int,text[])', 'pantry_groceries_set(uuid,boolean)', 'recipe_ferment_start(int)', 'recipe_ferment_step(uuid,text)',
    'recipe_handoff_send(text,int,text,text)', 'recipe_handoff_resolve(uuid,text)', 'recipe_cook_ping(int,int,boolean)', 'recipe_command_done(bigint)',
    'recipe_timer_start(int,text,int)', 'recipe_timer_adjust(uuid,int)', 'recipe_timer_stop(uuid)', 'recipe_timer_done(uuid)', 'recipe_parse_enqueue(text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['recipe_timer_fire(uuid)', 'recipe_timers_due()', 'recipe_name_alts(text)', 'recipe_match_item(text)', 'recipe_pantry_map(jsonb)', 'recipe_slug(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
-- recipes_overview() calls recipe_pantry_map() as its owner (SECURITY DEFINER), so authenticated never needs it directly.

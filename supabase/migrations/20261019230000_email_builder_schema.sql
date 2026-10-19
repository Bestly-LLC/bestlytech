-- Email Builder (2026-10-19): brand kits, email library, versions, send log, run log.
-- Plan: Jared's Opus-planned AI email builder inside /admin (branch email-builder).
--
-- ROLLBACK (nothing else depends on these tables; drop in this order):
--   drop function if exists public.email_kit_for_client(text), public.email_kit_build(text);
--   drop table if exists public.email_builder_runs, public.email_send_log, public.email_library_versions,
--     public.email_library, public.email_brand_kits cascade;
--   delete from public.notification_owners where prefix = 'email-builder';
--   delete from public.privacy_data_map where table_name in ('email_library','email_send_log');
--
-- Brand kits are DATA, not code: theme, header, signature, footer, product-ad slots, default sender, picture
-- library. A client brand is one more row (see email_kit_for_client). The renderer is
-- supabase/functions/_shared/email-render.ts and reads these columns as-is.

create table if not exists public.email_brand_kits (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null,
  kind text not null default 'house' check (kind in ('house','client')),
  extends text references public.email_brand_kits(slug) on update cascade on delete set null,
  source_client_slug text,                        -- approval_clients.slug this kit was pulled from, if any
  theme jsonb not null default '{}'::jsonb,       -- colors, fonts, heading size, dark-mode colors
  header jsonb not null default '{}'::jsonb,      -- layout banner|logo|text|none, image, link, name
  signature jsonb not null default '{}'::jsonb,   -- who signs, photo, contact line
  footer jsonb not null default '{}'::jsonb,      -- rainbow hairline + lines
  product_ads jsonb not null default '{}'::jsonb, -- {heading, items:[{key,name,blurb,url,cta,icon_url,...}]}
  ad_policy jsonb not null default '{}'::jsonb,   -- {mode: ensure|auto|never, max, default_keys, soft_prefix}
  default_sender jsonb not null default '{}'::jsonb, -- {from_name, from_email, reply_to, bcc}
  assets jsonb not null default '{}'::jsonb,      -- picture library: {key:{url,alt,label}}
  ai_images text not null default 'allow' check (ai_images in ('allow','never')),
  voice text,                                     -- plain-language voice note for the writer
  default_eyebrow text,
  site_url text,
  sort integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_library (
  id uuid primary key default gen_random_uuid(),
  brand_kit text not null references public.email_brand_kits(slug) on update cascade,
  title text not null,
  subject text not null default '',
  preheader text,
  blocks jsonb not null default '[]'::jsonb,       -- the editable email; [] for imported template files
  html text not null default '',                   -- exactly what is previewed, downloaded and sent
  text_body text not null default '',              -- plain-text twin
  source text not null default 'built' check (source in ('template','built')),
  template_slug text,
  brief text,                                      -- what Jared asked for
  recipient_name text,
  recipient_email text,
  status text not null default 'draft' check (status in ('draft','sent')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_library_kit_idx on public.email_library (brand_kit, updated_at desc);

create table if not exists public.email_library_versions (
  id bigserial primary key,
  library_id uuid not null references public.email_library(id) on delete cascade,
  version integer not null,
  subject text,
  preheader text,
  blocks jsonb,
  html text,
  saved_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (library_id, version)
);

create table if not exists public.email_send_log (
  id bigserial primary key,
  library_id uuid references public.email_library(id) on delete set null,
  to_email text,
  to_name text,
  subject text,
  from_email text,
  provider text not null default 'resend',
  provider_id text,
  status text not null check (status in ('sent','failed')),
  error text,
  html_sha text,
  sent_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.email_builder_runs (
  id bigserial primary key,
  op text not null,                -- generate | revise | image | export | send
  kit text,
  ok boolean not null,
  provider text,
  model text,
  ms integer,
  error text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists email_builder_runs_idx on public.email_builder_runs (op, created_at desc);

-- keep updated_at honest
drop trigger if exists email_brand_kits_touch on public.email_brand_kits;
create trigger email_brand_kits_touch before update on public.email_brand_kits for each row execute function public.update_updated_at_column();
drop trigger if exists email_library_touch on public.email_library;
create trigger email_library_touch before update on public.email_library for each row execute function public.update_updated_at_column();

-- every save that changes the email keeps the previous text as a numbered version
create or replace function public.email_library_keep_version() returns trigger
language plpgsql set search_path = public as $$
begin
  if (old.html is distinct from new.html) or (old.blocks is distinct from new.blocks) or (old.subject is distinct from new.subject) or (old.preheader is distinct from new.preheader) then
    insert into public.email_library_versions (library_id, version, subject, preheader, blocks, html)
    values (old.id, coalesce((select max(version) from public.email_library_versions where library_id = old.id), 0) + 1, old.subject, old.preheader, old.blocks, old.html);
  end if;
  return new;
end $$;
drop trigger if exists email_library_version on public.email_library;
create trigger email_library_version before update on public.email_library for each row execute function public.email_library_keep_version();

-- admin only, like the other admin tables
alter table public.email_brand_kits enable row level security;
alter table public.email_library enable row level security;
alter table public.email_library_versions enable row level security;
alter table public.email_send_log enable row level security;
alter table public.email_builder_runs enable row level security;

drop policy if exists email_brand_kits_admin on public.email_brand_kits;
create policy email_brand_kits_admin on public.email_brand_kits for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
drop policy if exists email_library_admin on public.email_library;
create policy email_library_admin on public.email_library for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
drop policy if exists email_library_versions_admin on public.email_library_versions;
create policy email_library_versions_admin on public.email_library_versions for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
-- logs: admins read; only the edge functions (service role) write
drop policy if exists email_send_log_admin_read on public.email_send_log;
create policy email_send_log_admin_read on public.email_send_log for select to authenticated using (public.has_role(auth.uid(), 'admin'));
drop policy if exists email_builder_runs_admin_read on public.email_builder_runs;
create policy email_builder_runs_admin_read on public.email_builder_runs for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- who answers when it breaks: Scout (existing employee). Alerts use keys email-builder.generate / .image / .send
insert into public.notification_owners (prefix, agent_slug, note)
values ('email-builder', 'scout', 'Email builder: free AI could not write the email, a picture failed, or a send failed (2026-10-19)')
on conflict (prefix) do nothing;

-- Vera (Privacy Clerk): addresses we store here
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason, enabled) values
  ('email_library',  'recipient_email', 'email', 'blank', 'Draft emails keep their text; the address is blanked when someone asks to be forgotten', true),
  ('email_send_log', 'to_email',        'email', 'blank', 'Send record keeps subject and time; the address is blanked on request', true)
on conflict do nothing;

-- A client brand becomes an email kit in one call. Colors, fonts and the wordmark come from client_brand.theme;
-- anything missing falls back to the Bestly look. Admin only.
create or replace function public.email_kit_build(p_slug text) returns text
language plpgsql security definer set search_path = public as $$
declare
  c record; th jsonb; pal jsonb; roles jsonb; kslug text; wm text; neutral text; sec text; prim text; inkc text;
  bg text; accent text; eyebrow text; box text; rule text; fam text;
begin
  select a.slug, a.name, b.theme, b.words_avoid into c from public.approval_clients a left join public.client_brand b on b.client_id = a.id where a.slug = p_slug;
  if not found then raise exception 'no client %', p_slug; end if;
  th := coalesce(c.theme, '{}'::jsonb); pal := coalesce(th->'palette', '{}'::jsonb); roles := coalesce(th->'roles', '{}'::jsonb);
  neutral := pal->>coalesce(roles->'neutral'->>0, 'cream');
  sec := pal->>coalesce(roles->'secondary'->>0, 'teal');
  prim := pal->>coalesce(roles->'primary'->>0, 'coral');
  inkc := coalesce(pal->>'ink', sec);
  bg := coalesce(neutral, '#faf9f7'); accent := coalesce(sec, '#3b4a9c'); eyebrow := coalesce(prim, accent);
  box := coalesce(pal->>'shell', '#f3f1ec'); rule := coalesce(pal->>'shell', '#e7e5e0');
  fam := coalesce(th->'fonts'->'body'->>'family', null);
  select value->>'url' into wm from jsonb_each(coalesce(th->'wordmarks', '{}'::jsonb)) where jsonb_typeof(value) = 'object' and value ? 'url' order by (key = p_slug) desc, key limit 1;
  kslug := left(regexp_replace(lower(p_slug), '[^a-z0-9-]', '-', 'g'), 40);
  insert into public.email_brand_kits (slug, name, kind, extends, source_client_slug, theme, header, footer, ad_policy, ai_images, sort)
  values (kslug, c.name, 'client', 'bestly', p_slug,
    jsonb_build_object('page_bg', bg, 'card_bg', '#ffffff', 'card_border', rule, 'text', inkc, 'heading', inkc, 'muted', inkc, 'accent', accent,
      'accent_text', coalesce(neutral, '#ffffff'), 'eyebrow', eyebrow, 'box_bg', bg, 'rule', rule)
      || case when fam is not null then jsonb_build_object('font_body', '''' || fam || ''',''Helvetica Neue'',Helvetica,Arial,sans-serif') else '{}'::jsonb end,
    case when wm is not null then jsonb_build_object('layout', 'logo', 'image_url', wm, 'alt', c.name, 'logo_size', 84, 'logo_radius', 0)
         else jsonb_build_object('layout', 'text', 'name', c.name) end,
    jsonb_build_object('rainbow', false, 'lines', jsonb_build_array(jsonb_build_object('text', 'Sent with Bestly Studio'))),
    jsonb_build_object('mode', 'ensure', 'default_keys', jsonb_build_array('bestly-studio'), 'max', 1),
    case when 'AI-generated imagery' = any (array(select jsonb_array_elements_text(coalesce(th->'shape_rules'->'avoid', '[]'::jsonb)))) then 'never' else 'allow' end,
    200)
  on conflict (slug) do update set name = excluded.name, theme = excluded.theme, header = excluded.header, source_client_slug = excluded.source_client_slug, ai_images = excluded.ai_images;
  return kslug;
end $$;
revoke all on function public.email_kit_build(text) from public, anon, authenticated;

create or replace function public.email_kit_for_client(p_slug text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admins only'; end if;
  return public.email_kit_build(p_slug);
end $$;
revoke all on function public.email_kit_for_client(text) from public, anon;
grant execute on function public.email_kit_for_client(text) to authenticated;

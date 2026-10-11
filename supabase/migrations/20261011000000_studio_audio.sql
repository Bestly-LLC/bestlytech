-- ElevenLabs inside Bestly Studio: switches, consent, jobs, quotes, billing (opusplan docs/elevenlabs-studio-opusplan.md, Track A).
-- Owner: Spark. Plan credits only; Jared alone flips switches; a cloned voice needs a signed consent on file.
-- Everything here is fail-closed: the rules are triggers, not UI.

-- ── settings (one row) ───────────────────────────────────────────────────────────────────────
create table if not exists public.studio_audio_settings (
  id boolean primary key default true check (id),
  markup_pct numeric not null default 20,
  reserve_pct numeric not null default 30,
  usd_per_credit numeric not null default 0.000165,          -- Pro $99 / 600,008 credits; the edge fn refreshes it from the subscription
  quote_ttl_min int not null default 30,
  jared_staff uuid not null default '4a612167-e8e9-48ce-9b93-f70ea46b31b8',
  music_commercial_ok boolean not null default false,       -- Jared confirms the ElevenLabs music licence covers Bestly's posts
  blocked_voices text[] not null default array['EXAVITQu4vr4xnSDxMaL'],   -- Sarah: RoofGuard caller, never content
  scribe_when jsonb not null default '["client_captions","dubbing_source","low_whisper_confidence"]',
  rates jsonb not null default '{"voiceover":{"per_char":1,"flash_per_char":0.5,"chars_per_sec":15},
    "sfx":{"per_sec":25,"auto_sec":5,"min":25},"music":{"per_sec":31.25,"default_sec":30},
    "dubbing":{"per_min":4125,"model":"dubbing_v1"},"stt":{"per_min":46},"voice_changer":{"per_min":1500},
    "voice_design":{"flat":150},"clone":{"flat":0}}',
  credits jsonb not null default '{}',                      -- last subscription snapshot {limit,used,remaining,reset_unix,tier,overage_ok,as_of}
  updated_at timestamptz not null default now()
);
insert into public.studio_audio_settings (id) values (true) on conflict do nothing;

-- ── the switches: per owner (client or app), per feature ─────────────────────────────────────
create table if not exists public.studio_audio_features (
  owner_slug text not null,
  feature text not null check (feature in ('voiceover','stt','dubbing','music','clone','sfx','voice_changer','voice_design')),
  enabled boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  note text,
  primary key (owner_slug, feature)
);

-- ── consent to clone a person's voice ────────────────────────────────────────────────────────
create table if not exists public.studio_voice_consents (
  id uuid primary key default gen_random_uuid(),
  owner_slug text not null,
  person_name text not null,
  voice_id text,
  addendum_path text,
  libresign_request_id text,
  signed_at timestamptz,                  -- null = prepared, not signed: NOT active
  scope jsonb not null default '{"per_post_approval":true}',
  revoked_at timestamptz,
  revoked_by text,
  prepared_by text,
  created_at timestamptz not null default now()
);
create index if not exists studio_voice_consents_owner on public.studio_voice_consents (owner_slug);
create index if not exists studio_voice_consents_voice on public.studio_voice_consents (voice_id) where voice_id is not null;

-- ── jobs: every generation, one row, quote to done ───────────────────────────────────────────
create or replace function public.studio_audio_new_code() returns text language plpgsql volatile set search_path = public as $$
declare c text;
begin
  loop
    c := substr(md5(gen_random_uuid()::text), 1, 7);
    exit when not exists (select 1 from public.studio_audio_jobs where code = c);
  end loop;
  return c;
end $$;

create table if not exists public.studio_audio_jobs (
  code text primary key default substr(md5(gen_random_uuid()::text), 1, 7),
  owner_slug text not null,
  feature text not null check (feature in ('voiceover','stt','dubbing','music','clone','sfx','voice_changer','voice_design')),
  requested_by text not null default 'spark',
  engine text not null default 'elevenlabs',           -- elevenlabs | whisper (Pi, free)
  inputs jsonb not null default '{}',
  voice_id text,
  consent_id uuid references public.studio_voice_consents(id),
  est_credits numeric,
  est_usd numeric,
  actual_credits numeric,
  cost_usd numeric,
  billed_usd numeric,
  status text not null default 'quoted' check (status in ('quoted','confirmed','running','done','failed','held')),
  held_reason text,
  error text,
  output_path text,
  item_id uuid,
  thread_id uuid,
  external_ref text,                                    -- e.g. the ElevenLabs dubbing id while it renders
  meta jsonb not null default '{}',                     -- model, avg logprob, transcript length ...
  provenance jsonb not null default '{}',
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists studio_audio_jobs_status on public.studio_audio_jobs (status, created_at);
create index if not exists studio_audio_jobs_owner on public.studio_audio_jobs (owner_slug, created_at desc);
create index if not exists studio_audio_jobs_consent on public.studio_audio_jobs (consent_id) where consent_id is not null;

create table if not exists public.studio_audio_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  owner_slug text,
  feature text,
  action text not null,
  actor text,
  detail jsonb not null default '{}'
);

alter table public.studio_audio_settings enable row level security;
alter table public.studio_audio_features enable row level security;
alter table public.studio_voice_consents enable row level security;
alter table public.studio_audio_jobs enable row level security;
alter table public.studio_audio_log enable row level security;
revoke all on public.studio_audio_settings, public.studio_audio_features, public.studio_voice_consents,
  public.studio_audio_jobs, public.studio_audio_log from anon, authenticated;
revoke all on sequence public.studio_audio_log_id_seq from anon, authenticated;

-- ── small helpers ────────────────────────────────────────────────────────────────────────────
create or replace function public.studio_audio_feature_label(p text) returns text language sql immutable set search_path = public as $$
  select case p when 'voiceover' then 'Voiceover' when 'stt' then 'Transcript' when 'dubbing' then 'Dubbing' when 'music' then 'Music'
    when 'clone' then 'Voice cloning' when 'sfx' then 'Sound effect' when 'voice_changer' then 'Voice changer' when 'voice_design' then 'Voice design' else p end $$;

create or replace function public.studio_audio_feature_on(p_owner text, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from public.studio_audio_features where owner_slug = p_owner and feature = p_feature), false) $$;

create or replace function public.studio_voice_consent_active(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.studio_voice_consents where id = p_id and signed_at is not null and revoked_at is null) $$;

create or replace function public.studio_audio_reserve_pct() returns numeric
language sql stable security definer set search_path = public as $$
  select greatest(coalesce((select reserve_pct from public.studio_audio_settings where id), 30),
                  coalesce((select (value->>'reserve_pct')::numeric from public.montage_settings where key = 'voice'), 0)) $$;

create or replace function public.studio_audio_is_jared(p_token text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s public.studio_caller; j uuid;
begin
  s := public.studio_resolve_staff(p_token);
  select jared_staff into j from public.studio_audio_settings where id;
  return s.id is not null and s.id = j;
end $$;

create or replace function public.studio_audio_log_add(p_owner text, p_feature text, p_action text, p_actor text, p_detail jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.studio_audio_log (owner_slug, feature, action, actor, detail) values (p_owner, p_feature, p_action, p_actor, coalesce(p_detail, '{}')) $$;

-- Spark's voice on every alert. Only money (credits, overage) interrupts; the rest lands in the recap.
create or replace function public.studio_audio_alert(p_key text, p_title text, p_body text, p_money boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.scout_notify(p_title => 'Spark: ' || p_title, p_body => p_body,
    p_severity => case when p_money then 'warning' else 'info' end, p_push => p_money,
    p_url => '/admin/team', p_dedupe => 'audio:' || p_key);
exception when others then null;
end $$;

-- ── the switch gate (triggers, fail closed) ──────────────────────────────────────────────────
create or replace function public.trg_studio_audio_features_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_mode text := coalesce(nullif(current_setting('studio_audio.mode', true), ''), '');
        v_actor text := nullif(current_setting('studio_audio.actor', true), '');
        v_jared uuid;
begin
  select jared_staff into v_jared from public.studio_audio_settings where id;
  if tg_op = 'UPDATE' and new.enabled is not distinct from old.enabled then
    new.updated_at := now(); return new;           -- a note edit that flips nothing
  end if;
  if v_mode = 'seed' then
    null;
  elsif v_mode in ('client_off', 'revoke') then
    if not (new.feature = 'clone' and new.enabled = false) then
      raise exception 'only the clone switch can be turned off this way' using errcode = 'check_violation';
    end if;
  elsif v_mode = 'jared' and v_actor is not null and v_actor::uuid = v_jared then
    null;
  else
    raise exception 'jared_only: only Jared can change the audio switches' using errcode = 'check_violation';
  end if;
  if new.feature = 'clone' and new.enabled and not exists (
       select 1 from public.studio_voice_consents c
        where c.owner_slug = new.owner_slug and c.signed_at is not null and c.revoked_at is null) then
    raise exception 'clone_needs_consent: voice cloning stays locked until a signed consent addendum is on file for %', new.owner_slug
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists studio_audio_features_gate on public.studio_audio_features;
create trigger studio_audio_features_gate before insert or update on public.studio_audio_features
  for each row execute function public.trg_studio_audio_features_gate();

-- A job that uses a person's cloned voice needs an active consent for that owner, and the clone switch on.
create or replace function public.trg_studio_audio_jobs_gate() returns trigger
language plpgsql security definer set search_path = public as $$
declare s public.studio_audio_settings; v_needs boolean; c public.studio_voice_consents;
begin
  select * into s from public.studio_audio_settings where id;
  new.updated_at := now();
  if new.status in ('failed', 'held') then return new; end if;
  if tg_op = 'UPDATE' and new.status = old.status and new.consent_id is not distinct from old.consent_id
     and new.voice_id is not distinct from old.voice_id then return new; end if;
  if new.voice_id is not null and new.voice_id = any (s.blocked_voices) then
    raise exception 'voice_blocked: that voice is reserved and never used for content' using errcode = 'check_violation';
  end if;
  if new.status in ('quoted', 'confirmed', 'running') and new.requested_by <> 'whisper'
     and not coalesce((select enabled from public.studio_audio_features where owner_slug = new.owner_slug and feature = new.feature), false) then
    raise exception 'switch_off: % is off for %', new.feature, new.owner_slug using errcode = 'check_violation';
  end if;
  v_needs := new.feature = 'clone'
          or coalesce((new.inputs->>'cloned_voice')::boolean, false)
          or (new.voice_id is not null and exists (select 1 from public.studio_voice_consents x where x.voice_id = new.voice_id));
  if v_needs then
    select * into c from public.studio_voice_consents where id = new.consent_id;
    if c.id is null or c.signed_at is null or c.revoked_at is not null or c.owner_slug <> new.owner_slug then
      raise exception 'voice_needs_consent: a cloned voice needs an active signed consent on file for %', new.owner_slug using errcode = 'check_violation';
    end if;
    if new.voice_id is not null and c.voice_id is not null and c.voice_id <> new.voice_id then
      raise exception 'voice_needs_consent: this consent is for a different voice' using errcode = 'check_violation';
    end if;
    if not coalesce((select enabled from public.studio_audio_features where owner_slug = new.owner_slug and feature = 'clone'), false) then
      raise exception 'clone_off: the voice-cloning switch is off for %', new.owner_slug using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists studio_audio_jobs_gate on public.studio_audio_jobs;
create trigger studio_audio_jobs_gate before insert or update on public.studio_audio_jobs
  for each row execute function public.trg_studio_audio_jobs_gate();

-- a new client or app starts with every switch off
create or replace function public.trg_approval_clients_audio_seed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('studio_audio.mode', 'seed', true);
  insert into public.studio_audio_features (owner_slug, feature, enabled, updated_by, note)
  select new.slug, f, false, 'seed', 'new client: all off' from unnest(array['voiceover','stt','dubbing','music','clone','sfx','voice_changer','voice_design']) f
  on conflict do nothing;
  perform set_config('studio_audio.mode', '', true);
  return new;
end $$;
drop trigger if exists approval_clients_audio_seed on public.approval_clients;
create trigger approval_clients_audio_seed after insert on public.approval_clients
  for each row execute function public.trg_approval_clients_audio_seed();

-- ── seeds (Jared's answers 3 and 10) ─────────────────────────────────────────────────────────
do $seed$
begin
  perform set_config('studio_audio.mode', 'seed', true);
  insert into public.studio_audio_features (owner_slug, feature, enabled, updated_by, note)
  select c.slug, f,
         case when c.slug in ('bestly-cloud','bestly-studio','cookie-yeti','hoku','inventoryproof','re-demo') and f <> 'clone' then true else false end,
         'seed',
         case when c.slug = 'centering-you' then 'built but locked: Centering YOU is not a first project' when f = 'clone' then 'locked until a signed consent addendum is on file' else 'first-project default' end
    from public.approval_clients c cross join unnest(array['voiceover','stt','dubbing','music','clone','sfx','voice_changer','voice_design']) f
   where c.active
  on conflict do nothing;
  insert into public.studio_audio_features (owner_slug, feature, enabled, updated_by, note)
  select a, f, f in ('voiceover','stt'), 'seed', 'app/agent default: voiceover and transcripts'
    from unnest(array['maya','ava']) a cross join unnest(array['voiceover','stt','dubbing','music','clone','sfx','voice_changer','voice_design']) f
  on conflict do nothing;
  perform set_config('studio_audio.mode', '', true);
end $seed$;

-- ── credits snapshot + the reserve rule ──────────────────────────────────────────────────────
create or replace function public.studio_audio_credits_set(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.studio_audio_settings set
    credits = coalesce(credits, '{}') || coalesce(p, '{}') || jsonb_build_object('as_of', now()),
    usd_per_credit = coalesce(nullif((p->>'usd_per_credit')::numeric, 0), usd_per_credit),
    updated_at = now()
  where id;
end $$;

create or replace function public.studio_audio_credit_check(p_est numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.studio_audio_settings; lim numeric; rem numeric; res numeric; v_after numeric;
begin
  select * into s from public.studio_audio_settings where id;
  lim := (s.credits->>'limit')::numeric; rem := (s.credits->>'remaining')::numeric;
  res := public.studio_audio_reserve_pct();
  if lim is null or rem is null or lim <= 0 then
    return jsonb_build_object('ok', false, 'known', false, 'reason', 'credits_unknown', 'reserve_pct', res);
  end if;
  v_after := rem - coalesce(p_est, 0);
  return jsonb_build_object('ok', v_after >= res / 100.0 * lim, 'known', true, 'remaining', rem, 'limit', lim, 'reserve_pct', res,
    'after_pct', round(100.0 * v_after / lim), 'as_of', s.credits->>'as_of', 'reset_unix', (s.credits->>'reset_unix')::bigint);
end $$;

-- ── quote → confirm → start → finish ─────────────────────────────────────────────────────────
create or replace function public.studio_audio_quote(p_owner text, p_feature text, p_inputs jsonb default '{}',
  p_requested_by text default 'spark', p_thread uuid default null, p_voice_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.studio_audio_settings; rt jsonb; f public.studio_audio_features; v_label text; v_name text; v_kind text;
  inp jsonb := coalesce(p_inputs, '{}'); v_engine text := 'elevenlabs'; v_model text; v_chars int; v_sec numeric; v_min numeric;
  v_credits numeric; v_detail text; v_usd numeric; v_billed numeric; chk jsonb; v_code text; v_con public.studio_voice_consents;
  v_txt text; v_policy text; v_langs int; v_stale boolean; v_after text; v_hold boolean := false; v_lic boolean := false;
begin
  select * into s from public.studio_audio_settings where id;
  rt := s.rates;
  if p_feature not in ('voiceover','stt','dubbing','music','clone','sfx','voice_changer','voice_design') then
    return jsonb_build_object('ok', false, 'error', 'bad_feature', 'text', 'I do not know that audio feature: ' || coalesce(p_feature, 'none'));
  end if;
  v_label := public.studio_audio_feature_label(p_feature);
  select coalesce(c.name, p_owner), c.kind into v_name, v_kind from public.approval_clients c where c.slug = p_owner;
  v_name := coalesce(v_name, p_owner);
  select * into f from public.studio_audio_features where owner_slug = p_owner and feature = p_feature;
  if f.owner_slug is null or not f.enabled then
    return jsonb_build_object('ok', false, 'error', 'switch_off', 'feature', p_feature, 'owner', p_owner,
      'text', v_label || ' is switched off for ' || v_name || '. Only Jared can turn it on: Studio, Settings, Audio.');
  end if;
  if p_voice_id is not null and p_voice_id = any (s.blocked_voices) then
    return jsonb_build_object('ok', false, 'error', 'voice_blocked', 'text', 'That voice is reserved (it is the RoofGuard caller) and is never used for content. Pick another voice.');
  end if;
  -- cloned voices: a consent must be active and belong to this owner
  if p_voice_id is not null then
    select * into v_con from public.studio_voice_consents where voice_id = p_voice_id
     order by (signed_at is not null and revoked_at is null) desc, created_at desc limit 1;
    if v_con.id is not null and (v_con.signed_at is null or v_con.revoked_at is not null or v_con.owner_slug <> p_owner) then
      return jsonb_build_object('ok', false, 'error', 'voice_needs_consent',
        'text', 'That is ' || v_con.person_name || '''s cloned voice and there is no active consent for it here' ||
                case when v_con.revoked_at is not null then ' (it was turned off).' else '.' end || ' I cannot use it.');
    end if;
  end if;
  if p_feature = 'clone' then
    if nullif(inp->>'consent_id', '') is null or not public.studio_voice_consent_active((inp->>'consent_id')::uuid) then
      return jsonb_build_object('ok', false, 'error', 'needs_consent', 'text',
        'Voice cloning needs a signed consent addendum on file first. Prepare it in Studio, Settings, Audio; Jared sends it and records it when it is signed.');
    end if;
    select * into v_con from public.studio_voice_consents where id = (inp->>'consent_id')::uuid;
  end if;

  -- estimate
  if p_feature = 'voiceover' then
    v_chars := length(coalesce(inp->>'text', ''));
    v_model := coalesce(nullif(inp->>'model', ''), 'eleven_multilingual_v2');
    if v_chars < 1 then return jsonb_build_object('ok', false, 'error', 'text_required', 'text', 'Voiceover needs the words to speak.'); end if;
    v_credits := ceil(v_chars * case when v_model ~* '(flash|turbo)' then (rt->'voiceover'->>'flash_per_char')::numeric else (rt->'voiceover'->>'per_char')::numeric end);
    v_sec := round(v_chars / (rt->'voiceover'->>'chars_per_sec')::numeric);
    v_detail := public.ltx_nb(v_sec::int::text, 'sec');
  elsif p_feature = 'sfx' then
    v_sec := coalesce((inp->>'duration_seconds')::numeric, (rt->'sfx'->>'auto_sec')::numeric);
    v_credits := greatest((rt->'sfx'->>'min')::numeric, ceil(v_sec * (rt->'sfx'->>'per_sec')::numeric));
    v_detail := public.ltx_nb(v_sec::text, 'sec');
  elsif p_feature = 'music' then
    v_sec := coalesce((inp->>'seconds')::numeric, (inp->>'music_length_ms')::numeric / 1000, (rt->'music'->>'default_sec')::numeric);
    v_credits := ceil(v_sec * (rt->'music'->>'per_sec')::numeric);
    v_detail := public.ltx_nb(round(v_sec)::text, 'sec');
    v_lic := not s.music_commercial_ok;
  elsif p_feature = 'dubbing' then
    v_min := coalesce((inp->>'minutes')::numeric, 1);
    v_langs := greatest(1, coalesce(jsonb_array_length(inp->'target_langs'), 1));
    v_credits := ceil(v_min * v_langs * (rt->'dubbing'->>'per_min')::numeric);
    v_detail := public.ltx_nb(v_min::text, 'min') || ' x ' || v_langs || ' language' || case when v_langs > 1 then 's' else '' end;
  elsif p_feature = 'voice_changer' then
    v_min := coalesce((inp->>'minutes')::numeric, 1);
    v_credits := ceil(v_min * (rt->'voice_changer'->>'per_min')::numeric);
    v_detail := public.ltx_nb(v_min::text, 'min');
  elsif p_feature = 'stt' then
    v_min := coalesce((inp->>'minutes')::numeric, 1);
    v_engine := case when inp->>'engine' in ('scribe','elevenlabs') or (s.scribe_when ? coalesce(inp->>'reason', '')) then 'elevenlabs' else 'whisper' end;
    v_credits := case when v_engine = 'whisper' then 0 else ceil(v_min * (rt->'stt'->>'per_min')::numeric) end;
    v_detail := public.ltx_nb(v_min::text, 'min');
  elsif p_feature = 'voice_design' then
    v_credits := (rt->'voice_design'->>'flat')::numeric; v_detail := '3 previews';
  else
    v_credits := (rt->'clone'->>'flat')::numeric; v_detail := 'one voice';
  end if;
  v_usd := round(v_credits * s.usd_per_credit, 2);
  v_billed := case when v_kind = 'client' then round(v_usd * (1 + s.markup_pct / 100.0), 2) else 0 end;

  chk := public.studio_audio_credit_check(v_credits);
  v_stale := coalesce((s.credits->>'as_of')::timestamptz < now() - interval '15 minutes', true);
  if v_engine = 'whisper' then
    v_after := '';
  elsif (chk->>'known')::boolean then
    v_hold := not (chk->>'ok')::boolean;
    v_after := ' Credits left after: ' || (chk->>'after_pct') || '%' || '.' ||
               case when v_hold then ' That is under the ' || (((chk->>'reserve_pct')::numeric)::int::text || '%') || ' reserve, so it will be held until credits reset.' else '' end ||
               case when v_stale then ' (credit count is a few minutes old)' else '' end;
  else
    v_after := ' Credits left: not checked yet.';
  end if;
  select note into v_policy from public.montage_brand_policy where client_slug = p_owner and ai_voice_ok = false and p_feature in ('voiceover','voice_changer','voice_design');

  v_txt := v_label || ', ' || v_detail || ', ' ||
    case when v_engine = 'whisper' then 'free (Whisper on the Pi).'
         else '~' || public.ltx_nb(v_credits::int::text, 'credits') || ', about ' || public.ltx_usd(v_usd) || '.' end ||
    v_after ||
    case when v_billed > 0 then ' Billed to the client: about ' || public.ltx_usd(v_billed) || ' (cost plus ' || (s.markup_pct::int::text || '%') || ').' else '' end ||
    case when v_lic then ' Music stays out of posts until Jared confirms the ElevenLabs music licence covers it.' else '' end ||
    case when v_policy is not null then ' Note: Montage policy for this client says no AI voice (' || left(v_policy, 120) || ').' else '' end;

  begin
    insert into public.studio_audio_jobs (code, owner_slug, feature, requested_by, engine, inputs, voice_id, consent_id, est_credits, est_usd, thread_id, status)
    values (public.studio_audio_new_code(), p_owner, p_feature, coalesce(p_requested_by, 'spark'), v_engine,
            inp || jsonb_build_object('model', v_model), p_voice_id, v_con.id, v_credits, v_usd, p_thread, 'quoted')
    returning code into v_code;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'error', split_part(sqlerrm, ':', 1), 'text', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'code', v_code, 'feature', p_feature, 'owner', p_owner, 'engine', v_engine,
    'est_credits', v_credits, 'est_usd', v_usd, 'est_billed_usd', v_billed, 'after_pct', chk->'after_pct', 'would_hold', v_hold,
    'music_licence_hold', v_lic, 'ttl_min', s.quote_ttl_min, 'text', v_txt);
end $$;

create or replace function public.studio_audio_confirm(p_code text, p_by text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.studio_audio_jobs; ttl int;
begin
  select quote_ttl_min into ttl from public.studio_audio_settings where id;
  select * into j from public.studio_audio_jobs where code = p_code for update;
  if j.code is null then return jsonb_build_object('ok', false, 'error', 'no_such_job'); end if;
  if j.status = 'confirmed' then return jsonb_build_object('ok', true, 'code', j.code, 'already', true); end if;
  if j.status <> 'quoted' then return jsonb_build_object('ok', false, 'error', 'bad_state', 'status', j.status); end if;
  if j.created_at < now() - make_interval(mins => ttl) then
    update public.studio_audio_jobs set status = 'failed', error = 'quote expired' where code = p_code;
    return jsonb_build_object('ok', false, 'error', 'quote_expired', 'text', 'That quote is older than ' || ttl || ' minutes. Ask for a new one.');
  end if;
  begin
    update public.studio_audio_jobs set status = 'confirmed', confirmed_at = now(),
      inputs = inputs || jsonb_build_object('confirmed_by', coalesce(p_by, 'unknown')) where code = p_code;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'error', split_part(sqlerrm, ':', 1), 'text', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'code', p_code);
end $$;

create or replace function public.studio_audio_hold(p_code text, p_reason text, p_text text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.studio_audio_jobs;
begin
  update public.studio_audio_jobs set status = 'held', held_reason = p_reason
   where code = p_code and status in ('confirmed', 'running') returning * into j;
  if j.code is null then return jsonb_build_object('ok', false, 'error', 'not_holdable'); end if;
  perform public.studio_audio_post(j, coalesce(p_text, 'Held: ' || p_reason || '. I will run it by itself as soon as it clears.'));
  return jsonb_build_object('ok', true, 'held', true, 'reason', p_reason);
end $$;

create or replace function public.studio_audio_start(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.studio_audio_jobs; chk jsonb; s public.studio_audio_settings; v_msg text; v_reset text;
begin
  select * into s from public.studio_audio_settings where id;
  select * into j from public.studio_audio_jobs where code = p_code for update;
  if j.code is null then return jsonb_build_object('ok', false, 'error', 'no_such_job'); end if;
  if j.status = 'running' then return jsonb_build_object('ok', false, 'error', 'already_running'); end if;
  if j.status <> 'confirmed' then return jsonb_build_object('ok', false, 'error', 'not_confirmed', 'status', j.status); end if;
  if j.engine = 'elevenlabs' then
    if coalesce((s.credits->>'as_of')::timestamptz, 'epoch') < now() - interval '3 minutes' then
      return jsonb_build_object('ok', false, 'error', 'credits_stale');     -- the caller refreshes the subscription first
    end if;
    chk := public.studio_audio_credit_check(coalesce(j.est_credits, 0));
    if not coalesce((chk->>'ok')::boolean, false) then
      v_reset := case when (chk->>'reset_unix') is not null
                 then to_char(to_timestamp((chk->>'reset_unix')::bigint) at time zone 'America/Los_Angeles', 'FMMon FMDD') else 'the next reset' end;
      v_msg := 'Held: this would take ElevenLabs credits under the ' || ((chk->>'reserve_pct') || '%') ||
               ' reserve, so I did not run it. It runs by itself when credits reset (' || v_reset || ').';
      update public.studio_audio_jobs set status = 'held', held_reason = 'credits' where code = p_code returning * into j;
      perform public.studio_audio_post(j, v_msg);
      perform public.studio_audio_alert('credits-held:' || to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD'),
        'Audio is paused: ElevenLabs credits are near the reserve',
        'About ' || (coalesce(chk->>'after_pct', '?') || '%') || ' of this month''s ElevenLabs credits would be left (about ' ||
        public.ltx_usd(round(coalesce((chk->>'remaining')::numeric, 0) * s.usd_per_credit, 0)) || ' of the plan). New audio waits until ' || v_reset ||
        '. Ava''s calls share the same credits and keep their reserve.', true);
      return jsonb_build_object('ok', false, 'held', true, 'reason', 'credits', 'text', v_msg);
    end if;
  end if;
  begin
    update public.studio_audio_jobs set status = 'running', started_at = now(), attempts = attempts + 1, held_reason = null
     where code = p_code returning * into j;
  exception when check_violation then
    update public.studio_audio_jobs set status = 'failed', error = sqlerrm where code = p_code;
    return jsonb_build_object('ok', false, 'error', split_part(sqlerrm, ':', 1), 'text', sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'job', to_jsonb(j));
end $$;

-- a message back to whoever asked (same doors the LTX queue uses)
create or replace function public.studio_audio_post(j public.studio_audio_jobs, body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if j.thread_id is null then return; end if;
  if j.requested_by = 'scout' then
    insert into admin_chat_messages (thread_id, role, body) values (j.thread_id, 'assistant', body);
    update admin_chat_threads set updated_at = now() where id = j.thread_id;
  elsif j.requested_by = 'spark' then
    insert into studio_request_messages (request_id, role, body) values (j.thread_id, 'claude', body);
    update studio_requests set updated_at = now() where id = j.thread_id;
  end if;
exception when others then null;
end $$;

-- AI provenance on the post (the Library badge and the platform AI label both read this)
create or replace function public.studio_audio_attach(p_code text, p_item uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.studio_audio_jobs; it public.approval_items; v_entry jsonb; v_name text; s public.studio_audio_settings; v_arr jsonb;
begin
  select * into j from public.studio_audio_jobs where code = p_code;
  if j.code is null then return jsonb_build_object('ok', false, 'error', 'no_such_job'); end if;
  if j.status <> 'done' then return jsonb_build_object('ok', false, 'error', 'not_done'); end if;
  select * into it from public.approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  select * into s from public.studio_audio_settings where id;
  v_name := coalesce(j.meta->>'voice_name', j.voice_id);
  v_entry := jsonb_strip_nulls(jsonb_build_object('feature', j.feature, 'job_code', j.code, 'model', j.meta->>'model', 'voice_id', j.voice_id,
    'voice_name', v_name, 'consent_id', j.consent_id, 'ai_generated', true, 'at', now()));
  v_arr := coalesce(it.provenance->'ai_audio', '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(v_arr) e where e->>'job_code' = j.code) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  update public.approval_items set provenance = coalesce(provenance, '{}'::jsonb) || jsonb_build_object('ai_audio', v_arr || jsonb_build_array(v_entry))
    || case when j.feature = 'music' and not s.music_commercial_ok
            then jsonb_build_object('publish_block', true, 'licensing', 'Music is held back from posting until Jared confirms the ElevenLabs music licence covers it.')
            else '{}'::jsonb end
   where id = p_item;
  update public.studio_audio_jobs set item_id = p_item, provenance = v_entry where code = p_code;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.studio_audio_finish(p_code text, p_ok boolean, p_credits numeric default null, p_path text default null,
  p_error text default null, p_meta jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare j public.studio_audio_jobs; s public.studio_audio_settings; v_kind text; v_cost numeric; v_msg text; v_cr numeric;
begin
  select * into s from public.studio_audio_settings where id;
  select * into j from public.studio_audio_jobs where code = p_code for update;
  if j.code is null or j.status <> 'running' then return jsonb_build_object('ok', false, 'error', 'not_running'); end if;
  v_cr := case when j.engine = 'whisper' then 0 else coalesce(p_credits, j.est_credits, 0) end;
  v_cost := round(v_cr * s.usd_per_credit, 4);
  select kind into v_kind from public.approval_clients where slug = j.owner_slug;
  update public.studio_audio_jobs set
    status = case when p_ok then 'done' else 'failed' end, finished_at = now(),
    actual_credits = v_cr, cost_usd = v_cost,
    billed_usd = case when p_ok and v_kind = 'client' then round(v_cost * (1 + s.markup_pct / 100.0), 4) else 0 end,
    output_path = case when p_ok then p_path end, error = case when p_ok then null else left(p_error, 500) end,
    meta = meta || coalesce(p_meta, '{}')
   where code = p_code returning * into j;
  v_msg := case when p_ok
    then public.studio_audio_feature_label(j.feature) || ' is ready' || case when p_path is not null then ': https://bestly.tech/a/' || j.code else '' end ||
         ' · Actual ' || public.ltx_nb(round(v_cr)::text, 'credits') || ' (about ' || public.ltx_usd(round(v_cost, 2)) || '; estimate was ' || public.ltx_nb(round(coalesce(j.est_credits, 0))::text, 'credits') || ')'
    else public.studio_audio_feature_label(j.feature) || ' failed: ' || coalesce(j.error, 'unknown error') || ' · Charged ' || public.ltx_nb(round(v_cr)::text, 'credits') end;
  perform public.studio_audio_post(j, v_msg);
  if j.requested_by in ('spark', 'scout', 'claude') then
    insert into admin_notifications (kind, title, body, url, severity, dedupe_key, agent_slug)
    values ('audio', case when p_ok then 'Audio ready' else 'Audio failed' end, left(v_msg, 300),
            case when p_ok and p_path is not null then 'https://bestly.tech/a/' || j.code end,
            case when p_ok then 'success' else 'warning' end, 'audio.job:' || j.code, 'spark')
    on conflict (dedupe_key) do nothing;
  end if;
  if p_ok and j.item_id is not null then perform public.studio_audio_attach(j.code, j.item_id); end if;
  return jsonb_build_object('ok', true, 'text', v_msg);
exception when unique_violation then
  return jsonb_build_object('ok', true, 'text', v_msg);
end $$;

create or replace function public.studio_audio_status(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j public.studio_audio_jobs;
begin
  select * into j from public.studio_audio_jobs where code = p_ref order by created_at desc limit 1;
  if j.code is null then return jsonb_build_object('ok', false, 'error', 'no such audio job'); end if;
  return jsonb_build_object('ok', true, 'status', j.status, 'code', j.code, 'feature', j.feature, 'est_credits', j.est_credits, 'actual_credits', j.actual_credits,
    'link', case when j.status = 'done' and j.output_path is not null then 'https://bestly.tech/a/' || j.code end, 'error', j.error, 'held_reason', j.held_reason,
    'text', case j.status
      when 'done' then public.studio_audio_feature_label(j.feature) || ' ready' || case when j.output_path is not null then ': https://bestly.tech/a/' || j.code else '' end ||
                       ' · Actual ' || public.ltx_nb(round(coalesce(j.actual_credits, 0))::text, 'credits') || ' (about ' || public.ltx_usd(round(coalesce(j.cost_usd, 0), 2)) || ')'
      when 'failed' then 'Failed: ' || coalesce(j.error, 'unknown')
      when 'held' then 'Held (' || coalesce(j.held_reason, 'waiting') || '). It runs by itself when that clears.'
      when 'running' then 'Working on it'
      when 'confirmed' then 'Confirmed, starting'
      else 'Quoted, waiting for a yes' end);
end $$;

-- Montage (and other pre-approved daily automation) logs spend in the same table without a per-video quote
create or replace function public.studio_audio_log_external(p_owner text, p_feature text, p_voice_id text, p_credits numeric,
  p_requested_by text default 'montage', p_inputs jsonb default '{}', p_output text default null, p_ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.studio_audio_settings; v_kind text; v_cost numeric; v_code text; v_con uuid;
begin
  select * into s from public.studio_audio_settings where id;
  select kind into v_kind from public.approval_clients where slug = p_owner;
  v_cost := round(coalesce(p_credits, 0) * s.usd_per_credit, 4);
  select id into v_con from public.studio_voice_consents where voice_id = p_voice_id and signed_at is not null and revoked_at is null and owner_slug = p_owner limit 1;
  v_code := public.studio_audio_new_code();
  insert into public.studio_audio_jobs (code, owner_slug, feature, requested_by, inputs, voice_id, consent_id, est_credits, actual_credits, cost_usd, billed_usd,
                                        status, output_path, external_ref, finished_at, confirmed_at, started_at)
  values (v_code, p_owner, p_feature, p_requested_by, coalesce(p_inputs, '{}'), p_voice_id, v_con, p_credits, p_credits, v_cost,
          case when v_kind = 'client' then round(v_cost * (1 + s.markup_pct / 100.0), 4) else 0 end, 'done', p_output, p_ref, now(), now(), now());
  return jsonb_build_object('ok', true, 'code', v_code);
exception when check_violation then
  return jsonb_build_object('ok', false, 'error', split_part(sqlerrm, ':', 1), 'text', sqlerrm);
end $$;

-- ── billing: month x owner (feeds invoices later, Libra) ─────────────────────────────────────
create or replace view public.studio_audio_billing with (security_invoker = on) as
select date_trunc('month', coalesce(j.finished_at, j.created_at) at time zone 'America/Los_Angeles')::date as month,
       j.owner_slug, coalesce(c.kind, 'app') as kind, count(*) as jobs,
       sum(coalesce(j.actual_credits, 0)) as credits,
       round(sum(coalesce(j.cost_usd, 0)), 4) as cost_usd,
       round(sum(case when c.kind = 'client' then coalesce(j.billed_usd, 0) else 0 end), 4) as billed_usd
  from public.studio_audio_jobs j left join public.approval_clients c on c.slug = j.owner_slug
 where j.status = 'done'
 group by 1, 2, 3;
revoke all on public.studio_audio_billing from anon, authenticated;

-- ── consent: record, sign, revoke ────────────────────────────────────────────────────────────
-- Revoke (answer 7): pull drafts that are not posted, keep what is already published.
create or replace function public.studio_audio_revoke_internal(p_consent uuid, p_by text, p_mode text default 'revoke') returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.studio_voice_consents; n_jobs int := 0; n_items int := 0; n_posts int := 0; it record;
begin
  select * into c from public.studio_voice_consents where id = p_consent for update;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'no_such_consent'); end if;
  if c.revoked_at is null then
    update public.studio_voice_consents set revoked_at = now(), revoked_by = p_by where id = p_consent;
  end if;
  -- clone off (only the off direction is allowed on this path)
  perform set_config('studio_audio.mode', p_mode, true);
  update public.studio_audio_features set enabled = false, updated_by = p_by, note = 'consent turned off by ' || p_by
   where owner_slug = c.owner_slug and feature = 'clone' and enabled;
  perform set_config('studio_audio.mode', '', true);
  -- jobs that were waiting on this consent
  update public.studio_audio_jobs set status = 'failed', error = 'consent revoked'
   where consent_id = p_consent and status in ('quoted', 'confirmed', 'held', 'running');
  get diagnostics n_jobs = row_count;
  -- unposted items that carry her voice: blocked now, and pulled back from the client if they were with her
  for it in select i.id, i.stage from public.approval_items i
             where i.posted_at is null
               and exists (select 1 from jsonb_array_elements(coalesce(i.provenance->'ai_audio', '[]'::jsonb)) e where e->>'consent_id' = p_consent::text)
  loop
    n_items := n_items + 1;
    update public.approval_items set provenance = coalesce(provenance, '{}'::jsonb) || jsonb_build_object(
        'publish_block', true, 'consent_revoked', true,
        'licensing', 'The voice owner turned off consent on ' || to_char(now() at time zone 'America/Los_Angeles', 'FMMon FMDD, YYYY') || '. This draft uses her voice and cannot be posted.')
     where id = it.id;
    if it.stage = 'client' then
      begin
        perform set_config('studio.client_pullback', it.id::text, true);
        update public.approval_items set stage = 'internal', status = 'pending', decided_at = null, internal_status = 'changes' where id = it.id;
        perform set_config('studio.client_pullback', '', true);
        insert into public.approval_item_events (item_id, kind, actor_kind, payload)
        values (it.id, 'unpromoted', 'system', jsonb_build_object('why', 'voice consent turned off', 'by', p_by, 'from', 'client', 'to', 'internal'));
      exception when others then
        perform set_config('studio.client_pullback', '', true);
      end;
    end if;
    with u as (update public.social_posts set status = 'canceled', error = 'voice consent turned off'
                where approval_item_id = it.id and status in ('queued', 'held', 'in_drafts') returning 1)
    select n_posts + count(*) into n_posts from u;
  end loop;
  perform public.studio_audio_log_add(c.owner_slug, 'clone', 'consent_revoked', p_by,
    jsonb_build_object('consent', p_consent, 'person', c.person_name, 'jobs_failed', n_jobs, 'items_blocked', n_items, 'posts_canceled', n_posts,
                       'voice_id', c.voice_id, 'delete_voice_from_elevenlabs', c.voice_id is not null));
  if c.voice_id is not null then
    perform public.studio_audio_alert('voice-delete:' || p_consent::text, 'Voice to remove from ElevenLabs',
      c.person_name || ' turned off consent. Spark deletes the cloned voice from ElevenLabs within the hour; only a new signed addendum and a new clone brings it back.', false);
  end if;
  return jsonb_build_object('ok', true, 'jobs_failed', n_jobs, 'items_blocked', n_items, 'posts_canceled', n_posts);
end $$;

create or replace function public.studio_voice_consent_prepare(p_token text, p_owner text, p_person text, p_voice_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.studio_audio_is_jared(p_token) then return jsonb_build_object('ok', false, 'error', 'jared_only', 'text', 'Only Jared can prepare a consent addendum.'); end if;
  if coalesce(btrim(p_person), '') = '' then return jsonb_build_object('ok', false, 'error', 'person_required'); end if;
  if not exists (select 1 from public.approval_clients where slug = p_owner) then return jsonb_build_object('ok', false, 'error', 'no_such_owner'); end if;
  insert into public.studio_voice_consents (owner_slug, person_name, voice_id, addendum_path, prepared_by)
  values (p_owner, btrim(p_person), p_voice_id, 'docs/legal/voice-clone-consent-addendum.md', 'jared') returning id into v_id;
  perform public.studio_audio_log_add(p_owner, 'clone', 'consent_prepared', 'jared', jsonb_build_object('consent', v_id, 'person', p_person));
  return jsonb_build_object('ok', true, 'consent_id', v_id, 'text', 'Addendum prepared for ' || btrim(p_person) || '. Nothing was sent. Send it from LibreSign (cloud.bestly.tech), then record it here when it is signed.');
end $$;

create or replace function public.studio_voice_consent_sign(p_token text, p_consent uuid, p_request_id text default null, p_signed_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.studio_audio_is_jared(p_token) then return jsonb_build_object('ok', false, 'error', 'jared_only', 'text', 'Only Jared can record a signed consent.'); end if;
  update public.studio_voice_consents set signed_at = coalesce(p_signed_at, now()), libresign_request_id = coalesce(p_request_id, libresign_request_id)
   where id = p_consent and revoked_at is null and signed_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_signable'); end if;
  perform public.studio_audio_log_add((select owner_slug from public.studio_voice_consents where id = p_consent), 'clone', 'consent_signed', 'jared', jsonb_build_object('consent', p_consent, 'request', p_request_id));
  return jsonb_build_object('ok', true, 'text', 'Recorded as signed. The voice-cloning switch is still off; flip it when you are ready.');
end $$;

create or replace function public.studio_voice_consent_revoke(p_token text, p_consent uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.studio_audio_is_jared(p_token) then return jsonb_build_object('ok', false, 'error', 'jared_only', 'text', 'Only Jared can revoke a consent from Studio. The voice owner can turn it off on her board.'); end if;
  return public.studio_audio_revoke_internal(p_consent, 'jared', 'revoke');
end $$;

-- board token: the person can turn her own voice OFF, any time, never on
create or replace function public.client_voice_off(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.approval_caller; k record; r jsonb; n int := 0; v_items int := 0; v_jobs int := 0;
begin
  c := public.approval_resolve_client(p_token);
  if public.client_viewer(p_token) is not null then
    return jsonb_build_object('ok', false, 'error', 'view_only', 'message', 'You are viewing as the client. Nothing here is saved as them.');
  end if;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  for k in select id from public.studio_voice_consents where owner_slug = c.slug and revoked_at is null loop
    r := public.studio_audio_revoke_internal(k.id, 'client:' || c.slug, 'client_off');
    n := n + 1; v_items := v_items + coalesce((r->>'items_blocked')::int, 0); v_jobs := v_jobs + coalesce((r->>'jobs_failed')::int, 0);
  end loop;
  perform set_config('studio_audio.mode', 'client_off', true);
  update public.studio_audio_features set enabled = false, updated_by = 'client:' || c.slug, note = 'turned off by the client'
   where owner_slug = c.slug and feature = 'clone' and enabled;
  perform set_config('studio_audio.mode', '', true);
  if n > 0 then
    perform public.studio_audio_alert('client-voice-off:' || c.slug || ':' || to_char(now(), 'YYYYMMDDHH24MI'),
      c.name || ' turned her voice off', 'Her voice is off. ' || v_items || ' unposted draft(s) using it were pulled; anything already posted stays up. Nothing to do.', false);
  end if;
  return jsonb_build_object('ok', true, 'consents_off', n, 'drafts_pulled', v_items,
    'message', case when n > 0 then 'Your voice is off. Drafts using it that were not posted yet have been pulled. Anything already posted stays up.' else 'Your voice was not on.' end);
end $$;

create or replace function public.client_audio_card(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.approval_caller; k public.studio_voice_consents; v_state text := 'none'; v_feat jsonb;
begin
  c := public.approval_resolve_client(p_token);
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into k from public.studio_voice_consents where owner_slug = c.slug order by (signed_at is not null and revoked_at is null) desc, created_at desc limit 1;
  v_state := case when k.id is null then 'none' when k.revoked_at is not null then 'off' when k.signed_at is null then 'prepared' else 'on' end;
  select coalesce(jsonb_object_agg(feature, enabled), '{}') into v_feat from public.studio_audio_features where owner_slug = c.slug;
  return jsonb_build_object('ok', true, 'features', v_feat,
    'voice', jsonb_build_object('state', v_state, 'person', k.person_name, 'signed_at', k.signed_at, 'revoked_at', k.revoked_at),
    'text', case v_state
      when 'none' then 'Bestly has not made a copy of your voice. Nothing uses it.'
      when 'prepared' then 'A consent form is ready for you to sign. Until you sign it, nothing uses your voice.'
      when 'on' then 'Your voice is on. Bestly uses it only in posts you approve. You can turn it off any time.'
      else 'Your voice is off. To turn it back on, ask Bestly to send the consent form.' end);
end $$;

-- ── the Studio panel (staff token; Eli reads, only Jared changes) ────────────────────────────
create or replace function public.studio_audio_features_get(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.studio_caller; st public.studio_audio_settings; v_cr jsonb; v_rows jsonb; v_month jsonb; v_music boolean;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into st from public.studio_audio_settings where id;
  v_cr := st.credits;
  select coalesce(jsonb_agg(o order by o->>'kind', o->>'slug'), '[]') into v_rows from (
    select jsonb_build_object('slug', x.owner_slug, 'name', coalesce(c.name, x.owner_slug), 'kind', coalesce(c.kind, 'app'), 'sandbox', coalesce(c.sandbox, false),
      'features', (select jsonb_object_agg(f.feature, jsonb_build_object('enabled', f.enabled, 'by', f.updated_by, 'at', f.updated_at, 'note', f.note))
                     from public.studio_audio_features f where f.owner_slug = x.owner_slug),
      'voice', (select jsonb_build_object('state', case when k.revoked_at is not null then 'off' when k.signed_at is null then 'prepared' else 'on' end,
                  'consent_id', k.id, 'person', k.person_name, 'signed_at', k.signed_at, 'revoked_at', k.revoked_at, 'revoked_by', k.revoked_by)
                  from public.studio_voice_consents k where k.owner_slug = x.owner_slug
                  order by (k.signed_at is not null and k.revoked_at is null) desc, k.created_at desc limit 1)) o
      from (select distinct owner_slug from public.studio_audio_features) x left join public.approval_clients c on c.slug = x.owner_slug
     where c.slug is null or public.staff_may_see_slug(s.id, c.slug)) q;
  select coalesce(jsonb_agg(jsonb_build_object('owner', owner_slug, 'kind', kind, 'jobs', jobs, 'credits', credits, 'cost_usd', cost_usd, 'billed_usd', billed_usd)), '[]')
    into v_month from public.studio_audio_billing where month = date_trunc('month', now() at time zone 'America/Los_Angeles')::date;
  return jsonb_build_object('ok', true, 'is_jared', s.id = st.jared_staff, 'viewer', s.name,
    'credits', jsonb_build_object('limit', v_cr->'limit', 'used', v_cr->'used', 'remaining', v_cr->'remaining', 'reset_unix', v_cr->'reset_unix', 'as_of', v_cr->'as_of',
       'tier', v_cr->'tier', 'overage_ok', v_cr->'overage_ok',
       'pct_left', case when coalesce((v_cr->>'limit')::numeric, 0) > 0 then round(100.0 * (v_cr->>'remaining')::numeric / (v_cr->>'limit')::numeric) end,
       'reserve_pct', public.studio_audio_reserve_pct()),
    'markup_pct', st.markup_pct, 'music_commercial_ok', st.music_commercial_ok, 'owners', v_rows, 'month', v_month);
end $$;

create or replace function public.studio_audio_set_feature(p_token text, p_owner text, p_feature text, p_enabled boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.studio_caller; v_jared uuid; v_name text;
begin
  s := public.studio_resolve_staff(p_token);
  select jared_staff into v_jared from public.studio_audio_settings where id;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if s.id <> v_jared then
    return jsonb_build_object('ok', false, 'error', 'jared_only', 'text', 'Only Jared can change these switches. You can see them, not flip them.');
  end if;
  if not exists (select 1 from public.studio_audio_features where owner_slug = p_owner and feature = p_feature) then
    return jsonb_build_object('ok', false, 'error', 'no_such_switch');
  end if;
  perform set_config('studio_audio.mode', 'jared', true);
  perform set_config('studio_audio.actor', s.id::text, true);
  begin
    update public.studio_audio_features set enabled = coalesce(p_enabled, false), updated_by = s.name, note = coalesce(p_note, note)
     where owner_slug = p_owner and feature = p_feature;
  exception when check_violation then
    perform set_config('studio_audio.mode', '', true); perform set_config('studio_audio.actor', '', true);
    return jsonb_build_object('ok', false, 'error', split_part(sqlerrm, ':', 1),
      'text', case when sqlerrm like 'clone_needs_consent%' then 'Voice cloning stays locked until a signed consent addendum is on file.' else sqlerrm end);
  end;
  perform set_config('studio_audio.mode', '', true); perform set_config('studio_audio.actor', '', true);
  perform public.studio_audio_log_add(p_owner, p_feature, case when p_enabled then 'on' else 'off' end, s.name, '{}');
  return jsonb_build_object('ok', true, 'owner', p_owner, 'feature', p_feature, 'enabled', coalesce(p_enabled, false));
end $$;

-- Jared confirms the ElevenLabs music licence covers Bestly's posts (Pro tier says "individual use only"; he decides)
create or replace function public.studio_audio_set_music_ok(p_token text, p_ok boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.studio_audio_is_jared(p_token) then return jsonb_build_object('ok', false, 'error', 'jared_only'); end if;
  update public.studio_audio_settings set music_commercial_ok = coalesce(p_ok, false), updated_at = now() where id;
  perform public.studio_audio_log_add(null, 'music', case when p_ok then 'music_licence_confirmed' else 'music_licence_unconfirmed' end, 'jared', '{}');
  return jsonb_build_object('ok', true, 'music_commercial_ok', coalesce(p_ok, false));
end $$;

-- ── posting: consent, per-post approval, AI label ────────────────────────────────────────────
-- null = fine. Used by the stage gate (promotion) and by the posting gates.
create or replace function public.studio_audio_consent_block(p_item uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare it public.approval_items; e jsonb; c public.studio_voice_consents;
begin
  select * into it from public.approval_items where id = p_item;
  if it.id is null then return null; end if;
  for e in select * from jsonb_array_elements(coalesce(it.provenance->'ai_audio', '[]'::jsonb)) loop
    if nullif(e->>'consent_id', '') is null then continue; end if;
    select * into c from public.studio_voice_consents where id = (e->>'consent_id')::uuid;
    if c.id is null or c.signed_at is null or c.revoked_at is not null then
      return 'The voice owner turned off consent for the voice in this post, so it cannot go out.';
    end if;
  end loop;
  return null;
end $$;

create or replace function public.studio_audio_post_gate(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare it public.approval_items; v_block text; e jsonb; v_needs boolean := false;
begin
  select * into it from public.approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', true); end if;
  v_block := public.studio_audio_consent_block(p_item);
  if v_block is not null then return jsonb_build_object('ok', false, 'error', 'voice_consent_off', 'detail', v_block); end if;
  for e in select * from jsonb_array_elements(coalesce(it.provenance->'ai_audio', '[]'::jsonb)) loop
    if nullif(e->>'consent_id', '') is not null then v_needs := true; end if;
  end loop;
  if v_needs and not exists (select 1 from public.approval_reviews r where r.item_id = p_item and r.reviewer_kind = 'client'
                              and r.decision = 'approved' and r.content_version = it.content_version) then
    return jsonb_build_object('ok', false, 'error', 'voice_owner_must_approve',
      'detail', 'This post uses a person''s cloned voice, so she has to approve this exact version before it can post.');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(it.provenance->'ai_audio', '[]'::jsonb)) x where x->>'feature' = 'music')
     and not (select music_commercial_ok from public.studio_audio_settings where id) then
    return jsonb_build_object('ok', false, 'error', 'music_licence_unconfirmed',
      'detail', 'This post has AI music. It waits until Jared confirms the ElevenLabs music licence covers it.');
  end if;
  return jsonb_build_object('ok', true, 'ai_audio', jsonb_array_length(coalesce(it.provenance->'ai_audio', '[]'::jsonb)) > 0);
end $$;

-- stage gate: keep everything, add the consent check on promotion
create or replace function public.trg_items_stage_gate() returns trigger
language plpgsql set search_path to 'public' as $function$
declare v_staff uuid; v_miss text[]; v_audio text;
begin
  if new.stage is not distinct from old.stage then return new; end if;

  if old.stage = 'client' and new.stage = 'internal'
     and nullif(current_setting('studio.client_pullback', true), '') = new.id::text then
    return new;                       -- approval_review logs this one itself
  end if;

  v_staff := nullif(current_setting('studio.staff_id', true), '')::uuid;
  if v_staff is null then
    raise exception 'stage change requires a staff session' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.approval_staff where id = v_staff and active and can_promote) then
    raise exception 'staff % may not change stage', v_staff using errcode = 'check_violation';
  end if;
  if new.stage = 'client' then
    v_audio := public.studio_audio_consent_block(new.id);
    if v_audio is not null then
      raise exception 'voice consent - %', v_audio using errcode = 'check_violation',
        hint = 'Take the cloned voice out of the post, or ask the voice owner for a new signed consent.';
    end if;
    v_miss := public.post_sells_product(new.id);
    if array_length(v_miss, 1) > 0 then
      raise exception 'house rule - every post sells the deck: %', array_to_string(v_miss, '; ')
        using errcode = 'check_violation', hint = 'Add a line that points at the deck (centeringyou.com) and send it again.';
    end if;
  end if;
  insert into public.approval_item_events (item_id, kind, actor_kind, staff_id, payload)
  values (new.id, 'promoted', 'staff', v_staff,
          jsonb_build_object('from', old.stage, 'to', new.stage, 'content_version', new.content_version));
  return new;
end $function$;

-- manual Post button gate: same checks
create or replace function public.studio_posting_gate(p_item uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare it approval_items%rowtype; sg jsonb; cv int; ag jsonb;
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  if it.posted_at is not null then return jsonb_build_object('ok', false, 'error', 'already_posted'); end if;
  if it.stage <> 'client' then return jsonb_build_object('ok', false, 'error', 'not_with_client'); end if;
  if it.status <> 'approved' then return jsonb_build_object('ok', false, 'error', 'not_approved_by_client'); end if;
  select max(r.content_version) into cv from approval_reviews r where r.item_id = it.id and r.reviewer_kind = 'client' and r.decision = 'approved';
  if cv is not null and cv < it.content_version then return jsonb_build_object('ok', false, 'error', 'client_saw_older_version'); end if;
  sg := public.studio_signoff(it.id);
  if coalesce(sg->>'state', 'pending') <> 'approved' then return jsonb_build_object('ok', false, 'error', 'team_not_signed_off'); end if;
  ag := public.studio_audio_post_gate(it.id);
  if not coalesce((ag->>'ok')::boolean, true) then return ag; end if;
  return jsonb_build_object('ok', true, 'ai_audio', coalesce((ag->>'ai_audio')::boolean, false));
end $function$;

-- both enqueue overloads: the audio gate comes first and p_force cannot skip it
create or replace function public.social_enqueue_item(p_item uuid, p_at timestamp with time zone, p_actor text, p_force boolean DEFAULT false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  it approval_items%rowtype; c approval_clients%rowtype; a social_accounts%rowtype;
  v_urls text[]; v_cap text; v_tags text[]; v_id uuid; v_n int; v_audio jsonb;
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_audio := public.studio_audio_post_gate(p_item);
  if not coalesce((v_audio->>'ok')::boolean, true) then return v_audio; end if;
  select * into c from approval_clients where id = it.client_id;
  if c.publish_mode = 'off' then return jsonb_build_object('ok', false, 'error', 'publishing_off'); end if;
  if c.social_brand is null then return jsonb_build_object('ok', false, 'error', 'instagram_not_connected'); end if;
  if not p_force and not public.claim_gate_ready(c.slug) then
    return jsonb_build_object('ok', false, 'error', 'claim_gate_not_set_up',
      'detail', 'This client has no claim rules of its own and nobody has confirmed house rules are enough.'); end if;
  select * into a from social_accounts where brand = c.social_brand and platform = 'instagram';
  if a.id is null or a.access_token is null or a.remote_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'instagram_not_connected'); end if;
  if not p_force and not (it.stage = 'client' and it.status = 'approved') then
    return jsonb_build_object('ok', false, 'error', 'not_approved',
      'detail', 'Only work the client has approved can be posted.'); end if;
  if coalesce((it.provenance->>'publish_block')::boolean, false) and not p_force then
    return jsonb_build_object('ok', false, 'error', 'publish_blocked',
      'detail', coalesce(it.provenance->>'licensing', 'This item is marked not for publication.')); end if;
  if exists (select 1 from social_posts where approval_item_id = p_item and status in ('queued','posting','posted','held')) then
    return jsonb_build_object('ok', false, 'error', 'already_queued'); end if;

  select array_agg(media_url order by position) into v_urls from approval_slides where item_id = p_item and media_url is not null;
  if v_urls is null then v_urls := array[it.media_url]; end if;
  v_n := coalesce(array_length(v_urls,1),0);
  if v_n = 0 or v_urls[1] is null then return jsonb_build_object('ok', false, 'error', 'no_media'); end if;
  if v_n > 10 then return jsonb_build_object('ok', false, 'error', 'too_many_slides',
      'detail', format('Instagram takes at most 10 slides; this has %s.', v_n)); end if;
  if it.media_type = 'video' then return jsonb_build_object('ok', false, 'error', 'video_not_supported_yet'); end if;

  select caption, hashtags into v_cap, v_tags from approval_variants
   where item_id = p_item and platform = 'instagram' order by created_at desc limit 1;
  v_cap := coalesce(v_cap, it.caption, '');
  if v_tags is not null and array_length(v_tags,1) > 0 then
    v_cap := v_cap || E'\n\n' || array_to_string(v_tags, ' ');
  end if;

  insert into social_posts (brand, platform, media_url, media_urls, media_type, caption, scheduled_at, approval_item_id)
  values (c.social_brand, 'instagram', v_urls[1], case when v_n > 1 then v_urls end,
          case when v_n > 1 then 'carousel' else 'image' end, left(v_cap, 2200), coalesce(p_at, now()), p_item)
  returning id into v_id;
  insert into approval_item_events (item_id, kind, actor_kind, payload)
  values (p_item, 'scheduled', case when p_actor = 'client' then 'client' else 'system' end, jsonb_build_object('instagram_post', v_id, 'at', coalesce(p_at, now()), 'by', p_actor, 'forced', p_force));
  return jsonb_build_object('ok', true, 'post', v_id, 'scheduled_at', coalesce(p_at, now()), 'slides', v_n, 'handle', a.handle);
end $function$;

create or replace function public.social_enqueue_item(p_item uuid, p_at timestamp with time zone, p_actor text, p_force boolean DEFAULT false, p_platform text DEFAULT 'instagram'::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  it approval_items%rowtype; c approval_clients%rowtype; a social_accounts%rowtype;
  v_urls text[]; v_cap text; v_tags text[]; v_id uuid; v_n int; v_type text; v_cover text; v_audio jsonb;
begin
  select * into it from approval_items where id = p_item;
  if it.id is null then return jsonb_build_object('ok', false, 'error', 'no_item'); end if;
  v_audio := public.studio_audio_post_gate(p_item);
  if not coalesce((v_audio->>'ok')::boolean, true) then return v_audio; end if;
  select * into c from approval_clients where id = it.client_id;
  if p_platform not in ('instagram','tiktok') then return jsonb_build_object('ok', false, 'error', 'platform_not_ready', 'detail', p_platform || ' posting comes in the next phase.'); end if;
  if c.publish_mode = 'off' then return jsonb_build_object('ok', false, 'error', 'publishing_off'); end if;
  if c.social_brand is null then return jsonb_build_object('ok', false, 'error', p_platform || '_not_connected'); end if;
  if not p_force and not public.claim_gate_ready(c.slug) then
    return jsonb_build_object('ok', false, 'error', 'claim_gate_not_set_up',
      'detail', 'This client has no claim rules of its own and nobody has confirmed house rules are enough.'); end if;
  select * into a from social_accounts where brand = c.social_brand and platform = p_platform;
  if a.id is null or a.access_token is null or a.remote_user_id is null then
    return jsonb_build_object('ok', false, 'error', p_platform || '_not_connected'); end if;
  if not coalesce(a.active, false) then return jsonb_build_object('ok', false, 'error', p_platform || '_needs_reconnect'); end if;
  if not p_force and not (it.stage = 'client' and it.status = 'approved') then
    return jsonb_build_object('ok', false, 'error', 'not_approved', 'detail', 'Only work the client has approved can be posted.'); end if;
  if coalesce((it.provenance->>'publish_block')::boolean, false) and not p_force then
    return jsonb_build_object('ok', false, 'error', 'publish_blocked',
      'detail', coalesce(it.provenance->>'licensing', 'This item is marked not for publication.')); end if;
  if exists (select 1 from social_posts where approval_item_id = p_item and platform = p_platform and status in ('queued','posting','posted','held','in_drafts')) then
    return jsonb_build_object('ok', false, 'error', 'already_queued'); end if;
  if it.media_type = 'video' then
    if it.media_url is null then return jsonb_build_object('ok', false, 'error', 'no_media'); end if;
    v_urls := array[it.media_url]; v_n := 1; v_type := 'video'; v_cover := it.thumb_url;
  else
    if p_platform = 'tiktok' then return jsonb_build_object('ok', false, 'error', 'tiktok_video_only', 'detail', 'TikTok takes video only.'); end if;
    select array_agg(media_url order by position) into v_urls from approval_slides where item_id = p_item and media_url is not null;
    if v_urls is null then v_urls := array[it.media_url]; end if;
    v_n := coalesce(array_length(v_urls,1),0);
    if v_n = 0 or v_urls[1] is null then return jsonb_build_object('ok', false, 'error', 'no_media'); end if;
    if v_n > 10 then return jsonb_build_object('ok', false, 'error', 'too_many_slides', 'detail', format('Instagram takes at most 10 slides; this has %s.', v_n)); end if;
    v_type := case when v_n > 1 then 'carousel' else 'image' end;
  end if;
  select caption, hashtags into v_cap, v_tags from approval_variants where item_id = p_item and platform = p_platform order by created_at desc limit 1;
  if v_cap is null and p_platform = 'tiktok' then
    select caption, hashtags into v_cap, v_tags from approval_variants where item_id = p_item and platform = 'instagram' order by created_at desc limit 1;
  end if;
  v_cap := coalesce(v_cap, it.caption, '');
  if v_tags is not null and array_length(v_tags,1) > 0 then v_cap := v_cap || E'\n\n' || array_to_string(v_tags, ' '); end if;
  insert into social_posts (brand, platform, media_url, media_urls, media_type, cover_url, caption, scheduled_at, approval_item_id, content_version)
  values (c.social_brand, p_platform, v_urls[1], case when v_n > 1 then v_urls end, v_type, v_cover, left(v_cap, 2200), coalesce(p_at, now()), p_item, it.content_version)
  returning id into v_id;
  insert into approval_item_events (item_id, kind, actor_kind, payload)
  values (p_item, 'scheduled', case when p_actor = 'client' then 'client' else 'system' end,
          jsonb_build_object('social_post', v_id, 'platform', p_platform, 'at', coalesce(p_at, now()), 'by', p_actor, 'forced', p_force));
  return jsonb_build_object('ok', true, 'post', v_id, 'platform', p_platform, 'scheduled_at', coalesce(p_at, now()), 'slides', v_n, 'media_type', v_type, 'handle', a.handle);
end $function$;

-- ── who may call what ────────────────────────────────────────────────────────────────────────
do $grants$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p where p.pronamespace = 'public'::regnamespace
            and (p.proname like 'studio_audio_%' or p.proname like 'studio_voice_consent_%' or p.proname in ('client_voice_off', 'client_audio_card', 'trg_studio_audio_features_gate', 'trg_studio_audio_jobs_gate', 'trg_approval_clients_audio_seed'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.f);
    execute format('grant execute on function %s to service_role', r.f);
  end loop;
end $grants$;
-- token doors: the browser calls these with the publishable key; the token is the authority
grant execute on function public.studio_audio_features_get(text) to anon, authenticated;
grant execute on function public.studio_audio_set_feature(text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.studio_audio_set_music_ok(text, boolean) to anon, authenticated;
grant execute on function public.studio_voice_consent_prepare(text, text, text, text) to anon, authenticated;
grant execute on function public.studio_voice_consent_sign(text, uuid, text, timestamptz) to anon, authenticated;
grant execute on function public.studio_voice_consent_revoke(text, uuid) to anon, authenticated;
grant execute on function public.client_voice_off(text) to anon, authenticated;
grant execute on function public.client_audio_card(text) to anon, authenticated;
insert into public.security_public_rpcs (fn, why) values
  ('studio_audio_features_get', 'Studio staff token door: reads the audio switches and credits (token is the authority)'),
  ('studio_audio_set_feature', 'Studio staff token door: Jared-only switch flip, checked inside'),
  ('studio_audio_set_music_ok', 'Studio staff token door: Jared-only music licence confirmation, checked inside'),
  ('studio_voice_consent_prepare', 'Studio staff token door: Jared-only, drafts a consent row (sends nothing)'),
  ('studio_voice_consent_sign', 'Studio staff token door: Jared-only, records a signed consent'),
  ('studio_voice_consent_revoke', 'Studio staff token door: Jared-only revoke'),
  ('client_voice_off', 'Client board token door: the voice owner can turn her own voice off'),
  ('client_audio_card', 'Client board token door: her Your voice card')
on conflict (fn) do nothing;

-- Allow write-once uploads of normalized (yuv420p / tv-range / bt709) videos and their thumbs:
--   video/<client>/<name>.<sha10>.(mp4|jpg)
-- Hash in the name keeps it write-once and cache-safe. Every earlier rule and the write-once check are unchanged.
create or replace function public.studio_ship_sign_upload(p_path text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'vault'
as $function$
declare v_key text; v_req bigint;
begin
  -- write-once paths only: hashed app files, the ship tool, client RULES.md copies, versioned carousel slides,
  -- reference-video copies for asks (refs/<ask uuid>/<name>.<sha10>.mp4|jpg — watched on her board, never posted),
  -- and normalized video re-encodes (video/<client>/<name>.<sha10>.mp4|jpg)
  if p_path !~ '^app/[a-z0-9-]+(\.[a-z0-9-]+)*\.[0-9a-f]{10}\.(html|js|css|json|webmanifest)$'
     and p_path !~ '^tools/[a-z0-9-]+\.[0-9a-f]{10}\.js$'
     and p_path !~ '^brand/[a-z0-9-]+/RULES\.[0-9a-f]{10}\.md$'
     and p_path !~ '^carousel/[a-z0-9-]+/v[0-9]+/[0-9]{2}\.jpg$'
     and p_path !~ '^refs/[0-9a-f-]{36}/[a-z0-9-]+\.[0-9a-f]{10}\.(mp4|jpg)$'
     and p_path !~ '^video/[a-z0-9-]+/[a-z0-9-]+\.[0-9a-f]{10}\.(mp4|jpg)$' then
    raise exception 'studio_ship_sign_upload: path not allowed %', p_path;
  end if;
  if exists (select 1 from storage.objects where bucket_id='review' and name=p_path) then
    raise exception 'studio_ship_sign_upload: % already exists (write-once; bump the version folder)', p_path;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='service_role_key' limit 1;
  if v_key is null then raise exception 'service_role_key missing from vault'; end if;
  select net.http_post(
    url := 'https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/upload/sign/review/'||p_path,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
    timeout_milliseconds := 15000) into v_req;
  return v_req;
end $function$;

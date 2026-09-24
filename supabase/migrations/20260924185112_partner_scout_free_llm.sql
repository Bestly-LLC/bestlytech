-- Eli's Scout answers on the free-LLM chain (groq -> Cloudflare -> the Mac mini), the same
-- _shared/free-llm.ts ladder the admin Scout uses, with paid never reached.
--
-- The cloud answerer cannot call partner_ai_claim(): that heartbeats partner_ai_status.seen_at,
-- which is exactly the signal free-llm's "local" rung reads to decide the Mac mini is alive.
-- Faking it would send every local-rung job into a 45s timeout. So these two wrappers borrow the
-- worker key from the Vault, and the claim restores the Mac's own heartbeat afterwards.
-- (20260924185521 supersedes the claim wrapper: the two callers now share partner_ai_claim_core.)

create or replace function public.partner_ai_claim_cloud()
returns jsonb language plpgsql security definer set search_path to 'public', 'vault'
as $$
declare v_seen timestamptz; v_model text; k text; r jsonb;
begin
  select seen_at, model into v_seen, v_model from public.partner_ai_status where id = 1;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'partner_ai_worker_key' limit 1;
  if k is null then raise exception 'partner_ai_worker_key missing from the vault'; end if;
  r := public.partner_ai_claim(k, null);
  update public.partner_ai_status set seen_at = v_seen, model = v_model where id = 1;
  return r;
end $$;

create or replace function public.partner_ai_write_cloud(
  p_reply_id uuid, p_content text, p_done boolean default false, p_error text default null)
returns void language plpgsql security definer set search_path to 'public', 'vault'
as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'partner_ai_worker_key' limit 1;
  if k is null then raise exception 'partner_ai_worker_key missing from the vault'; end if;
  perform public.partner_ai_write(k, p_reply_id, p_content, p_done, p_error);
end $$;

revoke all on function public.partner_ai_claim_cloud() from public, anon, authenticated;
revoke all on function public.partner_ai_write_cloud(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.partner_ai_claim_cloud() to service_role;
grant execute on function public.partner_ai_write_cloud(uuid, text, boolean, text) to service_role;

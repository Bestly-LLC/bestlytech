-- Bestly Agent (house client, code BA) posts to @bestly_llc like Bestly Cloud. Spark, 2026-10-12.
insert into public.approval_client_accounts (client_id, account_id, note)
select c.id, '7a877712-c503-418a-aaf4-a81697c70af2', 'Bestly Agent posts to @bestly_llc (Jared 2026-10-12)'
from public.approval_clients c where c.slug = 'bestly-agent'
on conflict do nothing;

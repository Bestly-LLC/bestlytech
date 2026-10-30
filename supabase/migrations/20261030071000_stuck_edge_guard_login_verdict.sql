-- Command Center: Edge Guard's card said "The error does not say what to do. Scout can look into it." for 23 hrs while
-- every "Have Scout fix it" tap failed. The real cause (edge_guard_log): "Cloudflare refused the login (401)" — the wrangler
-- OAuth sign-in on the Mac mini ran out, which only a person can renew (Cloudflare's Allow page). Give the card that verdict
-- and the one paste-ready line, so it stops sending Scout at something Scout cannot do.
-- stuck_items_core() merges this verdict into the card's "fix" as-is, so "command" / "command_note" reach the page.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.stuck_classify(text,text)'::regprocedure);
  if d like '%cloudflare_login%' then return; end if;
  d := replace(d, $a$lnk text := '/admin/settings';$a$, $a$lnk text := '/admin/settings';$a$);
  d := replace(d, $a$  if l ~ '\m(401|403)\M'$a$, $a$  if coalesce(p_slug, '') = 'edge-guard'
     and l ~ 'cloudflare access broken|wrangler is logged out|lost my cloudflare login|cloudflare refused the login|no wrangler login' then
    return jsonb_build_object('kind', 'auth', 'service', 'cloudflare_login', 'service_name', 'Cloudflare',
      'label', 'Edge Guard''s Cloudflare sign-in ran out',
      'tail', 'The sites are up. Edge Guard just can''t switch on the outage page until it signs in again.',
      'link', '/admin/settings', 'link_label', null,
      'command', 'cd ~/bestly-agents/edge-guard && npx wrangler login',
      'command_note', 'Run this once in Terminal on the Mac mini (jareds-mac-mini-2), then tap Allow on the Cloudflare page it opens. Edge Guard picks it up within a minute.');
  end if;

  if l ~ '\m(401|403)\M'$a$);
  if d not like '%cloudflare_login%' then raise exception 'stuck_classify patch did not apply'; end if;
  execute d;
end $$;

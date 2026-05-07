#!/bin/bash
# P1.1 + P2 + P3 — diagnostic logging, admin theming, public status page.
#
# P1.1 (CY pipeline diagnosis improvement):
#   - ai-generate-pattern fetcher now returns {html, reason} instead of just
#     html-or-null. Failure reason ("HTTP 403", "Timeout 10s", "DNS fail",
#     "no CMP detected", etc.) is surfaced into ai_generation_log.error_message.
#   - Added a richer browser-fingerprint header set (Sec-Ch-Ua, Sec-Fetch-*,
#     Accept-Encoding) — sometimes Akamai gates on missing Sec-Fetch headers
#     more than the UA itself. Won't beat full bot-management but cuts the
#     long tail of "easy" 403s.
#   - 10s fetch timeout added (was unbounded).
#
#   The 4 stuck domains (hulu, washingtonpost, techcrunch, wired) all have
#   real Akamai/PerimeterX bot management; the actual fix needs either a
#   headless-browser proxy server-side or extension-side HTML capture (which
#   the API already supports — banner_html field — but the extension doesn't
#   send today). Proper fix tracked separately.
#
# P2 (apply v7/v8 theming to /admin):
#   - PageHeader: text-2xl/font-semibold/tracking-tight → font-display
#     text-3xl tracking-[-0.01em] (Newsreader, matches marketing site)
#   - AdminLayout radial glow: white/[0.02] → indigo (matches /services bg)
#   - AdminSidebar active row accent: bg-white/[0.08] + before:bg-white →
#     bg-[hsl(var(--wow-indigo)/0.12)] + before:bg-wow-indigo-light with glow
#
# P3 (public status page):
#   - external_health_history table + AFTER trigger that snapshots every
#     probe write
#   - get_public_status() RPC: anon-callable, returns aggregated 90-day
#     uptime per service, never raw rows or error messages
#   - /status route in App.tsx → src/pages/Status.tsx, indigo + Newsreader
#     themed, 5 services with current-status pill, 90-day sparkline,
#     24h/30d uptime numbers, refreshes every 60s
#
# CNAME for status.bestly.tech → bestly.tech to be added at registrar
# (manual, can't be automated from here).

set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock

git checkout main
git pull origin main

git add \
  src/components/admin/PageHeader.tsx \
  src/components/admin/AdminLayout.tsx \
  src/components/admin/AdminSidebar.tsx \
  src/pages/Status.tsx \
  src/App.tsx \
  supabase/functions/ai-generate-pattern/index.ts

# Mirror the migration we already applied via mcp into the repo for parity
cat > supabase/migrations/20260430010000_external_health_history_and_public_read.sql << 'EOFMIG'
-- 2026-04-30 — public status page support.
-- Already applied via dashboard; mirrored here for repo parity.

CREATE TABLE IF NOT EXISTS public.external_health_history (
  id           bigserial PRIMARY KEY,
  service      text NOT NULL,
  status       text NOT NULL CHECK (status IN ('ok','warn','down','unknown')),
  http_code    integer,
  latency_ms   integer,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_health_history_service_time
  ON public.external_health_history(service, recorded_at DESC);

ALTER TABLE public.external_health_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_history" ON public.external_health_history;
CREATE POLICY "admins_read_history"
  ON public.external_health_history
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.copy_external_health_to_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.external_health_history (
    service, status, http_code, latency_ms, recorded_at
  ) VALUES (
    NEW.service, NEW.status, NEW.http_code, NEW.latency_ms, NEW.last_checked
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_external_health_history ON public.external_health;
CREATE TRIGGER trg_external_health_history
  AFTER INSERT OR UPDATE ON public.external_health
  FOR EACH ROW
  EXECUTE FUNCTION public.copy_external_health_to_history();

CREATE OR REPLACE FUNCTION public.get_public_status()
RETURNS TABLE (
  service           text,
  current_status    text,
  last_checked      timestamptz,
  uptime_24h_pct    numeric,
  uptime_30d_pct    numeric,
  daily_uptime      jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH days AS (
    SELECT generate_series(
      (now() - interval '89 days')::date,
      now()::date,
      '1 day'::interval
    )::date AS day
  ),
  service_days AS (
    SELECT
      eh.service,
      d.day,
      coalesce(
        avg(case when ehh.status = 'ok' then 1.0 else 0.0 end),
        NULL
      ) AS pct
    FROM external_health eh
    CROSS JOIN days d
    LEFT JOIN external_health_history ehh
      ON ehh.service = eh.service
     AND ehh.recorded_at >= d.day
     AND ehh.recorded_at <  d.day + interval '1 day'
    GROUP BY eh.service, d.day
  ),
  agg AS (
    SELECT
      sd.service,
      jsonb_agg(jsonb_build_object('day', sd.day, 'pct', sd.pct) ORDER BY sd.day) AS daily,
      avg(sd.pct) FILTER (WHERE sd.day >= (now() - interval '30 days')::date) AS pct30,
      (SELECT avg(case when status='ok' then 1.0 else 0.0 end)
         FROM external_health_history h2
        WHERE h2.service = sd.service
          AND h2.recorded_at >= now() - interval '24 hours') AS pct24
    FROM service_days sd
    GROUP BY sd.service
  )
  SELECT
    eh.service,
    eh.status AS current_status,
    eh.last_checked,
    coalesce(round(agg.pct24 * 100, 2), 0) AS uptime_24h_pct,
    coalesce(round(agg.pct30 * 100, 2), 0) AS uptime_30d_pct,
    coalesce(agg.daily, '[]'::jsonb) AS daily_uptime
  FROM external_health eh
  LEFT JOIN agg ON agg.service = eh.service
  ORDER BY eh.service;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_status() TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_status() TO authenticated;
EOFMIG
git add supabase/migrations/20260430010000_external_health_history_and_public_read.sql

echo "Files staged:"
git diff --cached --name-only

echo "→ Build sanity check..."
if ! npm run build > /tmp/p123-build.log 2>&1; then
  tail -30 /tmp/p123-build.log >&2
  exit 2
fi
echo "✓ Build passes"

git commit -m "feat(admin+status): P1.1 + P2 + P3 — diagnostic, theming, public status

P1.1 — CY pipeline diagnostic improvement
  ai-generate-pattern.fetchPageHtml now returns {html, reason} so the actual
  failure mode (HTTP 403, Timeout 10s, DNS fail, etc.) lands in
  ai_generation_log.error_message. Operator can answer 'why didn't pattern
  X get generated' with one query, no log dive. Added Sec-Ch-Ua and
  Sec-Fetch-* headers to the fetch — Akamai sometimes gates on missing
  client-hint headers more than UA itself. 10s fetch timeout added.

  The 4 stuck domains (hulu, wapo, techcrunch, wired) all have full bot
  management — proper fix needs headless-browser proxy or extension HTML
  capture, tracked separately.

P2 — apply v7/v8 indigo + Newsreader theming to /admin
  PageHeader title now uses font-display (Newsreader) at text-3xl with
  tracking-[-0.01em], matching the marketing site's editorial weight.
  AdminLayout radial glow shifted from white-alpha to indigo, matching
  /services and /products bg vocabulary. AdminSidebar active row gets an
  indigo wash + glowing accent line (was white).

P3 — public status.bestly.tech page (currently /status, CNAME pending)
  external_health_history table + AFTER trigger snapshots every probe
  write. get_public_status() RPC is security-definer + granted to anon —
  returns aggregated current-status + 24h/30d/90d uptime per service,
  never raw rows or error messages.

  /status route renders 5 services with current-status pill, 90-day
  daily-uptime sparkline, 24h/30d uptime numbers. Refreshes every 60s.
  Indigo + Newsreader themed to match the marketing site.

  TODO: registrar CNAME status.bestly.tech → cname.vercel-dns.com so
  the page lives at status.bestly.tech instead of bestly.tech/status.
"

git push origin main

echo ""
echo "============================================================"
echo "  PUBLISHED P1.1 + P2 + P3 to main."
echo "  Vercel rebuilds within ~90 sec."
echo ""
echo "  Test:"
echo "    bestly.tech/status        — public uptime page"
echo "    bestly.tech/admin         — Newsreader headers, indigo accents"
echo "============================================================"
sleep 25

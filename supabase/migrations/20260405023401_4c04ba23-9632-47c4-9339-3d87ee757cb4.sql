
CREATE TABLE public.home_hub_pihole_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  total_queries integer NOT NULL DEFAULT 0,
  queries_blocked integer NOT NULL DEFAULT 0,
  percent_blocked numeric(6,3) NOT NULL DEFAULT 0,
  domains_on_blocklist integer NOT NULL DEFAULT 0,
  active_clients integer NOT NULL DEFAULT 0,
  top_permitted jsonb,
  top_blocked jsonb,
  query_types jsonb,
  hourly_chart jsonb
);

CREATE INDEX idx_pihole_stats_captured_at_desc ON public.home_hub_pihole_stats (captured_at DESC);

ALTER TABLE public.home_hub_pihole_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_read_pihole_stats"
  ON public.home_hub_pihole_stats
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.prune_pihole_stats()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.home_hub_pihole_stats
  WHERE captured_at < now() - interval '25 hours';
  RETURN NEW;
END;
$$;

CREATE TRIGGER prune_pihole_stats_after_insert
  AFTER INSERT ON public.home_hub_pihole_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.prune_pihole_stats();

# Minute News Daily / Minute Tech Daily site watchers (Hestia)

Live copies: `/opt/bestly/cron/jobs/mnd_site_watch.py` and `mtd_site_watch.py` (also mirrored in `~/TrendLedger/{mnd,mtd}-site/` on the Mac mini, which is not a git repo).
Added to this repo 2026-10-31 with two fixes: the ads check reads `ad_audience_status` (hidden-until-1K is a pass), and a Vercel Security Checkpoint 403 counts as Vercel vetting the Pi's address, not an outage.

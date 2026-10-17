# Model Y Hunter on the Pi

Moves the Claude scheduled task "Used Model Y FSD Hunt" (`trig_01DAVaR3LQHduUdgj6SYuDkh`, left disabled as the fallback) to the Pi.
Free: stdlib Python plus the free AI ladder (`freellm`) only to read free-text listings. Daily at 7:57 AM PT (`57 7 * * *`).

## What it hunts
Used Tesla Model Y, Full Self-Driving **purchased** (not a subscription, trial, EAP, "FSD capable"), **HW4/AI4 only** (2024+ model year; 2023 only
when the listing itself says HW4/AI4; 2022 and older are HW3), at or under the max price (default $30,000), within about the radius
(default 100 mi straight line) of West Hollywood 90069. Numbers live in `model_y_settings` (`model_y_set` RPC, admin only).

## Sources (public, no login, one request at a time with a pause)
| Source | How | Status from the Pi |
|---|---|---|
| Find My Electric | public listings sitemap, then each Model Y detail page (has Autopilot Software / Hardware fields) | works |
| Craigslist | the search JSON the site's own page uses (LA, OC, Inland Empire, Ventura, San Diego), then the posting page | works |
| Tesla used inventory, CarGurus, Autotrader, Cars.com, Carvana, CarMax, TrueCar, Edmunds, eBay, Autolist, OfferUp, Facebook Marketplace | needs a browser, login or a challenge | **blocked, not worked around**; named in every run summary |

If you want those covered, the job has to run on the Mac mini with a logged-in browser. That is a separate decision.

## Grades
- **CONFIRMED**: the listing's own words say FSD was purchased / paid for / owned / included.
- **LIKELY**: the listing claims FSD (a field or a sentence) with no purchase wording. Verify with the seller before paying.
- Anything else is excluded. The free AI can only make a result stricter: its quote must appear verbatim in the listing.

## Output
New matches (and price drops on ones already told) go to the bell and the 7 PM recap as `success` (no push: a car listing is not one of the 4 kinds
of news that interrupt). Signed "Model Y Hunter:". Alert prefix `modely.`. The seen log is `model_y_seen` (60 days; price history kept).

## Install / test
    sh install.sh                                    # on the Pi
    python3 tools/model-y-hunt/test_model_y_hunt.py  # offline tests
    python3 -c "import sys; sys.path.insert(0,'/opt/bestly/cron'); from jobs.model_y_hunt import main; print(main(['--dry','--limit','5']))"   # read only: no log writes, no notification

## Undo
Switch it off with `select model_y_set(p_enabled => false)` (admin), or delete the `model_y_hunt` line with `crontab -e` (backup at
`/home/pi/scripts/crontab.bak-*-modely`), then re-enable the Claude task if wanted.

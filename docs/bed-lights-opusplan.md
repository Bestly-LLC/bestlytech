# Bed lights (Withings in-bed sensor → Home Assistant)

Status 2026-10-15: **sensor live.** `binary_sensor.bed_withings_sleep_in_bed` exists and
reported "on". The automation is `home-assistant/packages/bed_lights.yaml` (repo copy of the
Pi's `/mnt/ssd/apps/homeassistant/packages/bed_lights.yaml`).

How the sensor got there (Withings in-bed only works over a public HTTPS webhook):
- Withings developer app "Home Assistant", callback URLs `https://my.home-assistant.io/redirect/oauth/`
  and the same without the trailing slash (HA sends the no-slash form; Withings' Test button 301s on it).
- Cloudflare tunnel `bestly-nextcloud` route `ha.bestly.tech` -> `http://localhost:8123`.
- Cloudflare Access: app `ha.bestly.tech` = Allow "Only Jared"; app `ha.bestly.tech/api/webhook` = Bypass Everyone.
- HA external URL `https://ha.bestly.tech`.
- HA moved `http:` to `.storage/http` (`yaml_migration_done`), dropping `use_x_forwarded_for` and
  `trusted_proxies`; the YAML block is ignored and the Network page form failed to save the list, so both
  were written into `.storage/http` directly with HA stopped (backup `http.bak_proxy_<epoch>`).
  Without this every tunnel request is a 400.

## What Jared asked for

- Out of bed → lights on with the Adaptive Lighting setting (`switch.adaptive_lighting_home`).
- Back in bed → lights off.
- Out of bed between 8 PM and 1 AM → dim night light instead, off after 5 minutes.

## Unblock: get the in-bed sensor into HA

1. HA → Settings → Devices & services → Add integration → **Withings** → sign in.
2. Withings sends bed presence by **webhook**, so HA must be reachable over HTTPS from
   the internet (Nabu Casa, or an external URL in Settings → System → Network).
   Today HA is LAN/Tailscale only (`http://192.168.1.211:8123`), so the in-bed sensor
   may appear but never change. Check by getting in and out of bed and watching the entity.
3. The entity is usually `binary_sensor.<name>_in_bed`. Find it with a
   `homeassistant.states` command, `{"match": "in_bed"}`.

## Design choices

- **Lights:** `light.studio` (the studio group). Change if the bed area is a different group.
- **Debounce:** out of bed must hold 30 s, in bed 1 min, so rolling over doesn't flip lights.
- **Night branch** marks `light.studio` as manually controlled for Adaptive Lighting, then sets
  2% warm 2200 K, rather than turning on sleep mode for the whole home.
- **1 AM to morning:** uses the normal branch. Adaptive Lighting already runs dim and warm
  overnight and `automation.adaptive_lighting_sleep_mode_at_night` handles sleep mode.
- **Only when home** (`person.jared`), so a guest in the bed doesn't run it while away.
- `mode: restart` on the out-of-bed automation; getting back in bed turns the lights off
  whether or not the 5-minute timer is still running.

## Automation

See `home-assistant/packages/bed_lights.yaml`.

## Deploy

This cloud session can't write HA config: HA is LAN-only and the Home Hub agent (1.5.4)
only allows `states` reads and service `call`s, and no HA service creates automations.
Deploy from the Mac mini (SSH to the Pi, drop the package, `automation.reload`) or paste
it into the HA UI. Then onboard it on `/admin/team` per CLAUDE.md (it runs on its own).

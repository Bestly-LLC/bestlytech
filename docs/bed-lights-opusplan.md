# Bed lights (Withings in-bed sensor → Home Assistant)

Status 2026-10-15: **blocked on the sensor.** Home Assistant has no Withings entities
(live `homeassistant.states` lookups for `withings`, `in_bed`, `bed`, `sleep`, `analyzer`,
`occupan` and every `binary_sensor.*` found nothing). The automation below is ready;
it needs the real entity id in place of `binary_sensor.REPLACE_withings_in_bed`.

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
- **Night branch** sets the light directly (2% warm 2200 K) rather than turning on
  Adaptive Lighting sleep mode, so it doesn't change the rest of the evening's lighting.
- **1 AM to morning:** uses the normal branch. Adaptive Lighting already runs dim and warm
  overnight and `automation.adaptive_lighting_sleep_mode_at_night` handles sleep mode.
- **Only when home** (`person.jared`), so a guest in the bed doesn't run it while away.
- `mode: restart` on the out-of-bed automation; getting back in bed turns the lights off
  whether or not the 5-minute timer is still running.

## Automation (package `/mnt/ssd/apps/homeassistant/packages/bed_lights.yaml`)

Or paste each item into Settings → Automations → Create → Edit in YAML.

```yaml
automation:
  - id: bestly_bed_out_lights_on
    alias: Bed - lights on when I get up
    mode: restart
    trigger:
      - platform: state
        entity_id: binary_sensor.REPLACE_withings_in_bed
        from: "on"
        to: "off"
        for: "00:00:30"
    condition:
      - condition: state
        entity_id: person.jared
        state: home
    action:
      - choose:
          - conditions:
              - condition: time
                after: "20:00:00"
                before: "01:00:00"
            sequence:
              - service: light.turn_on
                target: { entity_id: light.studio }
                data: { brightness_pct: 2, color_temp_kelvin: 2200, transition: 2 }
              - delay: "00:05:00"
              - service: light.turn_off
                target: { entity_id: light.studio }
                data: { transition: 5 }
        default:
          - service: adaptive_lighting.apply
            data:
              entity_id: switch.adaptive_lighting_home
              lights: light.studio
              turn_on_lights: true
              transition: 2

  - id: bestly_bed_in_lights_off
    alias: Bed - lights off when I'm back in bed
    mode: single
    trigger:
      - platform: state
        entity_id: binary_sensor.REPLACE_withings_in_bed
        from: "off"
        to: "on"
        for: "00:01:00"
    action:
      - service: automation.turn_off
        target: { entity_id: automation.bed_lights_on_when_i_get_up }
        data: { stop_actions: true }
      - service: automation.turn_on
        target: { entity_id: automation.bed_lights_on_when_i_get_up }
      - service: light.turn_off
        target: { entity_id: light.studio }
        data: { transition: 5 }
```

## Deploy

This cloud session can't write HA config: HA is LAN-only and the Home Hub agent (1.5.4)
only allows `states` reads and service `call`s, and no HA service creates automations.
Deploy from the Mac mini (SSH to the Pi, drop the package, `automation.reload`) or paste
it into the HA UI. Then onboard it on `/admin/team` per CLAUDE.md (it runs on its own).

# Matter server (bestly-pi)

## What / why
- Home Assistant runs in Docker on bestly-pi, so there are no add-ons; the Matter integration needs its own server.
- `ghcr.io/matter-js/matterjs-server:stable` replaces the retired python-matter-server (drop-in, same websocket).
- Container `matter-server`, host network, listens on `127.0.0.1:5580` only. No auth, so it is never exposed to the LAN.
- Data: `/mnt/ssd/apps/matter-server/data`.

## Install / reinstall
- From the Mac mini (repo checked out): `ssh bestly-pi-lan 'bash -s' < scripts/matter-server/install.sh`
- Fallback: paste the script into a shell on the Pi as user `pi`.
- Idempotent: pulls the latest image, re-creates the container, keeps the data dir.

## Connect HA
- Settings -> Devices & services -> Add integration -> Matter.
- URL: `ws://localhost:5580/ws`

## Add a device already in Apple Home (multi-admin)
- Apple Home -> the accessory -> settings -> Turn On Pairing Mode -> copy the setup code.
- Home Assistant iPhone app: Settings -> Devices & services -> Add device -> Add Matter device -> "No, it's already in use" -> paste the code.
- Fallback, server dashboard over an SSH tunnel from the Mac: `ssh -N -L 5580:127.0.0.1:5580 bestly-pi-lan`, open http://localhost:5580, use "Commission node" with the code.

## Updates
- Not covered by the Home Hub agent's nightly maintenance (it only updates HA, Homebridge, Pi-hole and the OS).
- To update, re-run `install.sh`.
- Back up `/mnt/ssd/apps/matter-server/data` (fabric credentials). Never delete it.

## Logs
- `docker logs --tail 100 matter-server`

## First device
- The TP-Link Matter switch that powers the Edison bulbs.
- Then add it to the bed-lights "everything off" automation in `home-assistant/packages/bed_lights.yaml`.

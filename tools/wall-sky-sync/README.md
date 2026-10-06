# Sky Sync: keeps the wall's sky lined up with home

Bestly AI employee `wall-sky-sync` (Team page, reports to Wall). Hired Oct 5, 2026, after moving home left the roads,
traffic and city names behind (Jared: "I shouldn't have to keep fixing this home issue after adding traffic and roads").

## How the sync works
- **In the page (`wall.html`):** every layer drawn around home stamps the home, zoom and bearing it was drawn with.
  `SKYLAYERS` lists them; `window.__skyAudit()` reports how far each one is from the live home, in sky pixels.
  The page redraws on its own after 2 bad checks (every 4 s).
- **Moving home:** the 0.9 s glide redraws roads, signs, traffic and landmarks as it goes, then runs one full `airFit()`.
  `airFit()` now places home before it draws anything (it used to place it last).
- **Sky Sync (this folder, Mac mini, every 5 min, no AI):** reads the audit from outside, waits for the page to heal,
  reloads the page if it didn't, then pushes an urgent alert (`wall.skysync`). It also flags unregistered sky layers
  (`wall.skysync_unknown`), and when `wall.html` changes it runs a real move-home test at 2-5 AM (`wall.skysync_test`).

## Adding a sky layer
Stamp it when it draws (`X_AT={hx:AF.hx??AF.cx,hy:AF.hy??AF.my,ppn:AF.ppn,brg:AF.brg}`) and add it to `SKYLAYERS`
with the element ids it owns. Then run `python3 ~/Bestly/skysync/skysync.py --test`.

## Files
- Deployed: `~/Bestly/skysync/skysync.py`, LaunchAgent `~/Library/LaunchAgents/tech.bestly.skysync.plist`.
- Records: `skysync.log`, `state.json` next to the script. Uses Sweep's `config.json` and the Keychain key `bestly-home-hub-agent`.

```bash
python3 ~/Bestly/skysync/skysync.py --test   # check now, including a move-home glide (page only)
launchctl kickstart -k gui/$(id -u)/tech.bestly.skysync
```

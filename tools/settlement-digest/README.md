# settlement-digest (Nickel lock-screen "Yes, file all")

NOT INSTALLED YET. Until it runs on the Pi, the lock-screen Yes button does nothing; tapping the notification (or Open) lands on
https://bestly.tech/admin/settlements?digest=<id>, which has one big confirm button and works without this.

Install on bestly-pi (needs `pip3 install websocket-client`, an HA long-lived token in /home/pi/.bestly/ha_token mode 600):
```
sudo mkdir -p /opt/bestly/settlement-digest && sudo cp ha_action_listener.py /opt/bestly/settlement-digest/
sudo cp bestly-settle-digest.service /etc/systemd/system/ && sudo systemctl enable --now bestly-settle-digest
```
Alternative with no new service: add the same `SETTLE_YES_<uuid>` branch to `ha_events_loop` in /opt/bestly/wall/server.py
(it already subscribes to mobile_app_notification_action for the wall alarm) calling `settlement_digest_action_t`.
Tap flow and the sworn-statement rule: see the header of supabase/migrations/20261011003000_settlements_digest_push.sql.

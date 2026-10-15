# Car telemetry relay (telemetry.bestly.tech)

Tesla only streams to a hostname under the partner domain (`bestly.tech`). The first try pointed the car at
`bestly-pi.taile42611.ts.net` through a Tailscale Funnel and Tesla refused it ("hostname domain does not match with
partner account"). A Funnel can only serve `*.ts.net` names, so the public entrance moved to a tiny AWS box.

```
car --TLS (mTLS)--> telemetry.bestly.tech:443   Cloudflare A record, DNS only (grey cloud) -> 44.241.28.216
    -> AWS relay  systemd socket :443 -> systemd-socket-proxyd -> 127.0.0.1:9444
    -> reverse SSH tunnel opened BY the Pi (car-telemetry-tunnel.service, user "tunnel", one forward only)
    -> Pi 127.0.0.1:8444 -> fleet-telemetry receiver (TLS ends here)
```

- The relay holds no keys or certificates and is not in the tailnet. It can only see encrypted bytes.
- Relay: `i-0f172801cbf3d13e8`, us-west-2, t4g.nano, Elastic IP `44.241.28.216`, SG `sg-0bb1bcc7e0bd414a6`,
  IAM profile `bestly-telemetry-relay` (SSM only, no SSH admin). Built from `relay-userdata.sh`. About $7/month.
- Pi setup: `pi-relay-setup.sh <commit>` (installs `certs.sh` with the new name, `finish.sh`, the tunnel unit, and
  posts the tunnel's public key through `car_telemetry_relay_key`). The key is then added to
  `/home/tunnel/.ssh/authorized_keys` on the relay over SSM.
- Undo: terminate the instance, release the Elastic IP, delete the SG and the IAM role/profile, remove the DNS record,
  `systemctl disable --now car-telemetry-tunnel` on the Pi, queue `telemetry_delete`.

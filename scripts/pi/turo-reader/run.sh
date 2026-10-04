#!/bin/bash
# Pi Turo reader (bestly-turo-reader.service, 2026-10-03): plain Chromium in cage (headless Wayland) with its own
# Turo profile, DevTools on 127.0.0.1:9334 only, wayvnc on 127.0.0.1:5911 (noVNC sign-in view is started by
# reader.py only while Turo is signed out).
# enumerateDevices() never answers in headless cage (no media service) and Turo sign-in waits on it -> fake media devices.
# Own DNS (DNS over HTTPS to Cloudflare): the Pi-hole blocks scripts Turo's sign-in waits on, so it hung on the text code. If Chromium/cage or the reader dies, exit -> systemd restarts all.
set -u
export XDG_RUNTIME_DIR=${RUNTIME_DIRECTORY:-/run/bestly-turo}
export WLR_BACKENDS=headless WLR_HEADLESS_OUTPUTS=1 WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman
D=/opt/bestly/turo-reader
PROFILE=/var/lib/bestly/turo-host
mkdir -p "$PROFILE"
rm -f "$PROFILE"/Singleton* 2>/dev/null
log(){ echo "$(date '+%I:%M:%S %p') $*"; }

cat > $XDG_RUNTIME_DIR/child.sh <<EOF
#!/bin/bash
wlr-randr --output HEADLESS-1 --custom-mode 1280x900@10Hz 2>/dev/null
wayvnc -r 127.0.0.1 5911 >/dev/null 2>&1 &
exec /usr/bin/chromium --ozone-platform=wayland --start-maximized --user-data-dir=$PROFILE --no-first-run --noerrdialogs \\
  --password-store=basic --disable-features=Translate,MediaRouter --check-for-update-interval=31536000 \\
  --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \\
  --enable-features=DnsOverHttps\<DoHTrial --force-fieldtrials=DoHTrial/Group1 --force-fieldtrial-params=DoHTrial.Group1:Fallback/false/Templates/https%3A%2F%2Fcloudflare-dns.com%2Fdns-query \\
  --use-fake-device-for-media-stream --remote-debugging-address=127.0.0.1 --remote-debugging-port=9334 \\
  "https://turo.com/us/en/trips"
EOF
chmod +x $XDG_RUNTIME_DIR/child.sh
cage -s -- /bin/bash $XDG_RUNTIME_DIR/child.sh &
CAGE=$!
for i in $(seq 1 40); do curl -s --max-time 2 http://127.0.0.1:9334/json/version >/dev/null && break; sleep 1; done
log "chromium up"
/usr/bin/python3 $D/reader.py &
RD=$!
while kill -0 $CAGE 2>/dev/null && kill -0 $RD 2>/dev/null; do sleep 10; done
log "cage or reader exited; restarting"
kill $RD $CAGE 2>/dev/null; pkill -P $$ 2>/dev/null; sleep 2
exit 1

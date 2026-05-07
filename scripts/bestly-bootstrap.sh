#!/bin/bash
# /custom-config/bestly-bootstrap.sh on the Pi (cloud.bestly.tech).
#
# Runs from entrypoint-wrapper.sh as ROOT, before Nextcloud's /entrypoint.sh.
# Idempotent. Self-heals everything Bestly needs that the bare nextcloud:apache
# image / vanilla Libresign install doesn't provide on this Pi (32-bit ARM
# userland on aarch64 kernel):
#
#   1. openjdk-21-jre-headless (apt install) — Libresign's pinned aarch64 JDK
#      can't run on armhf userland, so we use Debian's package.
#   2. SerialNumberService — PHP_INT_MAX safe constant.
#   3. ConfigureCheckService — skip hash + exact-version checks for
#      java/pdftk/jsignpdf so system openjdk is accepted.
#   4. UI rebrand — Bestly Cloud logo + "using Bestly Cloud" string.
#
# Logs to stdout (visible via `docker logs nextcloud-app`).
# Failures are logged but never abort container start.
#
# Deploy:
#   scp scripts/bestly-bootstrap.sh pi@bestly-pi:/tmp/
#   ssh pi@bestly-pi 'sudo cp /tmp/bestly-bootstrap.sh /mnt/ssd/apps/nextcloud/custom-config/bestly-bootstrap.sh && sudo chmod +x /mnt/ssd/apps/nextcloud/custom-config/bestly-bootstrap.sh'
#
# Companion: /mnt/ssd/apps/nextcloud/custom-config/entrypoint-wrapper.sh (in this
# repo at scripts/entrypoint-wrapper.sh) — calls this bootstrap then exec's
# the real /entrypoint.sh.

set -uo pipefail
log() { echo "[bestly-bootstrap] $*"; }

LIB=/var/www/html/custom_apps/libresign

# ── 1. Java (root: apt install) ──────────────────────────────────────────────
if command -v java >/dev/null 2>&1; then
  log "openjdk present at $(command -v java)"
else
  log "openjdk missing — apt installing openjdk-21-jre-headless"
  export DEBIAN_FRONTEND=noninteractive
  if apt-get update -y >/tmp/bestly-apt.log 2>&1 \
     && apt-get install -y --no-install-recommends openjdk-21-jre-headless >>/tmp/bestly-apt.log 2>&1; then
    log "openjdk installed"
  else
    log "WARNING: openjdk install failed — see /tmp/bestly-apt.log inside container"
    log "WARNING: Libresign signing will be unavailable until reinstalled manually"
    tail -20 /tmp/bestly-apt.log 2>/dev/null | sed 's/^/[bestly-bootstrap apt] /'
  fi
fi

if [ -d "$LIB" ]; then
  su -s /bin/bash www-data -c "cd /var/www/html && \
    php occ config:app:set libresign java_path --value=/usr/bin/java >/dev/null 2>&1" || true
fi

if [ ! -d "$LIB/lib" ]; then
  log "Libresign not installed — skipping source patches"
  exit 0
fi

# ── 2. SerialNumberService ───────────────────────────────────────────────────
SNS="$LIB/lib/Service/SerialNumberService.php"
if [ -f "$SNS" ] && grep -q "9223372036854775807" "$SNS" 2>/dev/null; then
  log "patching SerialNumberService.php (SERIAL_MAX_VALUE → PHP_INT_MAX)"
  sed -i 's|private const SERIAL_MAX_VALUE = 9223372036854775807;|private const SERIAL_MAX_VALUE = PHP_INT_MAX; // PATCH: 32-bit safe|' "$SNS"
fi

# ── 3. ConfigureCheckService ─────────────────────────────────────────────────
CCS="$LIB/lib/Service/Install/ConfigureCheckService.php"
if [ -f "$CCS" ] && (grep -q "\$resultOfVerify = \$this->verify(" "$CCS" 2>/dev/null \
   || grep -qF 'if ($javaVersion !== InstallService::JAVA_VERSION) {' "$CCS" 2>/dev/null); then
  log "patching ConfigureCheckService.php"
  python3 - <<'PY'
import re, pathlib
p = pathlib.Path("/var/www/html/custom_apps/libresign/lib/Service/Install/ConfigureCheckService.php")
s = p.read_text()
s = re.sub(
    r"\$resultOfVerify = \$this->verify\('(java|pdftk|jsignpdf)'\);",
    r"$resultOfVerify = []; /* PATCH: skip hash check (armhf userland) */",
    s,
)
s = s.replace(
    "if ($javaVersion !== InstallService::JAVA_VERSION) {",
    "if (false) { // PATCH: accept any Java 21+ from system package",
)
p.write_text(s)
PY
fi

# ── 4. UI rebrand ────────────────────────────────────────────────────────────
LOGO="$LIB/img/logo-gray.svg"
if [ -f "$LOGO" ] && ! grep -q "BESTLY" "$LOGO" 2>/dev/null; then
  log "replacing logo-gray.svg with Bestly Cloud mark"
  if [ ! -f "$LOGO.orig" ]; then cp "$LOGO" "$LOGO.orig"; fi
  cat > "$LOGO" <<'SVG'
<svg width="406.012" height="177.619" viewBox="0 0 107.424 46.995" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(53.712 23.498)">
    <path d="M-39.5 -9 a6 6 0 0 1 6 -6 a8 8 0 0 1 14 -2 a7 7 0 0 1 13 4 a5 5 0 0 1 -1 9 h-30 a6 6 0 0 1 -2 -5 z" fill="#c84d2b" opacity="0.92"/>
    <path d="M-38 -2 l4 4 l8 -8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="-9" y="-2" font-family="-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="0.5" fill="#0a0a0a">BESTLY</text>
    <text x="-9" y="14" font-family="-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="6.6" font-weight="500" letter-spacing="3.4" fill="#475569">CLOUD SIGNING</text>
  </g>
</svg>
SVG
  chown www-data:www-data "$LOGO" 2>/dev/null || true
fi

NEEDS_STRING_PATCH=0
for f in "$LIB"/js/Validation-*.chunk.mjs "$LIB"/js/IncompleteCertification-*.chunk.mjs; do
  [ -f "$f" ] || continue
  case "$f" in *.map) continue ;; esac
  if grep -q "using LibreSign" "$f" 2>/dev/null; then NEEDS_STRING_PATCH=1; break; fi
done
if [ "$NEEDS_STRING_PATCH" = "1" ]; then
  log "rebranding 'using LibreSign' → 'using Bestly Cloud' in compiled chunks"
  python3 - <<'PY'
import glob, pathlib
swaps = [
    ("Congratulations you have digitally signed a document using LibreSign",
     "Congratulations — you have digitally signed a document using Bestly Cloud"),
    ("LibreSign logo", "Bestly Cloud logo"),
]
for pat in [
    "/var/www/html/custom_apps/libresign/js/Validation-*.chunk.mjs",
    "/var/www/html/custom_apps/libresign/js/IncompleteCertification-*.chunk.mjs",
]:
    for f in glob.glob(pat):
        if f.endswith(".map"): continue
        p = pathlib.Path(f)
        s = p.read_text(encoding="utf-8")
        orig = s
        for old, new in swaps: s = s.replace(old, new)
        if s != orig: p.write_text(s, encoding="utf-8")
PY
fi

log "done"
exit 0

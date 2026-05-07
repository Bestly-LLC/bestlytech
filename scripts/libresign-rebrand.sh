#!/bin/bash
# Rebrand Libresign signer-facing UI to Bestly Cloud (logo + visible strings).
#
# Re-apply this after every Libresign app upgrade — the upgrade replaces
# logo-gray.svg and the compiled JS chunks. The chunk filenames have content
# hashes (Validation-B9SUR5u4.chunk.mjs etc.) so the glob below copes with
# the new hash automatically.
#
# Usage:
#   scp scripts/libresign-rebrand.sh scripts/bestly-cloud-logo.svg pi@bestly-pi:/tmp/
#   ssh pi@bestly-pi 'docker cp /tmp/bestly-cloud-logo.svg nextcloud-app:/tmp/ \
#     && docker cp /tmp/libresign-rebrand.sh nextcloud-app:/tmp/lr.sh \
#     && docker exec -u root nextcloud-app bash /tmp/lr.sh'

set -e

LIB=/var/www/html/custom_apps/libresign

if [ ! -f "$LIB/img/logo-gray.svg.orig" ]; then
  cp "$LIB/img/logo-gray.svg" "$LIB/img/logo-gray.svg.orig"
fi
cp /tmp/bestly-cloud-logo.svg "$LIB/img/logo-gray.svg"
chown www-data:www-data "$LIB/img/logo-gray.svg"
echo "logo-gray.svg replaced ($(wc -c < $LIB/img/logo-gray.svg) bytes)"

python3 - <<'PY'
import glob, pathlib
swaps = [
    ("Congratulations you have digitally signed a document using LibreSign",
     "Congratulations — you have digitally signed a document using Bestly Cloud"),
    ("LibreSign logo", "Bestly Cloud logo"),
]
patched_files = []
for pat in [
    "/var/www/html/custom_apps/libresign/js/Validation-*.chunk.mjs",
    "/var/www/html/custom_apps/libresign/js/IncompleteCertification-*.chunk.mjs",
]:
    for f in glob.glob(pat):
        if f.endswith(".map"): continue
        p = pathlib.Path(f)
        s = p.read_text(encoding="utf-8")
        orig = s
        for old, new in swaps:
            s = s.replace(old, new)
        if s != orig:
            p.write_text(s, encoding="utf-8")
            patched_files.append(f)

print("patched:", patched_files)
PY

echo "done."

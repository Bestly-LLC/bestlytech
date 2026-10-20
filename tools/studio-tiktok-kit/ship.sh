#!/bin/bash
# Ships the TikTok kit + cover fix to Studio as a PREVIEW build. A person still taps Ship (or Claude calls `deploy` after
# the request reaches status 'ship'); nothing here touches production.
#   STUDIO_BUILD_KEY=<studio_build_key> STUDIO_REQUEST_ID=<studio_requests.id> ./ship.sh
# STUDIO_REQUEST_ID is a request made from Studio's Ask pill (status building/open) that this build belongs to.
set -euo pipefail
: "${STUDIO_BUILD_KEY:?set STUDIO_BUILD_KEY}"; : "${STUDIO_REQUEST_ID:?set STUDIO_REQUEST_ID}"
HERE="$(cd "$(dirname "$0")" && pwd)"; W="$(mktemp -d)"
FN="https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/studio-build"
SBK="sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
call() { curl -sS -X POST "$FN" -H "x-build-key: $STUDIO_BUILD_KEY" -H "apikey: $SBK" -H "content-type: application/json" -d "$1"; }
LIVE="$(call '{"action":"live"}')"
LIVE_PATH="$(echo "$LIVE" | python3 -c 'import sys,json; print(json.load(sys.stdin)["build"]["files"]["index.html"])')"
echo "live index.html = $LIVE_PATH"
curl -sS "https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/review/$LIVE_PATH" -o "$W/live.html"
python3 "$HERE/patch_studio.py" "$W/live.html" "$W/new.html"
H="$(sha256sum "$W/new.html" | cut -c1-10)"; DEST="app/index.$H.html"
BODY="$(python3 -c 'import sys,json,base64; print(json.dumps({"action":"put","dest":sys.argv[1],"base64":base64.b64encode(open(sys.argv[2],"rb").read()).decode()}))' "$DEST" "$W/new.html")"
call "$BODY"; echo
call "{\"action\":\"record\",\"request_id\":\"$STUDIO_REQUEST_ID\",\"changed\":{\"index.html\":\"$DEST\"},\"note\":\"TikTok posting kit panel + drafts list, and the custom cover on every post video\"}"; echo
call "{\"action\":\"preview\",\"request_id\":\"$STUDIO_REQUEST_ID\"}"; echo
echo "Open the preview URL above, check a TikTok post's detail, then tap Ship."

#!/bin/bash
# Ship Bestly Sky to internal TestFlight from the Mac mini (modelled on arrivekey/scripts/ship-arrivekey.sh).
#   1. App Store provisioning profiles for tech.bestly.sky + tech.bestly.sky.widgets via the ASC API
#   2. manual Release signing with the Apple Distribution cert in the arrivekey-build keychain
#   3. archive -> exportArchive (method app-store-connect, destination upload)
#   4. add the build to the internal TestFlight group "Bestly"
# Needs an App Store Connect app record for tech.bestly.sky (Apple's API cannot create one): the script waits for it.
# Run long: nohup scripts/ship-sky.sh > ~/Bestly/skyla/ship.log 2>&1 &
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$HOME/bin:$PATH"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
KEY_ID=GXS3838L2U
ISSUER="$(cat "$HOME/.appstoreconnect/issuer_id")"
KEYPATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
KC="$HOME/Library/Keychains/arrivekey-build.keychain-db"
WORK="${SKY_WORK:-$HOME/Bestly/skyla}"
DD="$WORK/dd"
ARCHIVE="$WORK/BestlySky.xcarchive"
EXPORT="$WORK/export"
FREE=$(df -g / | awk 'NR==2{print $4}')
if [ "$FREE" -lt 2 ]; then echo "disk too low ($FREE GB free), stopping"; exit 3; fi

if [ ! -f BestlySky/Generated/SkyKey.swift ]; then       # never committed; same value as Vault sky_app_key
  mkdir -p BestlySky/Generated
  printf 'enum SkyKey { static let value = "%s" }\n' "$(cat "$HOME/.bestly/sky/app_key")" > BestlySky/Generated/SkyKey.swift
fi

echo "### PROFILES $(date)"
/usr/bin/python3 scripts/sky_asc.py profiles

BUILD="$(grep -E '^    CURRENT_PROJECT_VERSION:' project.yml | head -1 | awk '{print $2}')"
echo "### BUILD NUMBER $BUILD"
xcodegen generate --quiet

security unlock-keychain -p "$(cat "$HOME/.appstoreconnect/build_keychain_pw")" "$KC"
security set-keychain-settings -lut 21600 "$KC"
rm -rf "$ARCHIVE" "$EXPORT"
mkdir -p "$WORK"

echo "### ARCHIVE START $(date)"
xcodebuild -project BestlySky.xcodeproj -scheme BestlySky \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath "$DD" -archivePath "$ARCHIVE" \
  OTHER_CODE_SIGN_FLAGS="--keychain $KC" \
  clean archive | tail -40
echo "### ARCHIVE OK $(date)"

cat > "$WORK/ExportOptions.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>teamID</key><string>PV65ABS5W9</string>
<key>uploadSymbols</key><true/>
<key>signingStyle</key><string>manual</string>
<key>signingCertificate</key><string>Apple Distribution</string>
<key>provisioningProfiles</key><dict>
  <key>tech.bestly.sky</key><string>Bestly Sky App Store</string>
  <key>tech.bestly.sky.widgets</key><string>Bestly Sky Widgets App Store</string>
</dict>
<key>destination</key><string>upload</string>
<key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

echo "### WAITING FOR THE APP STORE CONNECT APP RECORD $(date)"
for i in $(seq 1 8); do          # up to ~16 minutes, every 2 minutes
  if /usr/bin/python3 scripts/sky_asc.py app; then break; fi
  if [ "$i" = 8 ]; then echo "NO APP RECORD for tech.bestly.sky after ~16 minutes; archive is ready at $ARCHIVE, re-run to upload"; exit 4; fi
  sleep 120
done

echo "### EXPORT+UPLOAD START $(date)"
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" -exportPath "$EXPORT" \
  -authenticationKeyPath "$KEYPATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER" | tail -30
echo "### UPLOADED build $BUILD $(date)"

/usr/bin/python3 scripts/sky_asc.py testflight "$BUILD" || echo "### TESTFLIGHT GROUP STEP FAILED (see above)"

# next upload needs a higher build number
sed -i '' "s/^    CURRENT_PROJECT_VERSION: .*/    CURRENT_PROJECT_VERSION: $((BUILD + 1))/" project.yml
echo "### SHIP DONE $(date)"

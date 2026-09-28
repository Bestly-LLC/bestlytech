#!/bin/bash
# Build Bestly Sky (development-signed) on the Mac mini and install it straight onto Jared's paired iPhone.
# No TestFlight, no taps: automatic signing via the App Store Connect API key, install + launch via devicectl.
# The app key (x-sky-key) comes from ~/.bestly/sky/app_key (same value as Vault sky_app_key); never committed.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/bin:$PATH"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
KEY_ID=GXS3838L2U
ISSUER="$(cat "$HOME/.appstoreconnect/issuer_id")"
KEYPATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
KC="$HOME/Library/Keychains/arrivekey-build.keychain-db"
DEVICE="${SKY_DEVICE:-00008140-001869602EFB001C}"      # Jared's iPhone 16 Pro Max

mkdir -p BestlySky/Generated
printf 'enum SkyKey { static let value = "%s" }\n' "$(cat "$HOME/.bestly/sky/app_key")" > BestlySky/Generated/SkyKey.swift
xcodegen generate --quiet

if [ -f "$KC" ]; then
  security unlock-keychain -p "$(cat "$HOME/.appstoreconnect/build_keychain_pw")" "$KC"
  security set-keychain-settings -lut 21600 "$KC"
  SIGNFLAGS=(OTHER_CODE_SIGN_FLAGS="--keychain $KC")
else
  SIGNFLAGS=()
fi

echo "### BUILD START $(date)"
xcodebuild -project BestlySky.xcodeproj -scheme BestlySky -configuration Debug \
  -destination "id=$DEVICE" -derivedDataPath build \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  -authenticationKeyPath "$KEYPATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER" \
  "${SIGNFLAGS[@]}" build | tail -25
echo "### BUILD OK $(date)"

APP="build/Build/Products/Debug-iphoneos/BestlySky.app"
xcrun devicectl device install app --device "$DEVICE" "$APP"
echo "### INSTALLED $(date)"
# Launch once so the app hands its push-to-start token to the server (fails harmlessly if the phone is locked).
xcrun devicectl device process launch --device "$DEVICE" tech.bestly.sky || echo "### LAUNCH SKIPPED (phone locked?)"
echo "### DONE $(date)"

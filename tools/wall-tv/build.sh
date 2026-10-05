#!/bin/sh
# Build the Bestly Wall TV app on the Mac mini (release APK, signed with the Mac's debug key).
# Output: app/build/outputs/apk/release/app-release.apk -> scp to the Pi (/opt/bestly/stream/bestly-wall-tv.apk)
# -> adb -s 192.168.1.209:5555 install -r /opt/bestly/stream/bestly-wall-tv.apk
cd "$(dirname "$0")"
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
echo "sdk.dir=$ANDROID_HOME" > local.properties
if [ ! -d "$ANDROID_HOME/platforms/android-34" ] || [ ! -d "$ANDROID_HOME/build-tools/34.0.0" ]; then
  yes | sdkmanager --licenses >/dev/null 2>&1
  sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools" >/dev/null || exit 1
fi
if [ ! -x ./gradlew ]; then
  /opt/homebrew/bin/gradle wrapper --gradle-version 8.11.1 --distribution-type bin -q || exit 1
fi
./gradlew --no-daemon -q assembleRelease && ls -la app/build/outputs/apk/release/

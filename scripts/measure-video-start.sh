#!/usr/bin/env bash
# Measure video start times on connected Android device via logcat telemetry.
set -euo pipefail

DEVICE="${ADB_DEVICE:-14bb9b3f}"
PKG="com.ihirwe.talentix"

echo "=== Video start time measurement ==="
echo "Device: $DEVICE"

adb -s "$DEVICE" reverse tcp:8081 tcp:8081 2>/dev/null || true
adb -s "$DEVICE" logcat -c

# Reload JS bundle
curl -sf "http://localhost:8081/reload" >/dev/null 2>&1 || true
adb -s "$DEVICE" shell am force-stop "$PKG"
sleep 1
adb -s "$DEVICE" shell am start -n "$PKG/.MainActivity" \
  -d "exp+talentix://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"

echo "Waiting 25s for app + bundle..."
sleep 25

# Dismiss Expo dev menu (Continue button ~y=1150 on 720x1440)
adb -s "$DEVICE" shell input tap 360 1150
sleep 2

echo "Swipe 1 (forward)..."
adb -s "$DEVICE" shell input swipe 360 1100 360 350 300
sleep 4

echo "Swipe 2 (forward)..."
adb -s "$DEVICE" shell input swipe 360 1100 360 350 300
sleep 4

echo "Swipe 3 (backward)..."
adb -s "$DEVICE" shell input swipe 360 350 360 1100 300
sleep 4

echo "Swipe 4 (backward)..."
adb -s "$DEVICE" shell input swipe 360 350 360 1100 300
sleep 4

echo ""
echo "=== RESULTS (video_time_to_first_frame_ms / first_motion_ms) ==="
adb -s "$DEVICE" logcat -d -s ReactNativeJS:I | \
  grep -E 'video_time_to_first_frame_ms|video_time_to_first_motion_ms' | \
  sed 's/.*ReactNativeJS: //' | tail -20

echo ""
echo "=== PLAYER COUNT WARNINGS ==="
adb -s "$DEVICE" logcat -d -s ReactNativeJS:W | grep -i 'More than one' | tail -5 || echo "(none)"

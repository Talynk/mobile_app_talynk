#!/usr/bin/env bash
# On-device feed scroll test via ADB (Mara Z).
set -euo pipefail

DEVICE="${ADB_DEVICE:-14bb9b3f}"
PKG="com.ihirwe.talentix"
OUT="/tmp/feed_device_test_$(date +%s)"
mkdir -p "$OUT"

echo "Device test output: $OUT"
adb -s "$DEVICE" reverse tcp:8081 tcp:8081 2>/dev/null || true

echo "[1] Clearing logcat..."
adb -s "$DEVICE" logcat -c

echo "[2] Reloading app..."
curl -sf "http://localhost:8081/reload" >/dev/null 2>&1 || true
adb -s "$DEVICE" shell am force-stop "$PKG"
sleep 1
adb -s "$DEVICE" shell am start -n "$PKG/.MainActivity" \
  -d "exp+talentix://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
sleep 8

echo "[3] Screenshot: feed loaded"
adb -s "$DEVICE" exec-out screencap -p > "$OUT/00_initial.png"

# Vertical feed swipe: center x=360, swipe up from y=1200 to y=400
SWIPES=20
for i in $(seq 1 $SWIPES); do
  adb -s "$DEVICE" shell input swipe 360 1200 360 400 300
  sleep 2
  if [ $((i % 5)) -eq 0 ]; then
    adb -s "$DEVICE" exec-out screencap -p > "$OUT/$(printf '%02d' $i)_after_${i}_swipes.png"
    echo "  swipe $i/$SWIPES - screenshot saved"
  fi
done

echo "[4] Capturing logs (feed/video/errors)..."
adb -s "$DEVICE" logcat -d -t 500 | grep -iE \
  'feed|exoplayer|video|error|stall|buffer|caught|pagination|fetchNext|ReactNativeJS' \
  > "$OUT/logcat_filtered.txt" 2>/dev/null || true

adb -s "$DEVICE" logcat -d -t 200 > "$OUT/logcat_full.txt" 2>/dev/null || true

echo "[5] Final screenshot"
adb -s "$DEVICE" exec-out screencap -p > "$OUT/99_final.png"

echo ""
echo "=== LOG SUMMARY ==="
grep -iE 'error|exception|stall|buffer underflow|MediaCodec' "$OUT/logcat_filtered.txt" | tail -30 || echo "(no critical errors in filtered log)"
echo ""
echo "Screenshots: $OUT/*.png"
echo "Logs: $OUT/logcat_filtered.txt"
wc -l "$OUT/logcat_filtered.txt" 2>/dev/null || true

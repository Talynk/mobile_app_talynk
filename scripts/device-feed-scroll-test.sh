#!/usr/bin/env bash
# Record screen + capture scroll telemetry on connected Android device.
set -euo pipefail

DEVICE="${ADB_DEVICE:-14bb9b3f}"
PKG="com.ihirwe.talentix"
OUT_DIR="${OUT_DIR:-/tmp/talynk-device-test}"
mkdir -p "$OUT_DIR"
TS=$(date +%Y%m%d_%H%M%S)
RECORD="$OUT_DIR/feed_scroll_${TS}.mp4"
LOG="$OUT_DIR/logcat_${TS}.txt"
REPORT="$OUT_DIR/report_${TS}.txt"

adb -s "$DEVICE" reverse tcp:8081 tcp:8081 2>/dev/null || true

echo "=== Device feed scroll test ===" | tee "$REPORT"
echo "Device: $DEVICE" | tee -a "$REPORT"

adb -s "$DEVICE" logcat -c
adb -s "$DEVICE" shell am force-stop "$PKG"
sleep 2
adb -s "$DEVICE" shell am start -n "${PKG}/.MainActivity" \
  -d 'exp+talentix://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'

echo "Waiting 50s for Metro bundle..." | tee -a "$REPORT"
sleep 50

adb -s "$DEVICE" shell input tap 360 1150
sleep 4

echo "Starting screen record (90s)..." | tee -a "$REPORT"
adb -s "$DEVICE" shell screenrecord --time-limit 90 "/sdcard/talynk_feed_test.mp4" &
RECORD_PID=$!
sleep 2

for i in $(seq 1 8); do
  echo "Swipe $i" | tee -a "$REPORT"
  adb -s "$DEVICE" shell input swipe 360 1200 360 280 450
  sleep 4
done

wait "$RECORD_PID" 2>/dev/null || true
adb -s "$DEVICE" pull "/sdcard/talynk_feed_test.mp4" "$RECORD" 2>/dev/null || true
adb -s "$DEVICE" shell rm -f "/sdcard/talynk_feed_test.mp4" 2>/dev/null || true

for i in $(seq 1 3); do
  adb -s "$DEVICE" exec-out screencap -p > "$OUT_DIR/screen_${TS}_${i}.png" 2>/dev/null || true
  sleep 1
done

adb -s "$DEVICE" logcat -d -s ReactNativeJS:I ReactNativeJS:E > "$LOG"

SETTLED=$(grep -c 'feed_scroll_settled' "$LOG" 2>/dev/null || echo 0)
FRAMES=$(grep -c 'video_time_to_first_frame' "$LOG" 2>/dev/null || echo 0)
PLAYERS=$(grep 'active_feed_players_count' "$LOG" | tail -5)
MAX_PLAYER=$(grep 'active_feed_players_count' "$LOG" | grep -oE '"count": ?[0-9]*|count: [0-9]*' | grep -oE '[0-9]+' | sort -n | tail -1)
ERRORS=$(grep -iE 'Maximum update|TypeError|Error' "$LOG" | head -10)

{
  echo ""
  echo "Recording: $RECORD"
  echo "Screenshots: $OUT_DIR/screen_${TS}_*.png"
  echo "feed_scroll_settled events: $SETTLED"
  echo "video_time_to_first_frame events: $FRAMES"
  echo "max active_feed_players_count: ${MAX_PLAYER:-unknown}"
  echo "Recent player counts:"
  echo "$PLAYERS"
  echo "Errors:"
  echo "$ERRORS"
} | tee -a "$REPORT"

echo "Done. Report: $REPORT"

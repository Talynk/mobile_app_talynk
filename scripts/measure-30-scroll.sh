#!/usr/bin/env bash
# Auto-scroll 35 forward + 35 backward inside the app (no per-scroll activity restarts).
set -euo pipefail

DEVICE="${ADB_DEVICE:-14bb9b3f}"
PKG="com.ihirwe.talentix"
FORWARD_SCROLLS="${FORWARD_SCROLLS:-35}"
BACKWARD_SCROLLS="${BACKWARD_SCROLLS:-35}"
INTERVAL_MS="${INTERVAL_MS:-4000}"
RESULTS_DIR="${RESULTS_DIR:-/tmp/talynk-scroll-test}"
mkdir -p "$RESULTS_DIR"
TS=$(date +%Y%m%d_%H%M%S)
REPORT="$RESULTS_DIR/scroll_report_${TS}.txt"
LOGCAT="$RESULTS_DIR/logcat_${TS}.txt"

TOTAL_WAIT_SEC=$(( (FORWARD_SCROLLS + BACKWARD_SCROLLS) * INTERVAL_MS / 1000 + 50 ))

echo "=== 30+ Video Auto-Scroll Test ===" | tee "$REPORT"
echo "Device: $DEVICE | Fwd: $FORWARD_SCROLLS | Back: $BACKWARD_SCROLLS | Interval: ${INTERVAL_MS}ms" | tee -a "$REPORT"
echo "Expected runtime: ~${TOTAL_WAIT_SEC}s" | tee -a "$REPORT"

adb -s "$DEVICE" reverse tcp:8081 tcp:8081 2>/dev/null || true
adb -s "$DEVICE" logcat -c
adb -s "$DEVICE" logcat -v time > "$LOGCAT" &
LOGCAT_PID=$!
cleanup() {
  kill "$LOGCAT_PID" 2>/dev/null || true
}
trap cleanup EXIT

adb -s "$DEVICE" shell am force-stop "$PKG"
sleep 2
DEV_URL='exp+talentix://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
adb -s "$DEVICE" shell am start -n "${PKG}/.MainActivity" -d "$DEV_URL"

echo "Waiting 40s for bundle..." | tee -a "$REPORT"
sleep 40
adb -s "$DEVICE" shell input tap 360 1150
sleep 5

AUTO_URL="talentix://?devAutoScroll=1&forward=${FORWARD_SCROLLS}&backward=${BACKWARD_SCROLLS}&interval=${INTERVAL_MS}"
echo "Starting auto-scroll: $AUTO_URL" | tee -a "$REPORT"
adb -s "$DEVICE" shell "am start --activity-single-top -a android.intent.action.VIEW -d '${AUTO_URL}' -n ${PKG}/.MainActivity" 2>/dev/null || true

echo "Waiting ${TOTAL_WAIT_SEC}s for scroll test to complete..." | tee -a "$REPORT"
sleep "$TOTAL_WAIT_SEC"

cleanup
trap - EXIT
python3 "$(dirname "$0")/parse-scroll-logcat.py" "$LOGCAT" "$REPORT"
echo "Logcat: $LOGCAT" | tee -a "$REPORT"

#!/usr/bin/env bash
set -uo pipefail

# Full dev flow: same as `npx expo run:android --device` (device picker, build,
# Metro, logs — stays open) then auto-opens talentix:///v/<post-id> AFTER JS loads.
#
# Usage:
#   npm run android:open-shared-link -- <post-id>

POST_ID="${1:-}"
PACKAGE="${ANDROID_PACKAGE:-com.ihirwe.talentix}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINK_SENT=0
LOCK_FILE="/tmp/talentix-shared-link.lock"

if [[ -z "${POST_ID}" ]]; then
  cat <<'EOF'
Usage: npm run android:open-shared-link -- <post-id>

Example:
  npm run android:open-shared-link -- ebe94971-2dbc-4cb5-9fa6-c273afd59a50
EOF
  exit 1
fi

SCHEME_URL="talentix:///v/${POST_ID}"

open_shared_link() {
  if [[ "${LINK_SENT}" == "1" ]]; then
    return 0
  fi

  if ! command -v adb >/dev/null 2>&1; then
    echo "[shared-link] adb not found — cannot open deep link"
    return 1
  fi

  local output
  output="$(adb shell am start -a android.intent.action.VIEW -d "${SCHEME_URL}" -p "${PACKAGE}" 2>&1)" || true
  if echo "${output}" | grep -q "Error:"; then
    echo ""
    echo "[shared-link] Failed to open ${SCHEME_URL}"
    echo "${output}"
    return 1
  fi

  LINK_SENT=1
  echo ""
  echo "[shared-link] Opened ${SCHEME_URL}"
  echo "${output}"
  return 0
}

wait_for_js_bundle() {
  echo "[shared-link] Waiting for 'Android Bundled' in device logs (JS must load first)..."
  adb logcat -c 2>/dev/null || true

  for _ in $(seq 1 120); do
    if adb logcat -d -t 50 2>/dev/null | grep -q "Android Bundled"; then
      echo "[shared-link] JS bundle loaded — opening shared video in 4s"
      sleep 4
      return 0
    fi
    sleep 2
  done

  echo "[shared-link] Bundle log not seen — waiting 10s then opening anyway"
  sleep 10
  return 0
}

wait_and_open_shared_link() {
  echo "[shared-link] Will open after Metro + JS bundle:"
  echo "[shared-link]   ${SCHEME_URL}"

  adb wait-for-device

  local metro_ready=0
  for _ in $(seq 1 180); do
    if curl -sf "http://127.0.0.1:8081/status" >/dev/null 2>&1; then
      metro_ready=1
      break
    fi
    sleep 2
  done

  if [[ "${metro_ready}" != "1" ]]; then
    echo "[shared-link] Metro not ready — skip auto-open. Run later:"
    echo "  npm run android:open-shared-link:adb -- ${POST_ID}"
    return 0
  fi

  for _ in $(seq 1 90); do
    if adb shell pidof "${PACKAGE}" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  wait_for_js_bundle
  open_shared_link || true
}

# One watcher at a time (ignore stale runs from interrupted sessions)
if command -v flock >/dev/null 2>&1; then
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    echo "[shared-link] Another shared-link session is already running. Stop it (Ctrl+C) and retry."
    exit 1
  fi
fi

wait_and_open_shared_link &
WATCHER_PID=$!

cd "${PROJECT_ROOT}"

echo ""
echo "[shared-link] Starting npx expo run:android --device"
echo "[shared-link] Pick Mara when prompted. Shared video opens AFTER bundle loads."
echo ""

set +e
npx expo run:android --device
EXPO_EXIT=$?
set -e

kill "${WATCHER_PID}" 2>/dev/null || true
wait "${WATCHER_PID}" 2>/dev/null || true

exit "${EXPO_EXIT}"

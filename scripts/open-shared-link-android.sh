#!/usr/bin/env bash
set -euo pipefail

# Open a shared Talentix video in the USB-connected dev build.
# Usage:
#   ./scripts/open-shared-link-android.sh <post-id>
#   npm run android:open-shared-link -- <post-id>
#
# Local debug APKs cannot verify HTTPS App Links (Chrome/Play Store opens instead).
# This script uses talentix:// which always resolves to com.ihirwe.talentix.

POST_ID="${1:-}"
PACKAGE="${ANDROID_PACKAGE:-com.ihirwe.talentix}"
DETOUR_HASH="${DETOUR_APP_HASH:-mIlEGaC9ru}"
DETOUR_HOST="${DETOUR_HOST:-talentix.godetour.link}"

if [[ -z "${POST_ID}" ]]; then
  echo "Usage: $0 <post-id>"
  echo "Example: $0 e1b7e807-3d5c-4de3-bef0-0318bc1bd694"
  exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. Install Android platform-tools first."
  exit 1
fi

DEVICE_COUNT="$(adb devices | awk 'NR>1 && $2=="device" { print $1 }' | wc -l | tr -d ' ')"
if [[ "${DEVICE_COUNT}" == "0" ]]; then
  echo "No USB device detected. Enable USB debugging and reconnect the phone."
  exit 1
fi

SCHEME_URL="talentix:///v/${POST_ID}"
HTTPS_URL="https://${DETOUR_HOST}/${DETOUR_HASH}/v/${POST_ID}"

launch_intent() {
  local url="$1"
  local output
  output="$(adb shell am start -a android.intent.action.VIEW -d "${url}" -p "${PACKAGE}" 2>&1)" || true
  if echo "${output}" | grep -q "Error:"; then
    echo "${output}"
    return 1
  fi
  echo "${output}"
  return 0
}

echo "Opening shared video in ${PACKAGE}"
echo "  Dev route: ${SCHEME_URL}"
echo "  (HTTPS ${HTTPS_URL} only works after adding debug SHA-256 to Detour)"
echo

if launch_intent "${SCHEME_URL}"; then
  echo "OK — app should show /v/${POST_ID}"
  echo "If Metro is running, press r there to reload JS after code changes."
  exit 0
fi

echo
echo "talentix:// failed. Is the dev build installed?"
echo "  npx expo run:android --device"
exit 1

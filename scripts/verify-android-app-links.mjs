#!/usr/bin/env node
/**
 * Verifies Detour-hosted assetlinks.json includes the Google Play App Signing SHA-256.
 * Play Console domain validation fails when only debug / EAS upload certs are registered.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PACKAGE = 'com.ihirwe.talentix';
const DETOUR_HOST = 'talentix.godetour.link';
const DETOUR_HASH = 'mIlEGaC9ru';
const ASSETLINKS_URL = `https://${DETOUR_HOST}/.well-known/assetlinks.json`;

const PLAY_SIGNING_SHA256 =
  process.env.ANDROID_PLAY_SIGNING_SHA256 ||
  '3A:E9:0E:D7:CB:AD:E4:22:DF:26:EC:23:C9:99:B6:EC:22:C3:47:F8:65:5F:5E:53:1E:70:B3:17:97:0C:12:F7';

const EAS_UPLOAD_SHA256 =
  '0C:AE:9C:6B:55:31:9A:F6:3F:6B:A2:67:22:19:A4:38:CC:53:BE:57:41:37:78:13:72:1E:8B:32:AA:70:8C:B5';

function normalizeSha(value) {
  return value.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}

function formatSha(hex) {
  return hex.match(/.{1,2}/g).join(':').toUpperCase();
}

function findApksigner() {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdkRoot) return null;
  try {
    const path = execSync(
      `find "${sdkRoot}/build-tools" -name apksigner -type f 2>/dev/null | sort -V | tail -1`,
      { encoding: 'utf8' },
    ).trim();
    return path || null;
  } catch {
    return null;
  }
}

function resolvePlaySigningSha() {
  if (process.env.ANDROID_PLAY_SIGNING_SHA256) {
    return PLAY_SIGNING_SHA256;
  }

  const apksigner = findApksigner();
  if (!apksigner) {
    return PLAY_SIGNING_SHA256;
  }

  const dir = mkdtempSync(join(tmpdir(), 'talentix-apk-'));
  try {
    execSync(
      `curl -fsSL -o "${dir}/app.xapk" "https://apkpure.com/talentix-live/com.ihirwe.talentix/download" 2>/dev/null || true`,
      { stdio: 'pipe' },
    );
    // Fallback: use apkeep if available
    try {
      execSync(`apkeep -a ${PACKAGE} -d apk-pure "${dir}"`, { stdio: 'pipe' });
    } catch {
      return PLAY_SIGNING_SHA256;
    }

    const xapk = join(dir, `${PACKAGE}.xapk`);
    execSync(`unzip -q "${xapk}" -d "${dir}/xapk"`, { stdio: 'pipe' });
    const apk = join(dir, 'xapk', `${PACKAGE}.apk`);
    const output = execSync(
      `"${apksigner}" verify --print-certs "${apk}"`,
      { encoding: 'utf8' },
    );
    const match = output.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]+)/i);
    if (!match) return PLAY_SIGNING_SHA256;
    return formatSha(match[1]);
  } catch {
    return PLAY_SIGNING_SHA256;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function fetchAssetLinks() {
  const response = await fetch(ASSETLINKS_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`assetlinks.json HTTP ${response.status}`);
  }
  return response.json();
}

function extractFingerprints(assetLinks) {
  const entry = assetLinks.find(
    (item) => item?.target?.package_name === PACKAGE,
  );
  return entry?.target?.sha256_cert_fingerprints ?? [];
}

async function main() {
  const playSha = resolvePlaySigningSha();
  const playNorm = normalizeSha(playSha);

  console.log(`Checking ${ASSETLINKS_URL}`);
  console.log(`Expected Play App Signing SHA-256: ${playSha}`);

  const assetLinks = await fetchAssetLinks();
  const fingerprints = extractFingerprints(assetLinks);
  const normalized = fingerprints.map(normalizeSha);
  const unique = [...new Set(normalized)];

  console.log(`Registered fingerprints (${unique.length} unique):`);
  for (const fp of unique) {
    console.log(`  - ${formatSha(fp)}`);
  }

  const hasPlay = normalized.includes(playNorm);
  const hasUpload = normalized.includes(normalizeSha(EAS_UPLOAD_SHA256));

  if (!hasPlay) {
    console.error('\nFAIL: Google Play App Signing certificate is missing from assetlinks.json.');
    console.error('This is why Play Console reports "domain failed validation".');
    console.error('\nFix (Detour dashboard — one-time):');
    console.error('  1. Open https://godetour.dev → your Talentix app → App configuration → Android');
    console.error('  2. Paste this into "Production certificate (SHA256 certificate fingerprint)":');
    console.error(`     ${playSha}`);
    console.error('  3. Save and wait ~5 minutes for assetlinks.json to refresh');
    console.error('  4. Play Console → Grow → Deep links → re-run domain verification');
    console.error('  5. Ship a new production build (version code 48+) so users get verified App Links');
    process.exit(1);
  }

  if (unique.length !== normalized.length) {
    console.warn('\nWARN: assetlinks.json contains duplicate fingerprints (harmless but messy).');
  }

  if (!hasUpload) {
    console.warn('\nWARN: EAS upload certificate is not listed (only affects pre-release sideloads).');
  }

  console.log('\nOK: Play App Signing fingerprint is registered for Android App Links.');
  console.log(`Deep link path prefix: /${DETOUR_HASH}`);
}

main().catch((error) => {
  console.error(`verify-android-app-links failed: ${error.message}`);
  process.exit(1);
});

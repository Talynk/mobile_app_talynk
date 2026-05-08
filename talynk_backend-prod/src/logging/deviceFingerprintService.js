/**
 * Resolve or create a device fingerprint record from a hash and optional metadata.
 * Used for activity/audit logging and anomaly detection.
 */

const prisma = require('../lib/prisma');

const FINGERPRINT_HASH_MAX_LENGTH = 64;

/**
 * Parse optional metadata from client (e.g. X-Device-Metadata header as JSON).
 * @param {string|undefined} raw - JSON string or undefined
 * @returns {{ os?: string, browser?: string, locale?: string, extra?: object }|null}
 */
function parseDeviceMetadata(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Get or create DeviceFingerprint by hash. Updates last_seen_at and optional metadata.
 * @param {object} params
 * @param {string} params.fingerprintHash - One-way hash of device attributes (max 64 chars).
 * @param {string} [params.userAgent] - User-Agent string.
 * @param {object} [params.metadata] - Optional { os, browser, locale, extra }.
 * @returns {Promise<{ id: string }|null>} DeviceFingerprint id or null if hash invalid.
 */
async function getOrCreateDeviceFingerprint({ fingerprintHash, userAgent, metadata = null }) {
  if (!fingerprintHash || typeof fingerprintHash !== 'string') return null;
  const hash = fingerprintHash.trim().slice(0, FINGERPRINT_HASH_MAX_LENGTH);
  if (!hash) return null;

  const data = {
    fingerprint_hash: hash,
    last_seen_at: new Date(),
    user_agent: userAgent || undefined,
    os: metadata?.os ?? undefined,
    browser: metadata?.browser ?? undefined,
    locale: metadata?.locale ?? undefined,
    extra: metadata?.extra != null ? metadata.extra : undefined,
  };

  const existing = await prisma.deviceFingerprint.findUnique({
    where: { fingerprint_hash: hash },
    select: { id: true },
  });

  if (existing) {
    await prisma.deviceFingerprint.update({
      where: { id: existing.id },
      data: {
        last_seen_at: data.last_seen_at,
        ...(data.user_agent != null && { user_agent: data.user_agent }),
        ...(data.os != null && { os: data.os }),
        ...(data.browser != null && { browser: data.browser }),
        ...(data.locale != null && { locale: data.locale }),
        ...(data.extra != null && { extra: data.extra }),
      },
    });
    return { id: existing.id };
  }

  const created = await prisma.deviceFingerprint.create({
    data: {
      fingerprint_hash: hash,
      first_seen_at: new Date(),
      last_seen_at: data.last_seen_at,
      user_agent: data.user_agent,
      os: data.os,
      browser: data.browser,
      locale: data.locale,
      extra: data.extra,
    },
    select: { id: true },
  });
  return { id: created.id };
}

/**
 * Link a user to a device (upsert UserDevice). Call after successful login if desired.
 * @param {string} userId
 * @param {string} deviceFingerprintId
 * @param {{ label?: string, trusted?: boolean }} [options]
 */
async function linkUserToDevice(userId, deviceFingerprintId, options = {}) {
  if (!userId || !deviceFingerprintId) return;
  await prisma.userDevice.upsert({
    where: {
      unique_user_device: { user_id: userId, device_fingerprint_id: deviceFingerprintId },
    },
    create: {
      user_id: userId,
      device_fingerprint_id: deviceFingerprintId,
      label: options.label ?? null,
      trusted: options.trusted ?? false,
    },
    update: {
      last_used_at: new Date(),
      ...(options.label != null && { label: options.label }),
      ...(options.trusted != null && { trusted: options.trusted }),
    },
  });
}

module.exports = {
  getOrCreateDeviceFingerprint,
  linkUserToDevice,
  parseDeviceMetadata,
  FINGERPRINT_HASH_MAX_LENGTH,
};

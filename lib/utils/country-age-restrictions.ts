/**
 * Country-specific social media age restrictions.
 *
 * Based on GDPR digital-consent ages, Australia's Online Safety Amendment Act
 * (2024), Rwanda's proposed draft law (2025), and other national legislation.
 *
 * The map stores ISO-3166-1 alpha-2 codes → minimum age.
 * Any country NOT in the map defaults to `DEFAULT_MINIMUM_AGE` (13).
 */

// ── Minimum age by country code ───────────────────────────────────────────

const AGE_16_COUNTRIES = [
  // Africa
  'RW', // Rwanda
  // Europe (GDPR set to 16)
  'DE', // Germany
  'NL', // Netherlands
  'IE', // Ireland
  'LU', // Luxembourg
  'PL', // Poland
  'HU', // Hungary
  'SK', // Slovakia
  'HR', // Croatia
  // Oceania
  'AU', // Australia
  // Asia
  'KR', // South Korea
] as const;

const AGE_15_COUNTRIES = [
  // Europe (GDPR set to 15)
  'FR', // France
  'GR', // Greece
  'SI', // Slovenia
  'CZ', // Czech Republic
] as const;

const AGE_14_COUNTRIES = [
  // Europe (GDPR set to 14)
  'AT', // Austria
  'BG', // Bulgaria
  'CY', // Cyprus
  'IT', // Italy
  'LT', // Lithuania
  'RO', // Romania
  'ES', // Spain
  // Asia
  'CN', // China
] as const;

// Everything else (US, UK, Canada, most of Africa/Asia/LatAm) → 13.
const DEFAULT_MINIMUM_AGE = 13;

// ── Build lookup table ────────────────────────────────────────────────────

const COUNTRY_AGE_MAP: Record<string, number> = {};

AGE_16_COUNTRIES.forEach((code) => {
  COUNTRY_AGE_MAP[code] = 16;
});
AGE_15_COUNTRIES.forEach((code) => {
  COUNTRY_AGE_MAP[code] = 15;
});
AGE_14_COUNTRIES.forEach((code) => {
  COUNTRY_AGE_MAP[code] = 14;
});

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Returns the minimum social-media signup age for a given ISO country code.
 * Falls back to 13 when the code is unknown or `null`.
 */
export function getMinimumAge(countryCode: string | null | undefined): number {
  if (!countryCode) return DEFAULT_MINIMUM_AGE;
  return COUNTRY_AGE_MAP[countryCode.toUpperCase()] ?? DEFAULT_MINIMUM_AGE;
}

/**
 * Builds a user-friendly age-restriction notice.
 *
 * Example:
 *   "Rwanda restricts social media usage to users who are at least 16 years old."
 */
export function getAgeRestrictionMessage(
  countryName: string,
  minimumAge: number,
): string {
  return `${countryName} restricts social media usage to users who are at least ${minimumAge} years old.`;
}

/**
 * Returns the maximum allowed date-of-birth for a user to be eligible, given
 * the country's minimum age requirement.
 *
 * This is "today minus minimumAge years" — if the user's DOB is *after* this
 * date they are too young.
 */
export function getMaxDobForAge(minimumAge: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - minimumAge);
  return d;
}

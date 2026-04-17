const OVER_STATUSES = new Set(['ended', 'stopped']);

type DateLike = string | number | Date | null | undefined;

export function parseChallengeDate(value: DateLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const input = String(value).trim();
  if (!input) return null;

  // Normalize space-separated datetime to T-separated (Hermes doesn't parse "2026-04-14 22:30:00")
  const normalized = input.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');

  // Try ISO-like parsing first — works reliably across V8, JSC, and Hermes
  const isoMatch = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?)?([Zz]|[+-]\d{2}:?\d{2})?$/
  );

  if (isoMatch) {
    const [, year, month, day, hour = '00', minute = '00', second = '00', frac = '0', tz] = isoMatch;

    if (tz) {
      // Has timezone info — let native parser handle it since the format is now clean
      const isoStr = `${year}-${month}-${day}T${hour}:${minute}:${second}.${frac.padEnd(3, '0')}${tz.toUpperCase()}`;
      const d = new Date(isoStr);
      if (!Number.isNaN(d.getTime())) return d;
    }

    // No timezone — construct as local time explicitly (consistent across all engines)
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(frac.padEnd(3, '0').slice(0, 3)),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Fallback: try native parser
  const nativeDate = new Date(input);
  if (!Number.isNaN(nativeDate.getTime())) {
    return nativeDate;
  }

  const nativeNorm = new Date(normalized);
  return Number.isNaN(nativeNorm.getTime()) ? null : nativeNorm;
}

export function getChallengeStatusValue(challenge: any): string {
  return String(challenge?.status || '').toLowerCase();
}

export function isChallengeOver(challenge: any, now = new Date()): boolean {
  if (!challenge) return false;

  const status = getChallengeStatusValue(challenge);
  if (OVER_STATUSES.has(status)) {
    return true;
  }

  if (challenge.is_ended === true || challenge.isEnded === true) {
    return true;
  }

  const endDate = parseChallengeDate(challenge.end_date);
  return !!endDate && now.getTime() > endDate.getTime();
}

export function isChallengeUpcoming(challenge: any, now = new Date()): boolean {
  if (!challenge || isChallengeOver(challenge, now)) {
    return false;
  }

  const status = getChallengeStatusValue(challenge);
  if (status === 'active' || challenge.is_currently_active === true) {
    return false;
  }

  const startDate = parseChallengeDate(challenge.start_date);
  return status === 'approved' && !!startDate && now.getTime() < startDate.getTime();
}

export function isChallengeParticipationOpen(challenge: any, now = new Date()): boolean {
  if (!challenge || isChallengeOver(challenge, now)) {
    return false;
  }

  const status = getChallengeStatusValue(challenge);
  if (
    status === 'pending' ||
    status === 'draft' ||
    status === 'rejected' ||
    status === 'ended' ||
    status === 'stopped'
  ) {
    return false;
  }

  // Also trust backend flags that indicate the challenge is finished
  if (challenge.is_ended === true || challenge.isEnded === true) {
    return false;
  }

  const endDate = parseChallengeDate(challenge.end_date);

  if (challenge.is_currently_active === true || status === 'active') {
    // If there's no parseable end_date but the challenge was fetched from
    // an "active" endpoint, only treat it as open if end_date is genuinely
    // absent. If end_date exists but failed to parse, err on the side of
    // "ended" to prevent ghost appearances in the ongoing tab.
    if (!endDate) {
      const rawEnd = challenge.end_date;
      if (rawEnd !== null && rawEnd !== undefined && String(rawEnd).trim() !== '') {
        return false;
      }
      return true;
    }
    return now.getTime() <= endDate.getTime();
  }

  if (status !== 'approved') {
    return false;
  }

  const startDate = parseChallengeDate(challenge.start_date);

  if (startDate && now.getTime() < startDate.getTime()) {
    return false;
  }

  if (endDate && now.getTime() > endDate.getTime()) {
    return false;
  }

  return true;
}

export function isChallengeStartedEarly(challenge: any, now = new Date()): boolean {
  if (!challenge || isChallengeOver(challenge, now)) {
    return false;
  }

  const status = getChallengeStatusValue(challenge);
  const startDate = parseChallengeDate(challenge.start_date);

  if (!startDate) {
    return false;
  }

  return (
    (status === 'active' || challenge.is_currently_active === true) &&
    now.getTime() < startDate.getTime()
  );
}

export function isChallengeRunning(challenge: any, now = new Date()): boolean {
  return isChallengeParticipationOpen(challenge, now);
}

export function getChallengeDisplayStatus(challenge: any): {
  key: 'pending' | 'rejected' | 'ongoing' | 'upcoming' | 'ended' | 'ended_early' | 'inactive' | 'unknown';
  label: string;
} {
  if (!challenge) {
    return { key: 'unknown', label: 'Unknown' };
  }

  const status = getChallengeStatusValue(challenge);

  if (status === 'pending' || status === 'draft') {
    return { key: 'pending', label: 'Pending Review' };
  }

  if (status === 'rejected') {
    return { key: 'rejected', label: 'Rejected' };
  }

  if (status === 'stopped') {
    return { key: 'ended_early', label: 'Ended early' };
  }

  if (isChallengeStartedEarly(challenge)) {
    return { key: 'ongoing', label: 'Live now' };
  }

  if (isChallengeRunning(challenge)) {
    return { key: 'ongoing', label: 'Ongoing' };
  }

  if (isChallengeUpcoming(challenge)) {
    return { key: 'upcoming', label: 'Upcoming' };
  }

  if (status === 'ended' || isChallengeOver(challenge)) {
    return { key: 'ended', label: 'Ended' };
  }

  return { key: 'inactive', label: 'Inactive' };
}

export function getChallengeDateInfo(challenge: any, now = new Date()) {
  if (!challenge) return null;

  const status = getChallengeStatusValue(challenge);
  const startDate = parseChallengeDate(challenge.start_date);
  const endDate = parseChallengeDate(challenge.end_date);

  if (status === 'stopped') {
    return {
      label: 'Ended early on',
      date: endDate || startDate || now,
      showEndDate: false,
      endDate: endDate || undefined,
    };
  }

  if (isChallengeStartedEarly(challenge, now)) {
    return {
      label: 'Live now until',
      date: endDate || now,
      showEndDate: false,
      endDate: endDate || undefined,
      note: 'Started early by admin',
    };
  }

  if (status !== 'active' && challenge.is_currently_active !== true && startDate && now < startDate) {
    return {
      label: 'Starts on',
      date: startDate,
      showEndDate: !!endDate,
      endDate: endDate || undefined,
    };
  }

  if (!endDate || now <= endDate) {
    return {
      label: 'Started on',
      date: startDate || now,
      showEndDate: !!endDate,
      endDate: endDate || undefined,
    };
  }

  return {
    label: 'Ended on',
    date: endDate,
    showEndDate: false,
    endDate,
  };
}

function buildFormatter(options?: {
  month?: 'numeric' | '2-digit' | 'short' | 'long';
  includeTimeZone?: boolean;
}) {
  return new Intl.DateTimeFormat(undefined, {
    month: options?.month ?? 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(options?.includeTimeZone === false ? {} : { timeZoneName: 'short' }),
  });
}

export function formatChallengeDateTime(
  value: DateLike,
  options?: {
    month?: 'numeric' | '2-digit' | 'short' | 'long';
    includeTimeZone?: boolean;
  },
): string {
  const date = parseChallengeDate(value);
  if (!date) return 'Unknown time';

  try {
    return buildFormatter(options).format(date);
  } catch {
    return date.toLocaleString(undefined, {
      month: options?.month ?? 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
}

export function getCurrentTimeZoneLabel(): string {
  try {
    const formatter = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });
    const parts = formatter.formatToParts(new Date());
    const label = parts.find((part) => part.type === 'timeZoneName')?.value;
    return label || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  }
}

const ACTIVE_STATUSES = new Set(['approved', 'active']);
const OVER_STATUSES = new Set(['ended', 'stopped']);

type DateLike = string | number | Date | null | undefined;

export function parseChallengeDate(value: DateLike): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

  const endDate = parseChallengeDate(challenge.end_date);
  return !!endDate && now.getTime() > endDate.getTime();
}

export function isChallengeUpcoming(challenge: any, now = new Date()): boolean {
  if (!challenge || isChallengeOver(challenge, now)) {
    return false;
  }

  const startDate = parseChallengeDate(challenge.start_date);
  return !!startDate && now.getTime() < startDate.getTime();
}

export function isChallengeRunning(challenge: any, now = new Date()): boolean {
  if (!challenge) return false;

  const status = getChallengeStatusValue(challenge);
  if (challenge.is_currently_active === true) {
    return true;
  }

  if (
    status === 'pending' ||
    status === 'draft' ||
    status === 'rejected' ||
    status === 'ended' ||
    status === 'stopped'
  ) {
    return false;
  }

  const startDate = parseChallengeDate(challenge.start_date);
  const endDate = parseChallengeDate(challenge.end_date);

  if (!startDate || !endDate) {
    return ACTIVE_STATUSES.has(status);
  }

  return ACTIVE_STATUSES.has(status) && now >= startDate && now <= endDate;
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

  if (startDate && now < startDate) {
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

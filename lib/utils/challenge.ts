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

  const nativeDate = new Date(input);
  if (!Number.isNaN(nativeDate.getTime())) {
    return nativeDate;
  }

  const normalized = input.replace(' ', 'T');
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?)?$/
  );

  if (match) {
    const [, year, month, day, hour = '00', minute = '00', second = '00', millisecond = '0'] = match;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond.padEnd(3, '0')),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(input);
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

  if (challenge.is_currently_active === true || status === 'active') {
    const endDate = parseChallengeDate(challenge.end_date);
    return !endDate || now.getTime() <= endDate.getTime();
  }

  if (status !== 'approved') {
    return false;
  }

  const startDate = parseChallengeDate(challenge.start_date);
  const endDate = parseChallengeDate(challenge.end_date);

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

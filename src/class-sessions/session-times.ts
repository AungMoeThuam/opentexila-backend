// UTC timestamps for the session management API. The API sends and receives
// `YYYY-MM-DDTHH:mm:ss[.sss]Z`. MySQL DATETIME has no zone; the connection is
// configured with timezone 'Z', so values are written as UTC text.

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

// Null for text that is not an exact UTC timestamp, including dates that
// JavaScript would quietly move (for example 31 February).
export function parseUtcTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 19) === value.slice(0, 19) ? date : null;
}

// The longest late allowance, in minutes after the start: a check-in up to
// `late_after` is Present, a later one is Late. Without a limit, a student who
// arrives almost at the end of a class is still marked Present (#67). The
// frontend forms use the same number (MAX_LATE_MINUTES in
// frontend/src/features/courses/services/late-allowance.js); change both.
export const MAX_LATE_MINUTES = 30;

const MINUTE_MS = 60_000;

// True when `late` is more than MAX_LATE_MINUTES after `start`.
export function lateTooLong(start: Date, late: Date): boolean {
  return late.getTime() - start.getTime() > MAX_LATE_MINUTES * MINUTE_MS;
}

export const LATE_TOO_LONG_MESSAGE = `The late time must be at most ${MAX_LATE_MINUTES} minutes after the start time.`;

export function mysqlUtc(date: Date): string {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

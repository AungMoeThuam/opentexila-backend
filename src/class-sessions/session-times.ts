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

export function mysqlUtc(date: Date): string {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

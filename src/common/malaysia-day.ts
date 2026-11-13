// Date-only filters (`YYYY-MM-DD`) are Malaysia days: a fixed UTC+8 offset
// with no daylight saving. See docs/adr/0001-date-filters-use-malaysia-time.md.
export const MALAYSIA_OFFSET_HOURS = 8;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// MySQL DATETIME starts at year 1000. The top year leaves room for the
// one-day and eight-hour shifts below.
const MIN_YEAR = 1000;
const MAX_YEAR = 9998;

// UTC midnight of a real YYYY-MM-DD date in years 1000-9998, or undefined.
// Such a day is a label for a Malaysia day, not an instant: turn it into one
// with malaysiaDayStart.
export function parseMalaysiaDay(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [+match[1], +match[2], +match[3]];
  if (year < MIN_YEAR || year > MAX_YEAR) return undefined;
  const midnight = Date.UTC(year, month - 1, day);
  const check = new Date(midnight);
  return check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
    ? midnight
    : undefined;
}

// The UTC instant a Malaysia day starts. Pass `days = 1` for the instant it
// ends (the start of the next day).
export const malaysiaDayStart = (day: number, days = 0): Date =>
  new Date(day + days * DAY - MALAYSIA_OFFSET_HOURS * HOUR);

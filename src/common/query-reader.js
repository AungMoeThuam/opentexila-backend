import { validationError } from './api-exception';

// Date, time, then Z or a numeric offset. A timezone is required.
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// Reads and checks query or path values. Collect every problem, then call finish().
export class QueryReader {
  constructor(source) {
    this.source = source;
    this.fields = {};
  }

  fail(name, message) {
    this.fields[name] ??= message;
  }

  integer(name, { max, fallback, required = false }) {
    const value = this.source[name];
    if (value === undefined) {
      if (required) this.fail(name, `${name} is required.`);
      return fallback;
    }
    if (
      typeof value !== 'string' ||
      !/^[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) > max
    ) {
      this.fail(name, `${name} must be an integer between 1 and ${max}.`);
      return undefined;
    }
    return Number(value);
  }

  timestamp(name) {
    const value = this.source[name];
    if (value === undefined) return undefined;
    const parts = typeof value === 'string' ? TIMESTAMP.exec(value) : null;
    const date = parts ? new Date(value) : null;
    const [, year, month, day, hour, minute, second = '0'] = parts ?? [];
    if (
      !date ||
      Number.isNaN(date.getTime()) ||
      Number(month) < 1 ||
      Number(month) > 12 ||
      Number(day) < 1 ||
      Number(day) >
        new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate() ||
      Number(hour) > 23 ||
      Number(minute) > 59 ||
      Number(second) > 59
    ) {
      this.fail(name, `${name} must be an ISO 8601 timestamp with a timezone.`);
      return undefined;
    }
    return date;
  }

  oneOf(name, allowed) {
    const value = this.source[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !allowed.includes(value)) {
      this.fail(name, `${name} must be one of: ${allowed.join(', ')}.`);
      return undefined;
    }
    return value;
  }

  boolean(name, fallback = false) {
    const value = this.source[name];
    if (value === undefined || value === null || value === '') return fallback;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    this.fail(name, `${name} must be either "true" or "false".`);
    return fallback;
  }

  finish() {
    if (Object.keys(this.fields).length > 0) throw validationError(this.fields);
  }
}

export const pageMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

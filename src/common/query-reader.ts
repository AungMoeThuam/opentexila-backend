import { ErrorFields, validationError } from './api-exception';

// Date, time, then Z or a numeric offset. A timezone is required.
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Parses optional history timestamps. Call finish() to report invalid values.
export class QueryReader {
  private readonly source: Record<string, unknown>;
  private readonly fields: ErrorFields;

  constructor(source: Record<string, unknown>) {
    this.source = source;
    this.fields = {};
  }

  private fail(name: string, message: string): void {
    this.fields[name] ??= message;
  }

  timestamp(name: string): Date | undefined {
    const value = this.source[name];
    if (value === undefined) return undefined;
    const parts = typeof value === 'string' ? TIMESTAMP.exec(value) : null;
    const date = parts ? new Date(value as string) : null;
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

  finish(): void {
    if (Object.keys(this.fields).length > 0) throw validationError(this.fields);
  }
}

export const pageMeta = (
  page: number,
  limit: number,
  total: number,
): PageMeta => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

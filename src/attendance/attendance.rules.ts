import { HttpException } from '@nestjs/common';
import type {
  AttendanceRecordEntity,
  ClassSessionEntity,
  UserRole,
} from '../database/entities';

export interface AttendanceCaller {
  id: number;
  role: UserRole;
}

export interface ListQueryResult {
  page: number;
  limit: number;
  classId?: number;
  from?: Date;
  to?: Date;
}

export interface LocationReading {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  reading_timestamp: Date;
}

export type SessionAvailability =
  'cancelled' | 'upcoming' | 'in_progress' | 'ended';

export function fail(
  status: number,
  code: string,
  message: string,
  fields: Record<string, string> = {},
): never {
  throw new HttpException({ error: { code, message, fields } }, status);
}

export function invalid(field: string, message: string): never {
  fail(422, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', {
    [field]: message,
  });
}

export function positiveInteger(
  value: unknown,
  field: string,
  maximum = 4294967295,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > maximum
  )
    invalid(field, `Must be an integer between 1 and ${maximum}.`);
  return Number(value);
}

export function timestamp(
  value: unknown,
  field: string,
  utcOnly = false,
): Date {
  const pattern =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
  const match = typeof value === 'string' && pattern.exec(value);
  if (!match || (utcOnly && !(value as string).endsWith('Z')))
    invalid(field, 'Must be a valid ISO 8601 timestamp with timezone.');
  const [, year, month, day, hour, minute, second, zone] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (
    Number(year) < 1000 ||
    +month < 1 ||
    +month > 12 ||
    +day < 1 ||
    +day > days ||
    +hour > 23 ||
    +minute > 59 ||
    +second > 59 ||
    (zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) ||
    !Number.isFinite(Date.parse(value as string))
  )
    invalid(field, 'Must be a valid ISO 8601 timestamp with timezone.');
  return new Date(value as string);
}

export function listQuery(query: Record<string, unknown>): ListQueryResult {
  const result: ListQueryResult = {
    page: positiveInteger(query.page, 'page', 10000, 1),
    limit: positiveInteger(query.limit, 'limit', 100, 20),
  };
  if (query.classId !== undefined)
    result.classId = positiveInteger(query.classId, 'classId');
  for (const field of ['from', 'to'] as const)
    if (query[field] !== undefined)
      result[field] = timestamp(query[field], field);
  if (result.from && result.to && result.from >= result.to)
    invalid('to', 'Must be later than from.');
  return result;
}

export function locationBody(body: unknown): LocationReading {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    invalid('body', 'A JSON object is required.');
  const record = body as Record<string, unknown>;
  for (const [field, min, max] of [
    ['latitude', -90, 90],
    ['longitude', -180, 180],
    ['accuracy_m', 0, Number.MAX_VALUE],
  ] as const) {
    const val = record[field];
    if (
      typeof val !== 'number' ||
      !Number.isFinite(val) ||
      val < min ||
      val > max ||
      (field === 'accuracy_m' && val === 0)
    )
      invalid(
        field,
        `Must be a finite number ${field === 'accuracy_m' ? 'greater than zero' : `between ${min} and ${max}`}.`,
      );
  }
  return {
    latitude: record.latitude as number,
    longitude: record.longitude as number,
    accuracy_m: record.accuracy_m as number,
    reading_timestamp: timestamp(
      record.reading_timestamp,
      'reading_timestamp',
      true,
    ),
  };
}

export function availability(
  session: Pick<ClassSessionEntity, 'state' | 'starts_at' | 'ends_at'>,
  now: Date,
): SessionAvailability {
  return session.state === 'cancelled'
    ? 'cancelled'
    : now < session.starts_at
      ? 'upcoming'
      : now < session.ends_at
        ? 'in_progress'
        : 'ended';
}

export function eligibility(
  session: Pick<ClassSessionEntity, 'state' | 'starts_at' | 'ends_at'>,
  user: AttendanceCaller,
  eligible: boolean,
  record: Pick<AttendanceRecordEntity, 'status'> | null | undefined,
  now: Date,
) {
  const reason =
    session.state === 'cancelled'
      ? 'CLASS_CANCELLED'
      : user.role !== 'student'
        ? 'ROLE_NOT_STUDENT'
        : !eligible
          ? 'NOT_ELIGIBLE'
          : ['present', 'late'].includes(record?.status as string)
            ? 'ALREADY_CHECKED_IN'
            : now < session.starts_at
              ? 'NOT_STARTED'
              : now >= session.ends_at
                ? 'CLASS_ENDED'
                : null;
  return { allowed: reason === null, reason };
}

export function distanceMeters(
  latitude: number,
  longitude: number,
  targetLatitude: number,
  targetLongitude: number,
): number {
  const rad = (value: number) => (value * Math.PI) / 180;
  const a =
    Math.sin(rad(targetLatitude - latitude) / 2) ** 2 +
    Math.cos(rad(latitude)) *
      Math.cos(rad(targetLatitude)) *
      Math.sin(rad(targetLongitude - longitude) / 2) ** 2;
  return (
    6371000 *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)))
  );
}

// Explicit policy, shared by service and tests; raw readings are never stored.
export const locationPolicy = Object.freeze({
  maxAgeMs: 60000,
  futureToleranceMs: 5000,
  maxAccuracyM: 100,
});

export function validateLocation(
  reading: LocationReading,
  session: Pick<ClassSessionEntity, 'latitude' | 'longitude' | 'radius_m'>,
  now: Date,
): number {
  const age = +now - +reading.reading_timestamp;
  if (age > locationPolicy.maxAgeMs || age < -locationPolicy.futureToleranceMs)
    fail(
      422,
      'LOCATION_STALE',
      'Your location reading has expired or is in the future. Please retry.',
    );
  if (reading.accuracy_m > locationPolicy.maxAccuracyM)
    fail(
      422,
      'LOCATION_INACCURATE',
      'Your location is not accurate enough. Please retry.',
    );
  const distance = distanceMeters(
    reading.latitude,
    reading.longitude,
    Number(session.latitude),
    Number(session.longitude),
  );
  if (distance > Number(session.radius_m))
    fail(
      422,
      'OUTSIDE_ALLOWED_AREA',
      'You are outside the allowed classroom check-in area.',
    );
  return distance;
}

import { ApiException, validationError } from '../common/api-exception';
import type { CheckInEligibility } from './dto/attendance-response.dto';
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
  throw new ApiException(status, code, message, fields);
}

function invalid(field: string, message: string): never {
  throw validationError({ [field]: message });
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
  user: Pick<AttendanceCaller, 'role'>,
  eligible: boolean,
  record: Pick<AttendanceRecordEntity, 'status'> | null | undefined,
  now: Date,
): CheckInEligibility {
  const reason =
    session.state === 'cancelled'
      ? 'CLASS_CANCELLED'
      : user.role !== 'student'
        ? 'ROLE_NOT_STUDENT'
        : !eligible
          ? 'NOT_ELIGIBLE'
          : record?.status === 'present' || record?.status === 'late'
            ? 'ALREADY_CHECKED_IN'
            : now < session.starts_at
              ? 'NOT_STARTED'
              : now >= session.ends_at
                ? 'CLASS_ENDED'
                : null;
  return reason === null
    ? { allowed: true, reason: null }
    : { allowed: false, reason };
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

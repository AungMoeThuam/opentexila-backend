import { HttpException } from '@nestjs/common';

export function fail(status, code, message, fields = {}) {
  throw new HttpException({ error: { code, message, fields } }, status);
}
export function invalid(field, message) {
  fail(422, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', {
    [field]: message,
  });
}
export function positiveInteger(value, field, maximum = 4294967295, fallback) {
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
export function timestamp(value, field, utcOnly = false) {
  const pattern =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
  const match = typeof value === 'string' && pattern.exec(value);
  if (!match || (utcOnly && !value.endsWith('Z')))
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
    !Number.isFinite(Date.parse(value))
  )
    invalid(field, 'Must be a valid ISO 8601 timestamp with timezone.');
  return new Date(value);
}
export function listQuery(query) {
  const result = {
    page: positiveInteger(query.page, 'page', 10000, 1),
    limit: positiveInteger(query.limit, 'limit', 100, 20),
  };
  if (query.classId !== undefined)
    result.classId = positiveInteger(query.classId, 'classId');
  for (const field of ['from', 'to'])
    if (query[field] !== undefined)
      result[field] = timestamp(query[field], field);
  if (result.from && result.to && result.from >= result.to)
    invalid('to', 'Must be later than from.');
  return result;
}
export function locationBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    invalid('body', 'A JSON object is required.');
  for (const [field, min, max] of [
    ['latitude', -90, 90],
    ['longitude', -180, 180],
    ['accuracy_m', 0, Number.MAX_VALUE],
  ]) {
    if (
      typeof body[field] !== 'number' ||
      !Number.isFinite(body[field]) ||
      body[field] < min ||
      body[field] > max ||
      (field === 'accuracy_m' && body[field] === 0)
    )
      invalid(
        field,
        `Must be a finite number ${field === 'accuracy_m' ? 'greater than zero' : `between ${min} and ${max}`}.`,
      );
  }
  return {
    latitude: body.latitude,
    longitude: body.longitude,
    accuracy_m: body.accuracy_m,
    reading_timestamp: timestamp(
      body.reading_timestamp,
      'reading_timestamp',
      true,
    ),
  };
}
export function availability(session, now) {
  return session.state === 'cancelled'
    ? 'cancelled'
    : now < session.starts_at
      ? 'upcoming'
      : now < session.ends_at
        ? 'in_progress'
        : 'ended';
}
export function eligibility(session, user, eligible, record, now) {
  const reason =
    session.state === 'cancelled'
      ? 'CLASS_CANCELLED'
      : user.role !== 'student'
        ? 'ROLE_NOT_STUDENT'
        : !eligible
          ? 'NOT_ELIGIBLE'
          : ['present', 'late'].includes(record?.status)
            ? 'ALREADY_CHECKED_IN'
            : now < session.starts_at
              ? 'NOT_STARTED'
              : now >= session.ends_at
                ? 'CLASS_ENDED'
                : null;
  return { allowed: reason === null, reason };
}
export function distanceMeters(
  latitude,
  longitude,
  targetLatitude,
  targetLongitude,
) {
  const rad = (value) => (value * Math.PI) / 180;
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
export function validateLocation(reading, session, now) {
  const age = now - reading.reading_timestamp;
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

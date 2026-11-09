import { ApiException, type ErrorFields } from '../common/api-exception';

// Provisional upper limit for a class's attendance geofence, in metres.
// Documented in docs/api/courses-classes.md; tune once real venues are tested.
export const MAX_RADIUS_M = 1000;
export const MIN_RADIUS_M = 1;
export const MAX_ID = 4294967295;

// Fields that identify an offering. They are frozen once class sessions exist.
export const CLASS_IDENTITY_FIELDS = ['course_id', 'term', 'section'] as const;

export const courseCodeTaken = (): ApiException =>
  new ApiException(
    409,
    'COURSE_CODE_TAKEN',
    'A course with this code already exists.',
    { code: 'A course with this code already exists.' },
  );

export const classSectionTaken = (): ApiException =>
  new ApiException(
    409,
    'CLASS_SECTION_TAKEN',
    'This course already has this section in this term.',
    { section: 'This course already has this section in this term.' },
  );

export const classHasSessions = (fields: readonly string[]): ApiException =>
  new ApiException(
    409,
    'CLASS_HAS_SESSIONS',
    'Course, term and section cannot change after class sessions exist.',
    Object.fromEntries(
      fields.map((field) => [
        field,
        'Cannot change after class sessions exist.',
      ]),
    ) as ErrorFields,
  );

export const lecturerNotEligible = (): ApiException =>
  new ApiException(
    422,
    'LECTURER_NOT_ELIGIBLE',
    'The selected user cannot be assigned as the lecturer.',
    { lecturer_id: 'Select an active lecturer.' },
  );

export const emptyUpdate = (): ApiException =>
  new ApiException(
    422,
    'VALIDATION_ERROR',
    'Provide at least one field to update.',
  );

// Returns the unique key name for a MySQL duplicate-key error, else undefined.
export function duplicateKey(error: unknown): string | undefined {
  const candidates = [error, (error as { driverError?: unknown })?.driverError];
  for (const candidate of candidates) {
    const value = candidate as
      | {
          code?: unknown;
          errno?: unknown;
          message?: unknown;
          sqlMessage?: unknown;
        }
      | undefined;
    if (value?.code === 'ER_DUP_ENTRY' || value?.errno === 1062) {
      const text = String(value.sqlMessage ?? value.message ?? '');
      return /for key '(?:[^'.]+\.)?([^']+)'/.exec(text)?.[1] ?? '';
    }
  }
  return undefined;
}

// Keeps only properties the client actually sent (DTO fields default to undefined).
export function definedEntries<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export const toDecimal = (value: unknown, places: number): string =>
  Number(value).toFixed(places);

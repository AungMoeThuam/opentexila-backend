import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiException,
  validationError,
  notFound,
} from '../dist/common/api-exception.js';
import { QueryReader, pageMeta } from '../dist/common/query-reader.js';
import { createValidationPipe } from '../dist/common/validation.pipe.js';
import { PaginationQueryDto } from '../dist/common/dto/pagination-query.dto.js';
import {
  ClassSessionsQueryDto,
  ClassSessionParamsDto,
  PersonalAttendanceQueryDto,
} from '../dist/attendance/dto/attendance-query.dto.js';
import { CheckInDto } from '../dist/attendance/dto/check-in.dto.js';

function failure(work: () => void): any {
  try {
    work();
  } catch (error) {
    return error;
  }
  assert.fail('Expected the work to throw.');
}

function assertValidationError(error: any, ...names: string[]) {
  assert.ok(error instanceof ApiException);
  assert.equal(error.getStatus(), 422);
  const { code, message, fields } = (error.getResponse() as any).error;
  assert.equal(code, 'VALIDATION_ERROR');
  assert.equal(message, 'Please correct the highlighted fields.');
  assert.deepEqual(Object.keys(fields).sort(), names.sort());
}

test('ApiException helpers build the shared error envelope', () => {
  const missing = notFound('Class session not found.');
  assert.equal(missing.getStatus(), 404);
  assert.deepEqual(missing.getResponse(), {
    error: {
      code: 'RESOURCE_NOT_FOUND',
      message: 'Class session not found.',
      fields: {},
    },
  });
  const invalid = validationError({ page: 'bad' });
  assert.equal(invalid.getStatus(), 422);
  assert.deepEqual((invalid.getResponse() as any).error.fields, {
    page: 'bad',
  });
});

test('QueryReader.timestamp needs an explicit timezone', () => {
  const instant = '2026-10-29T01:00:00.000Z';
  for (const value of [instant, '2026-10-29T09:00:00+08:00']) {
    const reader = new QueryReader({ from: value });
    assert.equal(reader.timestamp('from')!.toISOString(), instant);
    assert.doesNotThrow(() => reader.finish());
  }
  assert.equal(new QueryReader({}).timestamp('from'), undefined);
  for (const value of [
    '2026-10-29T01:00:00',
    '2026-10-29',
    'abc',
    '2026-13-40T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-02-29T00:00:00Z',
    ['2026-10-29T01:00:00Z', '2026-10-30T01:00:00Z'],
  ]) {
    const reader = new QueryReader({ from: value });
    reader.timestamp('from');
    assertValidationError(
      failure(() => reader.finish()),
      'from',
    );
  }
});

test('pageMeta computes total pages', () => {
  assert.deepEqual(pageMeta(2, 5, 21), {
    page: 2,
    limit: 5,
    total: 21,
    totalPages: 5,
  });
  assert.equal(pageMeta(1, 20, 0).totalPages, 0);
});

test('createValidationPipe formats class-validator errors into 422 VALIDATION_ERROR envelope', async () => {
  const pipe = createValidationPipe();

  // Valid value
  const valid = (await pipe.transform(
    { page: '5', limit: '10' },
    {
      type: 'query',
      metatype: PaginationQueryDto,
    },
  )) as PaginationQueryDto;
  assert.equal(valid.page, 5);
  assert.equal(valid.limit, 10);

  // Invalid value throws 422 ApiException
  await assert.rejects(
    () =>
      pipe.transform(
        { page: '15000' },
        {
          type: 'query',
          metatype: PaginationQueryDto,
        },
      ),
    (error: any) => {
      assert.ok(error instanceof ApiException);
      assert.equal(error.getStatus(), 422);
      const body = error.getResponse() as any;
      assert.equal(body.error.code, 'VALIDATION_ERROR');
      assert.equal(
        body.error.message,
        'Please correct the highlighted fields.',
      );
      assert.equal(
        body.error.fields.page,
        'Must be an integer between 1 and 10000.',
      );
      return true;
    },
  );
});

test('request DTOs keep strict query parsing and remove undeclared fields', async () => {
  const pipe = createValidationPipe();
  const dto: ClassSessionsQueryDto = await pipe.transform(
    { page: '2', limit: '5', classId: '4294967295', studentId: '999' },
    { type: 'query', metatype: ClassSessionsQueryDto },
  );
  assert.ok(dto instanceof ClassSessionsQueryDto);
  assert.equal(dto.page, 2);
  assert.equal(dto.limit, 5);
  assert.equal(dto.classId, 4294967295);
  assert.equal('studentId' in dto, false);
  const defaults: ClassSessionsQueryDto = await pipe.transform(
    {},
    {
      type: 'query',
      metatype: ClassSessionsQueryDto,
    },
  );
  assert.equal(defaults.page, 1);
  assert.equal(defaults.limit, 20);
  for (const value of [
    '1e2',
    '0x10',
    '01',
    '+1',
    ' 1 ',
    '',
    ['1', '2'],
    null,
    true,
  ]) {
    await assert.rejects(
      () =>
        pipe.transform(
          { page: value },
          { type: 'query', metatype: ClassSessionsQueryDto },
        ),
      (error: unknown) =>
        error instanceof ApiException &&
        error.getStatus() === 422 &&
        'page' in error.getResponse().error.fields,
    );
  }
  const maximum: ClassSessionParamsDto = await pipe.transform(
    { classSessionId: '4294967295' },
    {
      type: 'param',
      metatype: ClassSessionParamsDto,
    },
  );
  assert.equal(maximum.classSessionId, 4294967295);
  await assert.rejects(
    () =>
      pipe.transform({}, { type: 'param', metatype: ClassSessionParamsDto }),
    ApiException,
  );
  for (const value of ['0', '4294967296', '30abc', ['30'], null]) {
    await assert.rejects(
      () =>
        pipe.transform(
          { classSessionId: value },
          { type: 'param', metatype: ClassSessionParamsDto },
        ),
      (error: unknown) =>
        error instanceof ApiException &&
        'classSessionId' in error.getResponse().error.fields,
    );
  }
});

test('history DTO handles false explicitly and aggregates field errors', async () => {
  const pipe = createValidationPipe();
  const valid: PersonalAttendanceQueryDto = await pipe.transform(
    { status: 'late' },
    {
      type: 'query',
      metatype: PersonalAttendanceQueryDto,
    },
  );
  assert.equal(valid.status, 'late');
  for (const status of ['LATE', 'x', '', ['late', 'late']]) {
    await assert.rejects(
      () =>
        pipe.transform(
          { status },
          {
            type: 'query',
            metatype: PersonalAttendanceQueryDto,
          },
        ),
      (error: unknown) => {
        assertValidationError(error, 'status');
        return true;
      },
    );
  }

  for (const [value, expected] of [
    ['false', false],
    ['true', true],
    ['', false],
  ] as const) {
    const dto: PersonalAttendanceQueryDto = await pipe.transform(
      { includeCancelled: value },
      {
        type: 'query',
        metatype: PersonalAttendanceQueryDto,
      },
    );
    assert.equal(dto.includeCancelled, expected);
  }
  await assert.rejects(
    () =>
      pipe.transform(
        { page: '0', limit: '101', status: 'LATE', includeCancelled: 'yes' },
        {
          type: 'query',
          metatype: PersonalAttendanceQueryDto,
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof ApiException);
      assert.deepEqual(Object.keys(error.getResponse().error.fields).sort(), [
        'includeCancelled',
        'limit',
        'page',
        'status',
      ]);
      return true;
    },
  );
});

test('date DTOs preserve timestamp precision rules and validate ranges', async () => {
  const pipe = createValidationPipe();
  const history: PersonalAttendanceQueryDto = await pipe.transform(
    { from: '2026-11-02T12:00+08:00' },
    {
      type: 'query',
      metatype: PersonalAttendanceQueryDto,
    },
  );
  assert.equal(history.from?.toISOString(), '2026-11-02T04:00:00.000Z');
  for (const metatype of [PersonalAttendanceQueryDto, ClassSessionsQueryDto]) {
    for (const query of [
      { from: '2026-02-30T00:00:00Z' },
      { from: '2026-11-02T00:00:00' },
      { from: '2026-11-02T00:00:00Z', to: '2026-11-02T00:00:00Z' },
      { from: '2026-11-03T00:00:00Z', to: '2026-11-02T00:00:00Z' },
    ]) {
      await assert.rejects(
        () => pipe.transform(query, { type: 'query', metatype }),
        ApiException,
      );
    }
  }
  await assert.rejects(
    () =>
      pipe.transform(
        { from: '2026-11-02T12:00Z' },
        {
          type: 'query',
          metatype: ClassSessionsQueryDto,
        },
      ),
    ApiException,
  );
});

test('check-in DTO rejects numeric coercion and requires a real UTC timestamp', async () => {
  const pipe = createValidationPipe();
  const body = {
    latitude: 0,
    longitude: 0,
    accuracy_m: 5,
    reading_timestamp: '2026-11-02T04:00:00Z',
  };
  const dto: CheckInDto = await pipe.transform(
    { ...body, student_id: 999 },
    {
      type: 'body',
      metatype: CheckInDto,
    },
  );
  assert.ok(dto instanceof CheckInDto);
  assert.ok(dto.reading_timestamp instanceof Date);
  assert.equal('student_id' in dto, false);
  for (const patch of [
    { latitude: '0' },
    { latitude: null },
    { latitude: true },
    { latitude: [0] },
    { longitude: 181 },
    { accuracy_m: 0 },
    { accuracy_m: '5' },
    { reading_timestamp: '2026-11-02T12:00:00+08:00' },
    { reading_timestamp: '2026-02-30T04:00:00Z' },
  ]) {
    await assert.rejects(
      () =>
        pipe.transform(
          { ...body, ...patch },
          {
            type: 'body',
            metatype: CheckInDto,
          },
        ),
      ApiException,
    );
  }
  await assert.rejects(
    () => pipe.transform([], { type: 'body', metatype: CheckInDto }),
    ApiException,
  );
});

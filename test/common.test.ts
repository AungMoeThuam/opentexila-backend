import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiException,
  validationError,
  notFound,
} from '../dist/common/api-exception.js';
import { ApiExceptionFilter } from '../dist/common/api-exception.filter.js';
import { QueryReader, pageMeta } from '../dist/common/query-reader.js';
import {
  createValidationPipe,
  formatValidationErrors,
} from '../dist/common/validation.pipe.js';
import { PaginationQueryDto } from '../dist/common/dto/pagination-query.dto.js';

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

test('ApiExceptionFilter writes the status and the error envelope', () => {
  const sent: { status?: number; body?: any } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: any) {
      sent.body = body;
      return this;
    },
  };
  const host: any = { switchToHttp: () => ({ getResponse: () => response }) };
  new ApiExceptionFilter().catch(
    new ApiException(404, 'RESOURCE_NOT_FOUND', 'x'),
    host,
  );
  assert.equal(sent.status, 404);
  assert.deepEqual(sent.body, {
    error: { code: 'RESOURCE_NOT_FOUND', message: 'x', fields: {} },
  });
});

test('QueryReader.integer applies fallback and accepts valid integers', () => {
  const options = { max: 10000, fallback: 1 };
  assert.equal(new QueryReader({}).integer('page', options), 1);
  const reader = new QueryReader({ page: '3' });
  assert.equal(reader.integer('page', options), 3);
  assert.doesNotThrow(() => reader.finish());
  assert.equal(new QueryReader({}).integer('classId', { max: 9 }), undefined);
});

test('QueryReader.integer rejects every malformed value', () => {
  for (const value of ['0', '-1', '1.5', '1e2', '', '10001', ['1', '2']]) {
    const reader = new QueryReader({ page: value });
    reader.integer('page', { max: 10000, fallback: 1 });
    assertValidationError(
      failure(() => reader.finish()),
      'page',
    );
  }
});

test('QueryReader.integer enforces required path ids and the id maximum', () => {
  const options = { max: 4294967295, required: true };
  for (const source of [
    {},
    { classSessionId: '4294967296' },
    { classSessionId: '1abc' },
  ]) {
    const reader = new QueryReader(source);
    reader.integer('classSessionId', options);
    assertValidationError(
      failure(() => reader.finish()),
      'classSessionId',
    );
  }
  const reader = new QueryReader({ classSessionId: '4294967295' });
  assert.equal(reader.integer('classSessionId', options), 4294967295);
  assert.doesNotThrow(() => reader.finish());
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

test('QueryReader.oneOf accepts only listed values', () => {
  const allowed = ['pending', 'present', 'late', 'absent'];
  const reader = new QueryReader({ status: 'late' });
  assert.equal(reader.oneOf('status', allowed), 'late');
  assert.doesNotThrow(() => reader.finish());
  assert.equal(new QueryReader({}).oneOf('status', allowed), undefined);
  for (const value of ['LATE', 'x', '', ['late', 'late']]) {
    const bad = new QueryReader({ status: value });
    bad.oneOf('status', allowed);
    assertValidationError(
      failure(() => bad.finish()),
      'status',
    );
  }
});

test('QueryReader.boolean parses boolean values and rejects others', () => {
  assert.equal(new QueryReader({}).boolean('includeCancelled', false), false);
  assert.equal(
    new QueryReader({ includeCancelled: 'true' }).boolean('includeCancelled'),
    true,
  );
  assert.equal(
    new QueryReader({ includeCancelled: 'false' }).boolean('includeCancelled'),
    false,
  );
  const bad = new QueryReader({ includeCancelled: 'yes' });
  bad.boolean('includeCancelled');
  assertValidationError(
    failure(() => bad.finish()),
    'includeCancelled',
  );
});

test('QueryReader.finish reports every bad field in one error', () => {
  const reader = new QueryReader({ page: '0', limit: '101', status: 'x' });
  reader.integer('page', { max: 10000, fallback: 1 });
  reader.integer('limit', { max: 100, fallback: 20 });
  reader.oneOf('status', ['pending']);
  reader.fail('from', 'from must be earlier than to.');
  assertValidationError(
    failure(() => reader.finish()),
    'page',
    'limit',
    'status',
    'from',
  );
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

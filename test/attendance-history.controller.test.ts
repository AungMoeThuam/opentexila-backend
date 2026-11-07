import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { ApiException } from '../dist/common/api-exception.js';
import { AttendanceRecordsController } from '../dist/attendance/me-attendance-records.controller.js';
import type { AttendanceHistoryService } from '../dist/attendance/attendance-history.service.js';
import { createValidationPipe } from '../dist/common/validation.pipe.js';
import { PersonalAttendanceQueryDto } from '../dist/attendance/dto/attendance-query.dto.js';
import type { AttendanceCaller } from '../dist/attendance/attendance.rules.js';

test('AttendanceRecordsController routes and metadata', () => {
  const paths = Reflect.getMetadata(PATH_METADATA, AttendanceRecordsController);

  assert.deepEqual(paths, ['me/attendance-records', 'attendance/me']);
});

test('AttendanceRecordsController and DTO pipeline enforce authentication, authorization, and validation', async (t) => {
  const calls: any[] = [];
  const service = {
    async getPersonalAttendanceRecords(query: any) {
      calls.push(query);
      return {
        data: [],
        meta: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
      };
    },
  } as unknown as AttendanceHistoryService;
  const controller = new AttendanceRecordsController(service);
  const pipe = createValidationPipe();
  async function invoke(
    query: Record<string, unknown>,
    request: { authUser?: AttendanceCaller },
  ) {
    const dto: PersonalAttendanceQueryDto = await pipe.transform(query, {
      type: 'query',
      metatype: PersonalAttendanceQueryDto,
    });
    return controller.getPersonalAttendanceRecords(dto, request.authUser!);
  }

  await t.test('rejects unauthenticated requests with 401', async () => {
    await assert.rejects(
      () => invoke({}, {} as any),
      (error) => error instanceof ApiException && error.getStatus() === 401,
    );
  });

  await t.test('rejects teacher and admin with 403', async () => {
    for (const role of ['teacher', 'admin'] as const) {
      await assert.rejects(
        () =>
          invoke({}, {
            authUser: { id: 2, role },
          } as any),
        (error) => error instanceof ApiException && error.getStatus() === 403,
      );
    }
  });

  const validReq: any = {
    authUser: {
      id: 3,
      role: 'student',
    },
  };

  await t.test('validates page', async () => {
    for (const invalid of ['0', '-1', '10001', 'abc', '1.5']) {
      await assert.rejects(
        () => invoke({ page: invalid }, validReq),
        (error) => error instanceof ApiException && error.getStatus() === 422,
      );
    }
  });

  await t.test('validates limit', async () => {
    for (const invalid of ['0', '-5', '101', 'xyz']) {
      await assert.rejects(
        () => invoke({ limit: invalid }, validReq),
        (error) => error instanceof ApiException && error.getStatus() === 422,
      );
    }
  });

  await t.test('validates classId', async () => {
    for (const invalid of ['0', '-1', 'abc']) {
      await assert.rejects(
        () => invoke({ classId: invalid }, validReq),
        (error) => error instanceof ApiException && error.getStatus() === 422,
      );
    }
  });

  await t.test('validates ISO timestamps and date range', async () => {
    for (const invalid of ['2026-10-29', 'not-a-date', '2026-10-29T10:00:00']) {
      await assert.rejects(
        () => invoke({ from: invalid }, validReq),
        (error) => error instanceof ApiException && error.getStatus() === 422,
      );
    }

    await assert.rejects(
      () =>
        invoke(
          {
            from: '2026-10-30T00:00:00.000Z',
            to: '2026-10-20T00:00:00.000Z',
          },
          validReq,
        ),
      (error) => error instanceof ApiException && error.getStatus() === 422,
    );
  });

  await t.test('validates status', async () => {
    await assert.rejects(
      () => invoke({ status: 'unknown' }, validReq),
      (error) => error instanceof ApiException && error.getStatus() === 422,
    );
  });

  await t.test('validates includeCancelled', async () => {
    for (const invalid of ['yes', '1', '0', 'no']) {
      await assert.rejects(
        () => invoke({ includeCancelled: invalid }, validReq),
        (error) => error instanceof ApiException && error.getStatus() === 422,
      );
    }
  });

  await t.test(
    'passes validated query and verified student identity to the service',
    async () => {
      const result = await invoke(
        {
          page: '1',
          limit: '10',
          includeCancelled: 'false',
          studentId: '999',
        },
        validReq,
      );

      assert.equal(result.meta.page, 1);
      assert.equal(result.meta.limit, 10);
      assert.equal(result.meta.total, 0);
      assert.ok(Array.isArray(result.data));

      assert.deepEqual(
        Object.fromEntries(
          Object.entries(calls.at(-1)).filter(
            ([, value]) => value !== undefined,
          ),
        ),
        {
          page: 1,
          limit: 10,
          includeCancelled: false,
          studentId: 3,
        },
      );
    },
  );
});

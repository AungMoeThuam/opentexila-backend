import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { ApiException } from '../dist/common/api-exception.js';
import { AttendanceRecordsController as AttendanceController } from '../dist/attendance/me-attendance-records.controller.js';
import { AttendanceHistoryService as AttendanceService } from '../dist/attendance/attendance-history.service.js';

import { createValidationPipe } from '../dist/common/validation.pipe.js';
import { PersonalAttendanceQueryDto } from '../dist/attendance/dto/attendance-query.dto.js';
import type { AttendanceCaller } from '../dist/attendance/attendance.rules.js';

// Test-only fixture. This data is never used by the actual API.
function makeRecord({
  studentId = 3,
  sessionId = 30,
  classId = 1,
  code = 'COS30043',
  status = 'present',
  sessionState = 'scheduled',
  startsAt = '2026-10-29T01:00:00.000Z',
}: Record<string, any> = {}) {
  return {
    class_session_id: sessionId,
    student_id: studentId,
    status,
    checked_in_at:
      status === 'present' || status === 'late'
        ? new Date('2026-10-29T01:05:00.000Z')
        : null,
    classSession: {
      id: sessionId,
      state: sessionState,
      room_label: 'EN402',
      starts_at: new Date(startsAt),
      ends_at: new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000),
      class: {
        id: classId,
        section: 'A',
        term: '2026-S2',
        room_label: 'EN401',
        course: { id: classId, code, name: 'Test Course' },
        teacher: { id: 2, name: 'Test Lecturer', email: 'secret@example.com' },
      },
    },
  };
}

function makeFakeDatabase(records: any[] = []) {
  const calls: {
    joins: Array<{ relation: string; alias: string }>;
    where: Array<{ sql: string; params: Record<string, any> }>;
    order: Array<{ field: string; direction: string }>;
    skip: number | null;
    take: number | null;
    repositoryRequested: boolean;
  } = {
    joins: [],
    where: [],
    order: [],
    skip: null,
    take: null,
    repositoryRequested: false,
  };

  const state: {
    conditions: Array<{ sql: string; params: Record<string, any> }>;
    orderFields: Array<{ field: string; direction: string }>;
    skip: number;
    take: number;
  } = {
    conditions: [],
    orderFields: [],
    skip: 0,
    take: 20,
  };

  function filteredRecords() {
    let result = [...records];

    for (const condition of state.conditions) {
      const { sql, params } = condition;

      if (sql.includes('ar.student_id = :studentId')) {
        result = result.filter(
          (record) => record.student_id === params.studentId,
        );
      }

      if (sql.includes("s.state != 'cancelled'")) {
        result = result.filter(
          (record) => record.classSession.state !== 'cancelled',
        );
      }

      if (sql.includes('c.id = :classId')) {
        result = result.filter(
          (record) => record.classSession.class.id === params.classId,
        );
      }

      if (sql.includes('s.starts_at >= :from')) {
        result = result.filter(
          (record) =>
            record.classSession.starts_at.getTime() >= params.from.getTime(),
        );
      }

      if (sql.includes('s.starts_at < :to')) {
        result = result.filter(
          (record) =>
            record.classSession.starts_at.getTime() < params.to.getTime(),
        );
      }

      if (sql.includes('ar.status = :status')) {
        result = result.filter((record) => record.status === params.status);
      }
    }

    result.sort((a, b) => {
      const timeDifference =
        b.classSession.starts_at.getTime() - a.classSession.starts_at.getTime();

      if (timeDifference !== 0) return timeDifference;

      return b.class_session_id - a.class_session_id;
    });

    return result;
  }

  const qb = {
    innerJoinAndSelect(relation: string, alias: string) {
      calls.joins.push({ relation, alias });
      return this;
    },

    leftJoinAndSelect(relation: string, alias: string) {
      calls.joins.push({ relation, alias });
      return this;
    },

    where(sql: string, params: Record<string, any> = {}) {
      state.conditions = [{ sql, params }];
      calls.where.push({ sql, params });
      return this;
    },

    andWhere(sql: string, params: Record<string, any> = {}) {
      state.conditions.push({ sql, params });
      calls.where.push({ sql, params });
      return this;
    },

    orderBy(field: string, direction: string) {
      state.orderFields = [{ field, direction }];
      calls.order.push({ field, direction });
      return this;
    },

    addOrderBy(field: string, direction: string) {
      state.orderFields.push({ field, direction });
      calls.order.push({ field, direction });
      return this;
    },

    skip(value: number) {
      state.skip = value;
      calls.skip = value;
      return this;
    },

    take(value: number) {
      state.take = value;
      calls.take = value;
      return this;
    },

    async getCount() {
      return filteredRecords().length;
    },

    async getMany() {
      return filteredRecords().slice(state.skip, state.skip + state.take);
    },
  };

  const database: any = {
    isInitialized: true,

    getRepository(schema: unknown) {
      calls.repositoryRequested = true;
      assert.ok(schema);
      return {
        createQueryBuilder(alias: string) {
          assert.equal(alias, 'ar');

          state.conditions = [];
          state.orderFields = [];
          state.skip = 0;
          state.take = 20;

          calls.joins = [];
          calls.where = [];
          calls.order = [];
          calls.skip = null;
          calls.take = null;

          return qb;
        },
      };
    },
  };

  return { database, calls };
}

function createFixture() {
  return [
    makeRecord({
      studentId: 3,
      sessionId: 30,
      classId: 1,
      status: 'present',
      startsAt: '2026-10-29T01:00:00.000Z',
    }),
    makeRecord({
      studentId: 3,
      sessionId: 28,
      classId: 1,
      status: 'late',
      startsAt: '2026-10-22T01:00:00.000Z',
    }),
    makeRecord({
      studentId: 3,
      sessionId: 25,
      classId: 2,
      code: 'SWE30009',
      status: 'absent',
      startsAt: '2026-10-15T01:00:00.000Z',
    }),
    makeRecord({
      studentId: 3,
      sessionId: 22,
      classId: 1,
      status: 'pending',
      sessionState: 'cancelled',
      startsAt: '2026-10-08T01:00:00.000Z',
    }),
    makeRecord({
      studentId: 4,
      sessionId: 31,
      classId: 1,
      status: 'absent',
      startsAt: '2026-10-29T01:00:00.000Z',
    }),
  ];
}

test('AttendanceController routes and metadata', () => {
  const paths = Reflect.getMetadata(PATH_METADATA, AttendanceController);

  assert.deepEqual(paths, ['me/attendance-records', 'attendance/me']);
});

test('AttendanceService queries real repository interface', async (t) => {
  await t.test('returns student records with default pagination', async () => {
    const { database, calls } = makeFakeDatabase(createFixture());
    const service = new AttendanceService(database);

    const result = await service.getPersonalAttendanceRecords({
      studentId: 3,
    });

    assert.equal(calls.repositoryRequested, true);
    assert.equal(result.meta.page, 1);
    assert.equal(result.meta.limit, 20);
    assert.equal(result.meta.total, 3);
    assert.equal(result.meta.totalPages, 1);

    assert.equal(result.data.length, 3);
    assert.ok(result.data.every((record) => record.student_id === 3));
    assert.ok(
      result.data.every((record) => record.class_state !== 'cancelled'),
    );

    assert.equal(result.data[0].class.course.code, 'COS30043');
    assert.equal(result.data[0].class.lecturer!.name, 'Test Lecturer');
    assert.equal((result.data[0].class.lecturer as any).email, undefined);
    assert.equal(result.data[0].class.room_label, 'EN402');
    assert.equal(result.data[0].starts_at, '2026-10-29T01:00:00.000Z');

    assert.deepEqual(
      calls.joins.map((join) => join.relation),
      ['ar.classSession', 's.class', 'c.course', 'c.teacher'],
    );
  });

  await t.test('includes cancelled records only when requested', async () => {
    const { database } = makeFakeDatabase(createFixture());
    const service = new AttendanceService(database);

    const defaultResult = await service.getPersonalAttendanceRecords({
      studentId: 3,
    });

    const withCancelled = await service.getPersonalAttendanceRecords({
      studentId: 3,
      includeCancelled: true,
    });

    assert.equal(defaultResult.meta.total, 3);
    assert.equal(withCancelled.meta.total, 4);

    assert.ok(
      withCancelled.data.some((record) => record.class_state === 'cancelled'),
    );
  });

  await t.test('filters by classId', async () => {
    const { database, calls } = makeFakeDatabase(createFixture());
    const service = new AttendanceService(database);

    const result = await service.getPersonalAttendanceRecords({
      studentId: 3,
      classId: 2,
    });

    assert.equal(result.meta.total, 1);
    assert.equal(result.data[0].class.id, 2);

    assert.ok(
      calls.where.some(
        (item) =>
          item.sql.includes('c.id = :classId') && item.params.classId === 2,
      ),
    );
  });

  await t.test('filters by attendance status', async () => {
    const { database } = makeFakeDatabase(createFixture());
    const service = new AttendanceService(database);

    const present = await service.getPersonalAttendanceRecords({
      studentId: 3,
      status: 'present',
    });

    assert.equal(present.meta.total, 1);
    assert.equal(present.data[0].status, 'present');
    assert.ok(present.data[0].checked_in_at);

    const absent = await service.getPersonalAttendanceRecords({
      studentId: 3,
      status: 'absent',
    });

    assert.equal(absent.meta.total, 1);
    assert.equal(absent.data[0].status, 'absent');
    assert.equal(absent.data[0].checked_in_at, null);
  });

  await t.test('filters by date range', async () => {
    const { database } = makeFakeDatabase(createFixture());
    const service = new AttendanceService(database);

    const from = new Date('2026-10-20T00:00:00.000Z');
    const to = new Date('2026-10-30T00:00:00.000Z');

    const result = await service.getPersonalAttendanceRecords({
      studentId: 3,
      from,
      to,
    });

    assert.equal(result.meta.total, 2);

    assert.ok(
      result.data.every((record) => {
        const timestamp = new Date(record.starts_at!).getTime();

        return timestamp >= from.getTime() && timestamp < to.getTime();
      }),
    );
  });

  await t.test('paginates and sorts descending', async () => {
    const { database, calls } = makeFakeDatabase(createFixture());
    const service = new AttendanceService(database);

    const result = await service.getPersonalAttendanceRecords({
      studentId: 3,
      page: 2,
      limit: 2,
    });

    assert.equal(result.meta.total, 3);
    assert.equal(result.meta.totalPages, 2);
    assert.equal(result.meta.page, 2);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].class_session_id, 25);

    assert.equal(calls.skip, 2);
    assert.equal(calls.take, 2);

    assert.deepEqual(calls.order, [
      { field: 's.starts_at', direction: 'DESC' },
      { field: 'ar.class_session_id', direction: 'DESC' },
    ]);
  });

  await t.test('isolates student records', async () => {
    const { database } = makeFakeDatabase(createFixture());
    const service = new AttendanceService(database);

    const student3 = await service.getPersonalAttendanceRecords({
      studentId: 3,
    });

    const student4 = await service.getPersonalAttendanceRecords({
      studentId: 4,
    });

    assert.equal(student3.meta.total, 3);
    assert.equal(student4.meta.total, 1);

    assert.ok(student3.data.every((record) => record.student_id === 3));

    assert.ok(student4.data.every((record) => record.student_id === 4));
  });

  await t.test('returns empty result for no records', async () => {
    const { database } = makeFakeDatabase([]);
    const service = new AttendanceService(database);

    const result = await service.getPersonalAttendanceRecords({
      studentId: 3,
    });

    assert.deepEqual(result.data, []);
    assert.deepEqual(result.meta, {
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  await t.test('returns 503 when database is unavailable', async () => {
    const service = new AttendanceService(null as any);

    await assert.rejects(
      () =>
        service.getPersonalAttendanceRecords({
          studentId: 3,
        }),
      (error) => error instanceof ServiceUnavailableException,
    );
  });

  await t.test(
    'does not silently return mock records on query failure',
    async () => {
      const database: any = {
        isInitialized: true,
        getRepository() {
          return {
            createQueryBuilder() {
              throw new Error('Simulated database error');
            },
          };
        },
      };

      const service = new AttendanceService(database);

      await assert.rejects(
        () =>
          service.getPersonalAttendanceRecords({
            studentId: 3,
          }),
        /Simulated database error/,
      );
    },
  );
});

test('AttendanceController and DTO pipeline enforce authentication, authorization, and validation', async (t) => {
  const { database } = makeFakeDatabase(createFixture());
  const service = new AttendanceService(database);
  const controller = new AttendanceController(service);
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

  await t.test('returns formatted data and pagination meta', async () => {
    const result = await invoke(
      {
        page: '1',
        limit: '10',
        includeCancelled: 'false',
      },
      validReq,
    );

    assert.equal(result.meta.page, 1);
    assert.equal(result.meta.limit, 10);
    assert.equal(result.meta.total, 3);
    assert.ok(Array.isArray(result.data));

    assert.ok(result.data.every((record) => record.student_id === 3));
  });
});

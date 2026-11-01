require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  ServiceUnavailableException,
} = require('@nestjs/common');

const { PATH_METADATA } = require('@nestjs/common/constants');

const {
  AttendanceController,
} = require('../dist/attendance/attendance.controller');

const { AttendanceService } = require('../dist/attendance/attendance.service');

// Test-only fixture. This data is never used by the actual API.
function makeRecord({
  studentId = 3,
  sessionId = 30,
  classId = 1,
  code = 'COS30043',
  status = 'present',
  meetingState = 'scheduled',
  sessionState = 'scheduled',
  startsAt = '2026-10-29T01:00:00.000Z',
} = {}) {
  return {
    session_id: sessionId,
    student_id: studentId,
    status,
    checked_in_at:
      status === 'present' || status === 'late'
        ? new Date('2026-10-29T01:05:00.000Z')
        : null,
    session: {
      state: sessionState,
      room_label: 'EN402',
      meeting: {
        state: meetingState,
        starts_at: new Date(startsAt),
        ends_at: new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000),
        classroom: {
          id: classId,
          code,
          name: 'Test Course',
          subject: 'Test Subject',
          term: '2026-S2',
          room_label: 'EN402',
          teacher: {
            id: 2,
            name: 'Test Lecturer',
          },
        },
      },
    },
  };
}

function makeFakeDatabase(records = []) {
  const calls = {
    joins: [],
    where: [],
    order: [],
    skip: null,
    take: null,
    repositoryRequested: false,
  };

  const state = {
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

      if (sql.includes("m.state != 'cancelled'")) {
        result = result.filter(
          (record) =>
            record.session.meeting.state !== 'cancelled' &&
            record.session.state !== 'cancelled',
        );
      }

      if (sql.includes('c.id = :classId')) {
        result = result.filter(
          (record) => record.session.meeting.classroom.id === params.classId,
        );
      }

      if (sql.includes('m.starts_at >= :from')) {
        result = result.filter(
          (record) =>
            record.session.meeting.starts_at.getTime() >= params.from.getTime(),
        );
      }

      if (sql.includes('m.starts_at < :to')) {
        result = result.filter(
          (record) =>
            record.session.meeting.starts_at.getTime() < params.to.getTime(),
        );
      }

      if (sql.includes('ar.status = :status')) {
        result = result.filter((record) => record.status === params.status);
      }
    }

    result.sort((a, b) => {
      const timeDifference =
        b.session.meeting.starts_at.getTime() -
        a.session.meeting.starts_at.getTime();

      if (timeDifference !== 0) return timeDifference;

      return b.session_id - a.session_id;
    });

    return result;
  }

  const qb = {
    innerJoinAndSelect(relation, alias) {
      calls.joins.push({ relation, alias });
      return this;
    },

    leftJoinAndSelect(relation, alias) {
      calls.joins.push({ relation, alias });
      return this;
    },

    where(sql, params = {}) {
      state.conditions = [{ sql, params }];
      calls.where.push({ sql, params });
      return this;
    },

    andWhere(sql, params = {}) {
      state.conditions.push({ sql, params });
      calls.where.push({ sql, params });
      return this;
    },

    orderBy(field, direction) {
      state.orderFields = [{ field, direction }];
      calls.order.push({ field, direction });
      return this;
    },

    addOrderBy(field, direction) {
      state.orderFields.push({ field, direction });
      calls.order.push({ field, direction });
      return this;
    },

    skip(value) {
      state.skip = value;
      calls.skip = value;
      return this;
    },

    take(value) {
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

  const database = {
    isInitialized: true,

    getRepository(schema) {
      calls.repositoryRequested = true;
      assert.ok(schema);
      return {
        createQueryBuilder(alias) {
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
      meetingState: 'cancelled',
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
    assert.equal(result.data[0].class.lecturer.name, 'Test Lecturer');
    assert.equal(result.data[0].starts_at, '2026-10-29T01:00:00.000Z');

    assert.deepEqual(
      calls.joins.map((join) => join.relation),
      ['ar.session', 's.meeting', 'm.classroom', 'c.teacher'],
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
        const timestamp = new Date(record.starts_at).getTime();

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
      { field: 'm.starts_at', direction: 'DESC' },
      { field: 'ar.session_id', direction: 'DESC' },
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
    const service = new AttendanceService(null);

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
      const database = {
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

test('AttendanceController enforces authentication, authorization, and validation', async (t) => {
  const { database } = makeFakeDatabase(createFixture());
  const service = new AttendanceService(database);
  const controller = new AttendanceController(service);

  await t.test('rejects unauthenticated requests with 401', async () => {
    await assert.rejects(
      () => controller.getPersonalAttendanceRecords({}, {}),
      (error) => error instanceof UnauthorizedException,
    );
  });

  await t.test('rejects teacher and admin with 403', async () => {
    for (const role of ['teacher', 'admin']) {
      await assert.rejects(
        () =>
          controller.getPersonalAttendanceRecords(
            {},
            { user: { id: 2, role } },
          ),
        (error) => error instanceof ForbiddenException,
      );
    }
  });

  const validReq = {
    user: {
      id: 3,
      role: 'student',
    },
  };

  await t.test('validates page', async () => {
    for (const invalid of ['0', '-1', '10001', 'abc', '1.5']) {
      await assert.rejects(
        () =>
          controller.getPersonalAttendanceRecords({ page: invalid }, validReq),
        (error) => error instanceof BadRequestException,
      );
    }
  });

  await t.test('validates limit', async () => {
    for (const invalid of ['0', '-5', '101', 'xyz']) {
      await assert.rejects(
        () =>
          controller.getPersonalAttendanceRecords({ limit: invalid }, validReq),
        (error) => error instanceof BadRequestException,
      );
    }
  });

  await t.test('validates classId', async () => {
    for (const invalid of ['0', '-1', 'abc']) {
      await assert.rejects(
        () =>
          controller.getPersonalAttendanceRecords(
            { classId: invalid },
            validReq,
          ),
        (error) => error instanceof BadRequestException,
      );
    }
  });

  await t.test('validates ISO timestamps and date range', async () => {
    for (const invalid of ['2026-10-29', 'not-a-date', '2026-10-29T10:00:00']) {
      await assert.rejects(
        () =>
          controller.getPersonalAttendanceRecords({ from: invalid }, validReq),
        (error) => error instanceof BadRequestException,
      );
    }

    await assert.rejects(
      () =>
        controller.getPersonalAttendanceRecords(
          {
            from: '2026-10-30T00:00:00.000Z',
            to: '2026-10-20T00:00:00.000Z',
          },
          validReq,
        ),
      (error) => error instanceof BadRequestException,
    );
  });

  await t.test('validates status', async () => {
    await assert.rejects(
      () =>
        controller.getPersonalAttendanceRecords(
          { status: 'unknown' },
          validReq,
        ),
      (error) => error instanceof BadRequestException,
    );
  });

  await t.test('validates includeCancelled', async () => {
    for (const invalid of ['yes', '1', '0', 'no']) {
      await assert.rejects(
        () =>
          controller.getPersonalAttendanceRecords(
            { includeCancelled: invalid },
            validReq,
          ),
        (error) => error instanceof BadRequestException,
      );
    }
  });

  await t.test('returns formatted data and pagination meta', async () => {
    const result = await controller.getPersonalAttendanceRecords(
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

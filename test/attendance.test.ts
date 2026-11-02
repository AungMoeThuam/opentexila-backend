import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Module, Global } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createValidationPipe } from '../dist/common/validation.pipe.js';
import { AttendanceModule } from '../dist/attendance/attendance.module.js';
import { AttendanceService } from '../dist/attendance/attendance.service.js';
import { DATABASE } from '../dist/database/database.constants.js';
import * as rules from '../dist/attendance/attendance.rules.js';
import { materialiseLockedRoster } from '../dist/attendance/roster.service.js';
import {
  ClassSessionsQueryDto,
  ClassSessionParamsDto,
} from '../dist/attendance/dto/attendance-query.dto.js';
import { CheckInDto } from '../dist/attendance/dto/check-in.dto.js';

const start = new Date('2026-11-01T01:00:00Z');
const late = new Date('2026-11-01T01:15:00Z');
const end = new Date('2026-11-01T02:00:00Z');
const session: any = {
  id: 30,
  class_id: 1,
  starts_at: start,
  late_after: late,
  ends_at: end,
  state: 'scheduled',
  room_label: 'Original room',
  latitude: '0',
  longitude: '0',
  radius_m: '100',
};
const student: rules.AttendanceCaller = { id: 3, role: 'student' };
const body = {
  latitude: 0,
  longitude: 0,
  accuracy_m: 12,
  reading_timestamp: start.toISOString(),
};
// Service tests receive already-parsed domain input; DTO tests exercise parsing.
const validReading = (): rules.LocationReading => ({
  ...body,
  reading_timestamp: new Date(start),
});

const code = (expected: string) => (error: any) =>
  error.getResponse().error.code === expected;

test('DTO query, path and reading validation rejects coercion and invalid calendar dates', async () => {
  const pipe = createValidationPipe();
  const defaults: ClassSessionsQueryDto = await pipe.transform(
    {},
    { type: 'query', metatype: ClassSessionsQueryDto },
  );
  assert.equal(defaults.page, 1);
  assert.equal(defaults.limit, 20);
  for (const query of [
    { page: '0' },
    { page: '10001' },
    { limit: '101' },
    { classId: '1e2' },
    { page: ['1', '2'] },
    { from: '2026-02-30T01:00:00Z' },
    { to: '2026-11-01' },
    { from: start.toISOString(), to: start.toISOString() },
  ])
    await assert.rejects(
      () =>
        pipe.transform(query, {
          type: 'query',
          metatype: ClassSessionsQueryDto,
        }),
      code('VALIDATION_ERROR'),
    );
  for (const id of ['0', '-1', '1.2', '4294967296', ['1']])
    await assert.rejects(
      () =>
        pipe.transform(
          { classSessionId: id },
          { type: 'param', metatype: ClassSessionParamsDto },
        ),
      code('VALIDATION_ERROR'),
    );
  for (const update of [
    { latitude: '0' },
    { latitude: NaN },
    { longitude: 181 },
    { accuracy_m: 0 },
    { accuracy_m: Infinity },
    { reading_timestamp: '2026-02-30T00:00:00Z' },
    { reading_timestamp: '2026-11-01T01:00:00+00:00' },
  ])
    await assert.rejects(
      () =>
        pipe.transform(
          { ...body, ...update },
          { type: 'body', metatype: CheckInDto },
        ),
      code('VALIDATION_ERROR'),
    );
  await assert.rejects(
    () => pipe.transform([], { type: 'body', metatype: CheckInDto }),
    code('VALIDATION_ERROR'),
  );
});

test('availability and eligibility use precise time boundaries and reason priority', () => {
  assert.equal(rules.availability(session, new Date(+start - 1)), 'upcoming');
  assert.equal(rules.availability(session, start), 'in_progress');
  assert.equal(rules.availability(session, end), 'ended');
  assert.equal(
    rules.availability({ ...session, state: 'cancelled' }, start),
    'cancelled',
  );
  assert.equal(
    rules.eligibility(
      { ...session, state: 'cancelled' },
      { role: 'teacher' },
      false,
      null,
      start,
    ).reason,
    'CLASS_CANCELLED',
  );
  assert.equal(
    rules.eligibility(session, { role: 'teacher' }, false, null, start).reason,
    'ROLE_NOT_STUDENT',
  );
  assert.equal(
    rules.eligibility(session, student, false, { status: 'present' }, end)
      .reason,
    'NOT_ELIGIBLE',
  );
  assert.equal(
    rules.eligibility(session, student, true, { status: 'present' }, end)
      .reason,
    'ALREADY_CHECKED_IN',
  );
  assert.equal(
    rules.eligibility(session, student, true, null, new Date(+start - 1))
      .reason,
    'NOT_STARTED',
  );
  assert.deepEqual(rules.eligibility(session, student, true, null, start), {
    allowed: true,
    reason: null,
  });
  assert.equal(
    rules.eligibility(session, student, true, null, end).reason,
    'CLASS_ENDED',
  );
});

test('geofence and reading policy boundaries', () => {
  assert.equal(rules.distanceMeters(0, 0, 0, 0), 0);
  assert.ok(Math.abs(rules.distanceMeters(0, 0, 0, 1) - 111194.9266) < 0.01);
  assert.ok(Number.isFinite(rules.distanceMeters(90, 0, -90, 180)));
  for (const offset of [-5000, 60000])
    assert.equal(
      rules.validateLocation(
        {
          ...validReading(),
          reading_timestamp: new Date(+start - offset),
        },
        session,
        start,
      ),
      0,
    );
  for (const offset of [-5001, 60001])
    assert.throws(
      () =>
        rules.validateLocation(
          {
            ...validReading(),
            reading_timestamp: new Date(+start - offset),
          },
          session,
          start,
        ),
      code('LOCATION_STALE'),
    );
  assert.throws(
    () =>
      rules.validateLocation(
        { ...validReading(), accuracy_m: 101 },
        session,
        start,
      ),
    code('LOCATION_INACCURATE'),
  );
  assert.throws(
    () =>
      rules.validateLocation(
        { ...validReading(), latitude: 1 },
        session,
        start,
      ),
    code('OUTSIDE_ALLOWED_AREA'),
  );
  const reading = { ...validReading(), longitude: 0.001 };
  const radius = rules.distanceMeters(0, 0.001, 0, 0);
  assert.equal(
    rules.validateLocation(
      reading,
      { ...session, radius_m: String(radius) },
      start,
    ),
    radius,
  );
});

// Small transactional fake: exercises service branching, SQL lock ordering and
// rollback of failed mutations. Real SQL/concurrency is covered by test:db.
function databaseFixture(now = start) {
  const state: any = {
    session: { ...session },
    enrolled: true,
    record: {
      class_session_id: 30,
      student_id: 3,
      status: 'pending',
      checked_in_at: null,
      distance_m: null,
    },
    now,
    calls: [] as Array<{ sql: string; args: any[] }>,
  };
  const query = async (sql: string, args: any[] = []) => {
    state.calls.push({ sql, args });
    if (sql.startsWith('SELECT class_id')) return [{ class_id: 1 }];
    if (sql.startsWith('SELECT * FROM classes'))
      return [
        {
          id: 1,
          teacher_id: 2,
          course_id: 1,
          section: 'A',
          term: '2026-S2',
          room_label: 'Changed room',
        },
      ];
    if (sql.startsWith('SELECT * FROM class_sessions')) return [state.session];
    if (sql.startsWith('SELECT UTC')) return [{ now: state.now }];
    if (sql.startsWith('SELECT student_id'))
      return state.enrolled ? [{ student_id: 3 }] : [];
    if (sql.startsWith('SELECT * FROM attendance_records'))
      return state.record ? [{ ...state.record }] : [];
    if (sql.startsWith('INSERT INTO attendance_records')) {
      if (!state.record && state.enrolled)
        state.record = {
          class_session_id: 30,
          student_id: 3,
          status: 'pending',
          checked_in_at: null,
          distance_m: null,
        };
      return {};
    }
    if (sql.startsWith('UPDATE attendance_records')) {
      Object.assign(state.record, {
        status: args[0],
        checked_in_at: args[1],
        distance_m: args[2],
      });
      return { affectedRows: 1 };
    }
    if (sql.startsWith('SELECT id, code'))
      return [{ id: 1, code: 'COS30043', name: 'Interface Design' }];
    if (sql.startsWith('SELECT id, name')) return [{ id: 2, name: 'Lecturer' }];
    if (sql.startsWith('SELECT COUNT')) return [{ total: 1 }];
    if (sql.startsWith('SELECT s.id')) return [{ id: 30 }];
    throw new Error(`Unexpected test query: ${sql}`);
  };
  const database: any = {
    query,
    async transaction(work: (manager: any) => Promise<any>) {
      const before = state.record && { ...state.record };
      try {
        return await work({ query });
      } catch (error) {
        state.record = before;
        throw error;
      }
    },
  };
  return { state, database, service: new AttendanceService(database) };
}
for (const [now, expected] of [
  [new Date(+start - 1), 'CLASS_NOT_STARTED'],
  [start, 'present'],
  [late, 'present'],
  [new Date(+late + 1), 'late'],
  [new Date(+end - 1), 'late'],
  [end, 'CLASS_ENDED'],
] as const) {
  test(`check-in at ${now.toISOString()} yields ${expected}`, async () => {
    const { service, state } = databaseFixture(now);
    const reading = { ...validReading(), reading_timestamp: now };
    if (expected.startsWith('CLASS'))
      await assert.rejects(
        service.checkIn(student, 30, reading),
        code(expected),
      );
    else {
      const result = await service.checkIn(student, 30, reading);
      assert.equal(result.data.attendance_record.status, expected);
      assert.equal(
        result.data.attendance_record.checked_in_at,
        now.toISOString(),
      );
      assert.equal(
        state.calls.find((c: any) => c.sql.startsWith('UPDATE')).args.length,
        5,
      );
    }
    const locks = state.calls.filter((c: any) => c.sql.includes('FOR UPDATE'));
    assert.ok(locks[0].sql.includes('FROM classes'));
    assert.ok(locks[1].sql.includes('FROM class_sessions'));
    assert.ok(
      state.calls.findIndex((c: any) => c.sql.startsWith('SELECT UTC')) >
        state.calls.indexOf(locks[1]),
    );
  });
}
test('location failures leave pending evidence unchanged and permit retry', async () => {
  for (const [patch, expected] of [
    [{ accuracy_m: 101 }, 'LOCATION_INACCURATE'],
    [{ latitude: 1 }, 'OUTSIDE_ALLOWED_AREA'],
    [{ reading_timestamp: new Date(+start - 60001) }, 'LOCATION_STALE'],
  ] as const) {
    const { service, state } = databaseFixture();
    await assert.rejects(
      service.checkIn(student, 30, {
        ...validReading(),
        ...(patch as any),
      }),
      code(expected),
    );
    assert.equal(state.record.status, 'pending');
    assert.equal(state.record.checked_in_at, null);
    assert.equal(
      (await service.checkIn(student, 30, validReading())).data
        .attendance_record.status,
      'present',
    );
  }
});
test('replay retains original record after end, but cancelled sessions reject replay', async () => {
  const { service, state } = databaseFixture();
  const original = await service.checkIn(student, 30, validReading());
  state.now = end;
  assert.deepEqual(
    await service.checkIn(student, 30, validReading()),
    original,
  );
  state.session.state = 'cancelled';
  await assert.rejects(
    service.checkIn(student, 30, validReading()),
    code('CLASS_CANCELLED'),
  );
});
test('resource authorization, roster creation, and safe snapshot DTOs', async () => {
  const { service, state } = databaseFixture();
  state.record = null;
  const result = await service.detail(student, 30);
  assert.ok(result.data.my_attendance);
  assert.equal(result.data.my_attendance.status, 'pending');
  assert.equal(result.data.class.room_label, 'Original room');
  assert.equal(JSON.stringify(result).includes('latitude'), false);
  assert.equal(
    (await service.detail({ id: 2, role: 'teacher' }, 30)).data.my_attendance,
    null,
  );
  await assert.rejects(
    service.detail({ id: 8, role: 'teacher' }, 30),
    code('RESOURCE_NOT_FOUND'),
  );
  await assert.rejects(
    service.checkIn({ id: 2, role: 'teacher' }, 30, validReading()),
    code('FORBIDDEN'),
  );
  state.enrolled = false;
  state.record = null;
  await assert.rejects(service.detail(student, 30), code('RESOURCE_NOT_FOUND'));
  await assert.rejects(
    service.checkIn(student, 30, validReading()),
    code('RESOURCE_NOT_FOUND'),
  );
  state.record = { class_session_id: 30, student_id: 3, status: 'absent' };
  await assert.rejects(
    service.checkIn(student, 30, validReading()),
    code('NOT_ELIGIBLE'),
  );
});
test('list queries are scoped, parameterized and ordered with half-open time filters', async () => {
  const { service, state } = databaseFixture();
  const result = await service.list(student, {
    page: 2,
    limit: 5,
    classId: 1,
    from: start,
    to: end,
  });
  assert.deepEqual(result.meta, { page: 2, limit: 5, total: 1, totalPages: 1 });
  assert.equal('check_in' in result.data[0], false);
  const list = state.calls.find((c: any) => c.sql.startsWith('SELECT s.id'));
  assert.match(list.sql, /e.student_id = \?/);
  assert.match(list.sql, /a.student_id = \?/);
  assert.match(list.sql, /s.starts_at >= \?/);
  assert.match(list.sql, /s.starts_at < \?/);
  assert.match(list.sql, /ORDER BY s.starts_at ASC, s.id ASC/);
  assert.deepEqual(list.args, [3, 3, 1, start, end, 5, 5]);
});
test('materialisation skips future/cancelled sessions and never resets duplicates', async () => {
  const calls: any[] = [];
  const manager: any = { query: async (...args: any[]) => calls.push(args) };
  await materialiseLockedRoster(manager, session, new Date(+start - 1));
  await materialiseLockedRoster(
    manager,
    { ...session, state: 'cancelled' },
    end,
  );
  assert.equal(calls.length, 0);
  await materialiseLockedRoster(manager, session, start);
  assert.match(
    calls[0][0],
    /ON DUPLICATE KEY UPDATE student_id = attendance_records.student_id/,
  );
});

test('HTTP routes enforce sessions, CSRF, account state, validation and safe errors', async (t) => {
  const { database } = databaseFixture();
  let currentSession: any;
  let user: any = {
    ...student,
    status: 'active',
    session_version: 0,
    must_change_password: false,
  };
  database.getRepository = () => ({ findOneBy: async () => user });
  class TestDatabaseModule {}
  Global()(TestDatabaseModule);
  Module({
    providers: [{ provide: DATABASE, useValue: database }],
    exports: [DATABASE],
  })(TestDatabaseModule);
  class TestApp {}
  Module({ imports: [TestDatabaseModule, AttendanceModule] })(TestApp);
  const app = await NestFactory.create(TestApp, { logger: false });
  t.after(() => app.close());
  // Trusted server-side fixture middleware, only inside this HTTP test.
  app.use((request: any, _response: any, next: () => void) => {
    request.session = currentSession;
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  const send = (path: string, options: RequestInit = {}) =>
    fetch(`${base}${path}`, options);
  const expectError = async (
    response: Response,
    status: number,
    expected: string,
  ) => {
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const payload = await response.json();
    assert.equal(payload.error.code, expected);
    assert.equal(typeof payload.error.fields, 'object');
  };
  await expectError(
    await send('/me/class-sessions', { headers: { 'x-user-id': '3' } }),
    401,
    'UNAUTHENTICATED',
  );
  currentSession = {
    userId: 3,
    sessionVersion: 0,
    csrfToken: 'fixture-token',
    cookie: { expires: new Date(Date.now() + 60000) },
  };
  await expectError(
    await send('/me/class-sessions?page=0'),
    422,
    'VALIDATION_ERROR',
  );
  await expectError(
    await send('/class-sessions/nope'),
    422,
    'VALIDATION_ERROR',
  );
  for (const path of [
    '/me/class-sessions?page=1e2',
    '/me/class-sessions?page=1&page=2',
    '/me/class-sessions?from=2026-02-30T00:00:00Z',
  ]) {
    await expectError(await send(path), 422, 'VALIDATION_ERROR');
  }
  const paginated = await send(
    '/me/class-sessions?page=2&limit=5&studentId=999',
  );
  assert.equal(paginated.status, 200);
  assert.deepEqual((await paginated.json()).meta, {
    page: 2,
    limit: 5,
    total: 1,
    totalPages: 1,
  });
  const get = await send('/class-sessions/30');
  assert.equal(get.status, 200);
  assert.equal((await get.json()).data.check_in.allowed, true);
  const post: {
    method: string;
    headers: Record<string, string>;
    body: string;
  } = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
  await expectError(
    await send('/class-sessions/30/check-ins', post),
    403,
    'CSRF_INVALID',
  );
  post.headers['x-csrf-token'] = 'fixture-token';
  await expectError(
    await send('/class-sessions/30/check-ins', { ...post, body: '{' }),
    400,
    'BAD_REQUEST',
  );
  await expectError(
    await send('/class-sessions/30/check-ins', { ...post, body: '{}' }),
    422,
    'VALIDATION_ERROR',
  );
  await expectError(
    await send('/class-sessions/30/check-ins', {
      ...post,
      body: JSON.stringify({ ...body, latitude: '0' }),
    }),
    422,
    'VALIDATION_ERROR',
  );
  assert.equal((await send('/class-sessions/30/check-ins', post)).status, 200);
  user = { ...user, must_change_password: true };
  await expectError(
    await send('/me/class-sessions'),
    403,
    'PASSWORD_CHANGE_REQUIRED',
  );
  user = { ...user, must_change_password: false, status: 'inactive' };
  await expectError(await send('/me/class-sessions'), 403, 'ACCOUNT_INACTIVE');
  user = { ...user, status: 'active', session_version: 1 };
  await expectError(await send('/me/class-sessions'), 401, 'UNAUTHENTICATED');
  user = { ...user, session_version: 0 };
  currentSession.cookie.expires = new Date(Date.now() - 1);
  await expectError(await send('/me/class-sessions'), 401, 'UNAUTHENTICATED');
  currentSession.cookie.expires = new Date(Date.now() + 60000);
  database.query = async () => {
    throw new Error('private SQL and GPS');
  };
  const failure = await send('/me/class-sessions');
  await expectError(failure, 500, 'INTERNAL_ERROR');
});

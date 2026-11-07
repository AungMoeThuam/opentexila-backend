import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';

const classSession = (overrides: Record<string, any> = {}) => ({
  id: 30,
  room_label: 'EN402',
  starts_at: new Date('2026-10-29T01:00:00.000Z'),
  late_after: new Date('2026-10-29T01:15:00.000Z'),
  ends_at: new Date('2026-10-29T03:00:00.000Z'),
  state: 'scheduled',
  class: {
    id: 1,
    section: 'A',
    term: '2026-S2',
    room_label: 'EN101',
    course: {
      id: 1,
      code: 'COS30043',
      name: 'Interface Design and Development',
    },
    lecturer: { id: 2, name: 'Lecturer One' },
  },
  ...overrides,
});

const record = (
  studentId: number,
  status: string,
  checkedIn: Date | null = null,
) => ({
  class_session_id: 30,
  student_id: studentId,
  status,
  checked_in_at: checkedIn,
  distance_m: '5.00',
  student: {
    id: studentId,
    name: `Student ${studentId}`,
    email: `student${studentId}@example.com`,
  },
});

const sorted = (object: Record<string, unknown>) => Object.keys(object).sort();

test('lecturer session roster over HTTP', async (t) => {
  const sessionCalls: any[] = [];
  const recordCalls: any[] = [];
  const ClassSession: any = {
    async findOne(options: any) {
      sessionCalls.push(options);
      return classSession();
    },
  };
  const AttendanceRecord: any = {
    async findAndCount(options: any) {
      recordCalls.push(options);
      return [
        [
          record(3, 'present', new Date('2026-10-29T01:05:00.000Z')),
          record(4, 'pending'),
          record(5, 'absent'),
        ],
        3,
      ];
    },
  };
  const app = await startAttendanceApp({ ClassSession, AttendanceRecord });
  t.after(() => app.close());
  const get = (path: string) => fetch(`${app.base}/class-sessions${path}`);

  await t.test(
    'success shape, scoping, ordering and private fields',
    async () => {
      const response = await get('/30/records');
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(sorted(body), ['context', 'data', 'meta']);
      assert.deepEqual(body.meta, {
        page: 1,
        limit: 20,
        total: 3,
        totalPages: 1,
      });
      assert.deepEqual(sorted(body.data[0]), [
        'checked_in_at',
        'class_session_id',
        'status',
        'student',
        'student_id',
      ]);
      assert.deepEqual(body.data[0].student, { id: 3, name: 'Student 3' });
      assert.deepEqual(
        body.data.map((row: any) => row.checked_in_at),
        ['2026-10-29T01:05:00.000Z', null, null],
      );
      assert.deepEqual(sorted(body.context), [
        'class',
        'class_session_id',
        'class_state',
        'ends_at',
        'late_after',
        'starts_at',
      ]);
      assert.equal(body.context.class_state, 'scheduled');
      assert.equal(body.context.class.lecturer.name, 'Lecturer One');
      assert.equal(body.context.class.room_label, 'EN402');
      assert.equal(JSON.stringify(body).includes('@example.com'), false);
      assert.equal(JSON.stringify(body).includes('distance'), false);
      assert.deepEqual(sessionCalls.at(-1).where, {
        id: 30,
        class: { lecturer_id: 2 },
      });
      assert.deepEqual(recordCalls.at(-1).where, { class_session_id: 30 });
      assert.deepEqual(recordCalls.at(-1).order, { student_id: 'ASC' });
      assert.equal(recordCalls.at(-1).skip, 0);
      assert.equal(recordCalls.at(-1).take, 20);
    },
  );

  await t.test('status filter and pagination reach the query', async () => {
    const response = await get('/30/records?status=late&page=2&limit=5');
    assert.equal(response.status, 200);
    assert.deepEqual(recordCalls.at(-1).where, {
      class_session_id: 30,
      status: 'late',
    });
    assert.equal(recordCalls.at(-1).skip, 5);
    assert.equal(recordCalls.at(-1).take, 5);
  });

  await t.test('the caller id scopes the session lookup', async () => {
    app.state.user = { ...app.state.user, id: 9 };
    await get('/30/records');
    assert.equal(sessionCalls.at(-1).where.class.lecturer_id, 9);
    app.state.user = { ...app.state.user, id: 2 };
  });

  await t.test('invalid input answers 422 before any query', async () => {
    const sessionCount = sessionCalls.length;
    const recordCount = recordCalls.length;
    const cases = [
      ['/4294967296/records', 'classSessionId'],
      ['/1abc/records', 'classSessionId'],
      ['/0/records', 'classSessionId'],
      ['/30/records?status=LATE', 'status'],
      ['/30/records?status=x', 'status'],
      ['/30/records?page=1&page=2', 'page'],
      ['/30/records?limit=0', 'limit'],
    ];
    for (const [path, field] of cases) {
      const response = await get(path);
      assert.equal(response.status, 422, path);
      const { error } = await response.json();
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.ok(field in error.fields, `${path} should name ${field}`);
    }
    assert.equal(sessionCalls.length, sessionCount);
    assert.equal(recordCalls.length, recordCount);
  });

  await t.test(
    'signed-out and student callers are refused while admin can view any session',
    async () => {
      const count = sessionCalls.length;
      app.state.signedIn = false;
      const signedOut = await get('/30/records');
      assert.equal(signedOut.status, 401);
      assert.equal((await signedOut.json()).error.code, 'UNAUTHENTICATED');
      app.state.signedIn = true;
      app.state.user = { ...app.state.user, role: 'student' };
      const studentRes = await get('/30/records');
      assert.equal(studentRes.status, 403);
      assert.equal((await studentRes.json()).error.code, 'FORBIDDEN');
      assert.equal(sessionCalls.length, count);

      app.state.user = { ...app.state.user, id: 1, role: 'admin' };
      const adminRes = await get('/30/records');
      assert.equal(adminRes.status, 200);
      assert.deepEqual(sessionCalls.at(-1).where, { id: 30 });
      app.state.user = { ...app.state.user, id: 2, role: 'lecturer' };
    },
  );

  await t.test(
    'a cancelled session without records keeps the context',
    async () => {
      ClassSession.findOne = async () => classSession({ state: 'cancelled' });
      AttendanceRecord.findAndCount = async () => [[], 0];
      const response = await get('/30/records');
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.data, []);
      assert.equal(body.context.class_state, 'cancelled');
      assert.equal(body.context.class_session_id, 30);
      assert.deepEqual(body.meta, {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    },
  );

  await t.test(
    'a missing or foreign session answers 404 and skips the records',
    async () => {
      ClassSession.findOne = async () => null;
      const count = recordCalls.length;
      AttendanceRecord.findAndCount = async (options: any) => {
        recordCalls.push(options);
        return [[], 0];
      };
      const response = await get('/31/records');
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Class session not found.',
          fields: {},
        },
      });
      assert.equal(recordCalls.length, count);
    },
  );

  await t.test('database errors do not leak details', async () => {
    ClassSession.findOne = async () => classSession();
    AttendanceRecord.findAndCount = async () => {
      throw new Error('private details');
    };
    const response = await get('/30/records');
    assert.equal(response.status, 500);
    assert.equal((await response.text()).includes('private details'), false);
  });
});

test('student attendance history requires a signed-in student', async (t) => {
  const app = await startAttendanceApp({
    ClassSession: {},
    AttendanceRecord: {},
  });
  t.after(() => app.close());
  const get = () => fetch(`${app.base}/me/attendance-records`);

  app.state.signedIn = false;
  const signedOut = await get();
  assert.equal(signedOut.status, 401);
  assert.equal((await signedOut.json()).error.code, 'UNAUTHENTICATED');

  // Identity headers are never trusted, only the verified session is.
  const spoofed = await fetch(`${app.base}/me/attendance-records`, {
    headers: {
      'x-authenticated-user-id': '3',
      'x-authenticated-role': 'student',
    },
  });
  assert.equal(spoofed.status, 401);

  app.state.signedIn = true;
  assert.equal((await get()).status, 403);
  assert.equal(
    (await fetch(`${app.base}/me/attendance-records?page=invalid`)).status,
    403,
  );

  app.state.user = { ...app.state.user, id: 3, role: 'student' };
  // The guard lets a student reach the service (the fake database is offline).
  assert.equal((await get()).status, 503);
});

require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startAttendanceApp } = require('./helpers/attendance-app');

const classSession = (overrides = {}) => ({
  id: 30,
  starts_at: new Date('2026-10-29T01:00:00.000Z'),
  late_after: new Date('2026-10-29T01:15:00.000Z'),
  ends_at: new Date('2026-10-29T03:00:00.000Z'),
  state: 'scheduled',
  class: {
    id: 1,
    section: 'A',
    term: '2026-S2',
    room_label: 'EN402',
    course: {
      id: 1,
      code: 'COS30043',
      name: 'Interface Design and Development',
    },
    teacher: { id: 2, name: 'Lecturer One' },
  },
  ...overrides,
});

const record = (studentId, status, checkedIn = null) => ({
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

const sorted = (object) => Object.keys(object).sort();

test('lecturer session roster over HTTP', async (t) => {
  const sessionCalls = [];
  const recordCalls = [];
  const ClassSession = {
    async findOne(options) {
      sessionCalls.push(options);
      return classSession();
    },
  };
  const AttendanceRecord = {
    async findAndCount(options) {
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
  const get = (path, headers = { 'x-dev-user-id': '2' }) =>
    fetch(`${app.base}/class-sessions${path}`, { headers });

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
        body.data.map((row) => row.checked_in_at),
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
      assert.equal(JSON.stringify(body).includes('@example.com'), false);
      assert.equal(JSON.stringify(body).includes('distance'), false);
      assert.deepEqual(sessionCalls.at(-1).where, {
        id: 30,
        class: { teacher_id: 2 },
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
    await get('/30/records', { 'x-dev-user-id': '9' });
    assert.equal(sessionCalls.at(-1).where.class.teacher_id, 9);
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

  await t.test('a missing or bad caller header answers 422', async () => {
    const count = sessionCalls.length;
    for (const headers of [{}, { 'x-dev-user-id': 'abc' }]) {
      const response = await get('/30/records', headers);
      assert.equal(response.status, 422);
      const { error } = await response.json();
      assert.deepEqual(Object.keys(error.fields), ['X-Dev-User-Id']);
    }
    assert.equal(sessionCalls.length, count);
  });

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
      AttendanceRecord.findAndCount = async (options) => {
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

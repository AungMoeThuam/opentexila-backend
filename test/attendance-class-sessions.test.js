require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startAttendanceApp } = require('./helpers/attendance-app');
const {
  MeClassSessionsService,
} = require('../dist/attendance/me-class-sessions.service');
const {
  ClassSessionSchema,
} = require('../dist/database/entities/class-session.schema');

const session = (overrides = {}) => ({
  id: 30,
  class_id: 1,
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

const sorted = (object) => Object.keys(object).sort();

test('lecturer session list over HTTP', async (t) => {
  const calls = [];
  const ClassSession = {
    async findAndCount(options) {
      calls.push(options);
      return [[session()], 21];
    },
  };
  const app = await startAttendanceApp({ ClassSession, AttendanceRecord: {} });
  t.after(() => app.close());
  const url = `${app.base}/me/class-sessions`;
  const get = (suffix = '', headers = { 'x-dev-user-id': '2' }) =>
    fetch(`${url}${suffix}`, { headers });

  await t.test(
    'defaults, scoping, ordering and the response shape',
    async () => {
      const response = await get();
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(sorted(body), ['data', 'meta']);
      assert.deepEqual(body.meta, {
        page: 1,
        limit: 20,
        total: 21,
        totalPages: 2,
      });
      const item = body.data[0];
      assert.deepEqual(sorted(item), [
        'availability',
        'class',
        'class_id',
        'ends_at',
        'id',
        'late_after',
        'my_attendance',
        'starts_at',
      ]);
      assert.deepEqual(sorted(item.class), [
        'course',
        'id',
        'lecturer',
        'room_label',
        'section',
        'term',
      ]);
      assert.deepEqual(item.class.lecturer, { id: 2, name: 'Lecturer One' });
      assert.equal(item.my_attendance, null);
      assert.equal(item.starts_at, '2026-10-29T01:00:00.000Z');
      const options = calls.at(-1);
      assert.deepEqual(options.where.class, { teacher_id: 2 });
      assert.equal(options.where.starts_at, undefined);
      assert.equal(options.skip, 0);
      assert.equal(options.take, 20);
      assert.deepEqual(options.order, { starts_at: 'ASC', id: 'ASC' });
    },
  );

  await t.test(
    'classId, pagination and the time range reach the query',
    async () => {
      const response = await get(
        '?classId=5&page=3&limit=5&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z',
      );
      assert.equal(response.status, 200);
      const options = calls.at(-1);
      assert.deepEqual(options.where.class, { teacher_id: 2, id: 5 });
      assert.ok(options.where.starts_at);
      assert.equal(options.skip, 10);
      assert.equal(options.take, 5);
    },
  );

  await t.test('another lecturer id scopes to that lecturer', async () => {
    await get('', { 'x-dev-user-id': '9' });
    assert.equal(calls.at(-1).where.class.teacher_id, 9);
  });

  await t.test('invalid input answers 422 before any query', async () => {
    const count = calls.length;
    const cases = [
      ['?page=1&page=2', 'page'],
      ['?page=0', 'page'],
      ['?limit=101', 'limit'],
      ['?classId=abc', 'classId'],
      ['?from=2026-10-29T01:00:00', 'from'],
      ['?to=2026-02-30T00:00:00Z', 'to'],
      ['?from=2026-10-30T00:00:00Z&to=2026-10-29T00:00:00Z', 'from'],
    ];
    for (const [suffix, field] of cases) {
      const response = await get(suffix);
      assert.equal(response.status, 422, suffix);
      const { error } = await response.json();
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.ok(field in error.fields, `${suffix} should name ${field}`);
    }
    assert.equal(calls.length, count);
  });

  await t.test('a missing or bad caller header answers 422', async () => {
    const count = calls.length;
    for (const headers of [{}, { 'x-dev-user-id': 'abc' }]) {
      const response = await get('', headers);
      assert.equal(response.status, 422);
      const { error } = await response.json();
      assert.deepEqual(Object.keys(error.fields), ['X-Dev-User-Id']);
    }
    assert.equal(calls.length, count);
  });

  await t.test('a page after the last page keeps the real total', async () => {
    ClassSession.findAndCount = async () => [[], 3];
    const response = await get('?page=9');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: [],
      meta: { page: 9, limit: 20, total: 3, totalPages: 1 },
    });
  });

  await t.test('database errors do not leak details', async () => {
    ClassSession.findAndCount = async () => {
      throw new Error('private details');
    };
    const response = await get();
    assert.equal(response.status, 500);
    assert.equal((await response.text()).includes('private details'), false);
  });
});

test('availability follows the server clock and the stored state', async () => {
  const rows = [
    session({ id: 1 }),
    session({ id: 2 }),
    session({ id: 3 }),
    session({ id: 4, state: 'cancelled' }),
  ];
  rows[1].starts_at = new Date('2026-10-29T00:00:00.000Z');
  rows[1].ends_at = new Date('2026-10-29T02:00:00.000Z');
  rows[2].starts_at = new Date('2026-10-28T00:00:00.000Z');
  rows[2].ends_at = new Date('2026-10-28T02:00:00.000Z');
  rows[0].starts_at = new Date('2026-10-30T00:00:00.000Z');
  rows[0].ends_at = new Date('2026-10-30T02:00:00.000Z');
  const database = {
    getRepository(schema) {
      assert.equal(schema, ClassSessionSchema);
      return { findAndCount: async () => [rows, rows.length] };
    },
  };
  const service = new MeClassSessionsService(database);
  const now = new Date('2026-10-29T01:00:00.000Z');
  const { data } = await service.list({ id: 2 }, {}, now);
  assert.deepEqual(
    data.map((item) => item.availability),
    ['upcoming', 'in_progress', 'ended', 'cancelled'],
  );
});

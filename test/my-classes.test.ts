import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';

test('my classes HTTP validation, permissions and query scoping', async (t) => {
  const calls: any[] = [];
  let rows: any[] = [
    {
      id: 1,
      section: 'A',
      term: '2026-S2',
      room_label: 'EN402',
      latitude: 3,
      course: { id: 1, code: 'COS30043', name: 'Interface Design' },
      lecturer: { id: 2, name: 'Lecturer', email: 'private@example.com' },
    },
  ];
  const builder: any = {};
  for (const method of [
    'innerJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'skip',
    'take',
  ])
    builder[method] = (...args: any[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  builder.getManyAndCount = async () => [rows, rows.length];
  const app = await startAttendanceApp({
    ClassSession: {},
    AttendanceRecord: {},
    Class: { createQueryBuilder: () => builder },
  });
  t.after(() => app.close());
  const get = (query = '') => fetch(`${app.base}/me/classes${query}`);
  let response = await get(
    '?page=2&limit=5&courseId=1&term=2026-S2&studentId=999&userId=999',
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body.data[0], {
    id: 1,
    course: { id: 1, code: 'COS30043', name: 'Interface Design' },
    section: 'A',
    term: '2026-S2',
    lecturer: { id: 2, name: 'Lecturer' },
    room_label: 'EN402',
  });
  assert.deepEqual(body.meta, { page: 2, limit: 5, total: 1, totalPages: 1 });
  assert.ok(
    calls.some(
      (c) =>
        c[0] === 'where' &&
        c[1] === 'class.lecturer_id = :userId' &&
        c[2].userId === 2,
    ),
  );
  assert.ok(calls.some((c) => c[0] === 'skip' && c[1] === 5));
  assert.ok(calls.some((c) => c[0] === 'andWhere' && c[2].term === '2026-S2'));
  app.state.user = { ...app.state.user, id: 3, role: 'student' };
  calls.length = 0;
  rows = [];
  response = await get();
  assert.deepEqual(await response.json(), {
    data: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  assert.ok(
    calls.some(
      (c) => c[0] === 'where' && c[1].includes('EXISTS') && c[2].userId === 3,
    ),
  );
  for (const query of [
    'page=0',
    'page=10001',
    'limit=101',
    'courseId=0',
    'courseId=1e2',
    'courseId=1&courseId=2',
    'term=',
    'term=%20',
    'term=a&term=b',
    'term=' + 'a'.repeat(51),
  ]) {
    calls.length = 0;
    response = await get('?' + query);
    assert.equal(response.status, 422, query);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    assert.equal(calls.length, 0);
  }
  app.state.user.role = 'admin';
  response = await get();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FORBIDDEN');
  app.state.signedIn = false;
  response = await get();
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
});

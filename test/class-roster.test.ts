import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';

const classroom = {
  id: 1,
  section: 'A',
  term: '2026-S2',
  room_label: 'EN402',
  course: { id: 1, code: 'COS30043', name: 'Interface Design' },
  lecturer: { id: 2, name: 'Lecturer Demo', email: 'private@example.com' },
};

async function start() {
  const calls: any[] = [];
  let enrolments: any[] = [];
  let found: any = classroom;
  const app = await startAttendanceApp({
    ClassSession: {},
    AttendanceRecord: {},
    Class: {
      findOne: async (options: any) => {
        calls.push(['Class.findOne', options]);
        return found;
      },
    },
    Enrolment: {
      findAndCount: async (options: any) => {
        calls.push(['Enrolment.findAndCount', options]);
        return [enrolments, enrolments.length];
      },
    },
  });
  return {
    app,
    calls,
    setEnrolments: (rows: any[]) => (enrolments = rows),
    setClass: (row: any) => (found = row),
    get: (path = '/classes/1/enrolments') => fetch(`${app.base}${path}`),
  };
}

test('students cannot read a class roster', async (t) => {
  const { app, calls, get } = await start();
  t.after(() => app.close());
  app.state.user = { ...app.state.user, id: 3, role: 'student' };
  const response = await get();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FORBIDDEN');
  assert.equal(calls.length, 0);
});

test('admins read the roster of any class', async (t) => {
  const { app, calls, get } = await start();
  t.after(() => app.close());
  app.state.user = { ...app.state.user, id: 9, role: 'admin' };
  const response = await get();
  assert.equal(response.status, 200);
  const [, classQuery] = calls.find((c) => c[0] === 'Class.findOne');
  assert.deepEqual(classQuery.where, { id: 1 });
  const [, rosterQuery] = calls.find((c) => c[0] === 'Enrolment.findAndCount');
  assert.deepEqual(rosterQuery.where, { class_id: 1 });
});

test('assigned lecturer reads the roster with class context', async (t) => {
  const { app, calls, get, setEnrolments } = await start();
  t.after(() => app.close());
  setEnrolments([
    {
      class_id: 1,
      student_id: 3,
      student: {
        id: 3,
        name: 'Student One',
        email: 'student.one@example.com',
        password_hash: 'secret',
      },
    },
  ]);
  const response = await get(
    '/classes/1/enrolments?page=2&limit=5&studentId=9',
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    data: [
      {
        class_id: 1,
        student_id: 3,
        student: {
          id: 3,
          name: 'Student One',
          email: 'student.one@example.com',
        },
      },
    ],
    context: {
      class: {
        id: 1,
        course: { id: 1, code: 'COS30043', name: 'Interface Design' },
        section: 'A',
        term: '2026-S2',
        lecturer: { id: 2, name: 'Lecturer Demo' },
        room_label: 'EN402',
      },
    },
    meta: { page: 2, limit: 5, total: 1, totalPages: 1 },
  });
  const [, classQuery] = calls.find((c) => c[0] === 'Class.findOne');
  assert.deepEqual(classQuery.where, { id: 1, lecturer_id: 2 });
  const [, rosterQuery] = calls.find((c) => c[0] === 'Enrolment.findAndCount');
  assert.deepEqual(rosterQuery.where, { class_id: 1 });
  assert.deepEqual(rosterQuery.order, { student_id: 'ASC' });
  assert.equal(rosterQuery.skip, 5);
  assert.equal(rosterQuery.take, 5);
});

test('missing or unassigned classes return the same 404', async (t) => {
  const { app, calls, get, setClass } = await start();
  t.after(() => app.close());
  setClass(null);
  const response = await get('/classes/99/enrolments');
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'RESOURCE_NOT_FOUND');
  assert.equal(
    calls.some((c) => c[0] === 'Enrolment.findAndCount'),
    false,
  );
});

test('invalid class id, page and limit are rejected before querying', async (t) => {
  const { app, calls, get } = await start();
  t.after(() => app.close());
  for (const path of [
    '/classes/0/enrolments',
    '/classes/abc/enrolments',
    '/classes/1e2/enrolments',
    '/classes/1/enrolments?page=0',
    '/classes/1/enrolments?page=10001',
    '/classes/1/enrolments?limit=0',
    '/classes/1/enrolments?limit=101',
    '/classes/1/enrolments?limit=1&limit=2',
  ]) {
    const response = await get(path);
    assert.equal(response.status, 422, path);
    assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
  }
  assert.equal(calls.length, 0);
});

test('a class with no students keeps its class context', async (t) => {
  const { app, get } = await start();
  t.after(() => app.close());
  const body = await (await get()).json();
  assert.deepEqual(body.data, []);
  assert.equal(body.context.class.id, 1);
  assert.deepEqual(body.meta, { page: 1, limit: 20, total: 0, totalPages: 0 });
});

test('signed-out callers get 401', async (t) => {
  const { app, get } = await start();
  t.after(() => app.close());
  app.state.signedIn = false;
  const response = await get();
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
});

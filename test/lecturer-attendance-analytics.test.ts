import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';

// The database seam is `DataSource.query`. Fake rows stand in for MySQL's
// aggregates, so these tests cover access control, validation and assembly.
// SQL rules (finalised sessions, enrolled students, UTC+8 days) are covered by
// test/attendance-analytics.integration.ts against real MySQL.
async function start(
  rows: {
    owned?: boolean;
    sessions?: any[];
    students?: any[];
    broken?: boolean;
  } = {},
) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const app = await startAttendanceApp(
    { ClassSession: {}, AttendanceRecord: {}, Class: {} },
    {
      database: {
        query: async (sql: string, params: unknown[] = []) => {
          calls.push({ sql, params });
          if (rows.broken) throw new Error('connection lost: secret detail');
          if (/FROM classes WHERE id/.test(sql))
            return rows.owned === false ? [] : [{ id: 7 }];
          if (/GROUP BY s\.class_id, r\.student_id/.test(sql))
            return rows.students ?? [];
          return rows.sessions ?? [];
        },
      },
    },
  );
  const get = (query = '?from=2026-10-01&to=2026-10-31') =>
    fetch(`${app.base}/lecturer/attendance-analytics${query}`);
  return { app, calls, get };
}

test('only signed-in lecturers can read analytics', async (t) => {
  const { app, calls, get } = await start();
  t.after(() => app.close());
  app.state.signedIn = false;
  let response = await get();
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
  app.state.signedIn = true;
  for (const role of ['student', 'admin']) {
    app.state.user = { ...app.state.user, id: 9, role };
    response = await get();
    assert.equal(response.status, 403, role);
    assert.equal((await response.json()).error.code, 'FORBIDDEN');
  }
  assert.equal(calls.length, 0);
});

test('invalid filters return 422 with a message under each bad field', async (t) => {
  const { app, get } = await start();
  t.after(() => app.close());
  const cases: [string, string[]][] = [
    ['', ['from', 'to']],
    ['?from=2026-10-01', ['to']],
    ['?from=2026-1-1&to=2026-10-31', ['from']],
    ['?from=2026-02-30&to=2026-10-31', ['from']],
    ['?from=2026-10-31&to=2026-10-01', ['from']],
    ['?from=2026-10-01&to=2026-10-31&atRiskBelow=74', ['atRiskBelow']],
    ['?from=2026-10-01&to=2026-10-31&atRiskBelow=101', ['atRiskBelow']],
    ['?from=2026-10-01&to=2026-10-31&atRiskBelow=80.5', ['atRiskBelow']],
    ['?from=2026-10-01&to=2026-10-31&atRiskBelow=abc', ['atRiskBelow']],
    ['?from=2026-10-01&to=2026-10-31&classId=abc', ['classId']],
    ['?from=2026-10-01&to=2026-10-31&classId=0', ['classId']],
    ['?from=2026-10-01&to=2026-10-31&classId=07', ['classId']],
    ['?from=2026-10-01&from=2026-10-02&to=2026-10-31', ['from']],
    ['?from=bad&to=bad&atRiskBelow=1', ['from', 'to', 'atRiskBelow']],
  ];
  for (const [query, fields] of cases) {
    const response = await get(query);
    assert.equal(response.status, 422, query);
    const { error } = await response.json();
    assert.equal(error.code, 'VALIDATION_ERROR', query);
    assert.deepEqual(Object.keys(error.fields).sort(), fields.sort(), query);
  }
  for (const ok of ['', '&atRiskBelow=75', '&atRiskBelow=100', '&classId=7']) {
    const response = await get(`?from=2026-10-01&to=2026-10-31${ok}`);
    assert.equal(response.status, 200, ok);
  }
});

test("a class that is not the lecturer's is forbidden, whether or not it exists", async (t) => {
  const { app, calls, get } = await start({ owned: false });
  t.after(() => app.close());
  const response = await get('?from=2026-10-01&to=2026-10-31&classId=99');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FORBIDDEN');
  assert.equal(calls.length, 1, 'only the ownership check ran');
});

test('an empty range returns zero counts and empty lists', async (t) => {
  const { app, calls, get } = await start();
  t.after(() => app.close());
  const response = await get('?from=2026-10-01&to=2026-10-31&atRiskBelow=80');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      summary: {
        sessions: 0,
        present: 0,
        late: 0,
        absent: 0,
        attendanceRate: 0,
        atRiskCount: 0,
        unfinalisedSessions: 0,
      },
      trend: [],
      byClass: [],
      atRisk: [],
      unfinalised: [],
    },
    meta: { from: '2026-10-01', to: '2026-10-31', atRiskBelow: 80 },
  });
  // Malaysia days: 1 Oct 00:00 +08:00 is 30 Sep 16:00 UTC; the range ends
  // before 1 Nov 00:00 +08:00, so a 31 Oct session is included.
  const params = calls.flatMap((c) => c.params.map(String));
  assert.ok(params.includes(new Date('2026-09-30T16:00:00Z').toString()));
  assert.ok(params.includes(new Date('2026-10-31T16:00:00Z').toString()));
  assert.ok(params.includes('2'), 'scoped to the signed-in lecturer');
});

const session = (over: Record<string, unknown>) => ({
  class_session_id: 1,
  class_id: 7,
  day: '2026-10-06',
  starts_at: new Date('2026-10-06T02:00:00Z'),
  ends_at: new Date('2026-10-06T04:00:00Z'),
  course_code: 'COS30043',
  course_name: 'Interface Design',
  section: '01',
  term: '2026-S2',
  present: '0',
  late: '0',
  absent: '0',
  pending: '0',
  ...over,
});

test('summary, trend and class comparison add up the finalised sessions', async (t) => {
  const { app, get } = await start({
    sessions: [
      session({ class_session_id: 1, present: '28', late: '3', absent: '4' }),
      session({
        class_session_id: 2,
        class_id: 8,
        course_code: 'COS20031',
        course_name: 'Databases',
        section: '02',
        present: '10',
      }),
      session({
        class_session_id: 3,
        day: '2026-10-07',
        present: '20',
        late: '5',
        absent: '5',
      }),
    ],
  });
  t.after(() => app.close());
  const { data } = await (await get()).json();
  // Worked by hand: present 58, late 8, absent 9; 66 of 75 attended = 88.0%.
  assert.deepEqual(data.summary, {
    sessions: 3,
    present: 58,
    late: 8,
    absent: 9,
    attendanceRate: 88,
    atRiskCount: 0,
    unfinalisedSessions: 0,
  });
  assert.deepEqual(data.trend, [
    { date: '2026-10-06', present: 38, late: 3, absent: 4 },
    { date: '2026-10-07', present: 20, late: 5, absent: 5 },
  ]);
  assert.deepEqual(data.byClass, [
    {
      classId: 7,
      course: { code: 'COS30043', name: 'Interface Design' },
      section: '01',
      term: '2026-S2',
      present: 48,
      late: 8,
      absent: 9,
      attendanceRate: 86.2,
    },
    {
      classId: 8,
      course: { code: 'COS20031', name: 'Databases' },
      section: '02',
      term: '2026-S2',
      present: 10,
      late: 0,
      absent: 0,
      attendanceRate: 100,
    },
  ]);
});

test('sessions that still have pending records are listed, never counted', async (t) => {
  const { app, get } = await start({
    sessions: [
      session({ class_session_id: 1, present: '3', late: '1' }),
      session({
        class_session_id: 2,
        day: '2026-10-08',
        starts_at: new Date('2026-10-08T02:00:00Z'),
        ends_at: new Date('2026-10-08T04:00:00Z'),
        present: '3',
        pending: '2',
      }),
      session({
        class_session_id: 3,
        class_id: 9,
        day: '2026-10-02',
        starts_at: new Date('2026-10-02T02:00:00Z'),
        ends_at: new Date('2026-10-02T04:00:00Z'),
        course_code: 'COS10001',
        course_name: 'Programming',
        section: '03',
        pending: '5',
      }),
    ],
  });
  t.after(() => app.close());
  const { data } = await (await get()).json();
  assert.deepEqual(data.summary, {
    sessions: 1,
    present: 3,
    late: 1,
    absent: 0,
    attendanceRate: 100,
    atRiskCount: 0,
    unfinalisedSessions: 2,
  });
  assert.deepEqual(data.trend, [
    { date: '2026-10-06', present: 3, late: 1, absent: 0 },
  ]);
  // Oldest first, so the lecturer sees what has waited longest.
  assert.deepEqual(data.unfinalised, [
    {
      classSessionId: 3,
      classId: 9,
      date: '2026-10-02',
      startsAt: '2026-10-02T02:00:00.000Z',
      endsAt: '2026-10-02T04:00:00.000Z',
      pendingCount: 5,
    },
    {
      classSessionId: 2,
      classId: 7,
      date: '2026-10-08',
      startsAt: '2026-10-08T02:00:00.000Z',
      endsAt: '2026-10-08T04:00:00.000Z',
      pendingCount: 2,
    },
  ]);
  // The card needs a label for class 9 even though it has no counted session.
  assert.deepEqual(
    data.byClass.map((c: any) => [c.classId, c.attendanceRate]),
    [
      [7, 100],
      [9, 0],
    ],
  );
  assert.equal(data.byClass[1].course.code, 'COS10001');
});

const student = (over: Record<string, unknown>) => ({
  class_id: 7,
  student_id: 1,
  name: 'Student',
  email: 'student@example.com',
  sessions: '0',
  present: '0',
  late: '0',
  absent: '0',
  ...over,
});

const studentRows = [
  student({
    student_id: 21,
    name: 'Zara',
    sessions: '12',
    present: '6',
    late: '1',
    absent: '5',
  }),
  student({
    student_id: 21,
    name: 'Zara',
    class_id: 8,
    sessions: '10',
    present: '5',
    absent: '5',
  }),
  student({
    student_id: 23,
    name: 'Bob',
    sessions: '10',
    present: '5',
    absent: '5',
  }),
  student({
    student_id: 26,
    name: 'Amy Tan',
    class_id: 8,
    sessions: '2',
    present: '1',
    absent: '1',
  }),
  student({
    student_id: 27,
    name: 'Amy Tan',
    sessions: '2',
    present: '1',
    absent: '1',
  }),
  student({
    student_id: 22,
    name: 'Amy Bright',
    sessions: '12',
    present: '9',
    absent: '3',
  }),
  student({
    student_id: 24,
    name: 'Eve',
    sessions: '9',
    present: '7',
    absent: '2',
  }),
  // 1499 of 2000 is 74.95%, shown as 75.0, so it is not below 75.
  student({
    student_id: 30,
    name: 'Edge',
    sessions: '2000',
    present: '1499',
    absent: '501',
  }),
];

const finalisedClasses = [
  session({ class_session_id: 1, present: '1' }),
  session({
    class_session_id: 2,
    class_id: 8,
    course_code: 'COS20031',
    course_name: 'Databases',
    section: '02',
    present: '1',
  }),
];

test('at-risk students are judged per class and sorted by the server', async (t) => {
  const { app, get } = await start({
    sessions: finalisedClasses,
    students: studentRows,
  });
  t.after(() => app.close());
  const { data } = await (await get()).json();
  // Lowest rate first; equal rates by name, then class.
  assert.deepEqual(
    data.atRisk.map((r: any) => [r.name, r.classId, r.attendanceRate]),
    [
      ['Amy Tan', 7, 50],
      ['Amy Tan', 8, 50],
      ['Bob', 7, 50],
      ['Zara', 8, 50],
      ['Zara', 7, 58.3],
    ],
  );
  assert.deepEqual(data.atRisk[4], {
    studentId: 21,
    name: 'Zara',
    email: 'student@example.com',
    classId: 7,
    sessions: 12,
    present: 6,
    late: 1,
    absent: 5,
    attendanceRate: 58.3,
  });
  // Zara is at risk in two classes: two rows, counted as rows.
  assert.equal(data.summary.atRiskCount, 5);
  assert.deepEqual(
    data.byClass.map((c: any) => c.classId),
    [7, 8],
  );
});

test('the threshold decides who is at risk', async (t) => {
  const { app, get } = await start({
    sessions: finalisedClasses,
    students: studentRows,
  });
  t.after(() => app.close());
  const { data, meta } = await (
    await get('?from=2026-10-01&to=2026-10-31&atRiskBelow=80')
  ).json();
  assert.equal(meta.atRiskBelow, 80);
  assert.deepEqual(
    data.atRisk.slice(5).map((r: any) => [r.name, r.attendanceRate]),
    [
      ['Amy Bright', 75],
      ['Edge', 75],
      ['Eve', 77.8],
    ],
  );
  assert.equal(data.summary.atRiskCount, 8);
});

test('a database failure returns the shared 500 envelope without details', async (t) => {
  const { app, get } = await start({ broken: true });
  t.after(() => app.close());
  const response = await get();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The server is not available.',
      fields: {},
    },
  });
});

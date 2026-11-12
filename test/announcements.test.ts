import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';
import { AnnouncementsModule } from '../dist/announcements/announcements.module.js';

const user = (role: string, id: number) => ({
  id,
  role,
  status: 'active',
  session_version: 0,
  must_change_password: false,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: '41',
  class_id: '7',
  category: 'class_change',
  title: "Tomorrow's class moves to EN305",
  body: 'Please go to room EN305.',
  created_at: new Date('2026-11-12T01:00:00.000Z'),
  updated_at: new Date('2026-11-12T01:30:00.000Z'),
  author_id: '2',
  author_name: 'Lecturer One',
  course_id: '1',
  course_code: 'COS30043',
  course_name: 'Interface Design',
  section: 'A',
  term: '2026-S2',
  like_count: '12',
  comment_count: '3',
  liked_by_me: '1',
  ...overrides,
});

test('announcement reading permissions, queries and responses', async (t) => {
  // Class 7 belongs to lecturer 2. Student 21 is enrolled; student 22 is not.
  const classes: Record<number, { id: number; lecturer_id: number }> = {
    7: { id: 7, lecturer_id: 2 },
    8: { id: 8, lecturer_id: 3 },
  };
  const enrolments = new Set(['7:21']);
  let rows: any[] = [row()];
  let total = 1;
  const queries: [string, any[]][] = [];
  const query = async (sql: string, params: any[] = []) => {
    queries.push([sql, params]);
    return sql.includes('COUNT(*) AS total')
      ? [{ total: String(total) }]
      : rows;
  };

  const app = await startAttendanceApp(
    {
      ClassSession: {},
      AttendanceRecord: {},
      Course: {},
      Class: {
        findOneBy: async ({ id }: any) => classes[id] ?? null,
        findOne: async ({ where: { id } }: any) =>
          classes[id]
            ? {
                ...classes[id],
                section: 'A',
                term: '2026-S2',
                room_label: 'EN402',
                course: { id: 1, code: 'COS30043', name: 'Interface Design' },
                lecturer: { id: classes[id].lecturer_id, name: 'Lecturer One' },
              }
            : null,
      },
      Enrolment: {
        findOneBy: async ({ class_id, student_id }: any) =>
          enrolments.has(`${class_id}:${student_id}`)
            ? { class_id, student_id }
            : null,
      },
      User: {
        findOneBy: async ({ id }: any) =>
          id === app.state.user.id ? app.state.user : null,
      },
    },
    { modules: [AnnouncementsModule], database: { query } },
  );
  t.after(() => app.close());

  const get = (path: string) => fetch(`${app.base}${path}`);
  const as = (role: string, id: number) => {
    app.state.user = user(role, id);
    app.state.signedIn = true;
  };
  const listSql = () =>
    queries.filter(([sql]) => !sql.includes('COUNT(*) AS total')).at(-1)!;

  await t.test('signed-out users get 401 on both endpoints', async () => {
    app.state.signedIn = false;
    for (const path of ['/classes/7/announcements', '/announcements/41']) {
      const response = await get(path);
      assert.equal(response.status, 401, path);
      assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
    }
    app.state.signedIn = true;
    assert.deepEqual(queries, []);
  });

  await t.test(
    'only the class lecturer, enrolled students and admins can read',
    async () => {
      const allowed: [string, number][] = [
        ['lecturer', 2],
        ['student', 21],
        ['admin', 1],
      ];
      for (const [role, id] of allowed) {
        as(role, id);
        const response = await get('/classes/7/announcements');
        assert.equal(response.status, 200, `${role} ${id}`);
      }
      const hidden: [string, number][] = [
        ['lecturer', 3],
        ['student', 22],
      ];
      queries.length = 0;
      for (const [role, id] of hidden) {
        as(role, id);
        const response = await get('/classes/7/announcements');
        assert.equal(response.status, 404, `${role} ${id}`);
        const error = (await response.json()).error;
        assert.equal(error.code, 'RESOURCE_NOT_FOUND');
      }
      as('admin', 1);
      assert.equal((await get('/classes/999/announcements')).status, 404);
      // A refused or unknown class never reaches the announcement tables.
      assert.deepEqual(queries, []);
    },
  );

  await t.test(
    'GET list returns the announcement object and paging',
    async () => {
      as('student', 21);
      rows = [row()];
      total = 41;
      const response = await get('/classes/7/announcements?page=2&limit=20');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        data: [
          {
            id: 41,
            class_id: 7,
            category: 'class_change',
            title: "Tomorrow's class moves to EN305",
            body: 'Please go to room EN305.',
            author: { id: 2, name: 'Lecturer One' },
            class: {
              id: 7,
              course: { id: 1, code: 'COS30043', name: 'Interface Design' },
              section: 'A',
              term: '2026-S2',
            },
            created_at: '2026-11-12T01:00:00.000Z',
            updated_at: '2026-11-12T01:30:00.000Z',
            like_count: 12,
            comment_count: 3,
            liked_by_me: true,
          },
        ],
        context: {
          class: {
            id: 7,
            course: { id: 1, code: 'COS30043', name: 'Interface Design' },
            section: 'A',
            term: '2026-S2',
            lecturer: { id: 2, name: 'Lecturer One' },
            room_label: 'EN402',
          },
        },
        meta: { page: 2, limit: 20, total: 41, totalPages: 3 },
      });
      const [sql, params] = listSql();
      assert.match(sql, /LIMIT \? OFFSET \?/);
      assert.deepEqual(params.slice(-2), [20, 20]);
      assert.equal(params[0], 21, 'liked_by_me uses the caller id');
    },
  );

  await t.test('an empty feed is an empty list, not an error', async () => {
    as('lecturer', 2);
    rows = [];
    total = 0;
    const response = await get('/classes/7/announcements');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: [],
      context: {
        class: {
          id: 7,
          course: { id: 1, code: 'COS30043', name: 'Interface Design' },
          section: 'A',
          term: '2026-S2',
          lecturer: { id: 2, name: 'Lecturer One' },
          room_label: 'EN402',
        },
      },
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    rows = [row()];
    total = 1;
  });

  await t.test('liked_by_me is always false for an admin', async () => {
    as('admin', 1);
    const body = await (await get('/classes/7/announcements')).json();
    assert.equal(body.data[0].liked_by_me, false);
    assert.equal(
      (await (await get('/announcements/41')).json()).data.liked_by_me,
      false,
    );
  });

  await t.test(
    'sort options use fixed ORDER BY text ending in id',
    async () => {
      as('student', 21);
      const orders: Record<string, RegExp> = {
        '': /ORDER BY a\.created_at DESC, a\.id DESC/,
        '?sort=newest': /ORDER BY a\.created_at DESC, a\.id DESC/,
        '?sort=oldest': /ORDER BY a\.created_at ASC, a\.id ASC/,
        '?sort=most_liked':
          /ORDER BY like_count DESC, a\.created_at DESC, a\.id DESC/,
      };
      for (const [query, pattern] of Object.entries(orders)) {
        const response = await get(`/classes/7/announcements${query}`);
        assert.equal(response.status, 200, query);
        assert.match(listSql()[0], pattern, query);
      }
    },
  );

  await t.test('search and category filters become parameters', async () => {
    as('student', 21);
    const response = await get(
      '/classes/7/announcements?search=%20100%25_%20&category=exam',
    );
    assert.equal(response.status, 200);
    const [sql, params] = listSql();
    assert.match(sql, /a\.category = \?/);
    assert.match(sql, /\(a\.title LIKE \? OR a\.body LIKE \?\)/);
    // [me, class, category, pattern, pattern, limit, offset]
    assert.deepEqual(params, [
      21,
      7,
      'exam',
      '%100\\%\\_%',
      '%100\\%\\_%',
      20,
      0,
    ]);
    assert.equal(
      sql.includes('exam'),
      false,
      'values are never in the SQL text',
    );
    assert.equal(sql.includes('100'), false);
  });

  await t.test('GET list validates the class ID and the query', async () => {
    as('student', 21);
    queries.length = 0;
    const cases: [string, string][] = [
      ['limit', '?limit=0'],
      ['limit', '?limit=101'],
      ['page', '?page=0'],
      ['sort', '?sort=random'],
      ['category', '?category=news'],
      ['search', '?search='],
      ['search', `?search=${'a'.repeat(101)}`],
    ];
    for (const [field, query] of cases) {
      const response = await get(`/classes/7/announcements${query}`);
      assert.equal(response.status, 422, query);
      const error = (await response.json()).error;
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.ok(error.fields[field], `${field} message`);
    }
    for (const id of ['0', 'abc', '1.5']) {
      const response = await get(`/classes/${id}/announcements`);
      assert.equal(response.status, 422, id);
      assert.ok((await response.json()).error.fields.classId);
    }
    assert.deepEqual(queries, []);
  });

  await t.test(
    'GET one announcement follows the same visibility rules',
    async () => {
      rows = [row()];
      for (const [role, id, status] of [
        ['student', 21, 200],
        ['lecturer', 2, 200],
        ['admin', 1, 200],
        ['student', 22, 404],
        ['lecturer', 3, 404],
      ] as [string, number, number][]) {
        as(role, id);
        const response = await get('/announcements/41');
        assert.equal(response.status, status, `${role} ${id}`);
        const body = await response.json();
        if (status === 200) assert.equal(body.data.id, 41);
        else assert.equal(body.error.code, 'RESOURCE_NOT_FOUND');
      }
      as('student', 21);
      rows = [];
      const missing = await get('/announcements/999');
      assert.equal(missing.status, 404);
      // A hidden post and a missing post give the same message.
      as('student', 22);
      rows = [row()];
      const hidden = await get('/announcements/41');
      assert.equal(
        (await hidden.json()).error.message,
        (await missing.json()).error.message,
      );
    },
  );

  await t.test('GET one validates the ID', async () => {
    as('student', 21);
    for (const id of ['0', 'abc', '-1']) {
      const response = await get(`/announcements/${id}`);
      assert.equal(response.status, 422, id);
      assert.ok((await response.json()).error.fields.announcementId);
    }
  });

  await t.test('GET /announcements needs a signed-in user', async () => {
    app.state.signedIn = false;
    const response = await get('/announcements');
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
    app.state.signedIn = true;
  });

  await t.test(
    'GET /announcements limits each role to its own classes',
    async () => {
      rows = [row()];
      total = 1;
      const cases: [string, number, RegExp, any[]][] = [
        [
          'student',
          21,
          /class_id IN \(SELECT class_id FROM enrolments WHERE student_id = \?\)/,
          [21, 21, 20, 0],
        ],
        [
          'lecturer',
          2,
          /class_id IN \(SELECT id FROM classes WHERE lecturer_id = \?\)/,
          [2, 2, 20, 0],
        ],
        ['admin', 1, /1 = 1/, [1, 20, 0]],
      ];
      for (const [role, id, pattern, params] of cases) {
        as(role, id);
        const response = await get('/announcements');
        assert.equal(response.status, 200, role);
        const [sql, used] = listSql();
        assert.match(sql, pattern, role);
        assert.deepEqual(used, params, role);
        const body = await response.json();
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(Object.keys(body).sort(), ['data', 'meta']);
        assert.deepEqual(body.meta, {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        });
        // Each post says which class it belongs to.
        assert.deepEqual(body.data[0].class, {
          id: 7,
          course: { id: 1, code: 'COS30043', name: 'Interface Design' },
          section: 'A',
          term: '2026-S2',
        });
      }
    },
  );

  await t.test(
    'GET /announcements applies filters, sort and paging',
    async () => {
      as('student', 21);
      total = 45;
      const response = await get(
        '/announcements?search=%20quiz%25%20&category=exam&sort=most_liked&page=2&limit=10',
      );
      assert.equal(response.status, 200);
      const [sql, params] = listSql();
      assert.match(
        sql,
        /ORDER BY like_count DESC, a\.created_at DESC, a\.id DESC/,
      );
      assert.match(sql, /a\.category = \?/);
      // [me, scope, category, pattern, pattern, limit, offset]
      assert.deepEqual(params, [
        21,
        21,
        'exam',
        '%quiz\\%%',
        '%quiz\\%%',
        10,
        10,
      ]);
      assert.deepEqual((await response.json()).meta, {
        page: 2,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
      total = 1;
    },
  );

  await t.test(
    'GET /announcements?classId narrows to one visible class',
    async () => {
      as('student', 21);
      let response = await get('/announcements?classId=7&category=reminder');
      assert.equal(response.status, 200);
      let [sql, params] = listSql();
      assert.match(sql, / AND a\.class_id = \?/);
      assert.deepEqual(params, [21, 21, 7, 'reminder', 20, 0]);
      as('admin', 1);
      response = await get('/announcements?classId=8');
      assert.equal(response.status, 200);
      [sql, params] = listSql();
      assert.deepEqual(params, [1, 8, 20, 0]);
    },
  );

  await t.test(
    'GET /announcements?classId hides classes the caller cannot see',
    async () => {
      queries.length = 0;
      for (const [role, id, classId] of [
        ['student', 22, 7],
        ['student', 21, 8],
        ['lecturer', 3, 7],
        ['lecturer', 2, 8],
        ['admin', 1, 999],
      ] as [string, number, number][]) {
        as(role, id);
        const response = await get(`/announcements?classId=${classId}`);
        assert.equal(response.status, 404, `${role} ${id} class ${classId}`);
        assert.equal((await response.json()).error.code, 'RESOURCE_NOT_FOUND');
      }
      assert.deepEqual(queries, []);
    },
  );

  await t.test('GET /announcements validates the query', async () => {
    as('student', 21);
    queries.length = 0;
    for (const [field, query] of [
      ['classId', '?classId=0'],
      ['classId', '?classId=abc'],
      ['classId', '?classId=1.5'],
      ['limit', '?limit=101'],
      ['page', '?page=0'],
      ['sort', '?sort=random'],
      ['category', '?category=news'],
      ['search', '?search='],
    ]) {
      const response = await get(`/announcements${query}`);
      assert.equal(response.status, 422, query);
      const error = (await response.json()).error;
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.ok(error.fields[field], `${field} message`);
    }
    assert.deepEqual(queries, []);
  });

  await t.test(
    'GET /announcements shows liked_by_me as false for an admin',
    async () => {
      as('admin', 1);
      const body = await (await get('/announcements')).json();
      assert.equal(body.data[0].liked_by_me, false);
    },
  );
});

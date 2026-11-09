import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';
import { CoursesModule } from '../dist/courses/courses.module.js';
import { MAX_RADIUS_M } from '../dist/courses/class-management.rules.js';

const admin = () => ({
  id: 1,
  role: 'admin',
  status: 'active',
  session_version: 0,
  must_change_password: false,
});

const duplicateError = (key: string) =>
  Object.assign(new Error(`Duplicate entry 'X' for key '${key}'`), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
  });

const validClass = () => ({
  course_id: 1,
  term: '2026-S2',
  section: 'a',
  lecturer_id: 2,
  room_label: 'EN402',
  latitude: -37.8221,
  longitude: 145.0389,
  radius_m: 50,
});

const detailRow = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  term: '2026-S2',
  section: 'A',
  room_label: 'EN402',
  latitude: '-37.822100',
  longitude: '145.038900',
  radius_m: '50.00',
  course_id: 1,
  course_code: 'COS30043',
  course_name: 'Interface Design',
  lecturer_id: 2,
  lecturer_name: 'Lecturer One',
  has_class_sessions: '0',
  ...overrides,
});

test('course and class management HTTP permissions, validation and responses', async (t) => {
  const builderCalls: any[] = [];
  const builder = (rows: any[]) => {
    const fake: any = {};
    for (const method of [
      'select',
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
      'innerJoinAndSelect',
    ]) {
      fake[method] = (...args: any[]) => {
        builderCalls.push([method, ...args]);
        return fake;
      };
    }
    fake.getManyAndCount = async () => [rows, rows.length];
    return fake;
  };

  let courseRows: any[] = [];
  let lecturerRows: any[] = [];
  let classRows: any[] = [];
  let insertedCourse: any = null;
  let updatedCourse: any = null;
  let courseInsert: (values: any) => Promise<any> = async (values) => {
    insertedCourse = values;
    return { identifiers: [{ id: 9 }] };
  };
  let existingCourse: any = { id: 1, code: 'COS30043', name: 'Old name' };
  let queries: [string, unknown[]][] = [];
  let onQuery: (sql: string, params: unknown[]) => any = () => [];
  const query = async (sql: string, params: unknown[] = []) => {
    queries.push([sql, params]);
    return onQuery(sql, params);
  };

  const app = await startAttendanceApp(
    {
      ClassSession: {},
      AttendanceRecord: {},
      Enrolment: {},
      Class: { createQueryBuilder: () => builder(classRows) },
      Course: {
        createQueryBuilder: () => builder(courseRows),
        insert: (values: any) => courseInsert(values),
        findOneBy: async ({ id }: any) =>
          existingCourse?.id === id ? existingCourse : null,
        update: async (criteria: any, values: any) => {
          updatedCourse = { criteria, values };
        },
      },
      User: {
        findOneBy: async ({ id }: any) =>
          id === app.state.user.id ? app.state.user : null,
        createQueryBuilder: () => builder(lecturerRows),
      },
    },
    {
      modules: [CoursesModule],
      database: { query, transaction: async (work: any) => work({ query }) },
    },
  );
  t.after(() => app.close());
  app.state.user = admin();

  const send = (method: string, path: string, body?: unknown, csrf = true) =>
    fetch(`${app.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(csrf ? { 'x-csrf-token': 'fixture-token' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const endpoints: [string, string, unknown?][] = [
    ['GET', '/courses'],
    ['POST', '/courses', { code: 'X1', name: 'X' }],
    ['PATCH', '/courses/1', { name: 'X' }],
    ['GET', '/lecturers'],
    ['POST', '/classes', validClass()],
    ['GET', '/classes/1'],
    ['PATCH', '/classes/1', { room_label: 'X' }],
  ];

  await t.test('only signed-in admins can use the endpoints', async () => {
    for (const role of ['student', 'lecturer']) {
      app.state.user = { ...admin(), role };
      for (const [method, path, body] of endpoints) {
        const response = await send(method, path, body);
        assert.equal(response.status, 403, `${role} ${method} ${path}`);
        assert.equal((await response.json()).error.code, 'FORBIDDEN');
      }
    }
    app.state.user = admin();
    app.state.signedIn = false;
    for (const [method, path, body] of endpoints) {
      const response = await send(method, path, body);
      assert.equal(response.status, 401, `${method} ${path}`);
    }
    app.state.signedIn = true;
    for (const [method, path, body] of endpoints.filter(
      ([method]) => method !== 'GET',
    )) {
      const response = await send(method, path, body, false);
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.equal((await response.json()).error.code, 'CSRF_INVALID');
    }
    assert.equal(insertedCourse, null);
    assert.equal(updatedCourse, null);
    assert.deepEqual(queries, []);
  });

  await t.test('GET /classes still uses the class-list handler', async () => {
    classRows = [
      {
        id: 1,
        section: 'A',
        term: '2026-S2',
        room_label: 'EN402',
        course: { id: 1, code: 'COS30043', name: 'Interface Design' },
        lecturer: { id: 2, name: 'Lecturer One' },
      },
    ];
    const response = await fetch(`${app.base}/classes`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(Object.keys(body.data[0]).sort(), [
      'course',
      'id',
      'lecturer',
      'room_label',
      'section',
      'term',
    ]);
  });

  await t.test('GET /courses lists, searches and validates', async () => {
    courseRows = [{ id: 1, code: 'COS30043', name: 'Interface Design' }];
    builderCalls.length = 0;
    const response = await fetch(`${app.base}/courses?q=%20cos%25_%20`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      data: [{ id: 1, code: 'COS30043', name: 'Interface Design' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    const search = builderCalls.find((call) => call[0] === 'andWhere');
    assert.equal(search[2].pattern, '%cos\\%\\_%');

    for (const query of ['q=', 'q=%20', `q=${'x'.repeat(101)}`, 'page=0']) {
      const invalid = await fetch(`${app.base}/courses?${query}`);
      assert.equal(invalid.status, 422, query);
    }
  });

  await t.test(
    'GET /lecturers returns only active lecturer selector fields',
    async () => {
      lecturerRows = [
        {
          id: 2,
          name: 'Lecturer One',
          email: 'lecturer.one@example.com',
          role: 'lecturer',
          status: 'active',
          password_hash: 'secret',
        },
      ];
      builderCalls.length = 0;
      const response = await fetch(`${app.base}/lecturers?limit=5`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.data, [
        { id: 2, name: 'Lecturer One', email: 'lecturer.one@example.com' },
      ]);
      assert.equal(body.meta.limit, 5);
      assert.ok(
        builderCalls.some(
          (call) => call[0] === 'where' && call[2]?.role === 'lecturer',
        ),
      );
      assert.ok(
        builderCalls.some(
          (call) => call[0] === 'andWhere' && call[2]?.status === 'active',
        ),
      );
    },
  );

  await t.test(
    'POST /courses normalises, validates and reports duplicates',
    async () => {
      const response = await send('POST', '/courses', {
        code: '  cos30043 ',
        name: '  Interface Design  ',
        extra: 'ignored',
      });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), {
        data: { id: 9, code: 'COS30043', name: 'Interface Design' },
      });
      assert.deepEqual(insertedCourse, {
        code: 'COS30043',
        name: 'Interface Design',
      });

      const missing = await send('POST', '/courses', {});
      assert.equal(missing.status, 422);
      assert.deepEqual(
        Object.keys((await missing.json()).error.fields).sort(),
        ['code', 'name'],
      );
      for (const body of [
        { code: 'COS 300', name: 'X' },
        { code: 'X'.repeat(31), name: 'X' },
        { code: 'CÖS', name: 'X' },
        { code: 'X1', name: '   ' },
        { code: 'X1', name: 'x'.repeat(151) },
        { code: 1, name: 'X' },
        { code: null, name: 'X' },
      ]) {
        const invalid = await send('POST', '/courses', body);
        assert.equal(invalid.status, 422, JSON.stringify(body));
        assert.equal((await invalid.json()).error.code, 'VALIDATION_ERROR');
      }

      courseInsert = async () => {
        throw duplicateError('courses.uq_courses_code');
      };
      const duplicate = await send('POST', '/courses', {
        code: 'X1',
        name: 'X',
      });
      assert.equal(duplicate.status, 409);
      assert.deepEqual((await duplicate.json()).error, {
        code: 'COURSE_CODE_TAKEN',
        message: 'A course with this code already exists.',
        fields: { code: 'A course with this code already exists.' },
      });
    },
  );

  await t.test(
    'PATCH /courses/:courseId updates sent fields only',
    async () => {
      const response = await send('PATCH', '/courses/1', {
        name: ' New name ',
      });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data, {
        id: 1,
        code: 'COS30043',
        name: 'New name',
      });
      assert.deepEqual(updatedCourse, {
        criteria: { id: 1 },
        values: { name: 'New name' },
      });

      const missing = await send('PATCH', '/courses/2', { name: 'X' });
      assert.equal(missing.status, 404);
      for (const [path, body] of [
        ['/courses/1', {}],
        ['/courses/1', { name: null }],
        ['/courses/0', { name: 'X' }],
        ['/courses/abc', { name: 'X' }],
      ] as const) {
        const invalid = await send('PATCH', path, body);
        assert.equal(invalid.status, 422, `${path} ${JSON.stringify(body)}`);
      }
    },
  );

  await t.test(
    'POST /classes validates every field before touching the database',
    async () => {
      queries = [];
      const missing = await send('POST', '/classes', {});
      assert.equal(missing.status, 422);
      assert.deepEqual(
        Object.keys((await missing.json()).error.fields).sort(),
        [
          'course_id',
          'latitude',
          'lecturer_id',
          'longitude',
          'radius_m',
          'room_label',
          'section',
          'term',
        ],
      );
      for (const [field, value] of [
        ['course_id', '1'],
        ['course_id', 0],
        ['course_id', 1.5],
        ['lecturer_id', 4294967296],
        ['term', ''],
        ['term', 'x'.repeat(51)],
        ['section', 'A B'],
        ['room_label', 'x'.repeat(101)],
        ['latitude', 90.1],
        ['latitude', '-37.8'],
        ['longitude', -180.5],
        ['radius_m', 0],
        ['radius_m', -5],
        ['radius_m', MAX_RADIUS_M + 1],
        ['radius_m', null],
      ] as const) {
        const response = await send('POST', '/classes', {
          ...validClass(),
          [field]: value,
        });
        assert.equal(response.status, 422, `${field}=${JSON.stringify(value)}`);
        const { error } = await response.json();
        assert.ok(error.fields[field], `${field}=${JSON.stringify(value)}`);
      }
      assert.deepEqual(queries, []);
    },
  );

  await t.test('POST /classes maps a duplicate section to 409', async () => {
    onQuery = (sql) => {
      if (sql.startsWith('SELECT id FROM courses')) return [{ id: 1 }];
      if (sql.startsWith('SELECT role, status FROM users'))
        return [{ role: 'lecturer', status: 'active' }];
      if (sql.startsWith('INSERT INTO classes'))
        throw duplicateError('classes.uq_classes_course_term_section');
      return [];
    };
    const response = await send('POST', '/classes', validClass());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'CLASS_SECTION_TAKEN');
    const insert = queries.find(([sql]) => sql.startsWith('INSERT'));
    // Section is upper-cased and the decimals are sent at column precision.
    assert.deepEqual(insert?.[1], [
      1,
      '2026-S2',
      'A',
      2,
      'EN402',
      -37.8221,
      145.0389,
      50,
    ]);
  });

  await t.test(
    'GET /classes/:classId returns decimals as strings',
    async () => {
      onQuery = (sql, params) => (params[0] === 7 ? [detailRow()] : []);
      const response = await fetch(`${app.base}/classes/7`);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data, {
        id: 7,
        course: { id: 1, code: 'COS30043', name: 'Interface Design' },
        term: '2026-S2',
        section: 'A',
        lecturer: { id: 2, name: 'Lecturer One' },
        room_label: 'EN402',
        latitude: '-37.822100',
        longitude: '145.038900',
        radius_m: '50.00',
        has_class_sessions: false,
      });
      assert.equal((await fetch(`${app.base}/classes/8`)).status, 404);
      assert.equal((await fetch(`${app.base}/classes/0`)).status, 422);
    },
  );

  await t.test(
    'PATCH /classes/:classId blocks identity changes once sessions exist',
    async () => {
      queries = [];
      onQuery = (sql) => {
        if (sql.startsWith('SELECT id, course_id'))
          return [
            {
              id: 7,
              course_id: 1,
              term: '2026-S2',
              section: 'A',
              lecturer_id: 2,
            },
          ];
        if (sql.includes('FROM class_sessions WHERE class_id'))
          return [{ found: '1' }];
        return [detailRow({ has_class_sessions: '1' })];
      };
      const blocked = await send('PATCH', '/classes/7', {
        term: '2026-S1',
        section: 'a',
        room_label: 'EN403',
      });
      assert.equal(blocked.status, 409);
      // `section: "a"` normalises to the current "A", so only term is rejected.
      assert.deepEqual((await blocked.json()).error.fields, {
        term: 'Cannot change after class sessions exist.',
      });
      assert.ok(!queries.some(([sql]) => sql.startsWith('UPDATE')));

      queries = [];
      const allowed = await send('PATCH', '/classes/7', {
        course_id: 1,
        term: '2026-S2',
        section: 'A',
        room_label: 'EN403',
        radius_m: 75.556,
      });
      assert.equal(allowed.status, 200);
      const update = queries.find(([sql]) => sql.startsWith('UPDATE'));
      assert.match(
        update![0],
        /SET room_label = \?, radius_m = \? WHERE id = \?/,
      );
      assert.deepEqual(update![1], ['EN403', 75.56, 7]);

      const empty = await send('PATCH', '/classes/7', {});
      assert.equal(empty.status, 422);
    },
  );
});

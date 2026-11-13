import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';
import { ClassSessionsModule } from '../dist/class-sessions/class-sessions.module.js';

const NOW = new Date('2026-11-12T00:00:00.000Z');
const user = (role: string, id: number) => ({
  id,
  role,
  status: 'active',
  session_version: 0,
  must_change_password: false,
});
const at = (hours: number) => new Date(NOW.getTime() + hours * 3600_000);
const iso = (hours: number) => at(hours).toISOString();
const sql = (value: Date) => value.toISOString().slice(0, 23).replace('T', ' ');

test('admin session management: permissions, rules, queries and responses', async (t) => {
  const klass = {
    id: 7,
    course_id: 1,
    lecturer_id: 2,
    section: 'A',
    term: '2026-S2',
    room_label: 'EN402',
    latitude: '3.121500',
    longitude: '101.656800',
    radius_m: '75.00',
  };
  const classes: Record<number, any> = { 7: klass };
  // Sessions by id, for the cancel lock and for the final read.
  const sessions: Record<number, any> = {};
  const makeSession = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    class_id: 7,
    room_label: 'EN402',
    latitude: '3.121500',
    longitude: '101.656800',
    radius_m: '75.00',
    starts_at: at(24),
    late_after: at(24.25),
    ends_at: at(26),
    state: 'scheduled',
    present_count: '0',
    late_count: '0',
    absent_count: '0',
    pending_count: '0',
    ...over,
  });
  let listRows: any[] = [];
  let total = 0;
  let sameStart: any[] = [];
  let overlapRows: any[] = [];
  let insertError: any = null;
  const log: string[] = [];
  const queries: [string, any[]][] = [];
  const query = async (text: string, params: any[] = []) => {
    queries.push([text, params]);
    const head = text.replace(/\s+/g, ' ').trim();
    if (head.startsWith('SELECT UTC_TIMESTAMP')) return [{ now: NOW }];
    if (head.startsWith('SELECT COUNT(*) AS total FROM class_sessions'))
      return [{ total: String(total) }];
    if (head.includes('FROM class_sessions s') && head.includes('LIMIT'))
      return listRows;
    if (head.includes('FROM class_sessions s WHERE s.id = ?'))
      return sessions[params[0]] ? [sessions[params[0]]] : [];
    if (head.startsWith('SELECT class_id FROM class_sessions WHERE id')) {
      log.push('session lookup');
      return sessions[params[0]]
        ? [{ class_id: sessions[params[0]].class_id }]
        : [];
    }
    if (head.startsWith('SELECT * FROM classes WHERE id = ? FOR UPDATE')) {
      log.push('lock class');
      return classes[params[0]] ? [classes[params[0]]] : [];
    }
    if (
      head.startsWith('SELECT * FROM class_sessions WHERE id = ? FOR UPDATE')
    ) {
      log.push('lock session');
      return sessions[params[0]] ? [sessions[params[0]]] : [];
    }
    if (head.startsWith('SELECT id FROM class_sessions WHERE class_id'))
      return sameStart;
    if (head.includes('JOIN classes c ON c.id = s.class_id'))
      return overlapRows;
    if (head.startsWith('INSERT INTO class_sessions')) {
      if (insertError) throw insertError;
      sessions[31] = makeSession(31, {
        starts_at: new Date(`${params[5].replace(' ', 'T')}Z`),
        late_after: new Date(`${params[6].replace(' ', 'T')}Z`),
        ends_at: new Date(`${params[7].replace(' ', 'T')}Z`),
      });
      return { insertId: 31 };
    }
    if (head.startsWith("UPDATE class_sessions SET state = 'cancelled'")) {
      log.push('update');
      sessions[params[0]].state = 'cancelled';
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected SQL: ${head}`);
  };
  const transaction = async (work: (manager: any) => Promise<unknown>) =>
    work({ query });

  const app = await startAttendanceApp(
    {
      ClassSession: {},
      AttendanceRecord: {},
      Course: {},
      Enrolment: {},
      Class: {
        findOne: async ({ where: { id } }: any) =>
          classes[id]
            ? {
                ...classes[id],
                course: { id: 1, code: 'COS30043', name: 'Interface Design' },
                lecturer: { id: 2, name: 'Lecturer One' },
              }
            : null,
      },
    },
    {
      modules: [ClassSessionsModule],
      database: { query, transaction, manager: { query } },
    },
  );
  t.after(() => app.close());

  const as = (role: string, id = 1) => {
    app.state.user = user(role, id);
    app.state.signedIn = true;
  };
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${app.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'fixture-token',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const reset = () => {
    queries.length = 0;
    log.length = 0;
    sameStart = [];
    overlapRows = [];
    insertError = null;
  };
  const valid = {
    starts_at: iso(24),
    late_after: iso(24.25),
    ends_at: iso(26),
  };

  await t.test('signed-out users get 401 on every endpoint', async () => {
    app.state.signedIn = false;
    reset();
    for (const [method, path] of [
      ['GET', '/classes/7/class-sessions'],
      ['POST', '/classes/7/class-sessions'],
      ['POST', '/class-sessions/31/cancel'],
    ]) {
      const response = await send(
        method,
        path,
        method === 'POST' ? valid : undefined,
      );
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
    }
    assert.deepEqual(queries, []);
  });

  await t.test('only admins can use the management endpoints', async () => {
    reset();
    for (const [role, id] of [
      ['student', 21],
      ['lecturer', 2],
    ] as [string, number][]) {
      as(role, id);
      for (const [method, path] of [
        ['GET', '/classes/7/class-sessions'],
        ['POST', '/classes/7/class-sessions'],
        ['POST', '/class-sessions/31/cancel'],
      ]) {
        const response = await send(
          method,
          path,
          method === 'POST' ? valid : undefined,
        );
        assert.equal(response.status, 403, `${role} ${method} ${path}`);
        assert.equal((await response.json()).error.code, 'FORBIDDEN');
      }
    }
    assert.deepEqual(queries, [], 'nothing reached the database');
  });

  await t.test(
    'GET lists one class with counts, context and paging',
    async () => {
      as('admin');
      reset();
      total = 21;
      listRows = [
        makeSession(30, {
          starts_at: at(-5),
          late_after: at(-4.75),
          ends_at: at(-3),
          present_count: '10',
          late_count: '2',
          absent_count: '1',
          pending_count: '0',
        }),
        makeSession(31),
      ];
      const response = await send(
        'GET',
        '/classes/7/class-sessions?page=2&limit=20',
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ['context', 'data', 'meta']);
      assert.deepEqual(body.meta, {
        page: 2,
        limit: 20,
        total: 21,
        totalPages: 2,
      });
      assert.deepEqual(body.context.class, {
        id: 7,
        course: { id: 1, code: 'COS30043', name: 'Interface Design' },
        section: 'A',
        term: '2026-S2',
        lecturer: { id: 2, name: 'Lecturer One' },
        room_label: 'EN402',
      });
      assert.deepEqual(body.data[0], {
        id: 30,
        class_id: 7,
        room_label: 'EN402',
        latitude: '3.121500',
        longitude: '101.656800',
        radius_m: '75.00',
        starts_at: iso(-5),
        late_after: iso(-4.75),
        ends_at: iso(-3),
        state: 'scheduled',
        availability: 'ended',
        attendance: { present: 10, late: 2, absent: 1, pending: 0 },
      });
      assert.equal(body.data[1].availability, 'upcoming');
      const listSql = queries.find(([text]) => text.includes('LIMIT'))!;
      assert.match(
        listSql[0],
        /ORDER BY s\.starts_at ASC, s\.id ASC LIMIT \? OFFSET \?/,
      );
      assert.deepEqual(listSql[1], [7, 20, 20]);
    },
  );

  await t.test(
    'GET shows cancelled and running sessions, and filters by state',
    async () => {
      reset();
      listRows = [
        makeSession(40, {
          starts_at: at(-1),
          late_after: at(-0.75),
          ends_at: at(1),
        }),
        makeSession(41, { state: 'cancelled' }),
      ];
      total = 2;
      const response = await send(
        'GET',
        '/classes/7/class-sessions?state=cancelled',
      );
      const body = await response.json();
      assert.deepEqual(
        body.data.map((item: any) => [item.state, item.availability]),
        [
          ['scheduled', 'in_progress'],
          ['cancelled', 'cancelled'],
        ],
      );
      const listSql = queries.find(([text]) => text.includes('LIMIT'))!;
      assert.match(listSql[0], /s\.state = \?/);
      assert.deepEqual(listSql[1], [7, 'cancelled', 20, 0]);
      assert.equal(
        listSql[0].includes('cancelled'),
        false,
        'values are parameters',
      );
    },
  );

  await t.test('GET returns an empty list and rejects bad input', async () => {
    reset();
    total = 0;
    listRows = [];
    const empty = await (await send('GET', '/classes/7/class-sessions')).json();
    assert.deepEqual(empty.data, []);
    assert.equal(empty.meta.total, 0);
    assert.equal(
      (await send('GET', '/classes/999/class-sessions')).status,
      404,
    );
    reset();
    for (const path of [
      '/classes/7/class-sessions?limit=0',
      '/classes/7/class-sessions?limit=101',
      '/classes/7/class-sessions?page=0',
      '/classes/7/class-sessions?state=done',
      '/classes/abc/class-sessions',
      '/classes/0/class-sessions',
    ]) {
      const response = await send('GET', path);
      assert.equal(response.status, 422, path);
      assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    }
    assert.deepEqual(queries, []);
  });

  await t.test(
    'POST schedules a session with the venue of the class',
    async () => {
      reset();
      const response = await send('POST', '/classes/7/class-sessions', {
        ...valid,
        state: 'cancelled',
        room_label: 'Elsewhere',
        latitude: 1,
        id: 99,
      });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.deepEqual(Object.keys(body), ['data']);
      assert.equal(body.data.id, 31);
      assert.equal(body.data.state, 'scheduled');
      assert.equal(body.data.availability, 'upcoming');
      assert.equal(body.data.room_label, 'EN402');
      assert.deepEqual(body.data.attendance, {
        present: 0,
        late: 0,
        absent: 0,
        pending: 0,
      });
      const insert = queries.find(([text]) =>
        text.includes('INSERT INTO class_sessions'),
      )!;
      assert.deepEqual(insert[1], [
        7,
        'EN402',
        '3.121500',
        '101.656800',
        '75.00',
        sql(at(24)),
        sql(at(24.25)),
        sql(at(26)),
      ]);
      assert.equal(insert[0].includes('EN402'), false, 'values are parameters');
      assert.deepEqual(
        log.slice(0, 1),
        ['lock class'],
        'the class is locked first',
      );
    },
  );

  await t.test(
    'POST accepts millisecond-less times and a late time equal to the start',
    async () => {
      reset();
      const response = await send('POST', '/classes/7/class-sessions', {
        starts_at: '2026-11-20T01:00:00Z',
        late_after: '2026-11-20T01:00:00Z',
        ends_at: '2026-11-20T03:00:00.000Z',
      });
      assert.equal(response.status, 201);
    },
  );

  await t.test(
    'POST accepts a late time of exactly 30 minutes, and refuses more',
    async () => {
      reset();
      const ok = await send('POST', '/classes/7/class-sessions', {
        starts_at: iso(24),
        late_after: iso(24.5),
        ends_at: iso(26),
      });
      assert.equal(ok.status, 201);
      reset();
      const over = await send('POST', '/classes/7/class-sessions', {
        starts_at: iso(24),
        late_after: iso(25),
        ends_at: iso(26),
      });
      assert.equal(over.status, 422);
      const error = (await over.json()).error;
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.equal(
        error.fields.late_after,
        'The late time must be at most 30 minutes after the start time.',
      );
      assert.equal(
        queries.some(([text]) => text.includes('INSERT')),
        false,
      );
    },
  );

  await t.test('POST reports every wrong field at once', async () => {
    reset();
    const cases: [Record<string, unknown>, string[]][] = [
      [{}, ['starts_at', 'late_after', 'ends_at']],
      [
        { starts_at: 5, late_after: null, ends_at: [] },
        ['starts_at', 'late_after', 'ends_at'],
      ],
      [{ ...valid, starts_at: '2026-11-20 01:00:00' }, ['starts_at']],
      [{ ...valid, ends_at: '2026-11-20T03:00:00+08:00' }, ['ends_at']],
      [{ ...valid, starts_at: '2026-02-31T01:00:00.000Z' }, ['starts_at']],
      [{ ...valid, late_after: iso(23) }, ['late_after']], // before the start
      [{ ...valid, late_after: iso(26) }, ['late_after']], // not before the end
      [{ ...valid, ends_at: iso(24) }, ['ends_at']], // end not after start
      [{ ...valid, late_after: iso(24.51) }, ['late_after']], // over 30 minutes
      [
        { starts_at: 'x', late_after: 'y', ends_at: 'z' },
        ['starts_at', 'late_after', 'ends_at'],
      ],
    ];
    for (const [payload, fields] of cases) {
      const response = await send('POST', '/classes/7/class-sessions', payload);
      assert.equal(response.status, 422, JSON.stringify(payload));
      const error = (await response.json()).error;
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.deepEqual(
        Object.keys(error.fields).sort(),
        [...fields].sort(),
        JSON.stringify(payload),
      );
    }
    assert.equal(
      queries.some(([text]) => text.includes('INSERT')),
      false,
    );
  });

  await t.test(
    'POST refuses a start time that is not in the future',
    async () => {
      reset();
      for (const hours of [-2, 0]) {
        const response = await send('POST', '/classes/7/class-sessions', {
          starts_at: iso(hours),
          late_after: iso(hours + 0.25),
          ends_at: iso(hours + 2),
        });
        assert.equal(response.status, 422, `${hours}`);
        assert.ok((await response.json()).error.fields.starts_at);
      }
      assert.equal(
        queries.some(([text]) => text.includes('INSERT')),
        false,
      );
    },
  );

  await t.test('POST needs an existing class', async () => {
    reset();
    const response = await send('POST', '/classes/999/class-sessions', valid);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'RESOURCE_NOT_FOUND');
    assert.equal(
      queries.some(([text]) => text.includes('INSERT')),
      false,
    );
    const bad = await send('POST', '/classes/abc/class-sessions', valid);
    assert.equal(bad.status, 422);
  });

  await t.test(
    'POST refuses a duplicate start, including a cancelled session',
    async () => {
      reset();
      sameStart = [{ id: 12 }];
      const response = await send('POST', '/classes/7/class-sessions', valid);
      assert.equal(response.status, 409);
      const error = (await response.json()).error;
      assert.equal(error.code, 'CLASS_SESSION_EXISTS');
      assert.ok(error.fields.starts_at);
      assert.equal(
        queries.some(([text]) => text.includes('INSERT')),
        false,
      );
      // A race that gets past the check is stopped by the unique key.
      reset();
      insertError = Object.assign(new Error('Duplicate entry'), {
        driverError: { errno: 1062 },
      });
      const raced = await send('POST', '/classes/7/class-sessions', valid);
      assert.equal(raced.status, 409);
      assert.equal((await raced.json()).error.code, 'CLASS_SESSION_EXISTS');
      // Other database errors are not hidden as conflicts.
      reset();
      insertError = new Error('Connection lost');
      assert.equal(
        (await send('POST', '/classes/7/class-sessions', valid)).status,
        500,
      );
    },
  );

  await t.test(
    'POST refuses overlap with the same class, lecturer or room',
    async () => {
      const other = (over: Record<string, unknown>) => ({
        id: 50,
        class_id: 8,
        lecturer_id: 3,
        room_label: 'Other room',
        starts_at: at(23),
        ends_at: at(25),
        state: 'scheduled',
        course_code: 'COS20019',
        course_name: 'Networks',
        section: 'A',
        term: '2026-S2',
        lecturer_name: 'Lecturer Three',
        ...over,
      });
      const cases: [Record<string, unknown>, string][] = [
        [{ class_id: 7 }, 'same class'],
        [{ lecturer_id: 2 }, 'same lecturer'],
        [{ room_label: ' en402 ' }, 'same room'],
      ];
      for (const [over, text] of cases) {
        reset();
        overlapRows = [other(over)];
        const response = await send('POST', '/classes/7/class-sessions', valid);
        assert.equal(response.status, 409, text);
        const error = (await response.json()).error;
        assert.equal(error.code, 'SCHEDULE_CONFLICT');
        assert.match(error.message, new RegExp(text));
        assert.equal(
          queries.some(([q]) => q.includes('INSERT')),
          false,
          text,
        );
      }
      reset();
      overlapRows = [
        other({ class_id: 7, lecturer_id: 2, room_label: 'EN402' }),
      ];
      const all = await (
        await send('POST', '/classes/7/class-sessions', valid)
      ).json();
      assert.equal(
        all.error.message,
        'This time overlaps a scheduled session of the same class, the same lecturer and the same room.',
      );
      // Two kinds read as "a and b".
      reset();
      overlapRows = [other({ lecturer_id: 2, room_label: 'EN402' })];
      const two = await (
        await send('POST', '/classes/7/class-sessions', valid)
      ).json();
      assert.equal(
        two.error.message,
        'This time overlaps a scheduled session of the same lecturer and the same room.',
      );
    },
  );

  await t.test(
    'the overlap error lists each clashing session and why it clashes',
    async () => {
      const row = (id: number, over: Record<string, unknown> = {}) => ({
        id,
        class_id: 8,
        lecturer_id: 3,
        room_label: 'Other room',
        starts_at: at(23),
        ends_at: at(25),
        state: 'scheduled',
        course_code: 'COS20019',
        course_name: 'Networks',
        section: 'A',
        term: '2026-S2',
        lecturer_name: 'Lecturer Three',
        ...over,
      });
      reset();
      overlapRows = [
        row(50, { lecturer_id: 2, lecturer_name: 'Lecturer One' }),
        row(51, {
          class_id: 7,
          lecturer_id: 2,
          lecturer_name: 'Lecturer One',
          room_label: 'EN402',
          starts_at: at(25),
          ends_at: at(27),
          section: 'B',
        }),
        // Overlaps in time but shares nothing, so it is not listed.
        row(52),
      ];
      const response = await send('POST', '/classes/7/class-sessions', valid);
      assert.equal(response.status, 409);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const error = (await response.json()).error;
      assert.deepEqual(Object.keys(error).sort(), [
        'code',
        'conflicts',
        'fields',
        'message',
      ]);
      assert.equal(error.code, 'SCHEDULE_CONFLICT');
      assert.deepEqual(error.fields, {});
      assert.deepEqual(error.conflicts, [
        {
          types: ['lecturer'],
          session: {
            id: 50,
            class: {
              id: 8,
              course: { code: 'COS20019', name: 'Networks' },
              section: 'A',
              term: '2026-S2',
            },
            lecturer: { id: 2, name: 'Lecturer One' },
            room_label: 'Other room',
            starts_at: iso(23),
            ends_at: iso(25),
          },
        },
        {
          types: ['class', 'lecturer', 'room'],
          session: {
            id: 51,
            class: {
              id: 7,
              course: { code: 'COS20019', name: 'Networks' },
              section: 'B',
              term: '2026-S2',
            },
            lecturer: { id: 2, name: 'Lecturer One' },
            room_label: 'EN402',
            starts_at: iso(25),
            ends_at: iso(27),
          },
        },
      ]);
    },
  );

  await t.test('the overlap error lists at most ten sessions', async () => {
    reset();
    overlapRows = Array.from({ length: 14 }, (_, index) => ({
      id: 100 + index,
      class_id: 8,
      lecturer_id: 2,
      room_label: 'Other room',
      starts_at: at(23 + index * 0.01),
      ends_at: at(25),
      state: 'scheduled',
      course_code: 'COS20019',
      course_name: 'Networks',
      section: 'A',
      term: '2026-S2',
      lecturer_name: 'Lecturer One',
    }));
    const error = (
      await (await send('POST', '/classes/7/class-sessions', valid)).json()
    ).error;
    assert.equal(error.conflicts.length, 10);
    assert.match(error.message, /same lecturer/);
  });

  await t.test(
    'POST allows sessions that only touch, and unrelated ones',
    async () => {
      reset();
      // Ends exactly when the new one starts: not an overlap.
      overlapRows = [
        {
          id: 50,
          class_id: 7,
          lecturer_id: 2,
          room_label: 'EN402',
          starts_at: at(22),
          ends_at: at(24),
          state: 'scheduled',
        },
        {
          id: 51,
          class_id: 9,
          lecturer_id: 4,
          room_label: 'Lab 1',
          starts_at: at(24),
          ends_at: at(26),
          state: 'scheduled',
        },
      ];
      assert.equal(
        (await send('POST', '/classes/7/class-sessions', valid)).status,
        201,
      );
    },
  );

  await t.test(
    'the overlap check ignores cancelled sessions in its query',
    async () => {
      reset();
      await send('POST', '/classes/7/class-sessions', valid);
      const overlap = queries.find(([text]) =>
        text.includes('JOIN classes c'),
      )!;
      assert.match(overlap[0], /s\.state = 'scheduled'/);
      assert.match(overlap[0], /s\.starts_at < \? AND s\.ends_at > \?/);
      assert.deepEqual(overlap[1].slice(0, 2), [sql(at(26)), sql(at(24))]);
    },
  );

  await t.test(
    'cancel changes an upcoming or running session after locking',
    async () => {
      for (const [id, over] of [
        [60, {}],
        [
          61,
          {
            starts_at: at(-1),
            late_after: at(-0.75),
            ends_at: at(1),
            present_count: '3',
          },
        ],
      ] as [number, Record<string, unknown>][]) {
        reset();
        sessions[id] = makeSession(id, over);
        const response = await send('POST', `/class-sessions/${id}/cancel`);
        assert.equal(response.status, 200, `${id}`);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const body = await response.json();
        assert.equal(body.data.state, 'cancelled');
        assert.equal(body.data.availability, 'cancelled');
        assert.deepEqual(log, [
          'session lookup',
          'lock class',
          'lock session',
          'update',
        ]);
        // Records are never touched.
        assert.equal(
          queries.some(
            ([text]) =>
              /attendance_records/.test(text) &&
              /^(UPDATE|DELETE|INSERT)/i.test(text.trim()),
          ),
          false,
        );
      }
      assert.equal(
        (await (await send('POST', '/class-sessions/61/cancel')).json()).data
          .attendance.present,
        3,
      );
    },
  );

  await t.test('cancel reads the time after the locks', async () => {
    reset();
    sessions[62] = makeSession(62);
    await send('POST', '/class-sessions/62/cancel');
    const order = queries.map(([text]) => text.replace(/\s+/g, ' ').trim());
    const lockSession = order.findIndex((text) =>
      text.startsWith('SELECT * FROM class_sessions WHERE id = ? FOR UPDATE'),
    );
    const clock = order.findIndex((text) =>
      text.startsWith('SELECT UTC_TIMESTAMP'),
    );
    assert.ok(lockSession >= 0 && clock > lockSession);
  });

  await t.test('cancelling twice is safe and keeps one update', async () => {
    reset();
    sessions[63] = makeSession(63);
    const first = await send('POST', '/class-sessions/63/cancel');
    const second = await send('POST', '/class-sessions/63/cancel');
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).data.state, 'cancelled');
    assert.equal(log.filter((entry) => entry === 'update').length, 1);
  });

  await t.test(
    'an ended session cannot be cancelled, an already cancelled one can be repeated',
    async () => {
      reset();
      sessions[64] = makeSession(64, {
        starts_at: at(-5),
        late_after: at(-4.75),
        ends_at: at(-3),
        absent_count: '4',
      });
      const response = await send('POST', '/class-sessions/64/cancel');
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, 'CLASS_SESSION_ENDED');
      assert.equal(sessions[64].state, 'scheduled');
      assert.equal(log.includes('update'), false);
      // Ended and already cancelled: the repeat is still a success.
      reset();
      sessions[65] = makeSession(65, {
        starts_at: at(-5),
        late_after: at(-4.75),
        ends_at: at(-3),
        state: 'cancelled',
      });
      const repeat = await send('POST', '/class-sessions/65/cancel');
      assert.equal(repeat.status, 200);
      assert.equal(log.includes('update'), false);
    },
  );

  await t.test(
    'cancel validates the ID and needs an existing session',
    async () => {
      reset();
      const missing = await send('POST', '/class-sessions/999/cancel');
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).error.code, 'RESOURCE_NOT_FOUND');
      for (const id of ['0', 'abc', '1.5']) {
        const response = await send('POST', `/class-sessions/${id}/cancel`);
        assert.equal(response.status, 422, id);
      }
    },
  );
});

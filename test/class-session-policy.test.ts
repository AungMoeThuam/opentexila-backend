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

test('attendance policy of one session: permissions, rules and queries', async (t) => {
  const classes: Record<number, any> = { 7: { id: 7, lecturer_id: 2 } };
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
  const updates: [string, any[]][] = [];
  const log: string[] = [];
  const queries: string[] = [];
  const query = async (text: string, params: any[] = []) => {
    const head = text.replace(/\s+/g, ' ').trim();
    queries.push(head);
    if (head.startsWith('SELECT UTC_TIMESTAMP')) {
      log.push('clock');
      return [{ now: NOW }];
    }
    if (head.startsWith('SELECT class_id FROM class_sessions WHERE id')) {
      log.push('session lookup');
      return sessions[params[0]] ? [{ class_id: 7 }] : [];
    }
    if (head.startsWith('SELECT * FROM classes WHERE id = ? FOR UPDATE')) {
      log.push('lock class');
      return [classes[params[0]]];
    }
    if (
      head.startsWith('SELECT * FROM class_sessions WHERE id = ? FOR UPDATE')
    ) {
      log.push('lock session');
      return sessions[params[0]] ? [sessions[params[0]]] : [];
    }
    if (head.startsWith('UPDATE class_sessions SET')) {
      log.push('update');
      updates.push([head, params]);
      const columns = [...head.matchAll(/(\w+) = \?/g)].map((m) => m[1]);
      const row = sessions[params[params.length - 1]];
      columns.forEach((column, index) => {
        row[column] =
          column === 'late_after'
            ? new Date(`${params[index].replace(' ', 'T')}Z`)
            : params[index];
      });
      return { affectedRows: 1 };
    }
    if (head.includes('FROM class_sessions s WHERE s.id = ?'))
      return sessions[params[0]] ? [sessions[params[0]]] : [];
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
      Class: {},
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
  const patch = (id: number | string, body?: unknown) =>
    fetch(`${app.base}/class-sessions/${id}/attendance-policy`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'fixture-token',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const reset = () => {
    updates.length = 0;
    log.length = 0;
    queries.length = 0;
  };
  const fresh = (id = 31, over: Record<string, unknown> = {}) => {
    sessions[id] = makeSession(id, over);
    return id;
  };

  await t.test('signed-out users get 401', async () => {
    app.state.signedIn = false;
    reset();
    const response = await patch(31, { radius_m: 50 });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
    assert.deepEqual(queries, []);
    app.state.signedIn = true;
  });

  await t.test('only admins may change a session policy', async () => {
    reset();
    for (const [role, id] of [
      ['student', 21],
      ['lecturer', 2],
    ] as [string, number][]) {
      as(role, id);
      const response = await patch(fresh(), { radius_m: 50 });
      assert.equal(response.status, 403, role);
      assert.equal((await response.json()).error.code, 'FORBIDDEN');
    }
    assert.deepEqual(queries, [], 'nothing reached the database');
  });

  await t.test('only the fields that are sent are saved', async () => {
    as('admin');
    reset();
    const id = fresh();
    const response = await patch(id, {
      radius_m: 50,
      starts_at: iso(1),
      ends_at: iso(2),
      state: 'cancelled',
      class_id: 9,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['data']);
    assert.equal(body.data.radius_m, '50.00');
    assert.equal(
      body.data.room_label,
      'EN402',
      'other fields keep their value',
    );
    assert.equal(
      body.data.starts_at,
      iso(24),
      'times and state cannot be changed here',
    );
    assert.equal(body.data.state, 'scheduled');
    assert.equal(updates.length, 1);
    assert.equal(
      updates[0][0],
      'UPDATE class_sessions SET radius_m = ? WHERE id = ?',
    );
    assert.deepEqual(updates[0][1], ['50.00', id]);
  });

  await t.test('the venue and the late time can change together', async () => {
    as('admin');
    reset();
    const id = fresh();
    const response = await patch(id, {
      room_label: '  EN305 ',
      latitude: 3.12345678,
      longitude: 101.98765432,
      radius_m: 75.5,
      late_after: iso(24.5),
    });
    assert.equal(response.status, 200);
    const [text, params] = updates[0];
    assert.equal(
      text,
      'UPDATE class_sessions SET room_label = ?, latitude = ?, longitude = ?, radius_m = ?, late_after = ? WHERE id = ?',
    );
    assert.deepEqual(params, [
      'EN305',
      '3.123457',
      '101.987654',
      '75.50',
      sql(at(24.5)),
      id,
    ]);
    assert.equal(text.includes('EN305'), false, 'values are parameters');
    const body = await response.json();
    assert.equal(body.data.late_after, iso(24.5));
    assert.equal(body.data.room_label, 'EN305');
  });

  await t.test(
    'the late time may be the start time, but not the end time',
    async () => {
      as('admin');
      reset();
      assert.equal(
        (await patch(fresh(), { late_after: iso(24) })).status,
        200,
        'equal to the start',
      );
      assert.equal(
        (await patch(fresh(), { late_after: iso(24.5) })).status,
        200,
        'exactly at the 30 minute limit',
      );
      reset();
      for (const late of [iso(26), iso(23.99), iso(30), iso(-5)]) {
        const response = await patch(fresh(), { late_after: late });
        assert.equal(response.status, 422, late);
        const error = (await response.json()).error;
        assert.equal(error.code, 'VALIDATION_ERROR');
        assert.ok(error.fields.late_after);
      }
      assert.deepEqual(updates, []);
    },
  );

  await t.test(
    'the late time is at most 30 minutes after the start',
    async () => {
      as('admin');
      reset();
      // Start is at(24); 30 minutes is at(24.5). One millisecond more is too long.
      const justOver = new Date(at(24.5).getTime() + 1).toISOString();
      for (const late of [justOver, iso(25), '2026-11-13T01:59:59.999Z']) {
        const response = await patch(fresh(), { late_after: late });
        assert.equal(response.status, 422, late);
        const error = (await response.json()).error;
        assert.equal(error.code, 'VALIDATION_ERROR');
        assert.equal(
          error.fields.late_after,
          'The late time must be at most 30 minutes after the start time.',
          late,
        );
      }
      assert.deepEqual(updates, [], 'nothing is saved');
      // Other fields can still change without a late time, also for a session
      // that was saved with a longer allowance before there was a limit.
      const old = fresh();
      sessions[old].late_after = at(25.5);
      assert.equal((await patch(old, { room_label: 'EN305' })).status, 200);
      assert.equal(updates.length, 1);
    },
  );

  await t.test(
    'an empty body and wrong fields are refused and save nothing',
    async () => {
      as('admin');
      reset();
      const id = fresh();
      const empty = await patch(id, {});
      assert.equal(empty.status, 422);
      assert.equal((await empty.json()).error.code, 'VALIDATION_ERROR');
      assert.equal(
        (await patch(id, { starts_at: iso(1), state: 'cancelled' })).status,
        422,
        'unknown fields leave nothing to save',
      );
      const cases: [string, Record<string, unknown>][] = [
        ['room_label', { room_label: '' }],
        ['room_label', { room_label: '   ' }],
        ['room_label', { room_label: 'a'.repeat(101) }],
        ['latitude', { latitude: 91 }],
        ['latitude', { latitude: -91 }],
        ['latitude', { latitude: 'north' }],
        ['longitude', { longitude: 181 }],
        ['longitude', { longitude: -181 }],
        ['radius_m', { radius_m: 0 }],
        ['radius_m', { radius_m: 1001 }],
        ['radius_m', { radius_m: -5 }],
        ['late_after', { late_after: 5 }],
        ['late_after', { late_after: '2026-11-13 01:15:00' }],
        ['late_after', { late_after: '2026-02-31T01:00:00Z' }],
        ['late_after', { late_after: '2026-11-13T01:15:00+08:00' }],
      ];
      for (const [field, payload] of cases) {
        const response = await patch(id, payload);
        assert.equal(response.status, 422, JSON.stringify(payload));
        const error = (await response.json()).error;
        assert.equal(error.code, 'VALIDATION_ERROR');
        assert.ok(error.fields[field], `${field} message`);
      }
      assert.deepEqual(updates, []);
    },
  );

  await t.test('the limits of the venue values are allowed', async () => {
    as('admin');
    reset();
    const response = await patch(fresh(), {
      latitude: -90,
      longitude: 180,
      radius_m: 1000,
      room_label: 'a'.repeat(100),
    });
    assert.equal(response.status, 200);
    assert.equal((await patch(fresh(), { radius_m: 1 })).status, 200);
  });

  await t.test(
    'a session that has started, ended or been cancelled is refused',
    async () => {
      as('admin');
      const cases: [string, Record<string, unknown>][] = [
        [
          'running',
          { starts_at: at(-1), late_after: at(-0.75), ends_at: at(1) },
        ],
        [
          'ended',
          { starts_at: at(-5), late_after: at(-4.75), ends_at: at(-3) },
        ],
        [
          'starting this moment',
          { starts_at: NOW, late_after: at(0.25), ends_at: at(2) },
        ],
        ['cancelled', { state: 'cancelled' }],
      ];
      for (const [name, over] of cases) {
        reset();
        const response = await patch(fresh(40, over), { radius_m: 50 });
        assert.equal(response.status, 409, name);
        assert.equal(
          (await response.json()).error.code,
          'SESSION_NOT_EDITABLE',
          name,
        );
        assert.deepEqual(updates, [], name);
        assert.equal(sessions[40].radius_m, '75.00', `${name}: unchanged`);
      }
    },
  );

  await t.test(
    'the class and session are locked before the clock is read',
    async () => {
      as('admin');
      reset();
      await patch(fresh(), { radius_m: 60 });
      assert.deepEqual(log, [
        'session lookup',
        'lock class',
        'lock session',
        'clock',
        'update',
      ]);
    },
  );

  await t.test('a missing session and a bad ID are refused', async () => {
    as('admin');
    reset();
    const missing = await patch(999, { radius_m: 50 });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'RESOURCE_NOT_FOUND');
    for (const id of ['0', 'abc', '1.5']) {
      const response = await patch(id, { radius_m: 50 });
      assert.equal(response.status, 422, id);
    }
    assert.deepEqual(updates, []);
  });
});

import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';
import { TimetableModule } from '../dist/timetable/timetable.module.js';

// GET /class-sessions takes Malaysia days (ADR 0001) as YYYY-MM-DD.
test('timetable date filter: Malaysia days, and 422 for dates out of range', async (t) => {
  const queries: [string, any[]][] = [];
  // Sessions the fake table holds; the fake query applies the overlap rule
  // (ends_at > from AND starts_at < to) to the bound parameters.
  let table: any[] = [];
  const mysql = (date: Date) =>
    date.toISOString().slice(0, 23).replace('T', ' ');
  const inRange = (params: any[]) =>
    table.filter(
      (row) =>
        mysql(row.ends_at) > params[0] && mysql(row.starts_at) < params[1],
    );
  const query = async (text: string, params: any[] = []) => {
    queries.push([text, params]);
    const head = text.replace(/\s+/g, ' ').trim();
    if (head.startsWith('SELECT COUNT(*) AS total'))
      return [{ total: String(inRange(params).length) }];
    if (head.includes('LIMIT')) return inRange(params);
    throw new Error(`Unexpected SQL: ${head}`);
  };
  const app = await startAttendanceApp(
    {
      ClassSession: {},
      AttendanceRecord: {},
      Course: {},
      Enrolment: {},
      Class: {},
    },
    { modules: [TimetableModule], database: { query } },
  );
  t.after(() => app.close());
  const admin = {
    id: 1,
    role: 'admin',
    status: 'active',
    session_version: 0,
    must_change_password: false,
  };
  app.state.user = admin;

  const get = (search: string) =>
    fetch(`${app.base}/class-sessions?${search}`, {
      headers: { 'x-csrf-token': 'fixture-token' },
    });

  await t.test(
    'a date outside years 1000-9998 is a 422 on that field',
    async () => {
      for (const [search, field] of [
        ['from=2026-01-01&to=9999-12-31', 'to'],
        ['from=0999-12-31&to=2026-01-01', 'from'],
      ]) {
        queries.length = 0;
        const response = await get(search);
        assert.equal(response.status, 422, search);
        const body = await response.json();
        assert.equal(body.error.code, 'VALIDATION_ERROR');
        assert.ok(body.error.fields[field], `${search} names ${field}`);
        assert.deepEqual(queries, [], 'nothing reached the database');
      }
    },
  );

  await t.test(
    'a day is a Malaysia day, and 1000 and 9998 are accepted',
    async () => {
      // 2026-11-20 in Malaysia runs from 2026-11-19T16:00Z to 2026-11-20T16:00Z,
      // so a session at 2026-11-19T17:00Z (01:00 on the 20th) is on the 20th.
      for (const [search, from, to] of [
        [
          'from=2026-11-20&to=2026-11-20',
          '2026-11-19 16:00:00.000',
          '2026-11-20 16:00:00.000',
        ],
        [
          'from=2026-11-19&to=2026-11-20',
          '2026-11-18 16:00:00.000',
          '2026-11-20 16:00:00.000',
        ],
        [
          'from=1000-01-01&to=9998-12-31',
          '1000-01-01 00:00:00.000',
          '9998-12-31 16:00:00.000',
        ],
      ]) {
        queries.length = 0;
        const response = await get(search);
        assert.equal(response.status, 200, search);
        const list = queries.find(([text]) => text.includes('LIMIT'))!;
        // The query keeps sessions that overlap [from, to): ends_at > from AND starts_at < to.
        assert.match(
          list[0].replace(/\s+/g, ' '),
          /ends_at > \? AND s\.starts_at < \?/,
        );
        assert.deepEqual(list[1].slice(0, 2), [from, to], search);
      }
    },
  );

  await t.test('sessions land on the Malaysia days they touch', async () => {
    const session = (id: number, starts: string, ends: string) => ({
      id,
      class_id: 7,
      lecturer_id: 2,
      course_code: 'COS30043',
      course_name: 'Interface Design',
      section: 'A',
      lecturer_name: 'Lecturer One',
      room_label: 'EN402',
      starts_at: new Date(starts),
      late_after: new Date(starts),
      ends_at: new Date(ends),
      state: 'scheduled',
    });
    table = [
      // 01:00 on 20 Nov Malaysia time: the issue's own example.
      session(1, '2026-11-19T17:00:00.000Z', '2026-11-19T18:00:00.000Z'),
      // 23:59 to 00:00: on the 20th only, since a session ending at midnight does not touch the next day.
      session(2, '2026-11-20T15:59:00.000Z', '2026-11-20T16:00:00.000Z'),
      // 00:00 on 21 Nov Malaysia time starts the next day.
      session(3, '2026-11-20T16:00:00.000Z', '2026-11-20T17:00:00.000Z'),
      // 23:30 on 20 Nov to 00:30 on 21 Nov: on both days.
      session(4, '2026-11-20T15:30:00.000Z', '2026-11-20T16:30:00.000Z'),
    ];
    const ids = async (search: string) => {
      const body = await (await get(search)).json();
      return body.data.map((row: any) => row.id).sort();
    };
    assert.deepEqual(await ids('from=2026-11-20&to=2026-11-20'), [1, 2, 4]);
    assert.deepEqual(await ids('from=2026-11-19&to=2026-11-19'), []);
    assert.deepEqual(await ids('from=2026-11-21&to=2026-11-21'), [3, 4]);
  });
});

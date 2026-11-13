import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';
import { TimetableModule } from '../dist/timetable/timetable.module.js';

// GET /class-sessions takes Malaysia days (ADR 0001) as YYYY-MM-DD.
test('timetable date filter: Malaysia days, and 422 for dates out of range', async (t) => {
  const queries: [string, any[]][] = [];
  const query = async (text: string, params: any[] = []) => {
    queries.push([text, params]);
    const head = text.replace(/\s+/g, ' ').trim();
    if (head.startsWith('SELECT COUNT(*) AS total')) return [{ total: '0' }];
    if (head.includes('LIMIT')) return [];
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
          '0999-12-31 16:00:00.000',
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

  await t.test(
    'a session that starts at 23:59 Malaysia time is on that day',
    async () => {
      // 23:59 on the 20th is 15:59Z. The window for the 20th ends at 16:00Z, and
      // the overlap rule is strict at the end, so the session is inside it.
      queries.length = 0;
      await get('from=2026-11-20&to=2026-11-20');
      const list = queries.find(([text]) => text.includes('LIMIT'))!;
      const end = new Date(`${list[1][1].replace(' ', 'T')}Z`).getTime();
      assert.ok(Date.parse('2026-11-20T15:59:00Z') < end);
      assert.ok(Date.parse('2026-11-20T16:00:00Z') >= end);
    },
  );
});

import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';

const start = new Date('2026-10-29T01:00:00.000Z');
const end = new Date('2026-10-29T03:00:00.000Z');
const afterEnd = new Date('2026-10-29T03:00:00.000Z');

type Row = { student_id: number; status: string; checked_in_at: Date | null };

// Transactional fake of the finalisation SQL. Real SQL and concurrency are
// covered by test:db; this exercises routing, access and the response contract.
function fixture(now = afterEnd) {
  const state: any = {
    now,
    lecturerId: 2,
    sessionExists: true,
    session: {
      id: 30,
      class_id: 1,
      starts_at: start,
      late_after: new Date('2026-10-29T01:15:00.000Z'),
      ends_at: end,
      state: 'scheduled',
    },
    enrolled: [3, 4, 5],
    records: [
      { student_id: 3, status: 'present', checked_in_at: start },
      { student_id: 4, status: 'pending', checked_in_at: null },
    ] as Row[],
  };
  const query = async (sql: string, args: any[] = []) => {
    if (sql.startsWith('SELECT class_id'))
      return state.sessionExists ? [{ class_id: 1 }] : [];
    if (sql.startsWith('SELECT * FROM classes'))
      return [{ id: 1, lecturer_id: state.lecturerId }];
    if (sql.startsWith('SELECT * FROM class_sessions')) return [state.session];
    if (sql.startsWith('SELECT UTC')) return [{ now: state.now }];
    if (sql.startsWith('SELECT COUNT'))
      return [
        {
          total: state.records.filter(
            (r: Row) =>
              (r.status === 'pending' && r.checked_in_at) ||
              (['present', 'late'].includes(r.status) && !r.checked_in_at),
          ).length,
        },
      ];
    if (sql.startsWith('UPDATE attendance_records')) {
      const pending = state.records.filter((r: Row) => r.status === 'pending');
      pending.forEach((r: Row) => (r.status = 'absent'));
      return { affectedRows: pending.length };
    }
    if (sql.startsWith('INSERT INTO attendance_records')) {
      const missing = state.enrolled.filter(
        (id: number) => !state.records.some((r: Row) => r.student_id === id),
      );
      missing.forEach((id: number) =>
        state.records.push({
          student_id: id,
          status: 'absent',
          checked_in_at: null,
        }),
      );
      return { affectedRows: missing.length };
    }
    throw new Error(`Unexpected test query: ${sql}`);
  };
  const database = {
    query,
    async transaction(work: (manager: any) => Promise<any>) {
      const before = state.records.map((r: Row) => ({ ...r }));
      try {
        return await work({ query });
      } catch (error) {
        state.records = before;
        throw error;
      }
    },
  };
  return { state, database };
}

// Other attendance services build their repositories at startup; finalisation
// itself only uses the transaction.
const unusedRepositories = { ClassSession: {}, AttendanceRecord: {} };

const post = (base: string, id: string | number = 30, csrf = true) =>
  fetch(`${base}/class-sessions/${id}/finalise`, {
    method: 'POST',
    headers: csrf ? { 'x-csrf-token': 'fixture-token' } : {},
  });

const statuses = (state: any) =>
  Object.fromEntries(state.records.map((r: Row) => [r.student_id, r.status]));

test('lecturer finalises an ended session: pending and missing students become absent', async (t) => {
  const { state, database } = fixture();
  const app = await startAttendanceApp(unusedRepositories, { database });
  t.after(() => app.close());

  const response = await post(app.base);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    class_session_id: 30,
    outcome: 'finalised',
    absent_marked: 2,
  });
  assert.deepEqual(statuses(state), { 3: 'present', 4: 'absent', 5: 'absent' });
  assert.equal(state.records[0].checked_in_at, start);
});

test('only the assigned lecturer, with a valid session and CSRF, may finalise', async (t) => {
  const { state, database } = fixture();
  const app = await startAttendanceApp(unusedRepositories, { database });
  t.after(() => app.close());
  const expectError = async (
    response: Response,
    status: number,
    code: string,
  ) => {
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
    assert.deepEqual(statuses(state), { 3: 'present', 4: 'pending' });
  };

  await expectError(await post(app.base, 30, false), 403, 'CSRF_INVALID');
  await expectError(await post(app.base, 'nope'), 422, 'VALIDATION_ERROR');

  state.sessionExists = false;
  await expectError(await post(app.base), 404, 'RESOURCE_NOT_FOUND');
  state.sessionExists = true;

  state.lecturerId = 9; // Another lecturer's class looks like a missing session.
  await expectError(await post(app.base), 404, 'RESOURCE_NOT_FOUND');
  state.lecturerId = 2;

  for (const role of ['student', 'admin']) {
    app.state.user = { ...app.state.user, role };
    await expectError(await post(app.base), 403, 'FORBIDDEN');
  }
});

test('finalisation does nothing before the session ends or when cancelled', async (t) => {
  const { state, database } = fixture(new Date(+end - 1));
  const app = await startAttendanceApp(unusedRepositories, { database });
  t.after(() => app.close());

  assert.deepEqual(await (await post(app.base)).json(), {
    class_session_id: 30,
    outcome: 'not_due',
    absent_marked: 0,
  });
  assert.deepEqual(statuses(state), { 3: 'present', 4: 'pending' });

  state.now = afterEnd;
  state.session.state = 'cancelled';
  assert.deepEqual(await (await post(app.base)).json(), {
    class_session_id: 30,
    outcome: 'cancelled',
    absent_marked: 0,
  });
  assert.deepEqual(statuses(state), { 3: 'present', 4: 'pending' });
});

test('a second finalisation is idempotent', async (t) => {
  const { state, database } = fixture();
  const app = await startAttendanceApp(unusedRepositories, { database });
  t.after(() => app.close());
  await post(app.base);

  assert.deepEqual(await (await post(app.base)).json(), {
    class_session_id: 30,
    outcome: 'already_finalised',
    absent_marked: 0,
  });
  assert.deepEqual(statuses(state), { 3: 'present', 4: 'absent', 5: 'absent' });
});

test('corrupt attendance evidence returns a conflict and changes nothing', async (t) => {
  const { state, database } = fixture();
  state.records.push({ student_id: 6, status: 'present', checked_in_at: null });
  const app = await startAttendanceApp(unusedRepositories, { database });
  t.after(() => app.close());

  const response = await post(app.base);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'ATTENDANCE_DATA_CONFLICT');
  assert.deepEqual(statuses(state), {
    3: 'present',
    4: 'pending',
    6: 'present',
  });
});

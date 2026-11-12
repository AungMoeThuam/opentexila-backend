import assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';
import type { ClassEntity } from '../dist/database/entities/index.js';
import { FinalisationService } from '../dist/attendance/finalisation.service.js';
import type { AttendanceCaller } from '../dist/attendance/attendance.rules.js';

const errorCode = (expected: string) => (error: any) =>
  error.getResponse?.().error.code === expected;

// Runs only inside the disposable MySQL container owned by test:db.
export async function finalisationIntegration(
  t: any,
  ds: DataSource,
  fixtures: any,
) {
  const original = await ds
    .getRepository<ClassEntity>('Class')
    .findOneBy({ id: fixtures.class_id });
  assert.ok(original);
  const { id: originalId, ...classFields } = original;
  const classroom = await ds
    .getRepository<ClassEntity>('Class')
    .save({ ...classFields, section: 'FINTEST' });
  const students: { id: number }[] = await ds.query(
    "SELECT id FROM users WHERE role = 'student' ORDER BY id LIMIT 3",
  );
  const [checkedIn, pending, unmaterialised] = students.map((s) => s.id);
  const lecturer: AttendanceCaller = {
    id: classroom.lecturer_id,
    role: 'lecturer',
  };
  const service = new FinalisationService(ds);
  const sessions: number[] = [];
  async function createSession(kind: 'ended' | 'open' | 'cancelled') {
    const [clock] = await ds.query('SELECT UTC_TIMESTAMP(3) AS now');
    const now = +new Date(clock.now);
    const row = await ds.getRepository('ClassSession').save({
      class_id: classroom.id,
      room_label: 'Frozen room',
      latitude: '0.000000',
      longitude: '0.000000',
      radius_m: '100.00',
      starts_at: new Date(now - 7200000 - sessions.length * 1000),
      late_after: new Date(now - 6000000 - sessions.length * 1000),
      ends_at: new Date(kind === 'open' ? now + 3600000 : now - 1000),
      state: kind === 'cancelled' ? 'cancelled' : 'scheduled',
    });
    sessions.push(row.id);
    await ds.getRepository('AttendanceRecord').save([
      {
        class_session_id: row.id,
        student_id: checkedIn,
        status: 'late',
        checked_in_at: new Date(now - 5000000),
        distance_m: '7.50',
      },
      { class_session_id: row.id, student_id: pending, status: 'pending' },
    ]);
    return row;
  }
  const rows = (id: number) =>
    ds.query(
      `SELECT student_id, status, checked_in_at, distance_m
      FROM attendance_records WHERE class_session_id = ? ORDER BY student_id`,
      [id],
    );
  try {
    await ds
      .getRepository('Enrolment')
      .save(
        students.map((s) => ({ class_id: classroom.id, student_id: s.id })),
      );

    await t.test(
      'finalising an ended session marks pending and unmaterialised students absent and keeps evidence',
      async () => {
        const ended = await createSession('ended');
        const before = await rows(ended.id);
        assert.deepEqual(
          await service.finaliseClassSession(lecturer, ended.id),
          {
            class_session_id: ended.id,
            outcome: 'finalised',
            absent_marked: 2,
          },
        );
        const after = await rows(ended.id);
        const byStudent = Object.fromEntries(
          after.map((r: any) => [r.student_id, r]),
        );
        assert.equal(byStudent[checkedIn].status, 'late');
        assert.deepEqual(
          byStudent[checkedIn],
          before.find((r: any) => r.student_id === checkedIn),
        );
        assert.equal(byStudent[pending].status, 'absent');
        assert.equal(byStudent[pending].checked_in_at, null);
        assert.equal(byStudent[unmaterialised].status, 'absent');
        assert.deepEqual(
          await service.finaliseClassSession(lecturer, ended.id),
          {
            class_session_id: ended.id,
            outcome: 'already_finalised',
            absent_marked: 0,
          },
        );
      },
    );

    await t.test(
      'concurrent finalisation marks each student absent exactly once',
      async () => {
        const ended = await createSession('ended');
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            service.finaliseClassSession(lecturer, ended.id),
          ),
        );
        assert.equal(
          results.reduce((sum, r) => sum + r.absent_marked, 0),
          2,
        );
        assert.equal(
          results.filter((r) => r.outcome === 'finalised').length,
          1,
        );
        assert.equal(
          results.filter((r) => r.outcome === 'already_finalised').length,
          4,
        );
      },
    );

    await t.test('open and cancelled sessions are left untouched', async () => {
      for (const [kind, outcome] of [
        ['open', 'not_due'],
        ['cancelled', 'cancelled'],
      ] as const) {
        const session = await createSession(kind);
        const before = await rows(session.id);
        assert.deepEqual(
          await service.finaliseClassSession(lecturer, session.id),
          { class_session_id: session.id, outcome, absent_marked: 0 },
        );
        assert.deepEqual(await rows(session.id), before);
      }
    });

    await t.test(
      'other lecturers and missing sessions are not found and change nothing',
      async () => {
        const ended = await createSession('ended');
        const before = await rows(ended.id);
        await assert.rejects(
          service.finaliseClassSession(
            { id: lecturer.id + 1000000, role: 'lecturer' },
            ended.id,
          ),
          errorCode('RESOURCE_NOT_FOUND'),
        );
        await assert.rejects(
          service.finaliseClassSession(lecturer, 4294967295),
          errorCode('RESOURCE_NOT_FOUND'),
        );
        // Corrupt evidence cannot be stored (ck_records_evidence), so the 409
        // defence-in-depth branch is covered by the HTTP test's fake instead.
        assert.deepEqual(await rows(ended.id), before);
      },
    );
  } finally {
    for (const id of sessions) {
      await ds
        .getRepository('AttendanceRecord')
        .delete({ class_session_id: id });
      await ds.getRepository('ClassSession').delete(id);
    }
    await ds.getRepository('Enrolment').delete({ class_id: classroom.id });
    await ds.getRepository<ClassEntity>('Class').delete(classroom.id);
  }
}

import assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';
import type { ClassEntity } from '../dist/database/entities/index.js';
import { AttendanceAnalyticsService } from '../dist/attendance/attendance-analytics.service.js';

const errorCode = (expected: string) => (error: any) =>
  error.getResponse?.().error.code === expected;

// Runs only inside the disposable MySQL container owned by test:db. It checks
// the SQL rules the HTTP tests cannot: Finalised class sessions, currently
// enrolled students and Malaysia-time (UTC+8) days.
export async function attendanceAnalyticsIntegration(
  t: any,
  ds: DataSource,
  fixtures: any,
) {
  const original = await ds
    .getRepository<ClassEntity>('Class')
    .findOneBy({ id: fixtures.class_id });
  assert.ok(original);
  const { id: _originalId, ...classFields } = original;
  const classroom = await ds
    .getRepository<ClassEntity>('Class')
    .save({ ...classFields, section: 'ANLTEST' });
  const lecturer = { id: original.lecturer_id, role: 'lecturer' as const };
  const [otherLecturer] = await ds.query(
    "SELECT id FROM users WHERE role = 'lecturer' AND id <> ? ORDER BY id LIMIT 1",
    [original.lecturer_id],
  );
  const students: { id: number }[] = await ds.query(
    "SELECT id FROM users WHERE role = 'student' ORDER BY id LIMIT 3",
  );
  const [ann, ben, left] = students;
  await ds
    .getRepository('Enrolment')
    .save(students.map((s) => ({ class_id: classroom.id, student_id: s.id })));
  const service = new AttendanceAnalyticsService(ds);
  const range = { from: '2025-03-01', to: '2025-03-31' };

  async function session(
    startsAt: string,
    records: [{ id: number }, string][],
    over: Record<string, unknown> = {},
  ) {
    const start = new Date(startsAt);
    const row = await ds.getRepository('ClassSession').save({
      class_id: classroom.id,
      room_label: 'Analytics room',
      latitude: '0.000000',
      longitude: '0.000000',
      radius_m: '100.00',
      starts_at: start,
      late_after: new Date(+start + 900_000),
      ends_at: new Date(+start + 7_200_000),
      state: 'scheduled',
      ...over,
    });
    for (const [who, status] of records)
      await ds.getRepository('AttendanceRecord').save({
        class_session_id: row.id,
        student_id: who.id,
        status,
      });
    return row;
  }

  try {
    // 8 Mar 10:00 MYT: Ann present, Ben late, Left absent (still enrolled).
    await session('2025-03-08T02:00:00Z', [
      [ann, 'present'],
      [ben, 'late'],
      [left, 'absent'],
    ]);
    // 15 Mar: Ann absent, Ben absent, Left absent.
    await session('2025-03-15T02:00:00Z', [
      [ann, 'absent'],
      [ben, 'absent'],
      [left, 'absent'],
    ]);

    await t.test('counts present, late and absent per student', async () => {
      const { data } = await service.read(lecturer, {
        ...range,
        classId: String(classroom.id),
      });
      assert.equal(data.summary.sessions, 2);
      assert.deepEqual(
        [data.summary.present, data.summary.late, data.summary.absent],
        [1, 1, 4],
      );
      assert.equal(data.summary.attendanceRate, 33.3);
      // Ann 1/2 = 50, Ben 1/2 = 50, Left 0/2 = 0: all below 75.
      assert.deepEqual(
        data.atRisk.map((r) => r.attendanceRate),
        [0, 50, 50],
      );
      assert.equal(data.atRisk[0].studentId, left.id);
    });

    await t.test(
      'cancelled and not-yet-ended sessions never count',
      async () => {
        await session('2025-03-20T02:00:00Z', [[ann, 'absent']], {
          state: 'cancelled',
        });
        const future = new Date(Date.now() + 86_400_000 * 30);
        await session(future.toISOString(), [[ann, 'pending']]);
        const { data } = await service.read(lecturer, {
          ...range,
          to: future.toISOString().slice(0, 10),
          classId: String(classroom.id),
        });
        assert.equal(data.summary.sessions, 2);
        assert.equal(data.unfinalised.length, 0);
      },
    );

    await t.test(
      'a session with a pending record is listed, not counted',
      async () => {
        const open = await session('2025-03-22T02:00:00Z', [
          [ann, 'present'],
          [ben, 'pending'],
          [left, 'pending'],
        ]);
        const { data } = await service.read(lecturer, {
          ...range,
          classId: String(classroom.id),
        });
        assert.equal(data.summary.sessions, 2);
        assert.equal(data.summary.unfinalisedSessions, 1);
        assert.deepEqual(
          data.unfinalised.map((u) => [u.classSessionId, u.pendingCount]),
          [[open.id, 2]],
        );
        await ds
          .getRepository('AttendanceRecord')
          .delete({ class_session_id: open.id });
        await ds.getRepository('ClassSession').delete({ id: open.id });
      },
    );

    await t.test(
      'students no longer enrolled are ignored everywhere',
      async () => {
        await ds
          .getRepository('Enrolment')
          .delete({ class_id: classroom.id, student_id: left.id });
        const { data } = await service.read(lecturer, {
          ...range,
          classId: String(classroom.id),
        });
        assert.equal(data.summary.absent, 2);
        assert.ok(data.atRisk.every((r) => r.studentId !== left.id));
        await ds
          .getRepository('Enrolment')
          .save({ class_id: classroom.id, student_id: left.id });
      },
    );

    await t.test('days are Malaysia time (UTC+8)', async () => {
      // 1 Mar 16:30 UTC is 2 Mar 00:30 in Malaysia.
      const edge = await session('2025-03-01T16:30:00Z', [[ann, 'present']]);
      const on = (day: string) =>
        service.read(lecturer, {
          from: day,
          to: day,
          classId: String(classroom.id),
        });
      assert.equal((await on('2025-03-01')).data.summary.sessions, 0);
      const second = await on('2025-03-02');
      assert.equal(second.data.summary.sessions, 1);
      assert.equal(second.data.trend[0].date, '2025-03-02');
      // The last Malaysian day includes sessions up to 15:59 UTC.
      const late = await session('2025-03-31T15:30:00Z', [[ann, 'present']]);
      assert.equal((await on('2025-03-31')).data.summary.sessions, 1);
      for (const row of [edge, late]) {
        await ds
          .getRepository('AttendanceRecord')
          .delete({ class_session_id: row.id });
        await ds.getRepository('ClassSession').delete({ id: row.id });
      }
    });

    await t.test('another lecturer cannot read this class', async () => {
      await assert.rejects(
        service.read(
          { id: otherLecturer.id, role: 'lecturer' },
          { ...range, classId: String(classroom.id) },
        ),
        errorCode('FORBIDDEN'),
      );
      await assert.rejects(
        service.read(lecturer, { ...range, classId: '4294967295' }),
        errorCode('FORBIDDEN'),
      );
      const { data } = await service.read(
        { id: otherLecturer.id, role: 'lecturer' },
        range,
      );
      assert.ok(data.byClass.every((c) => c.classId !== classroom.id));
    });
  } finally {
    await ds.query(
      'DELETE r FROM attendance_records r JOIN class_sessions s ON s.id = r.class_session_id WHERE s.class_id = ?',
      [classroom.id],
    );
    await ds.query('DELETE FROM class_sessions WHERE class_id = ?', [
      classroom.id,
    ]);
    await ds.query('DELETE FROM enrolments WHERE class_id = ?', [classroom.id]);
    await ds.query('DELETE FROM classes WHERE id = ?', [classroom.id]);
  }
}

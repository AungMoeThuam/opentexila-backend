import assert from 'node:assert/strict';
import type { DataSource } from 'typeorm';
import type { ClassEntity } from '../dist/database/entities/index.js';
import { AttendanceService } from '../dist/attendance/attendance.service.js';
import { RosterService } from '../dist/attendance/roster.service.js';
import type {
  AttendanceCaller,
  LocationReading,
} from '../dist/attendance/attendance.rules.js';

const errorCode = (expected: string) => (error: any) =>
  error.getResponse?.().error.code === expected;

// Runs only inside the disposable MySQL container owned by test:db.
export async function attendanceIntegration(
  t: any,
  ds: DataSource,
  fixtures: any,
) {
  const original = await ds
    .getRepository<ClassEntity>('Class')
    .findOneBy({ id: fixtures.class_id });
  assert.ok(original);
  const { id: originalId, ...classFields } = original;
  const classroom = await ds.getRepository<ClassEntity>('Class').save({
    ...classFields,
    section: 'ATTTEST',
    room_label: 'Frozen room',
    latitude: '0.000000',
    longitude: '0.000000',
    radius_m: '100.00',
  });
  const students = await ds.query(
    "SELECT id FROM users WHERE role = 'student' ORDER BY id LIMIT 3",
  );
  const student: AttendanceCaller = { id: students[0].id, role: 'student' };
  const nonmember: AttendanceCaller = { id: students[2].id, role: 'student' };
  const service = new AttendanceService(ds);
  const roster = new RosterService(ds);
  const sessions: number[] = [];
  const reading = (): LocationReading => ({
    latitude: 0,
    longitude: 0,
    accuracy_m: 5,
    reading_timestamp: new Date(),
  });
  async function createSession(kind = 'current') {
    const [clock] = await ds.query('SELECT UTC_TIMESTAMP(3) AS now');
    const now = +new Date(clock.now);
    const offset = sessions.length * 1000;
    const start =
      kind === 'future' ? now + 3600000 + offset : now - 3600000 - offset;
    const row = await ds.getRepository('ClassSession').save({
      class_id: classroom.id,
      room_label: 'Frozen room',
      latitude: '0.000000',
      longitude: '0.000000',
      radius_m: '100.00',
      starts_at: new Date(start),
      late_after: new Date(
        kind === 'late' || kind === 'ended'
          ? start + 1000
          : Math.max(now + 1800000, start + 900000),
      ),
      ends_at: new Date(
        kind === 'ended'
          ? now - 1000
          : Math.max(now + 3600000, start + 7200000),
      ),
      state: kind === 'cancelled' ? 'cancelled' : 'scheduled',
    });
    sessions.push(row.id);
    return row;
  }
  try {
    await ds
      .getRepository('Enrolment')
      .save(
        students
          .slice(0, 2)
          .map((s: any) => ({ class_id: classroom.id, student_id: s.id })),
      );
    const current = await createSession();
    await t.test(
      'concurrent materialisation creates one pending row per enrollee',
      async () => {
        await Promise.all(
          Array.from({ length: 5 }, () => roster.materialise(current.id)),
        );
        const records = await ds
          .getRepository('AttendanceRecord')
          .findBy({ class_session_id: current.id });
        assert.equal(records.length, 2);
        assert.ok(records.every((r: any) => r.status === 'pending'));
      },
    );
    await t.test(
      'failed readings preserve pending rows and concurrent replay returns original evidence',
      async () => {
        for (const [patch, code] of [
          [{ accuracy_m: 101 }, 'LOCATION_INACCURATE'],
          [{ latitude: 1 }, 'OUTSIDE_ALLOWED_AREA'],
          [
            { reading_timestamp: new Date(Date.now() - 120000) },
            'LOCATION_STALE',
          ],
        ] as const) {
          await assert.rejects(
            service.checkIn(student, current.id, {
              ...reading(),
              ...(patch as any),
            }),
            errorCode(code),
          );
          const row = await ds.getRepository('AttendanceRecord').findOneBy({
            class_session_id: current.id,
            student_id: student.id,
          });
          assert.equal(row!.status, 'pending');
          assert.equal(row!.checked_in_at, null);
        }
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            service.checkIn(student, current.id, reading()),
          ),
        );
        assert.ok(
          results.every(
            (result) => JSON.stringify(result) === JSON.stringify(results[0]),
          ),
        );
        assert.equal(results[0].data.attendance_record.status, 'present');
        await roster.materialise(current.id);
        assert.deepEqual(
          await service.checkIn(student, current.id, reading()),
          results[0],
        );
      },
    );
    await t.test(
      'venue snapshots and safe detail survive changes to the class venue',
      async () => {
        await ds.getRepository<ClassEntity>('Class').update(classroom.id, {
          room_label: 'Moved room',
          latitude: '10.000000',
        });
        const result = await service.detail(student, current.id);
        assert.equal(result.data.class.room_label, 'Frozen room');
        assert.equal(result.data.check_in.reason, 'ALREADY_CHECKED_IN');
        assert.equal(JSON.stringify(result).includes('latitude'), false);
        const second = await service.checkIn(
          { id: students[1].id, role: 'student' },
          current.id,
          reading(),
        );
        assert.equal(second.data.attendance_record.status, 'present');
      },
    );
    await t.test(
      'late, future, ended, cancelled and nonmember behavior',
      async () => {
        const late = await createSession('late');
        assert.equal(
          (await service.checkIn(student, late.id, reading())).data
            .attendance_record.status,
          'late',
        );
        for (const [kind, code] of [
          ['future', 'CLASS_NOT_STARTED'],
          ['ended', 'CLASS_ENDED'],
          ['cancelled', 'CLASS_CANCELLED'],
        ] as const) {
          const row = await createSession(kind);
          await assert.rejects(
            service.checkIn(student, row.id, reading()),
            errorCode(code),
          );
          if (kind !== 'ended') {
            await roster.materialise(row.id);
            assert.equal(
              await ds
                .getRepository('AttendanceRecord')
                .countBy({ class_session_id: row.id }),
              0,
            );
          }
        }
        await assert.rejects(
          service.detail(nonmember, current.id),
          errorCode('RESOURCE_NOT_FOUND'),
        );
        await assert.rejects(
          service.checkIn(nonmember, current.id, reading()),
          errorCode('RESOURCE_NOT_FOUND'),
        );
        await ds
          .getRepository('ClassSession')
          .update(current.id, { state: 'cancelled' });
        await assert.rejects(
          service.checkIn(student, current.id, reading()),
          errorCode('CLASS_CANCELLED'),
        );
      },
    );
    await t.test(
      'student and lecturer schedules are scoped and paginated, historical roster retains access',
      async () => {
        const list = await service.list(student, {
          page: 1,
          limit: 2,
          classId: classroom.id,
        });
        assert.equal(list.data.length, 2);
        assert.equal(list.meta.total, sessions.length);
        const beyond = await service.list(student, {
          page: 100,
          limit: 2,
          classId: classroom.id,
        });
        assert.deepEqual(beyond.data, []);
        assert.equal(beyond.meta.total, sessions.length);
        const empty = await service.list(nonmember, {
          page: 1,
          limit: 20,
          classId: classroom.id,
        });
        assert.equal(empty.meta.total, 0);
        const lecturer = await service.list(
          { id: classroom.lecturer_id, role: 'lecturer' },
          { page: 1, limit: 20, classId: classroom.id },
        );
        assert.equal(lecturer.meta.total, sessions.length);
        assert.ok(lecturer.data.every((s: any) => s.my_attendance === null));
        const foreignLecturer = await service.list(
          { id: 4294967295, role: 'lecturer' },
          { page: 1, limit: 20, classId: classroom.id },
        );
        assert.equal(foreignLecturer.meta.total, 0);
        const row = await ds
          .getRepository('ClassSession')
          .findOneBy({ id: current.id });
        const range = await service.list(student, {
          page: 1,
          limit: 20,
          classId: classroom.id,
          from: row!.starts_at,
          to: new Date(+row!.starts_at + 1),
        });
        assert.equal(range.meta.total, 1);
        assert.equal(range.data[0].id, row!.id);
        await ds
          .getRepository('Enrolment')
          .delete({ class_id: classroom.id, student_id: student.id });
        assert.equal(
          (await service.detail(student, current.id)).data.id,
          current.id,
        );
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

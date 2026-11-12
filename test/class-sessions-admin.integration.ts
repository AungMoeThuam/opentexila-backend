import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { DataSource } from 'typeorm';
import { AttendanceService } from '../dist/attendance/attendance.service.js';
import { FinalisationService } from '../dist/attendance/finalisation.service.js';
import { ClassSessionsAdminService } from '../dist/class-sessions/class-sessions-admin.service.js';

const code = (expected: string) => (error: any) => {
  assert.equal(error.getResponse?.().error.code, expected, String(error));
  return true;
};

// Runs only inside the disposable MySQL container owned by test:db.
export async function classSessionsAdminIntegration(
  t: TestContext,
  ds: DataSource,
) {
  await t.test('admin session management against MySQL', async (t) => {
    const service = new ClassSessionsAdminService(ds);
    const attendance = new AttendanceService(ds);
    const finalisation = new FinalisationService(ds);
    const accountId = async (email: string): Promise<number> => {
      const [row] = await ds.query('SELECT id FROM users WHERE email = ?', [
        email,
      ]);
      return Number(row.id);
    };
    const lecturerOne = await accountId('lecturer.one@example.com');
    const lecturerTwo = await accountId('lecturer.two@example.com');
    const studentId = await accountId('student.one@example.com');
    const [{ id: courseId }] = await ds.query(
      'SELECT id FROM courses ORDER BY id LIMIT 1',
    );
    const classIds: number[] = [];
    const makeClass = async (
      section: string,
      lecturer: number,
      room: string,
    ): Promise<number> => {
      const result: any = await ds.query(
        `INSERT INTO classes (course_id, section, term, lecturer_id, room_label, latitude, longitude, radius_m)
         VALUES (?, ?, '2099-TEST', ?, ?, 0, 0, 100)`,
        [courseId, section, lecturer, room],
      );
      classIds.push(Number(result.insertId));
      return Number(result.insertId);
    };
    const classA = await makeClass('ZZSESA', lecturerOne, 'Sess room A');
    const classB = await makeClass('ZZSESB', lecturerTwo, 'Sess room B');
    const classSameLecturer = await makeClass(
      'ZZSESC',
      lecturerOne,
      'Sess room C',
    );
    const classSameRoom = await makeClass(
      'ZZSESD',
      lecturerTwo,
      ' SESS ROOM a ',
    );
    await ds.query(
      'INSERT INTO enrolments (class_id, student_id) VALUES (?, ?)',
      [classA, studentId],
    );
    t.after(async () => {
      const ids = [...classIds];
      await ds.query(
        'DELETE FROM attendance_records WHERE class_session_id IN (SELECT id FROM class_sessions WHERE class_id IN (?))',
        [ids],
      );
      await ds.query('DELETE FROM class_sessions WHERE class_id IN (?)', [ids]);
      await ds.query('DELETE FROM enrolments WHERE class_id IN (?)', [ids]);
      await ds.query('DELETE FROM classes WHERE id IN (?)', [ids]);
    });

    const [clock] = await ds.query('SELECT UTC_TIMESTAMP(3) AS now');
    const base = new Date(clock.now).getTime();
    const hours = (value: number) =>
      new Date(base + value * 3600_000).toISOString();
    // A day in the future, so every scheduled time passes the "future" rule.
    const times = (start: number, late = 0.25, length = 2) => ({
      starts_at: hours(start),
      late_after: hours(start + late),
      ends_at: hours(start + length),
    });
    // A session that is already running, written directly (the API only
    // schedules future sessions).
    const insertRunning = async (classId: number): Promise<number> => {
      const result: any = await ds.query(
        `INSERT INTO class_sessions (class_id, room_label, latitude, longitude, radius_m, starts_at, late_after, ends_at)
         VALUES (?, 'Sess room A', 0, 0, 100,
           DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE),
           DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 20 MINUTE),
           DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR))`,
        [classId],
      );
      return Number(result.insertId);
    };
    const insertEnded = async (classId: number): Promise<number> => {
      const result: any = await ds.query(
        `INSERT INTO class_sessions (class_id, room_label, latitude, longitude, radius_m, starts_at, late_after, ends_at)
         VALUES (?, 'Sess room A', 0, 0, 100,
           DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 HOUR),
           DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 170 MINUTE),
           DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR))`,
        [classId],
      );
      return Number(result.insertId);
    };
    const records = (sessionId: number) =>
      ds.query(
        'SELECT student_id, status, checked_in_at FROM attendance_records WHERE class_session_id = ? ORDER BY student_id',
        [sessionId],
      );
    const reading = () => ({
      latitude: 0,
      longitude: 0,
      accuracy_m: 5,
      reading_timestamp: new Date(),
    });
    const student = { id: studentId, role: 'student' as const };
    const lecturer = { id: lecturerOne, role: 'lecturer' as const };

    let first: any;
    await t.test(
      'scheduling copies the venue of the class as a snapshot',
      async () => {
        const made = await service.create(classA, times(24));
        first = made.data;
        assert.equal(first.state, 'scheduled');
        assert.equal(first.availability, 'upcoming');
        assert.equal(first.room_label, 'Sess room A');
        assert.deepEqual(first.attendance, {
          present: 0,
          late: 0,
          absent: 0,
          pending: 0,
        });
        assert.equal(first.starts_at, hours(24));
        assert.equal(first.late_after, hours(24.25));
        // A later change to the class does not move the saved session.
        await ds.query(
          "UPDATE classes SET room_label = 'Moved room', radius_m = 10 WHERE id = ?",
          [classA],
        );
        const listed = await service.list(classA, { page: 1, limit: 20 });
        const saved = listed.data.find((item) => item.id === first.id)!;
        assert.equal(saved.room_label, 'Sess room A');
        assert.equal(Number(saved.radius_m), 100);
        await ds.query(
          "UPDATE classes SET room_label = 'Sess room A', radius_m = 100 WHERE id = ?",
          [classA],
        );
        // A session scheduled now takes the venue of the class at this moment.
        await ds.query(
          "UPDATE classes SET room_label = 'Snapshot room' WHERE id = ?",
          [classA],
        );
        const later = await service.create(classA, times(48));
        assert.equal(later.data.room_label, 'Snapshot room');
        await ds.query(
          "UPDATE classes SET room_label = 'Sess room A' WHERE id = ?",
          [classA],
        );
      },
    );

    await t.test(
      'wrong times, past starts and unknown classes are refused',
      async () => {
        await assert.rejects(
          service.create(classA, times(-1)),
          code('VALIDATION_ERROR'),
        );
        await assert.rejects(
          service.create(classA, { ...times(30), late_after: hours(29) }),
          code('VALIDATION_ERROR'),
        );
        await assert.rejects(
          service.create(classA, { ...times(30), ends_at: hours(30) }),
          code('VALIDATION_ERROR'),
        );
        await assert.rejects(
          service.create(4294967295, times(30)),
          code('RESOURCE_NOT_FOUND'),
        );
        const [{ total }] = await ds.query(
          'SELECT COUNT(*) AS total FROM class_sessions WHERE class_id = ?',
          [classA],
        );
        assert.equal(Number(total), 2, 'nothing extra was saved');
      },
    );

    await t.test(
      'a duplicate start is refused, also when the other session is cancelled',
      async () => {
        await assert.rejects(
          service.create(classA, times(24, 0.5, 3)),
          code('CLASS_SESSION_EXISTS'),
        );
        const cancelled = (await service.create(classA, times(72))).data;
        await service.cancel(cancelled.id);
        await assert.rejects(
          service.create(classA, times(72)),
          code('CLASS_SESSION_EXISTS'),
        );
      },
    );

    await t.test(
      'overlap with the same class, lecturer or room is refused',
      async () => {
        // classA has 24h to 26h. Same class, lecturer and room each overlap it.
        await assert.rejects(
          service.create(classA, times(25)),
          code('SCHEDULE_CONFLICT'),
        );
        await assert.rejects(
          service.create(classSameLecturer, times(25)),
          code('SCHEDULE_CONFLICT'),
        );
        await assert.rejects(
          service.create(classSameRoom, times(25)),
          code('SCHEDULE_CONFLICT'),
        );
        // The error says which session clashes and why.
        const conflictsOf = async (classId: number, start: number) => {
          try {
            await service.create(classId, times(start));
          } catch (error: any) {
            return error.getResponse().error;
          }
          throw new Error('Expected a schedule conflict.');
        };
        const sameLecturer = await conflictsOf(classSameLecturer, 25);
        assert.equal(sameLecturer.conflicts.length, 1);
        assert.deepEqual(sameLecturer.conflicts[0].types, ['lecturer']);
        assert.equal(sameLecturer.conflicts[0].session.class.id, classA);
        assert.equal(sameLecturer.conflicts[0].session.class.section, 'ZZSESA');
        assert.equal(sameLecturer.conflicts[0].session.class.term, '2099-TEST');
        assert.equal(
          sameLecturer.conflicts[0].session.lecturer.id,
          lecturerOne,
        );
        assert.ok(sameLecturer.conflicts[0].session.lecturer.name);
        assert.ok(sameLecturer.conflicts[0].session.class.course.code);
        assert.equal(
          sameLecturer.conflicts[0].session.room_label,
          'Sess room A',
        );
        assert.equal(sameLecturer.conflicts[0].session.starts_at, hours(24));
        assert.equal(sameLecturer.conflicts[0].session.ends_at, hours(26));
        const sameRoom = await conflictsOf(classSameRoom, 25);
        assert.deepEqual(sameRoom.conflicts[0].types, ['room']);
        const sameClass = await conflictsOf(classA, 25);
        assert.deepEqual(sameClass.conflicts[0].types.sort(), [
          'class',
          'lecturer',
          'room',
        ]);
        assert.match(
          sameClass.message,
          /same class, the same lecturer and the same room/,
        );
        // A different class, lecturer and room is free at the same time.
        const free = await service.create(classB, times(25));
        assert.equal(free.data.class_id, classB);
        // Sessions that only touch (end = start) do not overlap.
        const touching = await service.create(classA, times(26));
        assert.equal(touching.data.starts_at, hours(26));
      },
    );

    await t.test('a cancelled session no longer blocks its time', async () => {
      const slot = (await service.create(classSameLecturer, times(100))).data;
      await assert.rejects(
        service.create(classSameLecturer, times(100.5)),
        code('SCHEDULE_CONFLICT'),
      );
      await service.cancel(slot.id);
      const reused = await service.create(classSameLecturer, times(100.5));
      assert.equal(reused.data.state, 'scheduled');
    });

    await t.test(
      'two requests for the same time give one session',
      async () => {
        const results = await Promise.allSettled([
          service.create(classB, times(200)),
          service.create(classB, times(200)),
          service.create(classB, times(200.5)),
        ]);
        const ok = results.filter((item) => item.status === 'fulfilled');
        assert.equal(
          ok.length,
          1,
          'only one of the overlapping requests is saved',
        );
        for (const item of results)
          if (item.status === 'rejected')
            assert.ok(
              ['CLASS_SESSION_EXISTS', 'SCHEDULE_CONFLICT'].includes(
                (item.reason as any).getResponse().error.code,
              ),
            );
      },
    );

    await t.test(
      'the list is ordered, paged, filtered and counts real records',
      async () => {
        const running = await insertRunning(classA);
        await ds.query(
          `INSERT INTO attendance_records (class_session_id, student_id, status, checked_in_at, distance_m)
         VALUES (?, ?, 'late', UTC_TIMESTAMP(3), 3.5)`,
          [running, studentId],
        );
        const all = await service.list(classA, { page: 1, limit: 100 });
        const starts = all.data.map((item) => item.starts_at);
        assert.deepEqual(starts, [...starts].sort(), 'early to late');
        assert.equal(all.context.class.id, classA);
        const current = all.data.find((item) => item.id === running)!;
        assert.equal(current.availability, 'in_progress');
        assert.deepEqual(current.attendance, {
          present: 0,
          late: 1,
          absent: 0,
          pending: 0,
        });
        const pageOne = await service.list(classA, { page: 1, limit: 2 });
        const pageTwo = await service.list(classA, { page: 2, limit: 2 });
        assert.equal(pageOne.data.length, 2);
        assert.equal(pageOne.meta.total, all.data.length);
        assert.equal(
          new Set([...pageOne.data, ...pageTwo.data].map((item) => item.id))
            .size,
          pageOne.data.length + pageTwo.data.length,
          'pages do not repeat sessions',
        );
        const onlyCancelled = await service.list(classA, {
          page: 1,
          limit: 100,
          state: 'cancelled',
        });
        assert.ok(onlyCancelled.data.length >= 1);
        assert.ok(
          onlyCancelled.data.every((item) => item.state === 'cancelled'),
        );
        await assert.rejects(
          service.list(4294967295, { page: 1, limit: 20 }),
          code('RESOURCE_NOT_FOUND'),
        );
        const none = await service.list(classSameRoom, { page: 1, limit: 20 });
        assert.deepEqual(none.data, []);
      },
    );

    await t.test(
      'cancelling keeps attendance records and is safe to repeat',
      async () => {
        const running = await insertRunning(classA);
        await attendance.checkIn(student, running, reading());
        const before = await records(running);
        assert.equal(before.length, 1);
        const cancelled = await service.cancel(running);
        assert.equal(cancelled.data.state, 'cancelled');
        assert.equal(cancelled.data.availability, 'cancelled');
        assert.equal(cancelled.data.attendance.present, 1);
        assert.deepEqual(
          await records(running),
          before,
          'records are unchanged',
        );
        const again = await service.cancel(running);
        assert.deepEqual(again.data, cancelled.data);
        // Check-in after cancellation is refused, and the saved record stays.
        await assert.rejects(
          attendance.checkIn(student, running, reading()),
          code('CLASS_CANCELLED'),
        );
        assert.deepEqual(await records(running), before);
        // Finalisation ignores a cancelled session: no new absences.
        const outcome = await finalisation.finaliseClassSession(
          lecturer,
          running,
        );
        assert.equal(outcome.outcome, 'cancelled');
        assert.deepEqual(await records(running), before);
      },
    );

    await t.test(
      'an upcoming session is cancelled without any records',
      async () => {
        const upcoming = (await service.create(classB, times(300))).data;
        const cancelled = await service.cancel(upcoming.id);
        assert.equal(cancelled.data.state, 'cancelled');
        assert.deepEqual(await records(upcoming.id), []);
      },
    );

    await t.test(
      'an ended session cannot be cancelled and keeps its absences',
      async () => {
        const ended = await insertEnded(classA);
        await ds.query(
          "INSERT INTO attendance_records (class_session_id, student_id, status) VALUES (?, ?, 'absent')",
          [ended, studentId],
        );
        await assert.rejects(
          service.cancel(ended),
          code('CLASS_SESSION_ENDED'),
        );
        const [row] = await ds.query(
          'SELECT state FROM class_sessions WHERE id = ?',
          [ended],
        );
        assert.equal(row.state, 'scheduled');
        assert.equal((await records(ended))[0].status, 'absent');
        await assert.rejects(
          service.cancel(4294967295),
          code('RESOURCE_NOT_FOUND'),
        );
      },
    );

    await t.test(
      'a cancel and a check-in at the same time never disagree',
      async () => {
        for (let round = 0; round < 12; round += 1) {
          const running = await insertRunning(classA);
          const [checked, cancelled] = await Promise.allSettled([
            attendance.checkIn(student, running, reading()),
            service.cancel(running),
          ]);
          assert.equal(
            cancelled.status,
            'fulfilled',
            `round ${round}: cancel works`,
          );
          const saved = (await records(running)).filter((row: any) =>
            ['present', 'late'].includes(row.status),
          );
          if (checked.status === 'fulfilled') {
            // The check-in was saved before the cancellation and is kept.
            assert.equal(saved.length, 1, `round ${round}: record kept`);
          } else {
            code('CLASS_CANCELLED')(checked.reason);
            assert.equal(
              saved.length,
              0,
              `round ${round}: no check-in after cancel`,
            );
          }
          const [row] = await ds.query(
            'SELECT state FROM class_sessions WHERE id = ?',
            [running],
          );
          assert.equal(row.state, 'cancelled');
          // After the cancellation is saved, no check-in can succeed.
          await assert.rejects(
            attendance.checkIn(student, running, reading()),
            code('CLASS_CANCELLED'),
          );
        }
      },
    );

    await t.test(
      'the policy of one upcoming session changes, and nothing else',
      async () => {
        const target = (await service.create(classA, times(400))).data;
        const other = (await service.create(classA, times(430))).data;
        const classBefore = await ds.query(
          'SELECT room_label, latitude, longitude, radius_m FROM classes WHERE id = ?',
          [classA],
        );
        const changed = await service.updatePolicy(target.id, {
          room_label: 'Moved room',
          latitude: 3.12345678,
          longitude: 101.5,
          radius_m: 42.5,
          late_after: hours(400.5),
        });
        assert.equal(changed.data.room_label, 'Moved room');
        assert.equal(Number(changed.data.latitude), 3.123457);
        assert.equal(Number(changed.data.longitude), 101.5);
        assert.equal(Number(changed.data.radius_m), 42.5);
        assert.equal(changed.data.late_after, hours(400.5));
        assert.equal(
          changed.data.starts_at,
          target.starts_at,
          'the times of the session stay',
        );
        assert.equal(changed.data.state, 'scheduled');
        // The class and the other sessions of the class keep their values.
        assert.deepEqual(
          await ds.query(
            'SELECT room_label, latitude, longitude, radius_m FROM classes WHERE id = ?',
            [classA],
          ),
          classBefore,
        );
        const [untouched] = await ds.query(
          'SELECT room_label, radius_m, late_after FROM class_sessions WHERE id = ?',
          [other.id],
        );
        assert.equal(untouched.room_label, other.room_label);
        assert.equal(Number(untouched.radius_m), Number(other.radius_m));
        // A field that is not sent keeps its value.
        const partial = await service.updatePolicy(target.id, { radius_m: 60 });
        assert.equal(partial.data.room_label, 'Moved room');
        assert.equal(Number(partial.data.radius_m), 60);
        // The late time must lie inside the session.
        await assert.rejects(
          service.updatePolicy(target.id, { late_after: hours(402) }),
          code('VALIDATION_ERROR'),
        );
        await assert.rejects(
          service.updatePolicy(target.id, { late_after: hours(399) }),
          code('VALIDATION_ERROR'),
        );
        await assert.rejects(
          service.updatePolicy(target.id, {}),
          code('VALIDATION_ERROR'),
        );
        await assert.rejects(
          service.updatePolicy(4294967295, { radius_m: 5 }),
          code('RESOURCE_NOT_FOUND'),
        );
      },
    );

    await t.test(
      'a session that has started, ended or been cancelled keeps its policy',
      async () => {
        const running = await insertRunning(classA);
        const ended = await insertEnded(classA);
        const cancelled = (await service.create(classB, times(500))).data;
        await service.cancel(cancelled.id);
        for (const id of [running, ended, cancelled.id]) {
          const [before] = await ds.query(
            'SELECT * FROM class_sessions WHERE id = ?',
            [id],
          );
          await assert.rejects(
            service.updatePolicy(id, { radius_m: 5, late_after: hours(0) }),
            code('SESSION_NOT_EDITABLE'),
          );
          const [after] = await ds.query(
            'SELECT * FROM class_sessions WHERE id = ?',
            [id],
          );
          assert.deepEqual(after, before, `session ${id} is unchanged`);
        }
      },
    );

    await t.test(
      'a student check-in follows the changed radius and late time',
      async () => {
        // A session that starts in about two seconds, so it can be edited now and
        // checked in to shortly after.
        const [now] = await ds.query('SELECT UTC_TIMESTAMP(3) AS now');
        const start = new Date(new Date(now.now).getTime() + 2500);
        // classB has no running session, so nothing clashes with "now".
        await ds.query(
          'INSERT INTO enrolments (class_id, student_id) VALUES (?, ?)',
          [classB, studentId],
        );
        const made = (
          await service.create(classB, {
            starts_at: start.toISOString(),
            late_after: new Date(start.getTime() + 15 * 60_000).toISOString(),
            ends_at: new Date(start.getTime() + 3600_000).toISOString(),
          })
        ).data;
        // The class allows 100 m. This session allows only 30 m, and counts every
        // check-in after the start as Late.
        await service.updatePolicy(made.id, {
          latitude: 0,
          longitude: 0,
          radius_m: 30,
          late_after: start.toISOString(),
        });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const near = {
          latitude: 0,
          longitude: 0,
          accuracy_m: 5,
          reading_timestamp: new Date(),
        };
        // About 66 m from the point: inside the class radius, outside this session's.
        const far = { ...near, latitude: 0.0006 };
        await assert.rejects(
          attendance.checkIn(student, made.id, far),
          code('OUTSIDE_ALLOWED_AREA'),
        );
        const result = await attendance.checkIn(student, made.id, near);
        assert.equal(
          result.data.attendance_record.status,
          'late',
          'the new late time applies',
        );
        // Once it has started the policy can no longer be changed.
        await assert.rejects(
          service.updatePolicy(made.id, { radius_m: 500 }),
          code('SESSION_NOT_EDITABLE'),
        );
      },
    );
  });
}

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { DataSource } from 'typeorm';
import { AttendanceHistoryService } from '../dist/attendance/attendance-history.service.js';

export async function attendanceHistoryIntegration(
  t: TestContext,
  ds: DataSource,
) {
  await t.test('student attendance history reads real data', async (t) => {
    const history = new AttendanceHistoryService(ds!);
    const [{ student_id: studentId }] = await ds!.query(
      `SELECT student_id FROM attendance_records
             GROUP BY student_id ORDER BY COUNT(*) DESC, student_id LIMIT 1`,
    );
    const expected = await ds!.query(
      `SELECT r.class_session_id AS id, r.status FROM attendance_records r
             JOIN class_sessions s ON s.id = r.class_session_id
             WHERE r.student_id = ? AND s.state <> 'cancelled'
             ORDER BY s.starts_at DESC, r.class_session_id DESC`,
      [studentId],
    );
    assert.ok(expected.length > 0);
    const result = await history.getPersonalAttendanceRecords({
      studentId,
      limit: 100,
    });
    assert.deepEqual(
      result.data.map((row: any) => row.class_session_id),
      expected.map((row: any) => row.id),
    );
    assert.equal(result.meta.total, expected.length);
    for (const row of result.data) {
      assert.equal(row.student_id, studentId);
      assert.deepEqual(Object.keys(row.class.lecturer!).sort(), ['id', 'name']);
      assert.ok(row.class.course.code && row.class.section && row.class.term);
      assert.equal(typeof row.starts_at, 'string');
    }
    const filtered = await history.getPersonalAttendanceRecords({
      studentId,
      classId: result.data[0].class.id,
      status: result.data[0].status,
      limit: 100,
    });
    assert.ok(filtered.data.length > 0);
    assert.ok(
      filtered.data.every(
        (row: any) =>
          row.class.id === result.data[0].class.id &&
          row.status === result.data[0].status,
      ),
    );
    const withCancelled = await history.getPersonalAttendanceRecords({
      studentId,
      includeCancelled: true,
      limit: 100,
    });
    assert.ok(withCancelled.meta.total >= result.meta.total);

    await t.test(
      'date boundaries are inclusive from and exclusive to',
      async () => {
        const from = new Date(result.data.at(-1)!.starts_at!);
        const to = new Date(result.data[0].starts_at!);
        const expectedIds = result.data
          .filter(
            (row) =>
              new Date(row.starts_at!) >= from && new Date(row.starts_at!) < to,
          )
          .map((row) => row.class_session_id);
        const bounded = await history.getPersonalAttendanceRecords({
          studentId,
          from,
          to,
          limit: 100,
        });
        assert.deepEqual(
          bounded.data.map((row) => row.class_session_id),
          expectedIds,
        );
        assert.equal(bounded.meta.total, expectedIds.length);
      },
    );
    await t.test('pagination retains total and stable order', async () => {
      const page = await history.getPersonalAttendanceRecords({
        studentId,
        page: 2,
        limit: 2,
      });
      assert.deepEqual(
        page.data.map((row) => row.class_session_id),
        result.data.slice(2, 4).map((row) => row.class_session_id),
      );
      assert.equal(page.meta.total, result.meta.total);
      assert.equal(page.meta.totalPages, Math.ceil(result.meta.total / 2));
    });
    await t.test('class and status filters work independently', async () => {
      for (const query of [
        { classId: result.data[0].class.id },
        { status: result.data[0].status },
      ]) {
        const filtered = await history.getPersonalAttendanceRecords({
          studentId,
          limit: 100,
          ...query,
        });
        const expected = result.data.filter((row) =>
          'classId' in query
            ? row.class.id === query.classId
            : row.status === query.status,
        );
        assert.deepEqual(
          filtered.data.map((row) => row.class_session_id),
          expected.map((row) => row.class_session_id),
        );
        assert.equal(filtered.meta.total, expected.length);
      }
    });
    await t.test('student isolation and empty results', async () => {
      const others = await ds!.query(
        'SELECT DISTINCT student_id FROM attendance_records WHERE student_id <> ? LIMIT 1',
        [studentId],
      );
      assert.equal(others.length, 1);
      const otherId = others[0].student_id;
      const other = await history.getPersonalAttendanceRecords({
        studentId: otherId,
        limit: 100,
      });
      assert.ok(other.data.length > 0);
      assert.ok(other.data.every((row) => row.student_id === otherId));
      const [count] = await ds!.query(
        "SELECT COUNT(*) AS total FROM attendance_records r JOIN class_sessions s ON s.id = r.class_session_id WHERE r.student_id = ? AND s.state <> 'cancelled'",
        [otherId],
      );
      assert.equal(other.meta.total, Number(count.total));
      const empty = await history.getPersonalAttendanceRecords({
        studentId,
        classId: 4294967295,
      });
      assert.deepEqual(empty, {
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });
    await t.test(
      'cancelled rows are counted exactly when requested',
      async () => {
        const [count] = await ds!.query(
          "SELECT COUNT(*) AS total FROM attendance_records r JOIN class_sessions s ON s.id = r.class_session_id WHERE r.student_id = ? AND s.state = 'cancelled'",
          [studentId],
        );
        assert.equal(
          withCancelled.meta.total - result.meta.total,
          Number(count.total),
        );
      },
    );
  });

  await t.test('history class options', async (t) => {
    const history = new AttendanceHistoryService(ds!);
    const insert = async (sql: string, params: unknown[] = []) =>
      Number((await ds!.query(sql, params)).insertId);
    const user = (name: string, role: string) =>
      insert(
        'INSERT INTO users(name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [name, `${name.toLowerCase()}@options.test`, 'x', role],
      );
    const course = (code: string) =>
      insert('INSERT INTO courses(code, name) VALUES (?, ?)', [
        code,
        `Options ${code}`,
      ]);
    const classOf = (courseId: number, term: string, lecturerId: number) =>
      insert(
        `INSERT INTO classes(course_id, section, term, lecturer_id, room_label, latitude, longitude, radius_m)
         VALUES (?, 'A', ?, ?, 'R1', 1, 1, 50)`,
        [courseId, term, lecturerId],
      );
    const sessionOf = (classId: number, day: number, state = 'scheduled') =>
      insert(
        `INSERT INTO class_sessions(class_id, starts_at, late_after, ends_at, state, room_label, latitude, longitude, radius_m)
         VALUES (?, ?, ?, ?, ?, 'R1', 1, 1, 50)`,
        [
          classId,
          `2099-01-${day} 01:00:00`,
          `2099-01-${day} 01:15:00`,
          `2099-01-${day} 03:00:00`,
          state,
        ],
      );
    const record = (sessionId: number, studentId: number, status: string) =>
      ds!.query(
        `INSERT INTO attendance_records(class_session_id, student_id, status, checked_in_at, distance_m)
         VALUES (?, ?, ?, ?, ?)`,
        status === 'present'
          ? [sessionId, studentId, status, '2099-01-10 01:05:00', 1]
          : [sessionId, studentId, status, null, null],
      );
    const enrol = (classId: number, studentId: number) =>
      ds!.query('INSERT INTO enrolments(class_id, student_id) VALUES (?, ?)', [
        classId,
        studentId,
      ]);

    const lecturer = await user('OptLecturer', 'lecturer');
    const student = await user('OptStudent', 'student');
    const other = await user('OptOther', 'student');
    const nobody = await user('OptNobody', 'student');
    const [
      cBothCourse,
      cCurCourse,
      cFormerCourse,
      cCancelCourse,
      cOtherCourse,
    ] = [
      await course('OPT-A'),
      await course('OPT-B'),
      await course('OPT-C'),
      await course('OPT-D'),
      await course('OPT-E'),
    ];
    const both = await classOf(cBothCourse, '2099-S2', lecturer);
    const current = await classOf(cCurCourse, '2099-S2', lecturer);
    const former = await classOf(cFormerCourse, '2099-S1', lecturer);
    const cancelled = await classOf(cCancelCourse, '2098-S1', lecturer);
    const others = await classOf(cOtherCourse, '2099-S2', lecturer);

    await enrol(both, student);
    await enrol(current, student);
    const bothFirst = await sessionOf(both, 10);
    const bothSecond = await sessionOf(both, 11);
    await record(bothFirst, student, 'present');
    await record(bothSecond, student, 'absent');
    const formerSession = await sessionOf(former, 12);
    await record(formerSession, student, 'present');
    const cancelledSession = await sessionOf(cancelled, 13, 'cancelled');
    await record(cancelledSession, student, 'pending');
    await enrol(others, other);
    await record(await sessionOf(others, 14), other, 'present');

    t.after(async () => {
      await ds!.query(
        'DELETE FROM attendance_records WHERE student_id IN (?, ?)',
        [student, other],
      );
      await ds!.query(
        'DELETE FROM class_sessions WHERE class_id IN (?, ?, ?, ?, ?)',
        [both, current, former, cancelled, others],
      );
      await ds!.query('DELETE FROM enrolments WHERE student_id IN (?, ?)', [
        student,
        other,
      ]);
      await ds!.query('DELETE FROM classes WHERE id IN (?, ?, ?, ?, ?)', [
        both,
        current,
        former,
        cancelled,
        others,
      ]);
      await ds!.query("DELETE FROM courses WHERE code LIKE 'OPT-%'");
      await ds!.query("DELETE FROM users WHERE email LIKE '%@options.test'");
    });

    const ids = (result: { data: { id: number }[] }) =>
      result.data.map((row) => row.id);

    await t.test(
      'returns current, former and cancelled-only classes once each in a stable order',
      async () => {
        const result = await history.listHistoryClassOptions({
          studentId: student,
          limit: 100,
        });
        assert.deepEqual(ids(result), [both, current, former, cancelled]);
        assert.deepEqual(result.meta, {
          page: 1,
          limit: 100,
          total: 4,
          totalPages: 1,
        });
        assert.deepEqual(result.data[0], {
          id: both,
          course: { id: cBothCourse, code: 'OPT-A', name: 'Options OPT-A' },
          section: 'A',
          term: '2099-S2',
          lecturer: { id: lecturer, name: 'OptLecturer' },
          room_label: 'R1',
        });
      },
    );

    await t.test('pages never repeat or skip a class', async () => {
      const seen: number[] = [];
      for (let page = 1; page <= 4; page++) {
        const result = await history.listHistoryClassOptions({
          studentId: student,
          page,
          limit: 1,
        });
        assert.equal(result.meta.total, 4);
        assert.equal(result.meta.totalPages, 4);
        seen.push(...ids(result));
      }
      assert.deepEqual(seen, [both, current, former, cancelled]);
    });

    await t.test('options ignore the history filters', async () => {
      const filtered = await history.getPersonalAttendanceRecords({
        studentId: student,
        classId: former,
        status: 'absent',
        limit: 100,
      });
      assert.equal(filtered.meta.total, 0);
      const result = await history.listHistoryClassOptions({
        studentId: student,
        limit: 100,
      });
      assert.equal(result.meta.total, 4);
    });

    await t.test('another student only sees their own classes', async () => {
      const result = await history.listHistoryClassOptions({
        studentId: other,
        limit: 100,
      });
      assert.deepEqual(ids(result), [others]);
    });

    await t.test('a student with no classes gets an empty page', async () => {
      assert.deepEqual(
        await history.listHistoryClassOptions({ studentId: nobody }),
        {
          data: [],
          meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      );
    });

    await t.test(
      'removing an enrolment keeps classes that have records',
      async () => {
        await ds!.query('DELETE FROM enrolments WHERE student_id = ?', [
          student,
        ]);
        const result = await history.listHistoryClassOptions({
          studentId: student,
          limit: 100,
        });
        assert.deepEqual(ids(result), [both, former, cancelled]);
      },
    );
  });
}

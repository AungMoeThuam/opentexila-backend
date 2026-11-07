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
}

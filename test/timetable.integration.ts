import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { DataSource } from 'typeorm';

import { TimetableService } from '../dist/timetable/timetable.service.js';
import { ApiException } from '../dist/common/api-exception.js';

const START_DATE = '2035-01-15';

/**
 * Create UTC ISO 8601 timestamps for timetable changes.
 */
function change(id: number, startHour: number, endHour: number) {
  const time = (hour: number) =>
    `${START_DATE}T${String(hour).padStart(2, '0')}:00:00.000Z`;

  const late = `${START_DATE}T${String(startHour).padStart(2, '0')}:15:00.000Z`;

  return {
    id,
    starts_at: time(startHour),
    late_after: late,
    ends_at: time(endHour),
  };
}

/**
 * Convert UTC ISO timestamps into MySQL DATETIME format.
 *
 * Example:
 * 2035-01-15T08:00:00.000Z
 * becomes
 * 2035-01-15 08:00:00.000
 *
 * The project's MySQL connection uses UTC.
 */
function toMysqlDatetime(value: string): string {
  return new Date(value).toISOString().slice(0, 23).replace('T', ' ');
}

/**
 * Read existing session times directly from MySQL.
 */
async function getTimes(ds: DataSource, id: number) {
  const [row] = await ds.query(
    `SELECT starts_at, late_after, ends_at
     FROM class_sessions
     WHERE id = ?`,
    [id],
  );

  assert.ok(row, `Session ${id} must exist`);

  return {
    starts_at: new Date(row.starts_at).toISOString(),
    late_after: new Date(row.late_after).toISOString(),
    ends_at: new Date(row.ends_at).toISOString(),
  };
}

/**
 * Capture attendance records to verify that rescheduling
 * does not change or delete attendance history.
 */

async function attendanceSnapshot(ds: DataSource) {
  return ds.query(
    `SELECT *
     FROM attendance_records
     ORDER BY class_session_id, student_id`,
  );
}

/**
 * Insert an isolated future session using an existing
 * seeded class and location.
 *
 * Only the scheduled timestamps are changed.
 */
async function insertTestSession(
  ds: DataSource,
  sourceId: number,
  startHour: number,
  endHour: number,
): Promise<number> {
  const times = change(0, startHour, endHour);

  const result = await ds.query(
    `INSERT INTO class_sessions
      (
        class_id,
        room_label,
        latitude,
        longitude,
        radius_m,
        starts_at,
        late_after,
        ends_at,
        state
      )
     SELECT
       class_id,
       room_label,
       latitude,
       longitude,
       radius_m,
       ?,
       ?,
       ?,
       'scheduled'
     FROM class_sessions
     WHERE id = ?`,
    [
      toMysqlDatetime(times.starts_at),
      toMysqlDatetime(times.late_after),
      toMysqlDatetime(times.ends_at),
      sourceId,
    ],
  );

  const id = Number(result.insertId);

  assert.ok(id > 0, 'Test session must be inserted');

  return id;
}

/**
 * Backend Issue #32:
 * Admin timetable batch scheduling integration tests.
 *
 * These tests run against the disposable MySQL database
 * created by database.integration.ts.
 */
export async function timetableIntegration(t: TestContext, ds: DataSource) {
  await t.test('admin timetable batch scheduling against MySQL', async (t) => {
    const service = new TimetableService(ds);

    // Select two existing seeded classes.
    const sourceRows = await ds.query(
      `SELECT MIN(id) AS id
         FROM class_sessions
         GROUP BY class_id
         ORDER BY class_id
         LIMIT 2`,
    );

    assert.equal(sourceRows.length, 2, 'Two seeded classes are required');

    const sourceA = Number(sourceRows[0].id);
    const sourceB = Number(sourceRows[1].id);

    const createdIds: number[] = [];

    try {
      // Anchor and movable belong to the same class.
      // Other belongs to a different class.

      const anchor = await insertTestSession(ds, sourceA, 8, 9);
      createdIds.push(anchor);

      const movable = await insertTestSession(ds, sourceA, 10, 11);
      createdIds.push(movable);

      const other = await insertTestSession(ds, sourceB, 12, 13);
      createdIds.push(other);

      /**
       * TEST 1:
       * GET returns real sessions and pagination.
       */
      await t.test('GET returns real sessions and pagination', async () => {
        const result = await service.list({
          from: START_DATE,
          to: START_DATE,
          page: 1,
          limit: 20,
        });

        const ids = result.data.map((session) => session.id);

        assert.ok(ids.includes(anchor));
        assert.ok(ids.includes(movable));
        assert.ok(ids.includes(other));

        assert.equal(result.meta.total, 3);
        assert.equal(result.meta.page, 1);
        assert.equal(result.meta.limit, 20);
        assert.equal(result.meta.totalPages, 1);
      });

      /**
       * TEST 2:
       * A conflicting batch must not persist changes.
       */
      await t.test('conflicting batch is rejected atomically', async () => {
        const beforeMovable = await getTimes(ds, movable);

        const beforeOther = await getTimes(ds, other);

        // First change is valid.
        // Second overlaps with anchor in the same class.
        await assert.rejects(
          () =>
            service.updateBatch({
              changes: [change(other, 16, 17), change(movable, 8, 9)],
            }),
          (error: unknown) => {
            assert.ok(error instanceof ApiException);

            assert.equal(error.getStatus(), 409);

            assert.equal(error.getResponse().error.code, 'SCHEDULE_CONFLICT');

            return true;
          },
        );

        // Both sessions must remain unchanged.
        assert.deepEqual(await getTimes(ds, movable), beforeMovable);

        assert.deepEqual(await getTimes(ds, other), beforeOther);
      });

      /**
       * TEST 3:
       * Batch rescheduling updates multiple sessions.
       *
       * Attendance history must remain unchanged.
       */
      await t.test('successful batch updates multiple sessions', async () => {
        const attendanceBefore = await attendanceSnapshot(ds);

        const saved = await service.updateBatch({
          changes: [change(movable, 14, 15), change(other, 16, 17)],
        });

        assert.equal(saved.data.length, 2);

        // Check first updated session.
        assert.deepEqual(await getTimes(ds, movable), {
          starts_at: '2035-01-15T14:00:00.000Z',
          late_after: '2035-01-15T14:15:00.000Z',
          ends_at: '2035-01-15T15:00:00.000Z',
        });

        // Check second updated session.
        assert.deepEqual(await getTimes(ds, other), {
          starts_at: '2035-01-15T16:00:00.000Z',
          late_after: '2035-01-15T16:15:00.000Z',
          ends_at: '2035-01-15T17:00:00.000Z',
        });

        // Verify Attendance Records are untouched.
        const attendanceAfter = await attendanceSnapshot(ds);

        assert.deepEqual(
          attendanceAfter,
          attendanceBefore,
          'Attendance records must remain unchanged',
        );
      });
    } finally {
      /**
       * Clean up only sessions created by this suite.
       *
       * The parent integration runner also uses an
       * isolated, disposable MySQL container.
       */
      for (const id of [...createdIds].reverse()) {
        await ds.query('DELETE FROM class_sessions WHERE id = ?', [id]);
      }
    }
  });
}

import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import { AttendanceHistoryService } from '../dist/attendance/attendance-history.service.js';

function makeRecord({
  studentId = 3,
  sessionId = 30,
  classId = 1,
  code = 'COS30043',
  status = 'present',
  sessionState = 'scheduled',
  startsAt = '2026-10-29T01:00:00.000Z',
}: Record<string, any> = {}) {
  return {
    class_session_id: sessionId,
    student_id: studentId,
    status,
    checked_in_at:
      status === 'present' || status === 'late'
        ? new Date('2026-10-29T01:05:00.000Z')
        : null,
    classSession: {
      id: sessionId,
      state: sessionState,
      room_label: 'EN402',
      starts_at: new Date(startsAt),
      ends_at: new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000),
      class: {
        id: classId,
        section: 'A',
        term: '2026-S2',
        room_label: 'EN401',
        course: { id: classId, code, name: 'Test Course' },
        lecturer: { id: 2, name: 'Test Lecturer', email: 'secret@example.com' },
      },
    },
  };
}

// Supply repository results, without interpreting SQL or reproducing filtering.
function historyWith(records: any[] = [], total = records.length) {
  const qb: any = {};
  for (const method of [
    'innerJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
  ]) {
    qb[method] = () => qb;
  }
  qb.getCount = async () => total;
  qb.getMany = async () => records;
  return new AttendanceHistoryService({
    isInitialized: true,
    getRepository: () => ({ createQueryBuilder: () => qb }),
  } as any);
}

test('history maps database records to safe response fields', async (t) => {
  for (const status of ['present', 'late', 'absent', 'pending']) {
    await t.test(status, async () => {
      const record = makeRecord({ status });
      const result = await historyWith(
        [record],
        23,
      ).getPersonalAttendanceRecords({ studentId: 3, page: 2, limit: 20 });
      assert.deepEqual(result.meta, {
        page: 2,
        limit: 20,
        total: 23,
        totalPages: 2,
      });
      assert.equal(result.data[0].class.room_label, 'EN402');
      assert.deepEqual(result.data[0].class.lecturer, {
        id: 2,
        name: 'Test Lecturer',
      });
      assert.equal(result.data[0].class.course.code, 'COS30043');
      assert.equal(result.data[0].starts_at, '2026-10-29T01:00:00.000Z');
      assert.equal(
        result.data[0].checked_in_at,
        ['present', 'late'].includes(status)
          ? '2026-10-29T01:05:00.000Z'
          : null,
      );
      assert.equal(
        JSON.stringify(result).includes('secret@example.com'),
        false,
      );
    });
  }
});

test('history represents an empty database result', async () => {
  assert.deepEqual(
    await historyWith().getPersonalAttendanceRecords({ studentId: 3 }),
    {
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    },
  );
});

test('history fails explicitly when the database is unavailable or a query fails', async (t) => {
  await t.test('unavailable', async () => {
    await assert.rejects(
      new AttendanceHistoryService(null as any).getPersonalAttendanceRecords({
        studentId: 3,
      }),
      ServiceUnavailableException,
    );
  });
  await t.test('query failure', async () => {
    const failure = new Error('Simulated database error');
    const service = new AttendanceHistoryService({
      isInitialized: true,
      getRepository() {
        throw failure;
      },
    } as any);
    await assert.rejects(
      service.getPersonalAttendanceRecords({ studentId: 3 }),
      (error) => error === failure,
    );
  });
});

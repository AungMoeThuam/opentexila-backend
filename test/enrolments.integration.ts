import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { DataSource } from 'typeorm';
import { EnrolmentsService } from '../dist/enrolments/enrolments.service.js';
import { ApiException } from '../dist/common/api-exception.js';

export async function enrolmentsIntegration(
  t: TestContext,
  ds: DataSource,
  fixtures: any,
) {
  await t.test(
    'enrolments service interacts with real MySQL database',
    async (t) => {
      const service = new EnrolmentsService(ds);
      const classId = fixtures.class_id;

      await t.test(
        'listClasses returns real classes with course and lecturer relations',
        async () => {
          const result = await service.listClasses({ page: 1, limit: 100 });
          assert.ok(result.data.length >= 8);
          assert.equal(result.meta.page, 1);
          assert.equal(result.meta.limit, 100);
          assert.equal(result.meta.total, result.data.length);

          // Verify sorting is strictly classes.id ASC
          for (let i = 1; i < result.data.length; i++) {
            assert.ok(result.data[i].id > result.data[i - 1].id);
          }

          // Verify allowlisted response structure
          for (const cls of result.data) {
            assert.ok(cls.id > 0);
            assert.ok(cls.course.id > 0);
            assert.ok(cls.course.code);
            assert.ok(cls.course.name);
            assert.ok(cls.section);
            assert.ok(cls.term);
            assert.ok(cls.lecturer.id > 0);
            assert.ok(cls.lecturer.name);
            assert.ok(cls.room_label);
          }

          // Verify courseId filter
          const courseId = fixtures.course_id;
          const filtered = await service.listClasses({
            page: 1,
            limit: 100,
            courseId,
          });
          assert.ok(filtered.data.length > 0);
          assert.ok(filtered.data.every((c) => c.course.id === courseId));

          // Verify term filter
          const termFiltered = await service.listClasses({
            page: 1,
            limit: 100,
            term: '2026-S2',
          });
          assert.ok(termFiltered.data.length > 0);
          assert.ok(termFiltered.data.every((c) => c.term === '2026-S2'));
        },
      );

      await t.test(
        'addEnrolment inserts into MySQL and enforces constraints',
        async () => {
          // Find non-member student
          const nonMember = await ds.query(
            "SELECT id FROM users WHERE email = 'nonmember.demo@example.com'",
          );
          assert.ok(nonMember.length > 0);
          const studentId = nonMember[0].id;

          // Ensure not currently enrolled
          await ds.query(
            'DELETE FROM enrolments WHERE class_id = ? AND student_id = ?',
            [classId, studentId],
          );

          // Add enrolment
          const res = await service.addEnrolment(classId, studentId);
          assert.equal(res.data.class_id, classId);
          assert.equal(res.data.student_id, studentId);
          assert.equal(res.data.student.id, studentId);

          // Verify row exists in real MySQL table
          const rows = await ds.query(
            'SELECT * FROM enrolments WHERE class_id = ? AND student_id = ?',
            [classId, studentId],
          );
          assert.equal(rows.length, 1);

          // Attempt duplicate enrolment via service returns 409
          await assert.rejects(
            () => service.addEnrolment(classId, studentId),
            (err: any) =>
              err instanceof ApiException && err.getStatus() === 409,
          );

          // Direct insert into MySQL triggers ER_DUP_ENTRY (1062)
          await assert.rejects(
            () =>
              ds.query(
                'INSERT INTO enrolments(class_id, student_id) VALUES (?, ?)',
                [classId, studentId],
              ),
            /Duplicate entry|ER_DUP_ENTRY|1062/,
          );

          // Attempt to enrol non-student user returns 422
          const lecturer = await ds.query(
            "SELECT id FROM users WHERE email = 'lecturer.one@example.com'",
          );
          await assert.rejects(
            () => service.addEnrolment(classId, lecturer[0].id),
            (err: any) =>
              err instanceof ApiException &&
              err.getStatus() === 422 &&
              err.getResponse().error.code === 'STUDENT_NOT_ELIGIBLE',
          );

          // Attempt to enrol inactive user returns 422
          await ds.query(
            "INSERT INTO users(name, email, password_hash, role, status) VALUES ('Inactive User', 'inactive.test@example.com', 'x', 'student', 'inactive')",
          );
          const [inactiveUser] = await ds.query(
            "SELECT id FROM users WHERE email = 'inactive.test@example.com'",
          );
          await assert.rejects(
            () => service.addEnrolment(classId, inactiveUser.id),
            (err: any) =>
              err instanceof ApiException &&
              err.getStatus() === 422 &&
              err.getResponse().error.code === 'STUDENT_NOT_ELIGIBLE',
          );

          // Attempt to enrol into non-existent class returns 404
          await assert.rejects(
            () => service.addEnrolment(999999, studentId),
            (err: any) =>
              err instanceof ApiException && err.getStatus() === 404,
          );
        },
      );

      await t.test(
        'removeEnrolment deletes row and preserves historical attendance_records',
        async () => {
          // Pick Student One who has existing attendance records
          const [studentOne] = await ds.query(
            "SELECT id FROM users WHERE email = 'student.one@example.com'",
          );
          const studentId = studentOne.id;

          // Confirm student is currently enrolled
          const initialEnrolment = await ds.query(
            'SELECT * FROM enrolments WHERE class_id = ? AND student_id = ?',
            [classId, studentId],
          );
          assert.equal(initialEnrolment.length, 1);

          // Count existing attendance records for this student
          const initialRecords = await ds.query(
            `SELECT r.* FROM attendance_records r
         JOIN class_sessions s ON s.id = r.class_session_id
         WHERE s.class_id = ? AND r.student_id = ?`,
            [classId, studentId],
          );
          assert.ok(
            initialRecords.length > 0,
            'Expected student to have attendance records before removal',
          );

          // Execute removeEnrolment
          await service.removeEnrolment(classId, studentId);

          // Verify enrolment row was deleted from MySQL
          const remainingEnrolment = await ds.query(
            'SELECT * FROM enrolments WHERE class_id = ? AND student_id = ?',
            [classId, studentId],
          );
          assert.equal(
            remainingEnrolment.length,
            0,
            'Enrolment row must be removed',
          );

          // CRITICAL CHECK: Attendance records must remain completely intact
          const remainingRecords = await ds.query(
            `SELECT r.* FROM attendance_records r
         JOIN class_sessions s ON s.id = r.class_session_id
         WHERE s.class_id = ? AND r.student_id = ?`,
            [classId, studentId],
          );
          assert.equal(
            remainingRecords.length,
            initialRecords.length,
            'Historical attendance records must NOT be deleted when student is removed',
          );
          assert.deepEqual(
            remainingRecords.map((r: any) => r.status),
            initialRecords.map((r: any) => r.status),
            'Historical attendance statuses must be preserved exactly',
          );

          // Attempting to remove non-existent enrolment returns 404
          await assert.rejects(
            () => service.removeEnrolment(classId, studentId),
            (err: any) =>
              err instanceof ApiException && err.getStatus() === 404,
          );

          // Re-enrol student to leave fixture clean
          await service.addEnrolment(classId, studentId);
        },
      );
    },
  );
}

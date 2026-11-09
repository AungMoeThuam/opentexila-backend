import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { DataSource } from 'typeorm';
import { CoursesService } from '../dist/courses/courses.service.js';
import { ClassManagementService } from '../dist/courses/class-management.service.js';
import { ApiException } from '../dist/common/api-exception.js';

const rejectsWith =
  (status: number, code: string, field?: string) => (error: any) => {
    assert.ok(error instanceof ApiException, String(error));
    assert.equal(error.getStatus(), status);
    const body = error.getResponse().error;
    assert.equal(body.code, code);
    if (field) assert.ok(body.fields[field], `missing fields.${field}`);
    return true;
  };

// Rows whose history must survive class edits unchanged.
const historySnapshot = (ds: DataSource, classId: number) =>
  Promise.all([
    ds.query(
      'SELECT class_id, student_id FROM enrolments WHERE class_id = ? ORDER BY student_id',
      [classId],
    ),
    ds.query(
      `SELECT id, state, starts_at, room_label, latitude, longitude, radius_m
       FROM class_sessions WHERE class_id = ? ORDER BY id`,
      [classId],
    ),
    ds.query(
      `SELECT r.class_session_id, r.student_id, r.status, r.checked_in_at, r.distance_m
       FROM attendance_records r JOIN class_sessions s ON s.id = r.class_session_id
       WHERE s.class_id = ? ORDER BY r.class_session_id, r.student_id`,
      [classId],
    ),
  ]);

export async function coursesIntegration(
  t: TestContext,
  ds: DataSource,
  fixtures: any,
) {
  await t.test('course and class management against MySQL', async (t) => {
    const courses = new CoursesService(ds);
    const classes = new ClassManagementService(ds);
    const accountId = (email: string) =>
      fixtures.accounts.find((account: any) => account.email === email).id;
    const lecturerOne = accountId('lecturer.one@example.com');
    const lecturerTwo = accountId('lecturer.two@example.com');
    const studentOne = accountId('student.one@example.com');
    const [{ id: inactiveLecturer }] = await ds
      .query(
        `INSERT INTO users (name, email, password_hash, role, status, must_change_password)
         VALUES ('Inactive Lecturer', 'inactive.lecturer@example.com', 'x', 'lecturer', 'inactive', 0)`,
      )
      .then((result: any) => [{ id: result.insertId }]);

    let courseId = 0;
    // Later suites count the seeded rows, so remove everything created here.
    // The created classes never get sessions or enrolments.
    t.after(async () => {
      if (courseId) {
        await ds.query('DELETE FROM classes WHERE course_id = ?', [courseId]);
        await ds.query('DELETE FROM courses WHERE id = ?', [courseId]);
      }
      await ds.query('DELETE FROM users WHERE id = ?', [inactiveLecturer]);
    });
    await t.test('courses: create, search, update and conflicts', async () => {
      const created = await courses.createCourse({
        code: 'TST10001',
        name: 'Testing 100% Fundamentals',
      });
      courseId = created.data.id;
      assert.ok(courseId > 0);
      assert.deepEqual(created.data, {
        id: courseId,
        code: 'TST10001',
        name: 'Testing 100% Fundamentals',
      });

      const byCode = await courses.listCourses({
        page: 1,
        limit: 100,
        q: 'tst100',
      });
      assert.deepEqual(
        byCode.data.map((course) => course.code),
        ['TST10001'],
      );
      const byName = await courses.listCourses({
        page: 1,
        limit: 100,
        q: 'FUNDAMENTALS',
      });
      assert.deepEqual(
        byName.data.map((course) => course.id),
        [courseId],
      );
      const literal = await courses.listCourses({
        page: 1,
        limit: 100,
        q: '100%',
      });
      assert.deepEqual(
        literal.data.map((course) => course.id),
        [courseId],
      );
      const wildcard = await courses.listCourses({
        page: 1,
        limit: 100,
        q: '%',
      });
      assert.deepEqual(
        wildcard.data.map((course) => course.id),
        [courseId],
      );
      const all = await courses.listCourses({ page: 1, limit: 100 });
      const codes = all.data.map((course) => course.code);
      assert.deepEqual(codes, [...codes].sort());
      assert.equal(all.meta.total, all.data.length);

      await assert.rejects(
        () => courses.createCourse({ code: 'COS30043', name: 'Copy' }),
        rejectsWith(409, 'COURSE_CODE_TAKEN', 'code'),
      );
      await assert.rejects(
        () => courses.updateCourse(courseId, { code: 'COS30043' }),
        rejectsWith(409, 'COURSE_CODE_TAKEN', 'code'),
      );
      await assert.rejects(
        () => courses.updateCourse(4294967295, { name: 'Missing' }),
        rejectsWith(404, 'RESOURCE_NOT_FOUND'),
      );
      const renamed = await courses.updateCourse(courseId, {
        name: 'Testing Basics',
      });
      assert.deepEqual(renamed.data, {
        id: courseId,
        code: 'TST10001',
        name: 'Testing Basics',
      });
      const [stored] = await ds.query(
        'SELECT code, name FROM courses WHERE id = ?',
        [courseId],
      );
      assert.deepEqual(
        { ...stored },
        { code: 'TST10001', name: 'Testing Basics' },
      );
    });

    await t.test('lecturer options list only active lecturers', async () => {
      const result = await courses.listLecturers({ page: 1, limit: 100 });
      const ids = result.data.map((lecturer) => lecturer.id);
      assert.ok(ids.includes(lecturerOne));
      assert.ok(!ids.includes(inactiveLecturer));
      assert.ok(!ids.includes(studentOne));
      for (const option of result.data)
        assert.deepEqual(Object.keys(option).sort(), ['email', 'id', 'name']);
      const searched = await courses.listLecturers({
        page: 1,
        limit: 100,
        q: 'LECTURER.TWO',
      });
      assert.deepEqual(
        searched.data.map((lecturer) => lecturer.id),
        [lecturerTwo],
      );
    });

    let newClassId = 0;
    const newClass = () => ({
      course_id: courseId,
      term: '2027-S1',
      section: 'A',
      lecturer_id: lecturerOne,
      room_label: 'TD101',
      latitude: -37.8221,
      longitude: 145.0389,
      radius_m: 40,
    });

    await t.test('classes: create, detail and create-time rules', async () => {
      const created = await classes.createClass(newClass());
      newClassId = created.data.id;
      assert.deepEqual(created.data, {
        id: newClassId,
        course: { id: courseId, code: 'TST10001', name: 'Testing Basics' },
        term: '2027-S1',
        section: 'A',
        lecturer: { id: lecturerOne, name: 'Lecturer One' },
        room_label: 'TD101',
        latitude: '-37.822100',
        longitude: '145.038900',
        radius_m: '40.00',
        has_class_sessions: false,
      });
      assert.deepEqual((await classes.getClass(newClassId)).data, created.data);

      await assert.rejects(
        () => classes.createClass(newClass()),
        rejectsWith(409, 'CLASS_SECTION_TAKEN', 'section'),
      );
      // The unique key ignores letter case in the term.
      await assert.rejects(
        () => classes.createClass({ ...newClass(), term: '2027-s1' }),
        rejectsWith(409, 'CLASS_SECTION_TAKEN', 'section'),
      );
      for (const lecturer_id of [inactiveLecturer, studentOne, 4294967295]) {
        await assert.rejects(
          () =>
            classes.createClass({ ...newClass(), section: 'B', lecturer_id }),
          rejectsWith(422, 'LECTURER_NOT_ELIGIBLE', 'lecturer_id'),
        );
      }
      await assert.rejects(
        () =>
          classes.createClass({
            ...newClass(),
            section: 'B',
            course_id: 4294967295,
          }),
        rejectsWith(422, 'VALIDATION_ERROR', 'course_id'),
      );
      await assert.rejects(
        () => classes.getClass(4294967295),
        rejectsWith(404, 'RESOURCE_NOT_FOUND'),
      );
      const [{ count }] = await ds.query(
        'SELECT COUNT(*) AS count FROM classes WHERE course_id = ?',
        [courseId],
      );
      assert.equal(Number(count), 1);
    });

    await t.test('classes without sessions allow identity edits', async () => {
      await classes.createClass({ ...newClass(), section: 'B' });
      const moved = await classes.updateClass(newClassId, {
        section: 'C',
        term: '2027-S2',
      });
      assert.equal(moved.data.section, 'C');
      assert.equal(moved.data.term, '2027-S2');
      await assert.rejects(
        () =>
          classes.updateClass(newClassId, { section: 'B', term: '2027-S1' }),
        rejectsWith(409, 'CLASS_SECTION_TAKEN', 'section'),
      );
      await assert.rejects(
        () =>
          classes.updateClass(newClassId, { lecturer_id: inactiveLecturer }),
        rejectsWith(422, 'LECTURER_NOT_ELIGIBLE', 'lecturer_id'),
      );
      await assert.rejects(
        () => classes.updateClass(4294967295, { room_label: 'X' }),
        rejectsWith(404, 'RESOURCE_NOT_FOUND'),
      );
      await assert.rejects(
        () => classes.updateClass(newClassId, {}),
        rejectsWith(422, 'VALIDATION_ERROR'),
      );
    });

    await t.test(
      'classes with sessions: identity frozen, venue and lecturer editable, history kept',
      async () => {
        const classId = fixtures.class_id;
        const [original] = await ds.query(
          'SELECT course_id, term, section, lecturer_id, room_label, latitude, longitude, radius_m FROM classes WHERE id = ?',
          [classId],
        );
        const before = await historySnapshot(ds, classId);
        assert.ok(before[1].length > 0, 'fixture class must have sessions');
        assert.equal(
          (await classes.getClass(classId)).data.has_class_sessions,
          true,
        );

        await assert.rejects(
          () =>
            classes.updateClass(classId, {
              term: 'OTHER',
              course_id: courseId,
            }),
          (error: any) => {
            rejectsWith(409, 'CLASS_HAS_SESSIONS')(error);
            assert.deepEqual(
              Object.keys(error.getResponse().error.fields).sort(),
              ['course_id', 'term'],
            );
            return true;
          },
        );

        const otherLecturer =
          original.lecturer_id === lecturerTwo ? lecturerOne : lecturerTwo;
        const updated = await classes.updateClass(classId, {
          course_id: original.course_id,
          term: original.term,
          section: original.section,
          lecturer_id: otherLecturer,
          room_label: 'Moved Room',
          latitude: 1.5,
          longitude: 2.25,
          radius_m: 999.99,
        });
        assert.equal(updated.data.lecturer.id, otherLecturer);
        assert.equal(updated.data.room_label, 'Moved Room');
        assert.equal(updated.data.latitude, '1.500000');
        assert.equal(updated.data.radius_m, '999.99');
        assert.deepEqual(await historySnapshot(ds, classId), before);

        await ds.query(
          `UPDATE classes SET lecturer_id = ?, room_label = ?, latitude = ?, longitude = ?, radius_m = ?
         WHERE id = ?`,
          [
            original.lecturer_id,
            original.room_label,
            original.latitude,
            original.longitude,
            original.radius_m,
            classId,
          ],
        );
      },
    );

    await t.test(
      'class edits wait for a check-in holding the class lock',
      async () => {
        // Check-ins lock the class row first (lockClassSession); hold the same lock.
        const checkIn = ds.createQueryRunner();
        await checkIn.connect();
        await checkIn.startTransaction();
        let settled = false;
        try {
          await checkIn.query(
            'SELECT id FROM classes WHERE id = ? FOR UPDATE',
            [newClassId],
          );
          const edit = classes
            .updateClass(newClassId, { room_label: 'After check-in' })
            .finally(() => {
              settled = true;
            });
          await delay(300);
          assert.equal(
            settled,
            false,
            'edit must wait for the check-in to finish',
          );
          const [during] = await checkIn.query(
            'SELECT room_label FROM classes WHERE id = ?',
            [newClassId],
          );
          assert.equal(during.room_label, 'TD101');
          await checkIn.commitTransaction();
          const result = await edit;
          assert.equal(result.data.room_label, 'After check-in');
        } finally {
          if (checkIn.isTransactionActive) await checkIn.rollbackTransaction();
          await checkIn.release();
        }
      },
    );
  });
}

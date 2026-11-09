import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';

test('enrolments management HTTP validation, permissions, CSRF and operations', async (t) => {
  const calls: any[] = [];
  const mockClassRows: any[] = [
    {
      id: 1,
      section: 'A',
      term: '2026-S2',
      room_label: 'EN402',
      course: { id: 1, code: 'COS30043', name: 'Interface Design' },
      lecturer: { id: 2, name: 'Lecturer One' },
    },
    {
      id: 2,
      section: 'B',
      term: '2026-S2',
      room_label: 'EN305',
      course: { id: 2, code: 'SWE30003', name: 'Software Arch' },
      lecturer: { id: 5, name: 'Lecturer Two' },
    },
  ];

  const classBuilder: any = {};
  for (const method of [
    'innerJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'skip',
    'take',
  ]) {
    classBuilder[method] = (...args: any[]) => {
      calls.push([method, ...args]);
      return classBuilder;
    };
  }
  classBuilder.getManyAndCount = async () => [
    mockClassRows,
    mockClassRows.length,
  ];

  let existingClass: any = { id: 1 };
  let targetUser: any = {
    id: 3,
    name: 'Student One',
    email: 'student.one@example.com',
    role: 'student',
    status: 'active',
  };
  let existingEnrolment: any = null;
  let insertedEnrolment: any = null;
  let deletedEnrolment: any = null;

  const app = await startAttendanceApp({
    ClassSession: {},
    AttendanceRecord: {},
    Class: {
      createQueryBuilder: () => classBuilder,
      findOneBy: async (criteria: any) =>
        criteria.id === existingClass?.id ? existingClass : null,
    },
    User: {
      findOneBy: async (criteria: any) => {
        if (criteria.id === app.state.user.id) return app.state.user;
        if (criteria.id === targetUser?.id) return targetUser;
        return null;
      },
    },
    Enrolment: {
      findOneBy: async (criteria: any) =>
        existingEnrolment &&
        criteria.class_id === existingEnrolment.class_id &&
        criteria.student_id === existingEnrolment.student_id
          ? existingEnrolment
          : null,
      insert: async (data: any) => {
        insertedEnrolment = data;
      },
      delete: async (criteria: any) => {
        deletedEnrolment = criteria;
      },
    },
  });
  t.after(() => app.close());

  // Set default caller to admin
  app.state.user = {
    id: 1,
    role: 'admin',
    status: 'active',
    session_version: 0,
    must_change_password: false,
  };

  const csrfHeader = { 'x-csrf-token': 'fixture-token' };

  await t.test(
    'GET /api/v1/classes - admin can list classes with filters and pagination',
    async () => {
      calls.length = 0;
      const response = await fetch(
        `${app.base}/classes?page=1&limit=10&courseId=1&term=2026-S2`,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.equal(body.data.length, 2);
      assert.deepEqual(body.data[0], {
        id: 1,
        course: { id: 1, code: 'COS30043', name: 'Interface Design' },
        section: 'A',
        term: '2026-S2',
        lecturer: { id: 2, name: 'Lecturer One' },
        room_label: 'EN402',
      });
      assert.deepEqual(body.meta, {
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      assert.ok(
        calls.some(
          (c) => c[0] === 'orderBy' && c[1] === 'class.id' && c[2] === 'ASC',
        ),
      );
      assert.ok(
        calls.some(
          (c) =>
            c[0] === 'andWhere' &&
            c[1].includes('course_id') &&
            c[2].courseId === 1,
        ),
      );
      assert.ok(
        calls.some(
          (c) =>
            c[0] === 'andWhere' &&
            c[1].includes('term') &&
            c[2].term === '2026-S2',
        ),
      );
    },
  );

  await t.test('GET /api/v1/classes - permissions and validation', async () => {
    // Student receives 403
    app.state.user.role = 'student';
    let res = await fetch(`${app.base}/classes`);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'FORBIDDEN');

    // Lecturer receives 403
    app.state.user.role = 'lecturer';
    res = await fetch(`${app.base}/classes`);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'FORBIDDEN');

    // Unauthenticated receives 401
    app.state.signedIn = false;
    res = await fetch(`${app.base}/classes`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, 'UNAUTHENTICATED');

    // Restore admin
    app.state.signedIn = true;
    app.state.user.role = 'admin';

    // Invalid parameters return 422
    for (const query of [
      'page=0',
      'page=10001',
      'limit=0',
      'limit=101',
      'courseId=0',
      'courseId=bad',
      'term=',
      'term=%20',
      'term=' + 'x'.repeat(51),
    ]) {
      res = await fetch(`${app.base}/classes?${query}`);
      assert.equal(res.status, 422, query);
      assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
    }
  });

  await t.test(
    'POST /api/v1/classes/:classId/enrolments - successful enrolment',
    async () => {
      insertedEnrolment = null;
      existingEnrolment = null;
      targetUser = {
        id: 3,
        name: 'Student One',
        email: 'student.one@example.com',
        role: 'student',
        status: 'active',
      };
      existingClass = { id: 1 };

      const res = await fetch(`${app.base}/classes/1/enrolments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeader },
        body: JSON.stringify({ student_id: 3 }),
      });

      assert.equal(res.status, 201);
      const body = await res.json();
      assert.deepEqual(body, {
        data: {
          class_id: 1,
          student_id: 3,
          student: {
            id: 3,
            name: 'Student One',
            email: 'student.one@example.com',
          },
        },
      });
      assert.deepEqual(insertedEnrolment, { class_id: 1, student_id: 3 });
    },
  );

  await t.test(
    'POST /api/v1/classes/:classId/enrolments - duplicate enrolment returns 409',
    async () => {
      existingEnrolment = { class_id: 1, student_id: 3 };

      const res = await fetch(`${app.base}/classes/1/enrolments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeader },
        body: JSON.stringify({ student_id: 3 }),
      });

      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.error.code, 'ENROLMENT_ALREADY_EXISTS');
      assert.equal(
        body.error.message,
        'This student is already enrolled in the selected class.',
      );
    },
  );

  await t.test(
    'POST /api/v1/classes/:classId/enrolments - ineligible student returns 422',
    async () => {
      existingEnrolment = null;

      // Inactive student
      targetUser = {
        id: 4,
        name: 'Inactive Student',
        email: 'inactive@example.com',
        role: 'student',
        status: 'inactive',
      };
      let res = await fetch(`${app.base}/classes/1/enrolments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeader },
        body: JSON.stringify({ student_id: 4 }),
      });
      assert.equal(res.status, 422);
      let body = await res.json();
      assert.equal(body.error.code, 'STUDENT_NOT_ELIGIBLE');
      assert.equal(
        body.error.fields.student_id,
        'Selected account must be an active student.',
      );

      // Lecturer account (not student role)
      targetUser = {
        id: 5,
        name: 'Lecturer User',
        email: 'lecturer@example.com',
        role: 'lecturer',
        status: 'active',
      };
      res = await fetch(`${app.base}/classes/1/enrolments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeader },
        body: JSON.stringify({ student_id: 5 }),
      });
      assert.equal(res.status, 422);
      body = await res.json();
      assert.equal(body.error.code, 'STUDENT_NOT_ELIGIBLE');
    },
  );

  await t.test(
    'POST /api/v1/classes/:classId/enrolments - missing class or user returns 404',
    async () => {
      // Missing class
      existingClass = null;
      targetUser = { id: 3, role: 'student', status: 'active' };
      let res = await fetch(`${app.base}/classes/999/enrolments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeader },
        body: JSON.stringify({ student_id: 3 }),
      });
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error.code, 'RESOURCE_NOT_FOUND');

      // Missing user
      existingClass = { id: 1 };
      targetUser = null;
      res = await fetch(`${app.base}/classes/1/enrolments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeader },
        body: JSON.stringify({ student_id: 999 }),
      });
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error.code, 'RESOURCE_NOT_FOUND');
    },
  );

  await t.test(
    'POST /api/v1/classes/:classId/enrolments - validation, CSRF and permissions',
    async () => {
      existingClass = { id: 1 };
      targetUser = { id: 3, role: 'student', status: 'active' };

      // Missing CSRF token returns 403
      let res = await fetch(`${app.base}/classes/1/enrolments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: 3 }),
      });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error.code, 'CSRF_INVALID');

      // Invalid CSRF token returns 403
      res = await fetch(`${app.base}/classes/1/enrolments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': 'wrong-token',
        },
        body: JSON.stringify({ student_id: 3 }),
      });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error.code, 'CSRF_INVALID');

      // Non-admin receives 403
      app.state.user.role = 'lecturer';
      res = await fetch(`${app.base}/classes/1/enrolments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeader },
        body: JSON.stringify({ student_id: 3 }),
      });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error.code, 'FORBIDDEN');
      app.state.user.role = 'admin';

      // Invalid classId or student_id returns 422
      for (const [classId, student_id] of [
        ['0', 3],
        ['bad', 3],
        ['1', 0],
        ['1', -1],
        ['1', 1.5],
        ['1', 'bad'],
      ]) {
        res = await fetch(`${app.base}/classes/${classId}/enrolments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...csrfHeader },
          body: JSON.stringify({ student_id }),
        });
        assert.equal(res.status, 422);
        assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
      }
    },
  );

  await t.test(
    'DELETE /api/v1/classes/:classId/enrolments/:studentId - successful deletion',
    async () => {
      existingClass = { id: 1 };
      existingEnrolment = { class_id: 1, student_id: 3 };
      deletedEnrolment = null;

      const res = await fetch(`${app.base}/classes/1/enrolments/3`, {
        method: 'DELETE',
        headers: csrfHeader,
      });

      assert.equal(res.status, 204);
      assert.equal(await res.text(), '');
      assert.deepEqual(deletedEnrolment, { class_id: 1, student_id: 3 });
    },
  );

  await t.test(
    'DELETE /api/v1/classes/:classId/enrolments/:studentId - missing class or enrolment returns 404',
    async () => {
      // Missing class
      existingClass = null;
      let res = await fetch(`${app.base}/classes/999/enrolments/3`, {
        method: 'DELETE',
        headers: csrfHeader,
      });
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error.code, 'RESOURCE_NOT_FOUND');

      // Missing enrolment
      existingClass = { id: 1 };
      existingEnrolment = null;
      res = await fetch(`${app.base}/classes/1/enrolments/3`, {
        method: 'DELETE',
        headers: csrfHeader,
      });
      assert.equal(res.status, 404);
      assert.equal((await res.json()).error.code, 'RESOURCE_NOT_FOUND');
    },
  );

  await t.test(
    'DELETE /api/v1/classes/:classId/enrolments/:studentId - validation, CSRF and permissions',
    async () => {
      existingClass = { id: 1 };
      existingEnrolment = { class_id: 1, student_id: 3 };

      // Missing CSRF returns 403
      let res = await fetch(`${app.base}/classes/1/enrolments/3`, {
        method: 'DELETE',
      });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error.code, 'CSRF_INVALID');

      // Non-admin receives 403
      app.state.user.role = 'student';
      res = await fetch(`${app.base}/classes/1/enrolments/3`, {
        method: 'DELETE',
        headers: csrfHeader,
      });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error.code, 'FORBIDDEN');
      app.state.user.role = 'admin';

      // Invalid parameters return 422
      for (const [classId, studentId] of [
        ['0', '3'],
        ['bad', '3'],
        ['1', '0'],
        ['1', 'bad'],
        ['1', '1.5'],
      ]) {
        res = await fetch(
          `${app.base}/classes/${classId}/enrolments/${studentId}`,
          {
            method: 'DELETE',
            headers: csrfHeader,
          },
        );
        assert.equal(res.status, 422);
        assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
      }
    },
  );
});

require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BadRequestException, NotFoundException } = require('@nestjs/common');
const { PATH_METADATA } = require('@nestjs/common/constants');
const {
  ClassroomsController,
} = require('../dist/classrooms/classrooms.controller');
const { ClassroomsService } = require('../dist/classrooms/classrooms.service');
const { DEMO_CLASSES } = require('../dist/classrooms/demo-classes.data');

test('ClassroomsController routes and metadata', () => {
  const paths = Reflect.getMetadata(PATH_METADATA, ClassroomsController);
  assert.deepEqual(paths, [
    'classes',
    'demo/classes',
    'classrooms',
    'demo/classrooms',
  ]);
});

test('ClassroomsService returns demo classes when database is not connected', async (t) => {
  const service = new ClassroomsService(null);

  await t.test(
    'list returns all active demo classes with pagination meta',
    async () => {
      const result = await service.list({ page: 1, limit: 20 });
      assert.equal(result.data.length, DEMO_CLASSES.length);
      assert.equal(result.meta.page, 1);
      assert.equal(result.meta.limit, 20);
      assert.equal(result.meta.total, DEMO_CLASSES.length);
      assert.equal(result.meta.totalPages, 1);

      // Verify first demo class structure and field cleanliness
      const first = result.data[0];
      assert.equal(first.id, 1);
      assert.equal(first.code, 'COS30043-DEMO');
      assert.equal(first.name, 'Interface Design · Demo');
      assert.equal(first.subject, 'Interface Design and Development');
      assert.equal(first.term, 'DEMO');
      assert.equal(first.room_label, 'Demo room (synthetic location)');
      assert.equal(first.teacher.name, 'Lecturer Demo');
      assert.equal(first.teacher.role, 'teacher');
      assert.equal(first.teacher.password_hash, undefined);
      assert.equal(first.teacher.session_version, undefined);
    },
  );

  await t.test('list handles custom pagination', async () => {
    const result = await service.list({ page: 2, limit: 2 });
    assert.equal(result.data.length, 2);
    assert.equal(result.data[0].id, 3);
    assert.equal(result.data[1].id, 4);
    assert.equal(result.meta.page, 2);
    assert.equal(result.meta.limit, 2);
    assert.equal(result.meta.total, 4);
    assert.equal(result.meta.totalPages, 2);
  });

  await t.test(
    'list filters by search keyword across name, code, subject, and room',
    async () => {
      const byCode = await service.list({ search: 'COS30043' });
      assert.equal(byCode.data.length, 1);
      assert.equal(byCode.data[0].code, 'COS30043-DEMO');

      const bySubject = await service.list({ search: 'Software Engineering' });
      assert.equal(bySubject.data.length, 1);
      assert.equal(bySubject.data[0].code, 'SWE30009-DEMO');

      const byRoom = await service.list({ search: 'LH-01' });
      assert.equal(byRoom.data.length, 1);
      assert.equal(byRoom.data[0].code, 'COS10009-DEMO');

      const noMatch = await service.list({ search: 'NonExistentXYZ' });
      assert.equal(noMatch.data.length, 0);
      assert.equal(noMatch.meta.total, 0);
      assert.equal(noMatch.meta.totalPages, 0);
    },
  );

  await t.test('list filters by term and teacher_id', async () => {
    const byTerm = await service.list({ term: 'DEMO' });
    assert.equal(byTerm.data.length, 4);

    const byOtherTerm = await service.list({ term: '2025-SEM2' });
    assert.equal(byOtherTerm.data.length, 0);

    const byTeacher = await service.list({ teacher_id: 3 });
    assert.equal(byTeacher.data.length, 1);
    assert.equal(byTeacher.data[0].code, 'COS10009-DEMO');
  });

  await t.test('findOne retrieves a single class by id', async () => {
    const result = await service.findOne(1);
    assert.equal(result.data.id, 1);
    assert.equal(result.data.code, 'COS30043-DEMO');
    assert.equal(result.data.teacher.name, 'Lecturer Demo');
  });

  await t.test(
    'findOne throws NotFoundException for nonexistent id',
    async () => {
      await assert.rejects(
        () => service.findOne(999),
        (err) =>
          err instanceof NotFoundException &&
          err.message === 'Class not found.',
      );
    },
  );

  await t.test(
    'findMeetings returns timetable meetings for class',
    async () => {
      const result = await service.findMeetings(1, { page: 1, limit: 10 });
      assert.equal(result.data.length, 2);
      assert.equal(result.data[0].classroom_id, 1);
      assert.equal(result.meta.total, 2);
    },
  );

  await t.test(
    'findMeetings throws NotFoundException for nonexistent class',
    async () => {
      await assert.rejects(
        () => service.findMeetings(999),
        (err) => err instanceof NotFoundException,
      );
    },
  );
});

test('ClassroomsController validates input parameters', async (t) => {
  const service = new ClassroomsService(null);
  const controller = new ClassroomsController(service);

  await t.test('list accepts valid page and limit', async () => {
    const result = await controller.list({ page: '1', limit: '10' });
    assert.equal(result.data.length, 4);
    assert.equal(result.meta.page, 1);
    assert.equal(result.meta.limit, 10);
  });

  await t.test(
    'list rejects invalid page values with BadRequestException',
    () => {
      for (const badPage of ['0', '-1', '1.5', '10001', 'abc', '']) {
        assert.throws(
          () => controller.list({ page: badPage }),
          (err) =>
            err instanceof BadRequestException &&
            err.message.includes(
              'page must be an integer between 1 and 10000.',
            ),
        );
      }
    },
  );

  await t.test(
    'list rejects invalid limit values with BadRequestException',
    () => {
      for (const badLimit of ['0', '-1', '1.5', '101', 'abc', '']) {
        assert.throws(
          () => controller.list({ limit: badLimit }),
          (err) =>
            err instanceof BadRequestException &&
            err.message.includes('limit must be an integer between 1 and 100.'),
        );
      }
    },
  );

  await t.test('findOne accepts valid id and rejects invalid id', async () => {
    const valid = await controller.findOne('1');
    assert.equal(valid.data.id, 1);

    for (const badId of ['0', '-1', '1.5', '4294967296', 'abc', '']) {
      assert.throws(
        () => controller.findOne(badId),
        (err) =>
          err instanceof BadRequestException &&
          err.message.includes(
            'id must be an integer between 1 and 4294967295.',
          ),
      );
    }
  });

  await t.test(
    'findMeetings accepts valid id and returns meetings',
    async () => {
      const result = await controller.findMeetings('1', {
        page: '1',
        limit: '10',
      });
      assert.equal(result.data.length, 2);
      assert.equal(result.meta.total, 2);
    },
  );
});

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { DataSource } from 'typeorm';
import { AnnouncementAccessService } from '../dist/announcements/announcement-access.service.js';
import { AnnouncementsService } from '../dist/announcements/announcements.service.js';
import { ApiException } from '../dist/common/api-exception.js';

const notFound = (error: any) => {
  assert.ok(error instanceof ApiException, String(error));
  assert.equal(error.getStatus(), 404);
  assert.equal(error.getResponse().error.code, 'RESOURCE_NOT_FOUND');
  return true;
};

export async function announcementsIntegration(t: TestContext, ds: DataSource) {
  await t.test('announcement reading against MySQL', async (t) => {
    const service = new AnnouncementsService(
      ds,
      new AnnouncementAccessService(ds),
    );

    // Use an isolated class, so the seeded announcements do not change the
    // expected feed. People come from the seeded accounts.
    const accountId = async (email: string): Promise<number> => {
      const [row] = await ds.query('SELECT id FROM users WHERE email = ?', [
        email,
      ]);
      return Number(row.id);
    };
    const lecturerId = await accountId('lecturer.one@example.com');
    const studentId = await accountId('student.one@example.com');
    const outsiderId = await accountId('student.two@example.com');
    const otherLecturerId = await accountId('lecturer.two@example.com');
    const adminId = await accountId('admin.demo@example.com');
    const [{ id: courseId }] = await ds.query(
      'SELECT id FROM courses ORDER BY id LIMIT 1',
    );
    const classResult: any = await ds.query(
      `INSERT INTO classes (course_id, section, term, lecturer_id, room_label, latitude, longitude, radius_m)
       VALUES (?, 'ZZTEST', '2099-TEST', ?, 'Test room', 1, 1, 50)`,
      [courseId, lecturerId],
    );
    const classId = Number(classResult.insertId);
    await ds.query(
      'INSERT INTO enrolments (class_id, student_id) VALUES (?, ?)',
      [classId, studentId],
    );
    // A seeded class that this student is not enrolled in.
    const [{ id: otherClassId }] = await ds.query(
      `SELECT id FROM classes WHERE id <> ? AND id NOT IN
         (SELECT class_id FROM enrolments WHERE student_id = ?) ORDER BY id LIMIT 1`,
      [classId, studentId],
    );
    const student = { id: Number(studentId), role: 'student' as const };
    const lecturer = { id: Number(lecturerId), role: 'lecturer' as const };
    const admin = { id: Number(adminId), role: 'admin' as const };

    const created: number[] = [];
    const insertPost = async (
      cls: number,
      category: string,
      title: string,
      body: string,
      at: string,
    ): Promise<number> => {
      const result: any = await ds.query(
        `INSERT INTO announcements (class_id, author_id, category, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [cls, lecturerId, category, title, body, at, at],
      );
      created.push(result.insertId);
      return result.insertId;
    };
    // Later suites count the seeded rows. Deleting the posts removes their
    // likes and comments too.
    t.after(async () => {
      if (created.length)
        await ds.query('DELETE FROM announcements WHERE id IN (?)', [created]);
      await ds.query('DELETE FROM enrolments WHERE class_id = ?', [classId]);
      await ds.query('DELETE FROM classes WHERE id = ?', [classId]);
    });

    const a = await insertPost(
      classId,
      'general',
      'Welcome week',
      'Hello everyone.',
      '2026-01-01 10:00:00.000',
    );
    const b = await insertPost(
      classId,
      'reminder',
      'Bring laptops',
      'Bring your laptop to the lab.',
      '2026-01-02 10:00:00.000',
    );
    const c = await insertPost(
      classId,
      'exam',
      'Midterm',
      'The midterm covers 100% of weeks 1 to 6.',
      '2026-01-03 10:00:00.000',
    );
    const d = await insertPost(
      classId,
      'class_change',
      'Room change',
      'Moved to EN305.',
      '2026-01-04 10:00:00.000',
    );
    const elsewhere = await insertPost(
      otherClassId,
      'general',
      'Other class',
      'Not for this class.',
      '2026-01-05 10:00:00.000',
    );
    await ds.query(
      'INSERT INTO announcement_likes (announcement_id, user_id) VALUES (?, ?), (?, ?), (?, ?)',
      [b, studentId, b, lecturerId, c, lecturerId],
    );
    await ds.query(
      'INSERT INTO announcement_comments (announcement_id, author_id, body) VALUES (?, ?, ?), (?, ?, ?)',
      [b, studentId, 'Thanks.', b, lecturerId, 'See you there.'],
    );

    const ids = (page: { data: { id: number }[] }) =>
      page.data.map((post) => post.id);
    const feed = (user: any, query: Record<string, unknown> = {}) =>
      service.list(user, classId, {
        page: 1,
        limit: 100,
        sort: 'newest',
        ...query,
      } as any);

    await t.test('the feed shows only this class, newest first', async () => {
      const page = await feed(student);
      assert.deepEqual(ids(page), [d, c, b, a]);
      // The class summary says which class the feed belongs to.
      assert.equal(page.context.class.id, classId);
      assert.equal(page.context.class.section, 'ZZTEST');
      assert.equal(page.context.class.term, '2099-TEST');
      assert.ok(page.context.class.course.code);
      assert.equal(page.context.class.lecturer.id, lecturerId);
      assert.equal(ids(page).includes(elsewhere), false);
      assert.deepEqual(page.meta, {
        page: 1,
        limit: 100,
        total: 4,
        totalPages: 1,
      });
      assert.deepEqual(Object.keys(page.data[0]).sort(), [
        'author',
        'body',
        'category',
        'class',
        'class_id',
        'comment_count',
        'created_at',
        'id',
        'like_count',
        'liked_by_me',
        'title',
        'updated_at',
      ]);
      assert.equal(page.data[0].created_at, '2026-01-04T10:00:00.000Z');
      assert.equal(page.data[0].author.id, Number(lecturerId));
    });

    await t.test('sort options and paging are stable', async () => {
      assert.deepEqual(ids(await feed(student, { sort: 'oldest' })), [
        a,
        b,
        c,
        d,
      ]);
      // b has 2 likes, c has 1, then the rest by newest.
      assert.deepEqual(ids(await feed(student, { sort: 'most_liked' })), [
        b,
        c,
        d,
        a,
      ]);
      const second = await feed(student, { limit: 2, page: 2 });
      assert.deepEqual(ids(second), [b, a]);
      assert.deepEqual(second.meta, {
        page: 2,
        limit: 2,
        total: 4,
        totalPages: 2,
      });
      assert.deepEqual((await feed(student, { limit: 2, page: 3 })).data, []);
    });

    await t.test(
      'counts and liked_by_me match the like and comment rows',
      async () => {
        const post = (await feed(student)).data.find((p) => p.id === b)!;
        assert.equal(post.like_count, 2);
        assert.equal(post.comment_count, 2);
        assert.equal(post.liked_by_me, true);
        const none = (await feed(student)).data.find((p) => p.id === a)!;
        assert.deepEqual(
          [none.like_count, none.comment_count, none.liked_by_me],
          [0, 0, false],
        );
        const likedByLecturer = (await feed(lecturer)).data.find(
          (p) => p.id === c,
        )!;
        assert.equal(likedByLecturer.liked_by_me, true);
        // The other student has no like of their own on b.
        const outsiderView = await service.get(
          { id: Number(outsiderId), role: 'admin' },
          b,
        );
        assert.equal(outsiderView.data.like_count, 2);
        assert.equal(
          (await feed(admin)).data.find((p) => p.id === b)!.liked_by_me,
          false,
        );
      },
    );

    await t.test(
      'search is case-insensitive and treats % and _ literally',
      async () => {
        assert.deepEqual(ids(await feed(student, { search: 'LAPTOP' })), [b]);
        assert.deepEqual(ids(await feed(student, { search: 'midterm' })), [c]);
        assert.deepEqual(ids(await feed(student, { search: 'EN305' })), [d]);
        // Only post c contains a literal "%".
        assert.deepEqual(ids(await feed(student, { search: '%' })), [c]);
        assert.deepEqual(ids(await feed(student, { search: '_' })), []);
        assert.deepEqual(
          ids(await feed(student, { search: 'no such text' })),
          [],
        );
        assert.deepEqual(ids(await feed(student, { category: 'exam' })), [c]);
        assert.deepEqual(
          ids(await feed(student, { category: 'general', search: 'hello' })),
          [a],
        );
        assert.deepEqual(
          ids(await feed(student, { category: 'exam', search: 'laptop' })),
          [],
        );
      },
    );

    await t.test(
      'only the class lecturer, enrolled students and admins can read',
      async () => {
        for (const user of [student, lecturer, admin])
          assert.equal((await feed(user)).data.length, 4);
        for (const user of [
          { id: Number(outsiderId), role: 'student' as const },
          { id: Number(otherLecturerId), role: 'lecturer' as const },
        ]) {
          await assert.rejects(feed(user), notFound);
          await assert.rejects(service.get(user, b), notFound);
        }
        await assert.rejects(
          service.list(admin, 4294967295, {
            page: 1,
            limit: 20,
            sort: 'newest',
          } as any),
          notFound,
        );
      },
    );

    await t.test('get returns one announcement or 404', async () => {
      const post = await service.get(student, b);
      assert.equal(post.data.id, b);
      assert.equal(post.data.title, 'Bring laptops');
      assert.equal(post.data.like_count, 2);
      await assert.rejects(service.get(student, 4294967295), notFound);
      // A post of another class is hidden from this class's student.
      await assert.rejects(service.get(student, elsewhere), notFound);
      assert.equal((await service.get(admin, elsewhere)).data.id, elsewhere);
    });

    const allList = (user: any, query: Record<string, unknown> = {}) =>
      service.listAll(user, {
        page: 1,
        limit: 100,
        sort: 'newest',
        ...query,
      } as any);

    await t.test(
      'the all-classes list is limited to the caller classes',
      async () => {
        const classSet = async (sql: string, id: number) =>
          new Set<number>(
            (await ds.query(sql, [id])).map((row: any) => Number(row.id)),
          );
        const enrolled = await classSet(
          'SELECT class_id AS id FROM enrolments WHERE student_id = ?',
          studentId,
        );
        const taught = await classSet(
          'SELECT id FROM classes WHERE lecturer_id = ?',
          lecturerId,
        );
        const countIn = async (classes: Set<number>) => {
          const [{ total }] = await ds.query(
            'SELECT COUNT(*) AS total FROM announcements WHERE class_id IN (?)',
            [[...classes]],
          );
          return Number(total);
        };

        const forStudent = await allList(student);
        assert.ok(forStudent.data.length > 4, 'seeded posts and test posts');
        assert.ok(forStudent.data.every((post) => enrolled.has(post.class_id)));
        assert.equal(forStudent.meta.total, await countIn(enrolled));
        assert.ok(forStudent.data.some((post) => post.class_id === classId));

        const forLecturer = await allList(lecturer);
        assert.ok(forLecturer.data.every((post) => taught.has(post.class_id)));
        assert.equal(forLecturer.meta.total, await countIn(taught));

        const [{ every }] = await ds.query(
          'SELECT COUNT(*) AS every FROM announcements',
        );
        assert.equal((await allList(admin)).meta.total, Number(every));
        // A student who is not in this class sees none of its posts.
        const outsider = { id: Number(outsiderId), role: 'student' as const };
        assert.equal(
          (await allList(outsider)).data.some(
            (post) => post.class_id === classId,
          ),
          false,
        );
      },
    );

    await t.test(
      'the all-classes list filters, sorts and labels posts',
      async () => {
        const onlyClass = await allList(student, { classId });
        assert.deepEqual(ids(onlyClass), [d, c, b, a]);
        const [course] = await ds.query(
          'SELECT c.id, c.code, c.name FROM courses c JOIN classes k ON k.course_id = c.id WHERE k.id = ?',
          [classId],
        );
        assert.deepEqual(onlyClass.data[0].class, {
          id: classId,
          course: {
            id: Number(course.id),
            code: course.code,
            name: course.name,
          },
          section: 'ZZTEST',
          term: '2099-TEST',
        });
        assert.deepEqual(
          ids(await allList(student, { classId, sort: 'most_liked' })),
          [b, c, d, a],
        );
        assert.deepEqual(
          ids(await allList(student, { classId, category: 'exam' })),
          [c],
        );
        // Text that only the test posts contain, searched across every class.
        assert.deepEqual(
          ids(await allList(student, { search: 'BRING YOUR LAPTOP' })),
          [b],
        );
        // `%` is literal: every match contains one, and it is not "match all".
        const percent = await allList(student, { search: '%' });
        assert.ok(ids(percent).includes(c));
        assert.ok(
          percent.data.every((post) => (post.title + post.body).includes('%')),
        );
        assert.ok(percent.meta.total < (await allList(student)).meta.total);
        const paged = await allList(student, { classId, limit: 2, page: 2 });
        assert.deepEqual(ids(paged), [b, a]);
        assert.deepEqual(paged.meta, {
          page: 2,
          limit: 2,
          total: 4,
          totalPages: 2,
        });
        // Most liked puts the highest like counts first across all classes.
        const liked = (await allList(student, { sort: 'most_liked' })).data.map(
          (post) => post.like_count,
        );
        assert.deepEqual(
          liked,
          [...liked].sort((x, y) => y - x),
        );
        // Posts of different classes carry their own class label.
        const labels = new Set(
          (await allList(student)).data.map((post) => post.class.id),
        );
        assert.ok(labels.size > 1);
        assert.ok(
          ids(await allList(admin, { classId: otherClassId })).includes(
            elsewhere,
          ),
        );
      },
    );

    await t.test(
      'the all-classes list hides classes the caller cannot see',
      async () => {
        await assert.rejects(
          allList(
            { id: Number(outsiderId), role: 'student' as const },
            { classId },
          ),
          notFound,
        );
        await assert.rejects(
          allList(
            { id: Number(otherLecturerId), role: 'lecturer' as const },
            { classId },
          ),
          notFound,
        );
        await assert.rejects(allList(admin, { classId: 4294967295 }), notFound);
      },
    );

    await t.test(
      'deleting an announcement removes its likes and comments',
      async () => {
        await ds.query('DELETE FROM announcements WHERE id = ?', [b]);
        const [{ likes }] = await ds.query(
          'SELECT COUNT(*) AS likes FROM announcement_likes WHERE announcement_id = ?',
          [b],
        );
        const [{ comments }] = await ds.query(
          'SELECT COUNT(*) AS comments FROM announcement_comments WHERE announcement_id = ?',
          [b],
        );
        assert.deepEqual([Number(likes), Number(comments)], [0, 0]);
      },
    );

    await t.test('the database rejects bad rows', async () => {
      await assert.rejects(
        ds.query(
          `INSERT INTO announcements (class_id, author_id, category, title, body) VALUES (?, ?, 'general', '   ', 'x')`,
          [classId, lecturerId],
        ),
      );
      await assert.rejects(
        ds.query(
          `INSERT INTO announcements (class_id, author_id, category, title, body) VALUES (?, ?, 'news', 'T', 'x')`,
          [classId, lecturerId],
        ),
      );
      await assert.rejects(
        ds.query(
          'INSERT INTO announcement_likes (announcement_id, user_id) VALUES (?, ?), (?, ?)',
          [c, lecturerId, c, lecturerId],
        ),
        /Duplicate entry/,
      );
    });
  });
}

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { DataSource } from 'typeorm';
import { AnnouncementAccessService } from '../dist/announcements/announcement-access.service.js';
import { AnnouncementEngagementService } from '../dist/announcements/announcement-engagement.service.js';
import { AnnouncementsService } from '../dist/announcements/announcements.service.js';
import { ApiException } from '../dist/common/api-exception.js';

const notFound = (error: any) => {
  assert.ok(error instanceof ApiException, String(error));
  assert.equal(error.getStatus(), 404);
  assert.equal(error.getResponse().error.code, 'RESOURCE_NOT_FOUND');
  return true;
};

const forbidden = (error: any) => {
  assert.ok(error instanceof ApiException, String(error));
  assert.equal(error.getStatus(), 403);
  assert.equal(error.getResponse().error.code, 'FORBIDDEN');
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

    await t.test('announcement writing against MySQL', async (t) => {
      const outsider = { id: Number(outsiderId), role: 'student' as const };
      const otherLecturer = {
        id: Number(otherLecturerId),
        role: 'lecturer' as const,
      };
      const input = {
        category: 'class_change' as const,
        title: 'Room change',
        body: 'Moved to EN305.',
      };
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const made = await service.create(lecturer, classId, input);
      created.push(made.data.id);

      await t.test(
        'create stores the post for the signed-in author',
        async () => {
          const post = made.data;
          assert.equal(post.class_id, classId);
          assert.equal(post.author.id, lecturerId);
          assert.equal(post.category, 'class_change');
          assert.equal(post.title, 'Room change');
          assert.deepEqual(
            [post.like_count, post.comment_count, post.liked_by_me],
            [0, 0, false],
          );
          assert.equal(post.created_at, post.updated_at);
          const [row] = await ds.query(
            'SELECT author_id, class_id FROM announcements WHERE id = ?',
            [post.id],
          );
          assert.deepEqual(
            [Number(row.author_id), Number(row.class_id)],
            [lecturerId, classId],
          );
        },
      );

      await t.test(
        'create is limited to the lecturer of the class',
        async () => {
          await assert.rejects(
            service.create(otherLecturer, classId, input),
            notFound,
          );
          await assert.rejects(
            service.create(outsider, classId, input),
            notFound,
          );
          await assert.rejects(
            service.create(lecturer, 4294967295, input),
            notFound,
          );
        },
      );

      await t.test('edit changes updated_at and keeps created_at', async () => {
        await wait(15);
        const edited = await service.update(lecturer, made.data.id, {
          title: 'Room change (EN306)',
        });
        assert.equal(edited.data.title, 'Room change (EN306)');
        assert.equal(edited.data.body, 'Moved to EN305.', 'other fields stay');
        assert.equal(edited.data.category, 'class_change');
        assert.equal(edited.data.author.id, lecturerId);
        assert.equal(edited.data.created_at, made.data.created_at);
        assert.ok(
          Date.parse(edited.data.updated_at) > Date.parse(made.data.updated_at),
          'updated_at moved forward',
        );
        const both = await service.update(lecturer, made.data.id, {
          category: 'exam',
          body: 'New body.',
        });
        assert.deepEqual(
          [both.data.category, both.data.body, both.data.title],
          ['exam', 'New body.', 'Room change (EN306)'],
        );
      });

      await t.test('an edit with no fields is a validation error', async () => {
        await assert.rejects(
          service.update(lecturer, made.data.id, {}),
          (error: any) => {
            assert.equal(error.getStatus(), 422);
            assert.ok(error.getResponse().error.fields.body);
            return true;
          },
        );
      });

      await t.test('only the author may edit or delete', async () => {
        // A post by another lecturer in this class, as after a reassignment.
        const result: any = await ds.query(
          `INSERT INTO announcements (class_id, author_id, category, title, body)
           VALUES (?, ?, 'general', 'By someone else', 'x')`,
          [classId, otherLecturerId],
        );
        const foreign = Number(result.insertId);
        created.push(foreign);
        await assert.rejects(
          service.update(lecturer, foreign, { title: 'Hijack' }),
          forbidden,
        );
        await assert.rejects(service.remove(lecturer, foreign), forbidden);
        await assert.rejects(
          service.update(student, made.data.id, { title: 'Hijack' }),
          forbidden,
        );
        await assert.rejects(service.remove(student, made.data.id), forbidden);
        // A lecturer who cannot see the class and an outsider get 404.
        await assert.rejects(
          service.update(otherLecturer, made.data.id, { title: 'x' }),
          notFound,
        );
        await assert.rejects(service.remove(outsider, made.data.id), notFound);
        await assert.rejects(service.remove(lecturer, 4294967295), notFound);
        const [row] = await ds.query(
          'SELECT title FROM announcements WHERE id = ?',
          [made.data.id],
        );
        assert.equal(row.title, 'Room change (EN306)', 'nothing changed');
        // An admin may delete the post of someone else.
        await service.remove(admin, foreign);
        const gone = await ds.query(
          'SELECT id FROM announcements WHERE id = ?',
          [foreign],
        );
        assert.deepEqual(gone, []);
      });

      await t.test(
        'delete removes the post with its likes and comments',
        async () => {
          await ds.query(
            'INSERT INTO announcement_likes (announcement_id, user_id) VALUES (?, ?)',
            [made.data.id, studentId],
          );
          await ds.query(
            `INSERT INTO announcement_comments (announcement_id, author_id, body) VALUES (?, ?, 'Thanks')`,
            [made.data.id, studentId],
          );
          const counted = await service.get(student, made.data.id);
          assert.deepEqual(
            [
              counted.data.like_count,
              counted.data.comment_count,
              counted.data.liked_by_me,
            ],
            [1, 1, true],
          );
          await service.remove(lecturer, made.data.id);
          await assert.rejects(service.get(lecturer, made.data.id), notFound);
          const [{ likes }] = await ds.query(
            'SELECT COUNT(*) AS likes FROM announcement_likes WHERE announcement_id = ?',
            [made.data.id],
          );
          const [{ comments }] = await ds.query(
            'SELECT COUNT(*) AS comments FROM announcement_comments WHERE announcement_id = ?',
            [made.data.id],
          );
          assert.deepEqual([Number(likes), Number(comments)], [0, 0]);
        },
      );
    });

    await t.test('likes and comments against MySQL', async (t) => {
      const engagement = new AnnouncementEngagementService(
        ds,
        new AnnouncementAccessService(ds),
      );
      const outsider = { id: Number(outsiderId), role: 'student' as const };
      const otherLecturer = {
        id: Number(otherLecturerId),
        role: 'lecturer' as const,
      };
      const second = await accountId('student.three@example.com');
      await ds.query(
        'INSERT INTO enrolments (class_id, student_id) VALUES (?, ?)',
        [classId, second],
      );
      const student2 = { id: Number(second), role: 'student' as const };
      const post = await insertPost(
        classId,
        'general',
        'Engagement',
        'Like and comment here.',
        '2026-02-01 10:00:00.000',
      );

      await t.test(
        'likes count once per person and repeat safely',
        async () => {
          const first = await engagement.setLike(student, post, true);
          assert.deepEqual(first.data, { liked: true, like_count: 1 });
          const again = await engagement.setLike(student, post, true);
          assert.equal(again.data.like_count, 1, 'a second PUT adds no like');
          // Two requests at the same moment still give one like and no error.
          const racing = await Promise.all([
            engagement.setLike(lecturer, post, true),
            engagement.setLike(lecturer, post, true),
          ]);
          assert.deepEqual(
            racing.map((item) => item.data.liked),
            [true, true],
          );
          const seen = await service.get(student, post);
          assert.deepEqual(
            [seen.data.like_count, seen.data.liked_by_me],
            [2, true],
          );
          const lecturerView = await service.get(lecturer, post);
          assert.equal(lecturerView.data.liked_by_me, true);
          const other = await service.get(student2, post);
          assert.equal(other.data.liked_by_me, false);
          const off = await engagement.setLike(student, post, false);
          assert.deepEqual(off.data, { liked: false, like_count: 1 });
          const offAgain = await engagement.setLike(student, post, false);
          assert.deepEqual(offAgain.data, { liked: false, like_count: 1 });
        },
      );

      await t.test('outsiders cannot like or comment', async () => {
        await assert.rejects(
          engagement.setLike(outsider, post, true),
          notFound,
        );
        await assert.rejects(
          engagement.setLike(otherLecturer, post, true),
          notFound,
        );
        await assert.rejects(
          engagement.createComment(outsider, post, { body: 'Hi' }),
          notFound,
        );
        await assert.rejects(
          engagement.listComments(outsider, post, { page: 1, limit: 20 }),
          notFound,
        );
        await assert.rejects(
          engagement.setLike(student, 4294967295, true),
          notFound,
        );
      });

      await t.test(
        'comments list oldest first with paging and can_delete',
        async (t) => {
          const insertComment = async (
            author: number,
            body: string,
            at: string,
          ) => {
            const result: any = await ds.query(
              `INSERT INTO announcement_comments (announcement_id, author_id, body, created_at)
             VALUES (?, ?, ?, ?)`,
              [post, author, body, at],
            );
            return Number(result.insertId);
          };
          // Inserted out of order, so the sort has to do the work.
          const late = await insertComment(
            second,
            'Late',
            '2026-02-01 12:00:00.000',
          );
          const early = await insertComment(
            studentId,
            'Early',
            '2026-02-01 11:00:00.000',
          );
          const tie = await insertComment(
            studentId,
            'Tie',
            '2026-02-01 11:00:00.000',
          );

          const page = await engagement.listComments(student, post, {
            page: 1,
            limit: 20,
          });
          assert.deepEqual(
            page.data.map((item) => item.id),
            [early, tie, late],
            'oldest first, then by id',
          );
          assert.deepEqual(page.meta, {
            page: 1,
            limit: 20,
            total: 3,
            totalPages: 1,
          });
          assert.deepEqual(page.data[0].author, {
            id: studentId,
            name: page.data[0].author.name,
            role: 'student',
          });
          assert.deepEqual(
            page.data.map((item) => item.can_delete),
            [true, true, false],
            'a student may delete only own comments',
          );
          const asLecturer = await engagement.listComments(lecturer, post, {
            page: 1,
            limit: 20,
          });
          assert.deepEqual(
            asLecturer.data.map((item) => item.can_delete),
            [true, true, true],
          );
          const asAdmin = await engagement.listComments(admin, post, {
            page: 1,
            limit: 20,
          });
          assert.equal(
            asAdmin.data.every((item) => item.can_delete),
            true,
          );
          const paged = await engagement.listComments(student, post, {
            page: 2,
            limit: 2,
          });
          assert.deepEqual(
            paged.data.map((item) => item.id),
            [late],
          );
          assert.equal(paged.meta.totalPages, 2);
          const counted = await service.get(student, post);
          assert.equal(counted.data.comment_count, 3, 'the feed count is real');

          await t.test('writing a comment', async () => {
            const written = await engagement.createComment(student2, post, {
              body: 'Thank you, see you there.',
            });
            assert.equal(written.data.author.id, second);
            assert.equal(written.data.can_delete, true);
            const fromLecturer = await engagement.createComment(
              lecturer,
              post,
              {
                body: 'See you.',
              },
            );
            assert.equal(fromLecturer.data.author.role, 'lecturer');
            const [{ total }] = await ds.query(
              'SELECT COUNT(*) AS total FROM announcement_comments WHERE announcement_id = ?',
              [post],
            );
            assert.equal(Number(total), 5);
          });

          await t.test('deleting a comment', async () => {
            // A student cannot delete the comment of another student.
            await assert.rejects(
              engagement.deleteComment(student2, early),
              forbidden,
            );
            await assert.rejects(
              engagement.deleteComment(student, late),
              forbidden,
            );
            // A person outside the class sees no comment.
            await assert.rejects(
              engagement.deleteComment(outsider, early),
              notFound,
            );
            await assert.rejects(
              engagement.deleteComment(otherLecturer, early),
              notFound,
            );
            await assert.rejects(
              engagement.deleteComment(lecturer, 4294967295),
              notFound,
            );
            const [{ stay }] = await ds.query(
              'SELECT COUNT(*) AS stay FROM announcement_comments WHERE id IN (?, ?)',
              [early, late],
            );
            assert.equal(Number(stay), 2, 'nothing was deleted');
            await engagement.deleteComment(student, early); // own comment
            await engagement.deleteComment(lecturer, late); // lecturer of the class
            await engagement.deleteComment(admin, tie); // admin
            const rest = await ds.query(
              'SELECT id FROM announcement_comments WHERE id IN (?, ?, ?)',
              [early, late, tie],
            );
            assert.deepEqual(rest, []);
          });
        },
      );

      await t.test(
        'deleting the post removes its likes and comments',
        async () => {
          await engagement.setLike(student, post, true);
          await ds.query('DELETE FROM announcements WHERE id = ?', [post]);
          const [{ likes }] = await ds.query(
            'SELECT COUNT(*) AS likes FROM announcement_likes WHERE announcement_id = ?',
            [post],
          );
          const [{ comments }] = await ds.query(
            'SELECT COUNT(*) AS comments FROM announcement_comments WHERE announcement_id = ?',
            [post],
          );
          assert.deepEqual([Number(likes), Number(comments)], [0, 0]);
        },
      );
    });
  });
}

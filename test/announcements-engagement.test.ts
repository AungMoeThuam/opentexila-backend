import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startAttendanceApp } from './helpers/attendance-app.ts';
import { AnnouncementsModule } from '../dist/announcements/announcements.module.js';

const user = (role: string, id: number) => ({
  id,
  role,
  status: 'active',
  session_version: 0,
  must_change_password: false,
});

test('announcement likes and comments: permissions, queries and responses', async (t) => {
  // Class 7 belongs to lecturer 2. Students 21 and 23 are enrolled; 22 is not.
  // Lecturer 3 teaches class 8. Post 41 is in class 7.
  const classes: Record<number, { id: number; lecturer_id: number }> = {
    7: { id: 7, lecturer_id: 2 },
    8: { id: 8, lecturer_id: 3 },
  };
  const enrolments = new Set(['7:21', '7:23']);
  const posts: Record<number, { class_id: number; lecturer_id: number }> = {
    41: { class_id: 7, lecturer_id: 2 },
  };
  const likes = new Set<string>();
  // Comment 90 by student 21, comment 91 by student 23, both in post 41.
  const comments: Record<number, { author_id: number }> = {
    90: { author_id: 21 },
    91: { author_id: 23 },
  };
  const commentRow = (id: number, author: number, role = 'student') => ({
    id: String(id),
    body: `Comment ${id}`,
    created_at: new Date('2026-11-12T02:00:00.000Z'),
    author_id: String(author),
    author_name: `Author ${author}`,
    author_role: role,
  });
  let commentTotal = 2;
  const writes: [string, any[]][] = [];
  const queries: [string, any[]][] = [];
  const query = async (sql: string, params: any[] = []) => {
    queries.push([sql, params]);
    if (sql.includes('FROM announcements a JOIN classes cl'))
      return posts[params[0]] ? [posts[params[0]]] : [];
    if (sql.startsWith('INSERT IGNORE INTO announcement_likes')) {
      writes.push([sql, params]);
      likes.add(`${params[0]}:${params[1]}`);
      return { affectedRows: 1 };
    }
    if (sql.startsWith('DELETE FROM announcement_likes')) {
      writes.push([sql, params]);
      likes.delete(`${params[0]}:${params[1]}`);
      return { affectedRows: 1 };
    }
    if (sql.includes('COUNT(*) AS total FROM announcement_likes'))
      return [{ total: String(likes.size + 12) }];
    if (sql.includes('COUNT(*) AS total FROM announcement_comments'))
      return [{ total: String(commentTotal) }];
    if (sql.includes('WHERE c.announcement_id = ?'))
      return [commentRow(90, 21), commentRow(91, 23)];
    if (sql.startsWith('INSERT INTO announcement_comments')) {
      writes.push([sql, params]);
      comments[92] = { author_id: params[1] };
      return { insertId: 92 };
    }
    if (sql.startsWith('SELECT c.author_id, a.class_id')) {
      const comment = comments[params[0]];
      return comment
        ? [{ author_id: comment.author_id, class_id: 7, lecturer_id: 2 }]
        : [];
    }
    if (sql.includes('WHERE c.id = ?'))
      return [commentRow(92, comments[92].author_id, 'student')];
    if (sql.startsWith('DELETE FROM announcement_comments')) {
      writes.push([sql, params]);
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  let transactions = 0;
  const transaction = async (work: (manager: any) => Promise<unknown>) => {
    transactions += 1;
    return work({ query });
  };

  const app = await startAttendanceApp(
    {
      ClassSession: {},
      AttendanceRecord: {},
      Course: {},
      Class: { findOneBy: async ({ id }: any) => classes[id] ?? null },
      Enrolment: {
        findOneBy: async ({ class_id, student_id }: any) =>
          enrolments.has(`${class_id}:${student_id}`)
            ? { class_id, student_id }
            : null,
      },
    },
    { modules: [AnnouncementsModule], database: { query, transaction } },
  );
  t.after(() => app.close());

  const as = (role: string, id: number) => {
    app.state.user = user(role, id);
    app.state.signedIn = true;
  };
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${app.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'fixture-token',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const reset = () => {
    writes.length = 0;
    queries.length = 0;
  };

  await t.test('signed-out users get 401 on every endpoint', async () => {
    app.state.signedIn = false;
    reset();
    for (const [method, path] of [
      ['PUT', '/announcements/41/like'],
      ['DELETE', '/announcements/41/like'],
      ['GET', '/announcements/41/comments'],
      ['POST', '/announcements/41/comments'],
      ['DELETE', '/comments/90'],
    ]) {
      const response = await send(
        method,
        path,
        method === 'POST' ? { body: 'x' } : undefined,
      );
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
    }
    app.state.signedIn = true;
    assert.deepEqual(queries, []);
  });

  await t.test(
    'an enrolled student and the lecturer like and unlike',
    async () => {
      for (const [role, id] of [
        ['student', 21],
        ['lecturer', 2],
      ] as [string, number][]) {
        as(role, id);
        likes.clear();
        reset();
        const liked = await send('PUT', '/announcements/41/like');
        assert.equal(liked.status, 200, `${role} like`);
        assert.equal(liked.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await liked.json(), {
          data: { liked: true, like_count: 13 },
        });
        assert.deepEqual(
          writes[0][1],
          [41, id],
          'the like belongs to the caller',
        );
        const unliked = await send('DELETE', '/announcements/41/like');
        assert.equal(unliked.status, 200, `${role} unlike`);
        assert.deepEqual(await unliked.json(), {
          data: { liked: false, like_count: 12 },
        });
      }
      assert.ok(
        transactions > 0,
        'the change and the count share a transaction',
      );
    },
  );

  await t.test(
    'liking uses insert-if-missing and repeats are safe',
    async () => {
      as('student', 21);
      likes.clear();
      reset();
      await send('PUT', '/announcements/41/like');
      const again = await send('PUT', '/announcements/41/like');
      assert.equal(again.status, 200);
      assert.deepEqual((await again.json()).data, {
        liked: true,
        like_count: 13,
      });
      assert.match(writes[0][0], /^INSERT IGNORE INTO announcement_likes/);
      likes.clear();
      const first = await send('DELETE', '/announcements/41/like');
      const second = await send('DELETE', '/announcements/41/like');
      assert.equal(first.status, 200);
      assert.equal(second.status, 200, 'a second DELETE is not an error');
      assert.deepEqual((await second.json()).data, {
        liked: false,
        like_count: 12,
      });
    },
  );

  await t.test('only people of the class like, and admins cannot', async () => {
    reset();
    const cases: [string, number, number, string][] = [
      ['admin', 1, 403, 'FORBIDDEN'],
      ['student', 22, 404, 'RESOURCE_NOT_FOUND'], // not enrolled
      ['lecturer', 3, 404, 'RESOURCE_NOT_FOUND'], // other class
    ];
    for (const [role, id, status, code] of cases) {
      as(role, id);
      for (const method of ['PUT', 'DELETE']) {
        const response = await send(method, '/announcements/41/like');
        assert.equal(response.status, status, `${method} ${role} ${id}`);
        assert.equal((await response.json()).error.code, code);
      }
    }
    as('student', 21);
    assert.equal((await send('PUT', '/announcements/999/like')).status, 404);
    assert.deepEqual(writes, []);
  });

  await t.test(
    'comments list oldest first with paging and can_delete',
    async () => {
      reset();
      as('student', 21);
      const response = await send(
        'GET',
        '/announcements/41/comments?page=2&limit=1',
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.deepEqual(body.meta, {
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      assert.deepEqual(body.data[0], {
        id: 90,
        body: 'Comment 90',
        author: { id: 21, name: 'Author 21', role: 'student' },
        created_at: '2026-11-12T02:00:00.000Z',
        can_delete: true,
      });
      const listSql = queries.find(([sql]) => sql.includes('ORDER BY'))!;
      assert.match(
        listSql[0],
        /ORDER BY c\.created_at ASC, c\.id ASC LIMIT \? OFFSET \?/,
      );
      assert.deepEqual(listSql[1], [41, 1, 1]);
      const flags = async (role: string, id: number) => {
        as(role, id);
        const list = await (
          await send('GET', '/announcements/41/comments')
        ).json();
        return list.data.map((item: any) => item.can_delete);
      };
      assert.deepEqual(await flags('student', 21), [true, false]);
      assert.deepEqual(await flags('student', 23), [false, true]);
      assert.deepEqual(await flags('lecturer', 2), [true, true]);
      assert.deepEqual(await flags('admin', 1), [true, true]);
    },
  );

  await t.test('an empty comment list is not an error', async () => {
    as('admin', 1);
    commentTotal = 0;
    const response = await send('GET', '/announcements/41/comments');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).meta.total, 0);
    commentTotal = 2;
  });

  await t.test(
    'only people who can see the post read its comments',
    async () => {
      reset();
      const cases: [string, number, number][] = [
        ['student', 22, 404],
        ['lecturer', 3, 404],
        ['lecturer', 2, 200],
        ['admin', 1, 200],
      ];
      for (const [role, id, status] of cases) {
        as(role, id);
        const response = await send('GET', '/announcements/41/comments');
        assert.equal(response.status, status, `${role} ${id}`);
      }
      as('student', 21);
      assert.equal(
        (await send('GET', '/announcements/999/comments')).status,
        404,
      );
    },
  );

  await t.test('comment list validates the ID and paging', async () => {
    as('student', 21);
    reset();
    for (const path of [
      '/announcements/0/comments',
      '/announcements/abc/comments',
      '/announcements/41/comments?limit=0',
      '/announcements/41/comments?limit=101',
      '/announcements/41/comments?page=0',
    ]) {
      const response = await send('GET', path);
      assert.equal(response.status, 422, path);
      assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    }
    assert.deepEqual(queries, []);
  });

  await t.test('a student and the lecturer write a comment', async () => {
    for (const [role, id] of [
      ['student', 21],
      ['lecturer', 2],
    ] as [string, number][]) {
      as(role, id);
      reset();
      const response = await send('POST', '/announcements/41/comments', {
        body: '  Thank you, see you there.  ',
        author_id: 99,
        created_at: '2000-01-01',
      });
      assert.equal(response.status, 201, role);
      const body = await response.json();
      assert.deepEqual(Object.keys(body), ['data']);
      assert.equal(body.data.id, 92);
      assert.equal(body.data.author.id, id);
      assert.equal(body.data.can_delete, true);
      // The author is the caller and the text is trimmed.
      assert.deepEqual(writes[0][1], [41, id, 'Thank you, see you there.']);
    }
  });

  await t.test('comment writing refuses admins and outsiders', async () => {
    reset();
    const cases: [string, number, number, string][] = [
      ['admin', 1, 403, 'FORBIDDEN'],
      ['student', 22, 404, 'RESOURCE_NOT_FOUND'],
      ['lecturer', 3, 404, 'RESOURCE_NOT_FOUND'],
    ];
    for (const [role, id, status, code] of cases) {
      as(role, id);
      const response = await send('POST', '/announcements/41/comments', {
        body: 'Hello',
      });
      assert.equal(response.status, status, `${role} ${id}`);
      assert.equal((await response.json()).error.code, code);
    }
    assert.deepEqual(writes, []);
  });

  await t.test('empty and too long comments return 422', async () => {
    as('student', 21);
    reset();
    for (const payload of [
      {},
      { body: '' },
      { body: '   ' },
      { body: 5 },
      { body: 'a'.repeat(1001) },
    ]) {
      const response = await send(
        'POST',
        '/announcements/41/comments',
        payload,
      );
      assert.equal(response.status, 422, JSON.stringify(payload).slice(0, 30));
      const error = (await response.json()).error;
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.ok(error.fields.body);
    }
    const limit = await send('POST', '/announcements/41/comments', {
      body: 'a'.repeat(1000),
    });
    assert.equal(limit.status, 201, 'the limit itself is allowed');
    assert.equal(writes.length, 1);
  });

  await t.test(
    'comment authors, the class lecturer and admins delete',
    async () => {
      for (const [role, id, comment] of [
        ['student', 21, 90],
        ['lecturer', 2, 90],
        ['lecturer', 2, 91],
        ['admin', 1, 91],
      ] as [string, number, number][]) {
        as(role, id);
        reset();
        const response = await send('DELETE', `/comments/${comment}`);
        assert.equal(response.status, 204, `${role} ${id} comment ${comment}`);
        assert.equal(await response.text(), '');
        assert.deepEqual(writes, [
          ['DELETE FROM announcement_comments WHERE id = ?', [comment]],
        ]);
      }
    },
  );

  await t.test('comment delete refuses the wrong people', async () => {
    reset();
    const cases: [string, number, string, number, string][] = [
      ['student', 21, '91', 403, 'FORBIDDEN'], // another student's comment
      ['student', 23, '90', 403, 'FORBIDDEN'],
      ['lecturer', 3, '90', 404, 'RESOURCE_NOT_FOUND'], // other class
      ['student', 22, '90', 404, 'RESOURCE_NOT_FOUND'], // not enrolled
      ['admin', 1, '999', 404, 'RESOURCE_NOT_FOUND'],
    ];
    for (const [role, id, comment, status, code] of cases) {
      as(role, id);
      const response = await send('DELETE', `/comments/${comment}`);
      assert.equal(response.status, status, `${role} ${id} comment ${comment}`);
      assert.equal((await response.json()).error.code, code);
    }
    as('student', 21);
    const badId = await send('DELETE', '/comments/abc');
    assert.equal(badId.status, 422);
    assert.ok((await badId.json()).error.fields.commentId);
    assert.deepEqual(writes, []);
  });

  await t.test(
    'a hidden comment and a missing comment look the same',
    async () => {
      as('lecturer', 3);
      const hidden = await (await send('DELETE', '/comments/90')).json();
      const missing = await (await send('DELETE', '/comments/999')).json();
      assert.deepEqual(hidden, missing);
    },
  );
});

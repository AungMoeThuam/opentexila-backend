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

test('announcement write permissions, validation and queries', async (t) => {
  // Class 7 belongs to lecturer 2, class 8 to lecturer 3. Student 21 is
  // enrolled in class 7. Post 41 is in class 7 and was written by lecturer 2;
  // post 42 is in class 7 but was written by lecturer 3 (class was reassigned).
  const classes: Record<number, { id: number; lecturer_id: number }> = {
    7: { id: 7, lecturer_id: 2 },
    8: { id: 8, lecturer_id: 3 },
  };
  const enrolments = new Set(['7:21']);
  const posts: Record<number, { class_id: number; author_id: number }> = {
    41: { class_id: 7, author_id: 2 },
    42: { class_id: 7, author_id: 3 },
  };
  let saved: Record<string, unknown> = {};
  const writes: [string, any[]][] = [];
  const query = async (sql: string, params: any[] = []) => {
    if (sql.startsWith('SELECT class_id, author_id')) {
      const post = posts[params[0]];
      return post ? [post] : [];
    }
    if (sql.startsWith('INSERT INTO announcements')) {
      writes.push([sql, params]);
      const [class_id, author_id, category, title, body] = params;
      posts[50] = { class_id, author_id };
      saved = { id: 50, class_id, author_id, category, title, body };
      return { insertId: 50 };
    }
    if (sql.startsWith('UPDATE announcements')) {
      writes.push([sql, params]);
      return { affectedRows: 1 };
    }
    if (sql.startsWith('DELETE FROM announcements')) {
      writes.push([sql, params]);
      return { affectedRows: 1 };
    }
    // The shared SELECT used to answer with the announcement object.
    return [
      {
        id: '50',
        class_id: '7',
        category: 'class_change',
        title: 'Saved title',
        body: 'Saved body',
        created_at: new Date('2026-11-12T01:00:00.000Z'),
        updated_at: new Date('2026-11-12T01:00:00.000Z'),
        author_id: '2',
        author_name: 'Lecturer One',
        course_id: '1',
        course_code: 'COS30043',
        course_name: 'Interface Design',
        section: 'A',
        term: '2026-S2',
        like_count: '0',
        comment_count: '0',
        liked_by_me: '0',
      },
    ];
  };

  const app = await startAttendanceApp(
    {
      ClassSession: {},
      AttendanceRecord: {},
      Course: {},
      Class: {
        findOneBy: async ({ id }: any) => classes[id] ?? null,
      },
      Enrolment: {
        findOneBy: async ({ class_id, student_id }: any) =>
          enrolments.has(`${class_id}:${student_id}`)
            ? { class_id, student_id }
            : null,
      },
    },
    { modules: [AnnouncementsModule], database: { query } },
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
  const valid = {
    category: 'class_change',
    title: "Tomorrow's class moves to EN305",
    body: 'Please go to room EN305.',
  };

  await t.test('signed-out users get 401 on every write', async () => {
    app.state.signedIn = false;
    writes.length = 0;
    for (const [method, path] of [
      ['POST', '/classes/7/announcements'],
      ['PATCH', '/announcements/41'],
      ['DELETE', '/announcements/41'],
    ]) {
      const response = await send(method, path, { title: 'x', body: 'y' });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
    }
    app.state.signedIn = true;
    assert.deepEqual(writes, []);
  });

  await t.test('the class lecturer creates a post', async () => {
    as('lecturer', 2);
    writes.length = 0;
    const response = await send('POST', '/classes/7/announcements', valid);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['data']);
    assert.equal(body.data.id, 50);
    assert.equal(body.data.like_count, 0);
    assert.equal(body.data.comment_count, 0);
    assert.equal(body.data.liked_by_me, false);
    assert.equal(writes.length, 1);
    const [sql, params] = writes[0];
    assert.match(sql, /^INSERT INTO announcements/);
    // The author and class come from the sign-in and the path.
    assert.deepEqual(params, [7, 2, valid.category, valid.title, valid.body]);
    assert.equal(sql.includes(valid.title), false, 'values are parameters');
  });

  await t.test(
    'create trims text, defaults category, strips fields',
    async () => {
      as('lecturer', 2);
      writes.length = 0;
      const response = await send('POST', '/classes/7/announcements', {
        title: '  Hello  ',
        body: '\n Body text \n',
        author_id: 99,
        class_id: 8,
        created_at: '2000-01-01',
        like_count: 500,
      });
      assert.equal(response.status, 201);
      assert.deepEqual(writes[0][1], [7, 2, 'general', 'Hello', 'Body text']);
    },
  );

  await t.test('create is limited to the lecturer of the class', async () => {
    writes.length = 0;
    const roleCases: [string, number, number, string][] = [
      ['student', 21, 403, 'FORBIDDEN'],
      ['admin', 1, 403, 'FORBIDDEN'],
      ['lecturer', 3, 404, 'RESOURCE_NOT_FOUND'],
    ];
    for (const [role, id, status, code] of roleCases) {
      as(role, id);
      const response = await send('POST', '/classes/7/announcements', valid);
      assert.equal(response.status, status, `${role} ${id}`);
      assert.equal((await response.json()).error.code, code);
    }
    as('lecturer', 2);
    assert.equal(
      (await send('POST', '/classes/999/announcements', valid)).status,
      404,
    );
    assert.deepEqual(writes, []);
  });

  await t.test('create validates every field', async () => {
    as('lecturer', 2);
    writes.length = 0;
    const cases: [string, Record<string, unknown>][] = [
      ['title', { ...valid, title: '' }],
      ['title', { ...valid, title: '   ' }],
      ['title', { ...valid, title: 'a'.repeat(151) }],
      ['title', { ...valid, title: 42 }],
      ['title', { category: 'general', body: 'x' }],
      ['body', { ...valid, body: '' }],
      ['body', { ...valid, body: 'a'.repeat(5001) }],
      ['body', { title: 'x' }],
      ['category', { ...valid, category: 'news' }],
    ];
    for (const [field, payload] of cases) {
      const response = await send('POST', '/classes/7/announcements', payload);
      assert.equal(response.status, 422, JSON.stringify(payload).slice(0, 60));
      const error = (await response.json()).error;
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.ok(error.fields[field], `${field} message`);
    }
    const limit = await send('POST', '/classes/7/announcements', {
      ...valid,
      title: 'a'.repeat(150),
      body: 'b'.repeat(5000),
    });
    assert.equal(limit.status, 201, 'the limits themselves are allowed');
    const badId = await send('POST', '/classes/abc/announcements', valid);
    assert.equal(badId.status, 422);
    assert.ok((await badId.json()).error.fields.classId);
    assert.equal(writes.length, 1, 'only the valid post reached the database');
  });

  await t.test('the author edits own post', async () => {
    as('lecturer', 2);
    writes.length = 0;
    const response = await send('PATCH', '/announcements/41', {
      title: '  New title ',
      author_id: 99,
      created_at: '2000-01-01',
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.id, 50);
    const [sql, params] = writes[0];
    assert.match(
      sql,
      /^UPDATE announcements SET title = \?, updated_at = CURRENT_TIMESTAMP\(3\)/,
    );
    assert.equal(sql.includes('created_at ='), false);
    assert.equal(sql.includes('author_id = ?,'), false);
    assert.deepEqual(params, ['New title', 41, 2]);
  });

  await t.test('edit can change several fields at once', async () => {
    as('lecturer', 2);
    writes.length = 0;
    const response = await send('PATCH', '/announcements/41', {
      category: 'exam',
      title: 'T',
      body: 'B',
    });
    assert.equal(response.status, 200);
    assert.match(
      writes[0][0],
      /SET category = \?, title = \?, body = \?, updated_at/,
    );
    assert.deepEqual(writes[0][1], ['exam', 'T', 'B', 41, 2]);
  });

  await t.test('edit refuses other people and other roles', async () => {
    writes.length = 0;
    const cases: [string, number, string, number, string][] = [
      // role, id, post, status, code
      ['lecturer', 2, '42', 403, 'FORBIDDEN'], // sees the class, not the author
      ['lecturer', 3, '41', 404, 'RESOURCE_NOT_FOUND'], // cannot see the class
      ['student', 21, '41', 403, 'FORBIDDEN'],
      ['student', 22, '41', 403, 'FORBIDDEN'],
      ['admin', 1, '41', 403, 'FORBIDDEN'],
      ['lecturer', 2, '999', 404, 'RESOURCE_NOT_FOUND'],
    ];
    for (const [role, id, post, status, code] of cases) {
      as(role, id);
      const response = await send('PATCH', `/announcements/${post}`, {
        title: 'Changed',
      });
      assert.equal(response.status, status, `${role} ${id} post ${post}`);
      assert.equal((await response.json()).error.code, code);
    }
    assert.deepEqual(writes, []);
  });

  await t.test('an empty edit and bad fields return 422', async () => {
    as('lecturer', 2);
    writes.length = 0;
    const empty = await send('PATCH', '/announcements/41', {});
    assert.equal(empty.status, 422);
    assert.ok((await empty.json()).error.fields.body);
    // Fields the client may not set are stripped, which leaves nothing to save.
    const stripped = await send('PATCH', '/announcements/41', {
      author_id: 5,
      like_count: 9,
    });
    assert.equal(stripped.status, 422);
    const cases: [string, Record<string, unknown>][] = [
      ['title', { title: '' }],
      ['title', { title: 'a'.repeat(151) }],
      ['body', { body: '  ' }],
      ['body', { body: 'a'.repeat(5001) }],
      ['category', { category: 'news' }],
    ];
    for (const [field, payload] of cases) {
      const response = await send('PATCH', '/announcements/41', payload);
      assert.equal(response.status, 422, JSON.stringify(payload).slice(0, 40));
      assert.ok((await response.json()).error.fields[field], field);
    }
    const badId = await send('PATCH', '/announcements/0', { title: 'x' });
    assert.equal(badId.status, 422);
    assert.ok((await badId.json()).error.fields.announcementId);
    assert.deepEqual(writes, []);
  });

  await t.test(
    'the author deletes own post; an admin deletes any',
    async () => {
      for (const [role, id, post] of [
        ['lecturer', 2, '41'],
        ['admin', 1, '41'],
        ['admin', 1, '42'],
      ] as [string, number, string][]) {
        as(role, id);
        writes.length = 0;
        const response = await send('DELETE', `/announcements/${post}`);
        assert.equal(response.status, 204, `${role} ${id} post ${post}`);
        assert.equal(await response.text(), '');
        assert.deepEqual(writes, [
          ['DELETE FROM announcements WHERE id = ?', [Number(post)]],
        ]);
      }
    },
  );

  await t.test('delete refuses other people and other roles', async () => {
    writes.length = 0;
    const cases: [string, number, string, number, string][] = [
      ['lecturer', 2, '42', 403, 'FORBIDDEN'],
      ['lecturer', 3, '41', 404, 'RESOURCE_NOT_FOUND'],
      ['student', 21, '41', 403, 'FORBIDDEN'],
      ['student', 22, '41', 403, 'FORBIDDEN'],
      ['admin', 1, '999', 404, 'RESOURCE_NOT_FOUND'],
    ];
    for (const [role, id, post, status, code] of cases) {
      as(role, id);
      const response = await send('DELETE', `/announcements/${post}`);
      assert.equal(response.status, status, `${role} ${id} post ${post}`);
      assert.equal((await response.json()).error.code, code);
    }
    as('lecturer', 2);
    const badId = await send('DELETE', '/announcements/abc');
    assert.equal(badId.status, 422);
    assert.deepEqual(writes, []);
  });

  await t.test('a hidden post and a missing post look the same', async () => {
    as('lecturer', 3);
    const hidden = await (await send('DELETE', '/announcements/41')).json();
    const missing = await (await send('DELETE', '/announcements/999')).json();
    assert.deepEqual(hidden, missing);
  });
});

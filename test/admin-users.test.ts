import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as argon2 from 'argon2';
import { startAttendanceApp } from './helpers/attendance-app.ts';
import { AdminUsersModule } from '../dist/users/admin-users.module.js';

const admin = () => ({
  id: 1,
  role: 'admin',
  status: 'active',
  session_version: 0,
  must_change_password: false,
});

const validBody = () => ({
  name: 'Student Two',
  email: 'student.two@example.com',
  role: 'student',
  temporary_password: 'Temporary-pass-1',
});

const duplicateError = () =>
  Object.assign(new Error("Duplicate entry 'x' for key 'uq_users_email'"), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
  });

test('admin account provisioning HTTP permissions, validation and responses', async (t) => {
  let inserted: any = null;
  let insert: (values: any) => Promise<any> = async (values) => {
    inserted = values;
    return { identifiers: [{ id: 12 }] };
  };
  let target: any = null;
  const updates: { entity: string; criteria: any; values: any }[] = [];

  const app = await startAttendanceApp(
    {
      ClassSession: {},
      AttendanceRecord: {},
      Enrolment: {},
      Class: {},
      Course: {},
      User: {
        findOneBy: async ({ id }: any) =>
          id === app.state.user.id ? app.state.user : null,
        insert: (values: any) => insert(values),
      },
    },
    {
      modules: [AdminUsersModule],
      database: {
        transaction: async (work: any) =>
          work({
            getRepository: () => ({
              createQueryBuilder: () => {
                const fake: any = {};
                for (const method of ['where', 'setLock'])
                  fake[method] = () => fake;
                fake.getOne = async () => target;
                return fake;
              },
            }),
            update: async (entity: any, criteria: any, values: any) => {
              updates.push({ entity: entity.name, criteria, values });
            },
          }),
      },
    },
  );
  t.after(() => app.close());
  app.state.user = admin();

  const send = (method: string, path: string, body?: unknown, csrf = true) =>
    fetch(`${app.base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(csrf ? { 'x-csrf-token': 'fixture-token' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const endpoints: [string, string, unknown][] = [
    ['POST', '/admin/users', validBody()],
    [
      'POST',
      '/admin/users/5/reset-password',
      { temporary_password: 'x'.repeat(12) },
    ],
  ];

  await t.test('only signed-in admins can use the endpoints', async () => {
    for (const role of ['student', 'lecturer']) {
      app.state.user = { ...admin(), role };
      for (const [method, path, body] of endpoints) {
        const response = await send(method, path, body);
        assert.equal(response.status, 403, `${role} ${path}`);
        assert.equal((await response.json()).error.code, 'FORBIDDEN');
      }
    }
    app.state.user = { ...admin(), must_change_password: true };
    for (const [method, path, body] of endpoints) {
      const response = await send(method, path, body);
      assert.equal(response.status, 403, path);
      assert.equal(
        (await response.json()).error.code,
        'PASSWORD_CHANGE_REQUIRED',
      );
    }
    app.state.user = admin();
    for (const [method, path, body] of endpoints) {
      const response = await send(method, path, body, false);
      assert.equal(response.status, 403, path);
      assert.equal((await response.json()).error.code, 'CSRF_INVALID');
    }
    app.state.signedIn = false;
    for (const [method, path, body] of endpoints) {
      assert.equal((await send(method, path, body)).status, 401, path);
    }
    app.state.signedIn = true;
    assert.equal(inserted, null);
    assert.deepEqual(updates, []);
  });

  await t.test(
    'POST /admin/users creates a user with a hashed password',
    async () => {
      const response = await send('POST', '/admin/users', {
        ...validBody(),
        email: '  Student.Two@Example.COM ',
        status: 'inactive',
        must_change_password: false,
      });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.deepEqual(body, {
        data: {
          id: 12,
          name: 'Student Two',
          email: 'student.two@example.com',
          role: 'student',
          must_change_password: true,
          is_active: true,
        },
      });
      assert.equal(JSON.stringify(body).includes('Temporary-pass-1'), false);
      assert.equal(inserted.status, 'active');
      assert.equal(inserted.must_change_password, true);
      assert.match(inserted.password_hash, /^\$argon2id\$/);
      assert.equal(
        await argon2.verify(inserted.password_hash, 'Temporary-pass-1'),
        true,
      );
      assert.equal(inserted.temporary_password, undefined);
    },
  );

  await t.test('POST /admin/users validates the body', async () => {
    inserted = null;
    const cases: [string, any][] = [
      ['role', { ...validBody(), role: 'admin' }],
      ['role', { ...validBody(), role: 'teacher' }],
      ['temporary_password', { ...validBody(), temporary_password: 'short' }],
      [
        'temporary_password',
        { ...validBody(), temporary_password: 123456789012 },
      ],
      ['email', { ...validBody(), email: 'not-an-email' }],
      ['email', { ...validBody(), email: `${'a'.repeat(250)}@x.io` }],
      ['name', { ...validBody(), name: '   ' }],
      ['name', { ...validBody(), name: 'n'.repeat(101) }],
    ];
    for (const [field, body] of cases) {
      const response = await send('POST', '/admin/users', body);
      assert.equal(response.status, 422, field);
      const error = (await response.json()).error;
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.ok(error.fields[field], `${field} message`);
    }
    assert.equal(inserted, null);
  });

  await t.test(
    'POST /admin/users returns 409 for a duplicate email',
    async () => {
      insert = async () => {
        throw duplicateError();
      };
      const response = await send('POST', '/admin/users', validBody());
      assert.equal(response.status, 409);
      const error = (await response.json()).error;
      assert.equal(error.code, 'EMAIL_ALREADY_EXISTS');
      assert.ok(error.fields.email);
      insert = async (values) => {
        inserted = values;
        return { identifiers: [{ id: 12 }] };
      };
    },
  );

  await t.test(
    'reset-password sets a temporary password and ends sign-ins',
    async () => {
      target = { id: 5, role: 'student', status: 'active', session_version: 3 };
      updates.length = 0;
      const response = await send('POST', '/admin/users/5/reset-password', {
        temporary_password: 'Another-temp-pass',
      });
      assert.equal(response.status, 204);
      assert.equal(await response.text(), '');
      assert.equal(updates.length, 2);
      const [user, sessions] = updates;
      assert.equal(user.entity, 'User');
      assert.deepEqual(user.criteria, { id: 5 });
      assert.equal(user.values.must_change_password, true);
      assert.equal(user.values.session_version, 4);
      assert.match(user.values.password_hash, /^\$argon2id\$/);
      assert.equal(
        await argon2.verify(user.values.password_hash, 'Another-temp-pass'),
        true,
      );
      assert.equal(sessions.entity, 'RefreshSession');
      assert.equal(sessions.criteria.user_id, 5);
      assert.ok(sessions.values.revoked_at instanceof Date);
    },
  );

  await t.test(
    'reset-password rejects unknown users, admins and bad input',
    async () => {
      updates.length = 0;
      target = null;
      let response = await send('POST', '/admin/users/99/reset-password', {
        temporary_password: 'Another-temp-pass',
      });
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.code, 'RESOURCE_NOT_FOUND');

      target = { id: 2, role: 'admin', status: 'active', session_version: 0 };
      response = await send('POST', '/admin/users/2/reset-password', {
        temporary_password: 'Another-temp-pass',
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, 'FORBIDDEN');

      for (const [path, body] of [
        ['/admin/users/5/reset-password', { temporary_password: 'short' }],
        ['/admin/users/5/reset-password', {}],
        [
          '/admin/users/0/reset-password',
          { temporary_password: 'Another-temp-pass' },
        ],
        [
          '/admin/users/abc/reset-password',
          { temporary_password: 'Another-temp-pass' },
        ],
      ] as [string, any][]) {
        response = await send('POST', path, body);
        assert.equal(response.status, 422, path);
        assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
      }
      assert.deepEqual(updates, []);
    },
  );
});

import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Module, Global } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { devAuthEnabled } from '../dist/dev/dev-auth.js';
import { DevAuthModule } from '../dist/dev/dev-auth.module.js';
import { AttendanceController } from '../dist/attendance/attendance.controller.js';
import { AttendanceGuard } from '../dist/attendance/attendance.guard.js';
import { AttendanceService } from '../dist/attendance/attendance.service.js';
import { DATABASE } from '../dist/database/database.constants.js';

test('development authentication is explicit and refuses production and remote databases', () => {
  assert.equal(
    devAuthEnabled({ NODE_ENV: 'development', DB_HOST: 'db' }),
    false,
  );
  assert.equal(
    devAuthEnabled({ NODE_ENV: 'production', DEV_AUTH_ENABLED: 'false' }),
    false,
  );
  for (const NODE_ENV of ['production', 'test', undefined])
    assert.throws(
      () =>
        devAuthEnabled({ NODE_ENV, DEV_AUTH_ENABLED: 'true', DB_HOST: 'db' }),
      /development/,
    );
  assert.throws(
    () =>
      devAuthEnabled({
        NODE_ENV: 'development',
        DEV_AUTH_ENABLED: 'true',
        DB_HOST: 'production.example',
      }),
    /local/,
  );
  assert.equal(
    devAuthEnabled({
      NODE_ENV: 'development',
      DEV_AUTH_ENABLED: 'true',
      DB_HOST: 'db',
    }),
    true,
  );
});

test('real cookie flow: bootstrap, select seeded role, guard access, rotate, logout and revoke', async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'development',
    DEV_AUTH_ENABLED: 'true',
    DB_HOST: 'db',
  });
  t.after(() => {
    for (const key of ['NODE_ENV', 'DEV_AUTH_ENABLED', 'DB_HOST']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  const student: Record<string, any> = {
    id: 3,
    email: 'student.one@example.com',
    role: 'student',
    name: 'Demo student',
    status: 'active',
    must_change_password: false,
    session_version: 0,
    password_hash: 'never expose',
  };
  const teacher: Record<string, any> = {
    ...student,
    id: 2,
    email: 'lecturer.one@example.com',
    role: 'teacher',
  };
  const users = [student, teacher];
  class TestDatabase {}
  Global()(TestDatabase);
  Module({
    providers: [
      {
        provide: DATABASE,
        useValue: {
          getRepository: () => ({
            findOneBy: async (where: Record<string, any>) =>
              users.find((u) =>
                Object.entries(where).every(([k, v]) => u[k] === v),
              ),
          }),
        },
      },
    ],
    exports: [DATABASE],
  })(TestDatabase);
  class TestApp {}
  Module({
    imports: [TestDatabase, DevAuthModule],
    controllers: [AttendanceController],
    providers: [
      AttendanceGuard,
      {
        provide: AttendanceService,
        useValue: {
          list: async (user: { id: number }) => ({
            data: [{ student_id: user.id }],
            meta: {},
          }),
        },
      },
    ],
  })(TestApp);
  const app = await NestFactory.create(TestApp, { logger: false });
  t.after(() => app.close());
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  let cookie = '';
  let token: string | undefined;
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    csrf = token,
    updateCookie = true,
  ) {
    const response = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        cookie,
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (updateCookie && response.headers.has('set-cookie'))
      cookie = response.headers.get('set-cookie')!.split(';')[0];
    return response;
  }
  assert.equal((await request('/auth/me')).status, 401);
  assert.equal(
    (await request('/dev/auth/select-role', 'POST', { role: 'student' }))
      .status,
    403,
  );
  let response = await request('/auth/csrf');
  token = (await response.json()).data.csrfToken;
  assert.match(
    response.headers.get('set-cookie')!,
    /HttpOnly; SameSite=Strict/,
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const anonymousCookie = cookie;
  assert.equal(
    (
      await request(
        '/dev/auth/select-role',
        'POST',
        { role: 'student' },
        'wrong',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/dev/auth/select-role', 'POST', {
        role: 'student',
        userId: 999,
      })
    ).status,
    200,
  );
  const studentCookie = cookie;
  assert.notEqual(studentCookie, anonymousCookie);
  response = await request('/auth/me');
  const profile = (await response.json()).data;
  assert.equal(profile.id, 3);
  assert.equal(profile.password_hash, undefined);
  assert.equal(
    (await (await request('/me/class-sessions')).json()).data[0].student_id,
    3,
  );
  assert.equal(
    (await request('/dev/auth/select-role', 'POST', { role: 'teacher' }))
      .status,
    403,
  ); // old CSRF is invalid after rotation
  token = (await (await request('/auth/csrf')).json()).data.csrfToken;
  assert.equal(
    (await request('/dev/auth/select-role', 'POST', { role: 'arbitrary' }))
      .status,
    422,
  );
  assert.equal(
    (await request('/dev/auth/select-role', 'POST', { role: 'admin' })).status,
    409,
  ); // missing seed: no arbitrary fallback
  assert.equal(
    (await request('/dev/auth/select-role', 'POST', { role: 'teacher' }))
      .status,
    200,
  );
  assert.equal((await (await request('/auth/me')).json()).data.role, 'teacher');
  teacher.session_version++;
  assert.equal((await request('/auth/me')).status, 401);
  assert.equal((await request('/me/class-sessions')).status, 401);
  token = (await (await request('/auth/csrf')).json()).data.csrfToken;
  assert.equal((await request('/auth/logout', 'POST')).status, 204);
  assert.equal((await request('/auth/me')).status, 401);
  cookie = studentCookie;
  assert.equal((await request('/auth/me')).status, 401); // switching invalidated previous cookie
  cookie = anonymousCookie;
  assert.equal((await request('/auth/me')).status, 401);
});

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { DataSource } from 'typeorm';
import { AuthController } from '../dist/auth/auth.controller.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { AuthCookies } from '../dist/auth/auth.cookies.js';
import { AuthThrottleGuard } from '../dist/auth/auth-throttle.guard.js';
import { jwtOptions } from '../dist/auth/auth.config.js';
import { DATABASE } from '../dist/database/database.constants.js';
import { User, RefreshSession } from '../dist/database/entities/index.js';
import { JwtAuthGuard } from '../dist/auth/jwt-auth.guard.js';
import { RolesGuard } from '../dist/auth/roles.guard.js';
import { Roles } from '../dist/auth/roles.decorator.js';
import { CurrentUser } from '../dist/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../dist/auth/auth-request.js';
import { AttendanceGuard } from '../dist/attendance/attendance.guard.js';
import { AttendanceController } from '../dist/attendance/attendance.controller.js';
import { AttendanceService } from '../dist/attendance/attendance.service.js';
import { AttendanceRecordsController } from '../dist/attendance/me-attendance-records.controller.js';
import { AttendanceHistoryService } from '../dist/attendance/attendance-history.service.js';
import { ClassSessionRecordsController } from '../dist/attendance/class-session-records.controller.js';
import { ClassSessionRecordsService } from '../dist/attendance/class-session-records.service.js';
import { createValidationPipe } from '../dist/common/validation.pipe.js';

export async function authIntegration(
  t: TestContext,
  database: DataSource,
): Promise<void> {
  const password = 'Initial-password-' + randomBytes(12).toString('hex');
  const nextPassword = 'Changed-password-' + randomBytes(12).toString('hex');
  const email = `auth-${randomBytes(8).toString('hex')}@example.com`;
  const user = await database.getRepository(User).save({
    name: 'Auth integration',
    email,
    password_hash: await argon2.hash(password),
    role: 'student',
    status: 'active',
    must_change_password: true,
  });
  class PublicController {
    open() {
      return { accessible: true };
    }
  }
  Controller('public-probe')(PublicController);
  Get()(
    PublicController.prototype,
    'open',
    Object.getOwnPropertyDescriptor(PublicController.prototype, 'open')!,
  );
  class ProtectedController {
    admin(current: AuthenticatedUser) {
      return current;
    }
    student(current: AuthenticatedUser) {
      return current;
    }
  }
  Controller('protected-probe')(ProtectedController);
  UseGuards(JwtAuthGuard, RolesGuard)(ProtectedController);
  Roles('admin')(ProtectedController);
  for (const method of ['admin', 'student'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(
      ProtectedController.prototype,
      method,
    )!;
    Get(method)(ProtectedController.prototype, method, descriptor);
    CurrentUser()(ProtectedController.prototype, method, 0);
  }
  Roles('student')(
    ProtectedController.prototype,
    'student',
    Object.getOwnPropertyDescriptor(ProtectedController.prototype, 'student')!,
  );
  class RolesOnlyController {
    read() {
      return {};
    }
  }
  Controller('roles-only')(RolesOnlyController);
  UseGuards(RolesGuard)(RolesOnlyController);
  Get()(
    RolesOnlyController.prototype,
    'read',
    Object.getOwnPropertyDescriptor(RolesOnlyController.prototype, 'read')!,
  );
  class TestModule {}
  Module({
    imports: [
      JwtModule.register(
        jwtOptions({ JWT_SECRET: randomBytes(48).toString('hex') }),
      ),
    ],
    controllers: [
      AuthController,
      PublicController,
      ProtectedController,
      RolesOnlyController,
      AttendanceController,
      AttendanceRecordsController,
      ClassSessionRecordsController,
    ],
    providers: [
      { provide: DATABASE, useValue: database },
      AuthService,
      AuthCookies,
      AuthThrottleGuard,
      JwtAuthGuard,
      RolesGuard,
      AttendanceGuard,
      AttendanceService,
      AttendanceHistoryService,
      ClassSessionRecordsService,
    ],
  })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const auth = app.get(AuthService);
  const bearer = (token: string) => `Bearer ${token}`;
  const jar = new Map<string, string>();
  let csrf = '';
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    access?: string,
    useCsrf = true,
  ) {
    const response = await fetch(base + '/api/v1/' + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(useCsrf && csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(access ? { Authorization: bearer(access) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]!;
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const payload = response.status === 204 ? null : await response.json();
    if (payload?.data?.csrfToken) csrf = payload.data.csrfToken;
    return { response, payload };
  }
  async function login(pass = password) {
    await request('auth/csrf');
    const result = await request('auth/login', 'POST', {
      email,
      password: pass,
    });
    assert.equal(result.response.status, 200);
    return result.payload.data.accessToken as string;
  }
  try {
    await t.test(
      'JWT endpoints leave unrelated routes public and require CSRF for login',
      async () => {
        assert.equal((await request('public-probe')).response.status, 200);
        assert.equal((await request('auth/me')).response.status, 401);
        assert.equal(
          (
            await request(
              'auth/login',
              'POST',
              { email, password },
              undefined,
              false,
            )
          ).response.status,
          403,
        );
        await request('auth/csrf');
        assert.equal(
          (await request('auth/login', 'POST', { email, password: 123 }))
            .response.status,
          422,
        );
        assert.equal(
          (await request('auth/login', 'POST', { email, password: 'wrong' }))
            .response.status,
          401,
        );
        assert.equal(
          (
            await request('auth/login', 'POST', {
              email: 'absent@example.com',
              password,
            })
          ).response.status,
          401,
        );
      },
    );
    await t.test(
      'login returns safe profile and HttpOnly cookie; hashes only are stored',
      async () => {
        await request('auth/csrf');
        const result = await request('auth/login', 'POST', { email, password });
        assert.equal(result.response.status, 200);
        assert.equal(result.response.headers.get('cache-control'), 'no-store');
        assert.ok(
          result.response.headers
            .getSetCookie()
            .some(
              (c) =>
                c.startsWith('ot_refresh=') &&
                c.includes('HttpOnly') &&
                c.includes('SameSite=Strict'),
            ),
        );
        assert.equal(result.payload.data.user.must_change_password, true);
        assert.equal(result.payload.data.user.password_hash, undefined);
        const access = result.payload.data.accessToken as string;
        assert.equal(
          (await request('auth/me', 'GET', undefined, access)).payload.data.id,
          user.id,
        );
        assert.equal(
          (await request('auth/me', 'GET', undefined, access + 'tampered'))
            .response.status,
          401,
        );
        const session = await database
          .getRepository(RefreshSession)
          .createQueryBuilder('s')
          .addSelect('s.token_hash')
          .where('s.user_id = :id', { id: user.id })
          .getOneOrFail();
        assert.equal(session.token_hash.length, 64);
        assert.notEqual(session.token_hash, jar.get('ot_refresh'));
      },
    );
    await t.test(
      'forged refresh credentials cannot revoke a legitimate session',
      async () => {
        const issued = await auth.login({ email, password });
        const [header, payload] = issued.refreshToken.split('.');
        const forged = `${header}.${payload}.${'x'.repeat(43)}`;
        await assert.rejects(auth.refresh(forged));
        await assert.rejects(auth.logout(forged));
        await assert.rejects(auth.refresh(issued.response.accessToken));
        await assert.rejects(auth.logout(issued.response.accessToken));
        assert.equal(
          (await auth.authenticate(bearer(issued.response.accessToken))).user
            .id,
          user.id,
        );
        const rotated = await auth.refresh(issued.refreshToken);
        await auth.logout(rotated.refreshToken);
      },
    );
    await t.test(
      'refresh rotates credentials; replay revokes the session including access JWTs',
      async () => {
        const old = jar.get('ot_refresh')!;
        const validCsrf = csrf;
        jar.set('ot_csrf', 'forged');
        csrf = 'forged';
        const forged = await request('auth/refresh', 'POST');
        assert.equal(forged.response.status, 403);
        assert.equal(forged.response.headers.get('cache-control'), 'no-store');
        csrf = validCsrf;
        jar.set('ot_csrf', validCsrf);
        assert.equal(
          (await request('auth/me', 'GET', undefined, validCsrf)).response
            .status,
          401,
        );

        assert.equal(
          (await request('auth/refresh', 'POST', undefined, undefined, false))
            .response.status,
          403,
        );
        const rotated = await request('auth/refresh', 'POST');
        assert.equal(rotated.response.status, 200);
        const fresh = jar.get('ot_refresh')!;
        assert.notEqual(fresh, old);
        assert.equal(
          (
            await request(
              'auth/me',
              'GET',
              undefined,
              rotated.payload.data.accessToken,
            )
          ).response.status,
          200,
        );
        await assert.rejects(auth.refresh(old));
        await assert.rejects(auth.refresh(fresh));
        await assert.rejects(
          auth.authenticate(bearer(rotated.payload.data.accessToken)),
        );
      },
    );
    await t.test(
      'logout clears cookies and immediately invalidates access and refresh credentials',
      async () => {
        const access = await login();
        const token = jar.get('ot_refresh')!;
        assert.equal(
          (await request('auth/logout', 'POST', undefined, undefined, false))
            .response.status,
          403,
        );
        const result = await request('auth/logout', 'POST');
        assert.equal(result.response.status, 204);
        assert.equal(jar.get('ot_refresh'), '');
        await assert.rejects(auth.authenticate(bearer(access)));
        await assert.rejects(auth.refresh(token));
      },
    );
    await t.test(
      'inactive users, expired sessions and changed session versions cannot authenticate',
      async () => {
        const issued = await auth.login({ email, password });
        await database
          .getRepository(User)
          .update(user.id, { status: 'inactive' });
        await assert.rejects(auth.login({ email, password }));
        await assert.rejects(auth.refresh(issued.refreshToken));
        await assert.rejects(
          auth.authenticate(bearer(issued.response.accessToken)),
        );
        await database
          .getRepository(User)
          .update(user.id, { status: 'active', session_version: 1 });
        await assert.rejects(
          auth.authenticate(bearer(issued.response.accessToken)),
        );
        await assert.rejects(auth.refresh(issued.refreshToken));
        await database
          .getRepository(User)
          .update(user.id, { session_version: 0 });
        await database
          .getRepository(RefreshSession)
          .update(
            { user_id: user.id },
            { expires_at: new Date(Date.now() - 1000) },
          );
        await assert.rejects(auth.refresh(issued.refreshToken));
        await assert.rejects(
          auth.authenticate(bearer(issued.response.accessToken)),
        );
      },
    );
    await t.test(
      'password change checks current password and revokes every login',
      async () => {
        const access = await login();
        const second = await auth.login({ email, password });
        const body = { currentPassword: password, newPassword: nextPassword };
        assert.equal(
          (await request('auth/change-password', 'POST', body)).response.status,
          401,
        );
        assert.equal(
          (
            await request(
              'auth/change-password',
              'POST',
              { ...body, currentPassword: 'wrong' },
              access,
            )
          ).response.status,
          401,
        );
        assert.equal(
          (
            await request(
              'auth/change-password',
              'POST',
              { ...body, newPassword: 'short' },
              access,
            )
          ).response.status,
          422,
        );
        assert.equal(
          (await request('auth/change-password', 'POST', body, access)).response
            .status,
          204,
        );
        await assert.rejects(auth.authenticate(bearer(access)));
        await assert.rejects(
          auth.authenticate(bearer(second.response.accessToken)),
        );
        await assert.rejects(auth.refresh(second.refreshToken));
        await assert.rejects(auth.login({ email, password }));
        const updated = await auth.login({ email, password: nextPassword });
        assert.equal(updated.response.user.must_change_password, false);
        const current = await database
          .getRepository(User)
          .findOneByOrFail({ id: user.id });
        assert.equal(current.session_version, 1);
      },
    );
    await t.test(
      'opt-in guards expose verified identity, enforce roles and read current account state',
      async () => {
        const issued = await auth.login({ email, password: nextPassword });
        const access = issued.response.accessToken;
        assert.equal(
          (await request('protected-probe/student')).response.status,
          401,
        );
        assert.equal((await request('roles-only')).response.status, 401);
        assert.equal(
          (await request('protected-probe/admin', 'GET', undefined, access))
            .response.status,
          403,
        );
        const allowed = await request(
          'protected-probe/student',
          'GET',
          undefined,
          access,
        );
        assert.equal(allowed.response.status, 200);
        assert.deepEqual(allowed.payload, { id: user.id, role: 'student' });
        await database.getRepository(User).update(user.id, { role: 'admin' });
        assert.equal(
          (await request('protected-probe/admin', 'GET', undefined, access))
            .response.status,
          200,
        );
        assert.equal(
          (await request('protected-probe/student', 'GET', undefined, access))
            .response.status,
          403,
        );
        await database
          .getRepository(User)
          .update(user.id, { role: 'student', must_change_password: true });
        const blocked = await request(
          'protected-probe/student',
          'GET',
          undefined,
          access,
        );
        assert.equal(blocked.response.status, 403);
        assert.equal(blocked.payload.error.code, 'PASSWORD_CHANGE_REQUIRED');
        assert.equal(
          (await request('auth/me', 'GET', undefined, access)).response.status,
          200,
        );
        await database
          .getRepository(User)
          .update(user.id, { must_change_password: false, status: 'inactive' });
        assert.equal(
          (await request('protected-probe/student', 'GET', undefined, access))
            .response.status,
          401,
        );
        await database
          .getRepository(User)
          .update(user.id, { status: 'active' });
        await auth.logout(issued.refreshToken);
        assert.equal(
          (await request('protected-probe/student', 'GET', undefined, access))
            .response.status,
          401,
        );
        assert.equal((await request('public-probe')).response.status, 200);
      },
    );
    await t.test(
      'existing attendance endpoints accept JWTs and preserve roles and check-in rules',
      async () => {
        const issued = await auth.login({ email, password: nextPassword });
        const access = issued.response.accessToken;
        assert.equal((await request('me/class-sessions')).response.status, 401);
        assert.equal(
          (await request('me/attendance-records', 'GET', undefined, access))
            .response.status,
          200,
        );
        assert.equal(
          (await request('me/class-sessions', 'GET', undefined, access))
            .response.status,
          200,
        );
        assert.equal(
          (await request('class-sessions/1/records', 'GET', undefined, access))
            .response.status,
          403,
        );
        // This valid Bearer request reaches domain authorization without a CSRF header.
        // The test user has no enrolment, so the class must remain inaccessible.
        const checkin = await request(
          'class-sessions/1/check-ins',
          'POST',
          {
            latitude: 0,
            longitude: 0,
            accuracy_m: 5,
            reading_timestamp: new Date().toISOString(),
          },
          access,
          false,
        );
        assert.equal(checkin.response.status, 404);
        await database.getRepository(User).update(user.id, { role: 'admin' });
        assert.equal(
          (await request('me/attendance-records', 'GET', undefined, access))
            .response.status,
          403,
        );
        assert.equal(
          (await request('class-sessions/1/records', 'GET', undefined, access))
            .response.status,
          200,
        );
        await database
          .getRepository(User)
          .update(user.id, { role: 'student', must_change_password: true });
        const blocked = await request(
          'me/class-sessions',
          'GET',
          undefined,
          access,
        );
        assert.equal(blocked.response.status, 403);
        assert.equal(blocked.payload.error.code, 'PASSWORD_CHANGE_REQUIRED');
        await database
          .getRepository(User)
          .update(user.id, { must_change_password: false });
        await auth.logout(issued.refreshToken);
        assert.equal(
          (await request('me/class-sessions', 'GET', undefined, access))
            .response.status,
          401,
        );
      },
    );
    await t.test(
      'simultaneous refresh replay leaves no valid session',
      async () => {
        const issued = await auth.login({ email, password: nextPassword });
        const results = await Promise.allSettled([
          auth.refresh(issued.refreshToken),
          auth.refresh(issued.refreshToken),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        const success = results.find((r) => r.status === 'fulfilled');
        assert.ok(success?.status === 'fulfilled');
        await assert.rejects(auth.refresh(success.value.refreshToken));
      },
    );
    await t.test(
      'login attempts are throttled while unrelated endpoints remain accessible',
      async () => {
        await request('auth/csrf');
        let limited = false;
        for (let i = 0; i < 11; i++) {
          const result = await request('auth/login', 'POST', {
            email,
            password: 'wrong',
          });
          if (result.response.status === 429) {
            limited = true;
            assert.ok(Number(result.response.headers.get('retry-after')) > 0);
            break;
          }
        }
        assert.ok(limited);
        assert.equal((await request('public-probe')).response.status, 200);
      },
    );
  } finally {
    await app.close();
    await database.getRepository(RefreshSession).delete({ user_id: user.id });
    await database.getRepository(User).delete(user.id);
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions, Request, Response } from 'express';
import { AuthCookies } from '../dist/auth/auth.cookies.js';
import { jwtOptions } from '../dist/auth/auth.config.js';
import { tokenHash } from '../dist/auth/auth.service.js';

const jwt = () => new JwtService(jwtOptions({ JWT_SECRET: 'a'.repeat(48) }));
const request = (cookie: string, csrf?: string) =>
  ({
    headers: { cookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
  }) as Request;
function response() {
  const set: { name: string; value: string; options: CookieOptions }[] = [];
  const cleared: { name: string; options: CookieOptions }[] = [];
  const res = {
    cookie(name: string, value: string, options: CookieOptions) {
      set.push({ name, value, options });
    },
    clearCookie(name: string, options: CookieOptions) {
      cleared.push({ name, options });
    },
  } as unknown as Response;
  return { set, cleared, res };
}

test('production cookies use Secure, HttpOnly, host prefixes and matching deletion scope', async (t) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
  const cookies = new AuthCookies(jwt());
  const result = response();
  await cookies.issue(request(''), result.res, {
    response: {
      accessToken: 'access',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: 1,
        name: 'Student',
        email: 'student@example.com',
        role: 'student',
        must_change_password: false,
      },
    },
    refreshToken: 'refresh',
    expiresAt: new Date(Date.now() + 60000),
  });
  cookies.clear(result.res);
  assert.deepEqual(
    result.set.map((c) => c.name),
    ['__Host-ot_refresh', '__Host-ot_csrf'],
  );
  for (const cookie of [...result.set, ...result.cleared]) {
    assert.equal(cookie.options.secure, true);
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.sameSite, 'strict');
    assert.equal(cookie.options.path, '/');
    assert.equal(cookie.options.domain, undefined);
  }
  assert.deepEqual(
    result.cleared.map((c) => c.name),
    result.set.map((c) => c.name),
  );
});

test('CSRF rejects expiry, refresh-cookie mismatch and duplicate cookie injection', async (t) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
  const service = jwt();
  const cookies = new AuthCookies(service);
  const result = response();
  const token = await cookies.csrf(
    request('ot_refresh=valid-refresh'),
    result.res,
  );
  await cookies.checkCsrf(
    request(`ot_refresh=valid-refresh; ot_csrf=${token}`, token),
  );
  await assert.rejects(
    cookies.checkCsrf(request(`ot_refresh=other; ot_csrf=${token}`, token)),
  );
  await assert.rejects(
    cookies.checkCsrf(
      request(
        `ot_refresh=valid-refresh; ot_csrf=${token}; ot_csrf=${token}`,
        token,
      ),
    ),
  );
  await assert.rejects(
    cookies.checkCsrf(
      request(
        `ot_refresh=valid-refresh; ot_refresh=other; ot_csrf=${token}`,
        token,
      ),
    ),
  );
  const expired = await service.signAsync(
    { purpose: 'csrf', binding: tokenHash('valid-refresh') },
    { audience: 'opentexila-csrf', expiresIn: -1 },
  );
  await assert.rejects(
    cookies.checkCsrf(
      request(`ot_refresh=valid-refresh; ot_csrf=${expired}`, expired),
    ),
  );
});

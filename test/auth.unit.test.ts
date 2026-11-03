import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JwtService } from '@nestjs/jwt';
import { jwtOptions } from '../dist/auth/auth.config.js';

test('JWT configuration rejects missing or short signing secrets', () => {
  for (const JWT_SECRET of [undefined, '', 'short']) {
    assert.throws(() => jwtOptions({ JWT_SECRET }), /JWT_SECRET/);
  }
});

test('JWT verification enforces signature, expiry, issuer and audience', async () => {
  const jwt = new JwtService(jwtOptions({ JWT_SECRET: 'a'.repeat(48) }));
  const claims = { sub: '1', sid: 'test-session', sessionVersion: 0 };
  const token = await jwt.signAsync(claims);
  assert.equal((await jwt.verifyAsync(token)).sub, '1');
  for (const options of [
    { secret: 'b'.repeat(48) },
    { expiresIn: -1 },
    { issuer: 'other' },
    { audience: 'other' },
  ]) {
    const invalid = await jwt.signAsync(claims, options);
    await assert.rejects(jwt.verifyAsync(invalid));
  }
});

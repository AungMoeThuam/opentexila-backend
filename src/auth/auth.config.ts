import type { JwtModuleOptions } from '@nestjs/jwt';

export function jwtOptions(
  env: NodeJS.ProcessEnv = process.env,
): JwtModuleOptions {
  const secret = env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error(
      'JWT_SECRET must contain at least 32 bytes. Generate a random secret.',
    );
  }
  return {
    secret,
    signOptions: {
      algorithm: 'HS256',
      expiresIn: 900,
      issuer: 'opentexila',
      audience: 'opentexila-api',
    },
    verifyOptions: {
      algorithms: ['HS256'],
      issuer: 'opentexila',
      audience: 'opentexila-api',
    },
  };
}

// Endpoint activation is separate from route protection.
export function jwtAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (
    env.JWT_AUTH_ENABLED !== undefined &&
    !['true', 'false'].includes(env.JWT_AUTH_ENABLED)
  ) {
    throw new Error('JWT_AUTH_ENABLED must be true or false.');
  }
  if (env.JWT_AUTH_ENABLED !== 'true') return false;
  if (env.DEV_AUTH_ENABLED === 'true') {
    throw new Error(
      'Choose JWT_AUTH_ENABLED or DEV_AUTH_ENABLED; their auth routes overlap.',
    );
  }
  return true;
}

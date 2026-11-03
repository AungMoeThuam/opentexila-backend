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

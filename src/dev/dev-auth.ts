import type { Request } from 'express';

export interface DevSession {
  csrfToken: string;
  cookie: { expires: Date };
  userId?: number;
  sessionVersion?: number;
}

export type SessionRequest = Request & {
  session?: DevSession;
  devSessionId?: string;
};

export function devAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DEV_AUTH_ENABLED !== 'true') return false;
  if (env.NODE_ENV !== 'development')
    throw new Error('DEV_AUTH_ENABLED requires NODE_ENV=development.');
  if (!['localhost', '127.0.0.1', '::1', 'db'].includes(env.DB_HOST ?? ''))
    throw new Error(
      'Development authentication requires a local development database.',
    );
  return true;
}

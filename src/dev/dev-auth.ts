import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response, RequestHandler } from 'express';
import type { DataSource } from 'typeorm';
import type { UserEntity, UserRole } from '../database/entities';

export interface DevSession {
  csrfToken: string;
  cookie: { expires: Date };
  userId?: number;
  sessionVersion?: number;
}

export type SessionRequest = Request & {
  session?: DevSession;
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

const accounts: Readonly<Record<UserRole, string>> = Object.freeze({
  student: 'student.one@example.com',
  teacher: 'lecturer.one@example.com',
  admin: 'admin.demo@example.com',
});

const cookieName = 'ot_dev_session';
const lifetime = 8 * 60 * 60 * 1000;

const profile = (user: UserEntity) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  must_change_password: user.must_change_password,
});

// Local development only. Opaque cookies refer to memory owned by this process;
// restarting the API expires all sessions. No client-supplied identity is trusted.
export function createDevAuthMiddleware(
  database: DataSource,
  env: NodeJS.ProcessEnv = process.env,
): RequestHandler {
  if (!devAuthEnabled(env))
    throw new Error('Development authentication is disabled.');
  const sessions = new Map<string, DevSession>();
  const error = (
    response: Response,
    status: number,
    code: string,
    message: string,
  ) => response.status(status).json({ error: { code, message, fields: {} } });

  return async (
    request: SessionRequest,
    response: Response,
    next: NextFunction,
  ) => {
    const path = request.path;
    const handled = [
      '/api/v1/auth/csrf',
      '/api/v1/auth/me',
      '/api/v1/auth/logout',
      '/api/v1/dev/auth/select-role',
    ].includes(path);
    if (handled) response.setHeader('Cache-Control', 'no-store');
    try {
      const now = Date.now();
      for (const [key, session] of sessions)
        if (+session.cookie.expires <= now) sessions.delete(key);
      const id = (request.headers.cookie || '')
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
      let session = id ? sessions.get(id) : undefined;
      if (session) request.session = session;
      const create = (user?: UserEntity): DevSession | null => {
        if (id) sessions.delete(id);
        if (sessions.size >= 1000) return null;
        const token = randomBytes(32).toString('hex');
        session = {
          csrfToken: randomBytes(32).toString('hex'),
          cookie: { expires: new Date(now + lifetime) },
          ...(user
            ? { userId: user.id, sessionVersion: user.session_version }
            : {}),
        };
        sessions.set(token, session);
        request.session = session;
        response.setHeader(
          'Set-Cookie',
          `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetime / 1000}`,
        );
        return session;
      };
      if (!handled) return next();
      if (request.method === 'GET' && path === '/api/v1/auth/csrf') {
        if (!session && !create())
          return error(
            response,
            503,
            'DEV_SESSION_LIMIT',
            'Too many development sessions. Restart the API.',
          );
        return response.json({ data: { csrfToken: session!.csrfToken } });
      }
      if (request.method === 'GET' && path === '/api/v1/auth/me') {
        if (!session?.userId)
          return error(
            response,
            401,
            'UNAUTHENTICATED',
            'Select a development role to sign in.',
          );
        const user = await database
          .getRepository<UserEntity>('User')
          .findOneBy({ id: session.userId });
        if (
          !user ||
          user.session_version !== session.sessionVersion ||
          user.status !== 'active'
        )
          return error(
            response,
            401,
            'UNAUTHENTICATED',
            'This development session is no longer valid.',
          );
        return response.json({ data: profile(user) });
      }
      if (
        request.method === 'POST' &&
        ['/api/v1/auth/logout', '/api/v1/dev/auth/select-role'].includes(path)
      ) {
        const actual = request.headers['x-csrf-token'];
        const expected = session?.csrfToken;
        if (
          !expected ||
          typeof actual !== 'string' ||
          Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
          !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
        )
          return error(
            response,
            403,
            'CSRF_INVALID',
            'The security token is missing or invalid.',
          );
        if (path === '/api/v1/auth/logout') {
          if (id) sessions.delete(id);
          response.setHeader(
            'Set-Cookie',
            `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
          );
          return response.status(204).end();
        }
        const role = request.body?.role;
        if (typeof role !== 'string' || !Object.hasOwn(accounts, role))
          return error(
            response,
            422,
            'VALIDATION_ERROR',
            'Select student, teacher or admin.',
          );
        const user = await database
          .getRepository<UserEntity>('User')
          .findOneBy({ email: accounts[role as UserRole] });
        if (!user)
          return error(
            response,
            409,
            'DEV_ACCOUNT_MISSING',
            'Demo account is missing. Run npm run db:seed in the backend first.',
          );
        if (
          user.role !== role ||
          user.status !== 'active' ||
          user.must_change_password
        )
          return error(
            response,
            403,
            'DEV_ACCOUNT_UNAVAILABLE',
            'The demo account must have the expected role, be active, and have no required password change.',
          );
        if (!create(user))
          return error(
            response,
            503,
            'DEV_SESSION_LIMIT',
            'Too many development sessions. Restart the API.',
          );
        return response.json({ data: profile(user) });
      }
      return error(
        response,
        404,
        'RESOURCE_NOT_FOUND',
        'The requested resource was not found.',
      );
    } catch {
      return error(
        response,
        500,
        'INTERNAL_ERROR',
        'Development account services are unavailable.',
      );
    }
  };
}

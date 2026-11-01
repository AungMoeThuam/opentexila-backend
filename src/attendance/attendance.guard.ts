import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import type { UserEntity } from '../database/entities';
import type { DevSession } from '../dev/dev-auth';
import { AttendanceCaller, fail } from './attendance.rules';

export type AttendanceRequest = Request & {
  session?: DevSession;
  attendanceUser?: AttendanceCaller;
};

// Integration seam for the auth feature: req.session must be populated by the
// verified server-side cookie-session middleware, never by request input.
@Injectable()
export class AttendanceGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AttendanceRequest>();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const session = request.session;
    const expires =
      session?.cookie?.expires && new Date(session.cookie.expires).getTime();
    if (
      !session ||
      !Number.isSafeInteger(session.userId) ||
      session.userId! <= 0 ||
      !Number.isSafeInteger(session.sessionVersion) ||
      !expires ||
      expires <= Date.now()
    )
      fail(401, 'UNAUTHENTICATED', 'A valid sign-in session is required.');
    const user = await this.database
      .getRepository<UserEntity>('User')
      .findOneBy({ id: session.userId });
    if (!user || user.session_version !== session.sessionVersion)
      fail(401, 'UNAUTHENTICATED', 'A valid sign-in session is required.');
    if (user.status !== 'active')
      fail(403, 'ACCOUNT_INACTIVE', 'Your account is inactive.');
    if (user.must_change_password)
      fail(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Change your password before continuing.',
      );
    if (request.method === 'POST') {
      const expected = session.csrfToken;
      const actual = request.headers['x-csrf-token'];
      if (
        typeof expected !== 'string' ||
        !expected ||
        typeof actual !== 'string' ||
        Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
      )
        fail(403, 'CSRF_INVALID', 'The security token is missing or invalid.');
    }
    request.attendanceUser = { id: user.id, role: user.role };
    return true;
  }
}

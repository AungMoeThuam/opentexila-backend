import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { User, type UserRole } from '../database/entities';
import type { DevSession } from '../dev/dev-auth';
import { AttendanceCaller, fail } from './attendance.rules';
import { ATTENDANCE_ROLES } from './roles.decorator';

export type AttendanceRequest = Request & {
  session?: DevSession;
  attendanceUser?: AttendanceCaller;
};

// Integration seam for the auth feature: req.session must be populated by the
// verified server-side cookie-session middleware, never by request input.
@Injectable()
export class AttendanceGuard implements CanActivate {
  constructor(
    @Inject(DATABASE) private readonly database: DataSource,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AttendanceRequest>();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const session = request.session;
    const expires =
      session?.cookie?.expires && new Date(session.cookie.expires).getTime();
    if (
      !session ||
      typeof session.userId !== 'number' ||
      !Number.isSafeInteger(session.userId) ||
      session.userId <= 0 ||
      !Number.isSafeInteger(session.sessionVersion) ||
      !expires ||
      expires <= Date.now()
    )
      fail(401, 'UNAUTHENTICATED', 'A valid sign-in session is required.');
    const user = await this.database
      .getRepository(User)
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
    const roles = this.reflector.getAllAndOverride<readonly UserRole[]>(
      ATTENDANCE_ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (roles && !roles.includes(user.role))
      fail(403, 'FORBIDDEN', 'Your role cannot perform this operation.');
    return true;
  }
}

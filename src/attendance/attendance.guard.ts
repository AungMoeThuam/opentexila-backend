import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { User, type UserRole } from '../database/entities';
import type { DevSession } from '../dev/dev-auth';
import { fail } from './attendance.rules';
import { AUTH_ROLES } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { jwtAuthEnabled } from '../auth/auth.config';
import type { AuthenticatedRequest } from '../auth/auth-request';

export type AttendanceRequest = AuthenticatedRequest & {
  session?: DevSession;
};

// JWT mode accepts only Bearer credentials. Demo mode uses server-owned sessions.
@Injectable()
export class AttendanceGuard implements CanActivate {
  constructor(
    @Inject(DATABASE) private readonly database: DataSource,
    private readonly reflector: Reflector,
    @Optional() private readonly jwtGuard?: JwtAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AttendanceRequest>();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    delete request.authUser;
    if (this.jwtGuard) {
      await this.jwtGuard.canActivate(context);
    } else {
      if (jwtAuthEnabled())
        fail(503, 'AUTH_UNAVAILABLE', 'JWT authentication is unavailable.');
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
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const expected = session.csrfToken;
        const actual = request.headers['x-csrf-token'];
        if (
          typeof expected !== 'string' ||
          !expected ||
          typeof actual !== 'string' ||
          Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
          !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
        )
          fail(
            403,
            'CSRF_INVALID',
            'The security token is missing or invalid.',
          );
      }
      request.authUser = { id: user.id, role: user.role };
    }
    const user = request.authUser;
    if (!user) fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    const roles = this.reflector.getAllAndOverride<readonly UserRole[]>(
      AUTH_ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (roles && !roles.includes(user.role))
      fail(403, 'FORBIDDEN', 'Your role cannot perform this operation.');
    return true;
  }
}

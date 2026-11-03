import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth-request';
import { ApiException } from '../common/api-exception';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    http.getResponse<Response>().setHeader('Cache-Control', 'no-store');
    // Always verify the Bearer credential; never trust existing request input.
    delete request.authUser;
    const { user } = await this.auth.authenticate(
      request.headers.authorization,
    );
    if (user.must_change_password) {
      throw new ApiException(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Change your password before continuing.',
      );
    }
    request.authUser = { id: user.id, role: user.role };
    return true;
  }
}

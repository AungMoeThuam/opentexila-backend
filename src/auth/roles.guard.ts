import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth-request';
import type { UserRole } from '../database/entities';
import { ApiException } from '../common/api-exception';
import { AUTH_ROLES } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().authUser;
    if (!user)
      throw new ApiException(
        401,
        'UNAUTHENTICATED',
        'Authentication required.',
      );
    const roles = this.reflector.getAllAndOverride<readonly UserRole[]>(
      AUTH_ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (roles && !roles.includes(user.role)) {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'Your role cannot perform this operation.',
      );
    }
    return true;
  }
}

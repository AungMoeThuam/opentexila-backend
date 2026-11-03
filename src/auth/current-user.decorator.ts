import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth-request';
import { ApiException } from '../common/api-exception';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().authUser;
    if (!user)
      throw new ApiException(
        401,
        'UNAUTHENTICATED',
        'Authentication required.',
      );
    return user;
  },
);

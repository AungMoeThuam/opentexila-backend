import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ApiException } from '../common/api-exception';
import type { SessionRequest } from './dev-auth';

@Injectable()
export class DevCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const actual = request.headers['x-csrf-token'];
    const expected = request.session?.csrfToken;
    if (
      !expected ||
      typeof actual !== 'string' ||
      Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    ) {
      throw new ApiException(
        403,
        'CSRF_INVALID',
        'The security token is missing or invalid.',
      );
    }
    return true;
  }
}

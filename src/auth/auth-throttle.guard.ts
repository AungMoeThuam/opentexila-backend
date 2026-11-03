import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { ApiException } from '../common/api-exception';

// Single-process fixed windows. No client-supplied forwarding headers are trusted.
@Injectable()
export class AuthThrottleGuard implements CanActivate {
  private readonly attempts = new Map<
    string,
    { count: number; until: number }
  >();
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    for (const [key, value] of this.attempts)
      if (value.until <= now) this.attempts.delete(key);
    const operation = context.getHandler().name;
    const limit =
      operation === 'login' || operation === 'changePassword' ? 10 : 60;
    const keys = [
      `${operation}:ip:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`,
    ];
    if (operation === 'login' && typeof request.body?.email === 'string') {
      keys.push(
        `login:email:${createHash('sha256').update(request.body.email.trim().toLowerCase()).digest('hex')}`,
      );
    }
    for (const key of keys) {
      const entry = this.attempts.get(key) ?? { count: 0, until: now + 60000 };
      if (
        entry.count >= limit ||
        (!this.attempts.has(key) && this.attempts.size >= 10000)
      ) {
        response.setHeader(
          'Retry-After',
          Math.ceil((entry.until - now) / 1000),
        );
        throw new ApiException(
          429,
          'RATE_LIMITED',
          'Too many attempts. Try again shortly.',
        );
      }
      entry.count++;
      this.attempts.set(key, entry);
    }
    return true;
  }
}

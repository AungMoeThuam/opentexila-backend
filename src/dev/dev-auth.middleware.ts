import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { DevAuthService } from './dev-auth.service';
import type { SessionRequest } from './dev-auth';

// Middleware only restores server-owned session state; Nest controllers own routes.
@Injectable()
export class DevAuthSessionMiddleware implements NestMiddleware {
  constructor(private readonly auth: DevAuthService) {}

  use(request: SessionRequest, _response: Response, next: NextFunction): void {
    const { id, session } = this.auth.read(request.headers.cookie);
    request.devSessionId = id;
    request.session = session;
    next();
  }
}

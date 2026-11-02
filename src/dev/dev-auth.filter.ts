import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiException } from '../common/api-exception';

@Catch()
export class DevAuthExceptionFilter implements ExceptionFilter<unknown> {
  catch(exception: unknown, host: ArgumentsHost): void {
    const error =
      exception instanceof ApiException
        ? exception
        : new ApiException(
            500,
            'INTERNAL_ERROR',
            'Development account services are unavailable.',
          );
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    response.status(error.getStatus()).json(error.getResponse());
  }
}

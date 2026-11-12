import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

// Client errors keep their own envelope. Anything else becomes the shared
// 500 envelope with the message the dashboard shows, and no internal detail.
@Catch()
export class AttendanceAnalyticsExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException && exception.getStatus() < 500)
      return super.catch(exception, host);
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The server is not available.',
        fields: {},
      },
    });
  }
}

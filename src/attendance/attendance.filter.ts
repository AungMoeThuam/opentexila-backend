import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ApiException } from '../common/api-exception';

// Also handles malformed JSON rejected before controller/guard dispatch.
@Catch()
export class AttendanceExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const path = (request.originalUrl || request.url).split('?')[0];
    if (
      !/^\/api\/v1\/(me\/classes|me\/attendance-records|attendance\/me|me\/class-sessions|class-sessions(?:\/[^/]+(?:\/(check-ins|records))?)?)\/?$/.test(
        path,
      )
    )
      return super.catch(exception, host);
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : typeof exception === 'object' &&
            exception !== null &&
            'status' in exception &&
            exception.status === 400
          ? 400
          : 500;
    const error =
      status < 500 && exception instanceof ApiException
        ? exception.getResponse().error
        : {
            code:
              status === 400
                ? 'BAD_REQUEST'
                : status === 404
                  ? 'RESOURCE_NOT_FOUND'
                  : 'INTERNAL_ERROR',
            message:
              status === 400
                ? 'The request body is invalid.'
                : status === 404
                  ? 'The requested resource was not found.'
                  : 'The server could not complete the request.',
            fields: {},
          };
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({ error });
  }
}

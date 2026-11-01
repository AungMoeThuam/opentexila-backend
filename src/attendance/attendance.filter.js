import { Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// Also handles malformed JSON rejected before controller/guard dispatch.
@Catch()
export class AttendanceExceptionFilter extends BaseExceptionFilter {
  catch(exception, host) {
    const http = host.switchToHttp();
    const request = http.getRequest();
    const path = (request.originalUrl || request.url).split('?')[0];
    if (
      !/^\/api\/v1\/(me\/class-sessions|class-sessions(?:\/[^/]+(?:\/check-ins)?)?)\/?$/.test(
        path,
      )
    )
      return super.catch(exception, host);
    const response = http.getResponse();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : exception.status === 400
          ? 400
          : 500;
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const error =
      status < 500 && body?.error?.code
        ? body.error
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

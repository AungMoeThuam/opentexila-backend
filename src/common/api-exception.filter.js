import { Catch } from '@nestjs/common';
import { ApiException } from './api-exception';

@Catch(ApiException)
export class ApiExceptionFilter {
  catch(exception, host) {
    host
      .switchToHttp()
      .getResponse()
      .status(exception.getStatus())
      .json(exception.getResponse());
  }
}

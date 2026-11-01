import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UseFilters,
} from '@nestjs/common';
import { callerFrom } from '../auth/dev-caller';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { MeClassSessionsService } from './me-class-sessions.service';

@Controller('me/class-sessions')
@UseFilters(ApiExceptionFilter)
export class MeClassSessionsController {
  constructor(sessions) {
    this.sessions = sessions;
  }

  @Get()
  list(query, request) {
    return this.sessions.list(callerFrom(request), query);
  }
}

// Babel legacy decorators do not support parameter decorator syntax in JS.
Inject(MeClassSessionsService)(MeClassSessionsController, undefined, 0);
Query()(MeClassSessionsController.prototype, 'list', 0);
Req()(MeClassSessionsController.prototype, 'list', 1);

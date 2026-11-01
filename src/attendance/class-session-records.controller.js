import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UseFilters,
} from '@nestjs/common';
import { callerFrom } from '../auth/dev-caller';
import { ApiExceptionFilter } from '../common/api-exception.filter';
import { ClassSessionRecordsService } from './class-session-records.service';

@Controller('class-sessions')
@UseFilters(ApiExceptionFilter)
export class ClassSessionRecordsController {
  constructor(records) {
    this.records = records;
  }

  @Get(':classSessionId/records')
  list(classSessionId, query, request) {
    return this.records.list(callerFrom(request), classSessionId, query);
  }
}

// Babel legacy decorators do not support parameter decorator syntax in JS.
Inject(ClassSessionRecordsService)(ClassSessionRecordsController, undefined, 0);
Param('classSessionId')(ClassSessionRecordsController.prototype, 'list', 0);
Query()(ClassSessionRecordsController.prototype, 'list', 1);
Req()(ClassSessionRecordsController.prototype, 'list', 2);

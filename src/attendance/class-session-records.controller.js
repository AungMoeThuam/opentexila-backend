import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AttendanceGuard } from './attendance.guard';
import { ClassSessionRecordsService } from './class-session-records.service';

@Controller('class-sessions')
@UseGuards(AttendanceGuard)
export class ClassSessionRecordsController {
  constructor(records) {
    this.records = records;
  }

  @Get(':classSessionId/records')
  list(classSessionId, query, request) {
    return this.records.list(request.attendanceUser, classSessionId, query);
  }
}

// Babel legacy decorators do not support parameter decorator syntax in JS.
Inject(ClassSessionRecordsService)(ClassSessionRecordsController, undefined, 0);
Param('classSessionId')(ClassSessionRecordsController.prototype, 'list', 0);
Query()(ClassSessionRecordsController.prototype, 'list', 1);
Req()(ClassSessionRecordsController.prototype, 'list', 2);

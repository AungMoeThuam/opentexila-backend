import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AttendanceGuard, type AttendanceRequest } from './attendance.guard';
import { ClassSessionRecordsService } from './class-session-records.service';

@Controller('class-sessions')
@UseGuards(AttendanceGuard)
export class ClassSessionRecordsController {
  readonly records: ClassSessionRecordsService;

  constructor(
    @Inject(ClassSessionRecordsService) records: ClassSessionRecordsService,
  ) {
    this.records = records;
  }

  @Get(':classSessionId/records')
  list(
    @Param('classSessionId') classSessionId: string,
    @Query() query: Record<string, any>,
    @Req() request: AttendanceRequest,
  ) {
    return this.records.list(request.attendanceUser, classSessionId, query);
  }
}

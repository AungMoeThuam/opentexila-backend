import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AttendanceGuard, type AttendanceRequest } from './attendance.guard';
import { ClassSessionRecordsService } from './class-session-records.service';
import { CurrentUser } from './current-user.decorator';
import type { AttendanceCaller } from './attendance.rules';

@Controller('class-sessions')
@UseGuards(AttendanceGuard)
export class ClassSessionRecordsController {
  constructor(public readonly records: ClassSessionRecordsService) {}

  @Get(':classSessionId/records')
  list(
    @Param('classSessionId') classSessionId: string,
    @Query() query: Record<string, any>,
    @Req() request: AttendanceRequest,
    @CurrentUser() user?: AttendanceCaller,
  ) {
    const caller = user ?? request?.attendanceUser;
    return this.records.list(caller, classSessionId, query);
  }
}

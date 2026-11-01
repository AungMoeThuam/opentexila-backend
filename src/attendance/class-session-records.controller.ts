import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AttendanceGuard } from './attendance.guard';
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
    @CurrentUser() user: AttendanceCaller,
  ) {
    return this.records.list(user, classSessionId, query);
  }
}

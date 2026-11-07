import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AttendanceGuard } from './attendance.guard';
import { ClassSessionRecordsService } from './class-session-records.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AttendanceCaller } from './attendance.rules';
import {
  ClassSessionParamsDto,
  SessionRecordsQueryDto,
} from './dto/attendance-query.dto';
import { Roles } from '../auth/roles.decorator';

@Controller('class-sessions')
@UseGuards(AttendanceGuard)
@Roles('lecturer', 'admin')
export class ClassSessionRecordsController {
  constructor(public readonly records: ClassSessionRecordsService) {}

  @Get(':classSessionId/records')
  list(
    @Param() params: ClassSessionParamsDto,
    @Query() query: SessionRecordsQueryDto,
    @CurrentUser() user: AttendanceCaller,
  ) {
    return this.records.list(user, params.classSessionId, query);
  }
}

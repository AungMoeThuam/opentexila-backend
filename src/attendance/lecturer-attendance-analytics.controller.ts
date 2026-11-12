import { Controller, Get, Query, UseFilters, UseGuards } from '@nestjs/common';
import { AttendanceGuard } from './attendance.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AttendanceCaller } from './attendance.rules';
import { AttendanceAnalyticsService } from './attendance-analytics.service';
import { AttendanceAnalyticsExceptionFilter } from './attendance-analytics.filter';

@Controller('lecturer/attendance-analytics')
@UseFilters(AttendanceAnalyticsExceptionFilter)
@UseGuards(AttendanceGuard)
@Roles('lecturer')
export class LecturerAttendanceAnalyticsController {
  constructor(private readonly analytics: AttendanceAnalyticsService) {}

  @Get()
  read(
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AttendanceCaller,
  ) {
    return this.analytics.read(user, query);
  }
}

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AttendanceGuard } from '../attendance/attendance.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth-request';
import { ClassRosterParamsDto } from './class-roster-params.dto';
import { ClassRosterQueryDto } from './class-roster-query.dto';
import { ClassRosterService } from './class-roster.service';

@Controller('classes')
@UseGuards(AttendanceGuard)
@Roles('admin', 'lecturer')
export class ClassRosterController {
  constructor(private readonly roster: ClassRosterService) {}

  @Get(':classId/enrolments')
  list(
    @Param() params: ClassRosterParamsDto,
    @Query() query: ClassRosterQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roster.list(user, params.classId, query);
  }
}

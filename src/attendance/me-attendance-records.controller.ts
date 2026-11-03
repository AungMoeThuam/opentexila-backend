import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { AttendanceHistoryService } from './attendance-history.service';
import { AttendanceGuard } from './attendance.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AttendanceCaller } from './attendance.rules';

import { PersonalAttendanceQueryDto } from './dto/attendance-query.dto';
import { Roles } from '../auth/roles.decorator';

@Controller(['me/attendance-records', 'attendance/me'])
@UseGuards(AttendanceGuard)
@Roles('student')
export class AttendanceRecordsController {
  constructor(public readonly attendanceService: AttendanceHistoryService) {}

  @Get()
  async getPersonalAttendanceRecords(
    @Query() query: PersonalAttendanceQueryDto,
    @CurrentUser() user: AttendanceCaller,
  ) {
    if (!user) {
      throw new ApiException(
        401,
        'UNAUTHENTICATED',
        'Authentication required.',
      );
    }

    if (user.role !== 'student') {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'Only students can access personal attendance records.',
      );
    }

    return this.attendanceService.getPersonalAttendanceRecords({
      ...query,
      studentId: user.id,
    });
  }
}

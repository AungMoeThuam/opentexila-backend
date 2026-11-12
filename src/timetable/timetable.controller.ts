import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';

import { AttendanceGuard } from '../attendance/attendance.guard';
import { Roles } from '../auth/roles.decorator';

import {
  TimetableBatchUpdateDto,
  TimetableQueryDto,
} from './dto/timetable.dto';

import { TimetableService } from './timetable.service';

/**
 * Admin class timetable API.
 *
 * Backend Issue #32 / Frontend Issue #23.
 *
 * Reuses the existing authentication guard and
 * global validation configuration.
 *
 * Does not create or cancel class sessions.
 */
@Controller('class-sessions')
@UseGuards(AttendanceGuard)
@Roles('admin')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  /**
   * GET /api/v1/class-sessions?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * Retrieve class sessions within a selected date range.
   */
  @Get()
  list(@Query() query: TimetableQueryDto) {
    return this.timetable.list(query);
  }

  /**
   * PATCH /api/v1/class-sessions/batch
   *
   * Reschedule multiple existing sessions atomically.
   */
  @Patch('batch')
  updateBatch(@Body() body: TimetableBatchUpdateDto) {
    return this.timetable.updateBatch(body);
  }
}

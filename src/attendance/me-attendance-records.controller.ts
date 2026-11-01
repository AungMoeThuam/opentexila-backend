import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { QueryReader } from '../common/query-reader';
import type { AttendanceStatus } from '../database/entities/attendance-record.schema';
import { AttendanceHistoryService } from './attendance-history.service';
import { AttendanceGuard, type AttendanceRequest } from './attendance.guard';

const STATUSES: readonly AttendanceStatus[] = [
  'pending',
  'present',
  'late',
  'absent',
];

@Controller(['me/attendance-records', 'attendance/me'])
@UseGuards(AttendanceGuard)
export class AttendanceRecordsController {
  readonly attendanceService: AttendanceHistoryService;

  constructor(
    @Inject(AttendanceHistoryService)
    attendanceService: AttendanceHistoryService,
  ) {
    this.attendanceService = attendanceService;
  }

  @Get()
  async getPersonalAttendanceRecords(
    @Query() query: Record<string, any>,
    @Req() req: AttendanceRequest,
  ) {
    const effectiveUser = req?.attendanceUser;

    if (!effectiveUser) {
      throw new ApiException(
        401,
        'UNAUTHENTICATED',
        'Authentication required.',
      );
    }

    if (effectiveUser.role !== 'student') {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'Only students can access personal attendance records.',
      );
    }

    const reader = new QueryReader(query || {});
    const page = reader.integer('page', { max: 10000, fallback: 1 }) ?? 1;
    const limit = reader.integer('limit', { max: 100, fallback: 20 }) ?? 20;
    const classId = reader.integer('classId', { max: 4294967295 });
    const from = reader.timestamp('from');
    const to = reader.timestamp('to');
    const status = reader.oneOf('status', STATUSES);
    const includeCancelled = reader.boolean('includeCancelled', false) ?? false;

    if (from && to && from.getTime() >= to.getTime()) {
      reader.fail('to', 'to must be later than from.');
    }
    reader.finish();

    return this.attendanceService.getPersonalAttendanceRecords({
      studentId: effectiveUser.id,
      page,
      limit,
      classId,
      from,
      to,
      status,
      includeCancelled,
    });
  }
}

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { QueryReader } from '../common/query-reader';
import { AttendanceHistoryService } from './attendance-history.service';
import { AttendanceGuard } from './attendance.guard';

const STATUSES = ['pending', 'present', 'late', 'absent'];

@Controller(['me/attendance-records', 'attendance/me'])
@UseGuards(AttendanceGuard)
export class AttendanceRecordsController {
  constructor(attendanceService) {
    this.attendanceService = attendanceService;
  }

  @Get()
  async getPersonalAttendanceRecords(query, req) {
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
    const page = reader.integer('page', { max: 10000, fallback: 1 });
    const limit = reader.integer('limit', { max: 100, fallback: 20 });
    const classId = reader.integer('classId', { max: 4294967295 });
    const from = reader.timestamp('from');
    const to = reader.timestamp('to');
    const status = reader.oneOf('status', STATUSES);
    const includeCancelled = reader.boolean('includeCancelled', false);

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

Inject(AttendanceHistoryService)(AttendanceRecordsController, undefined, 0);
Query()(
  AttendanceRecordsController.prototype,
  'getPersonalAttendanceRecords',
  0,
);
Req()(AttendanceRecordsController.prototype, 'getPersonalAttendanceRecords', 1);

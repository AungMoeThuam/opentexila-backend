import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AttendanceHistoryService } from './attendance-history.service';
import { AttendanceGuard } from './attendance.guard';

function validatePagination(value, name, maximum, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > maximum
  ) {
    throw new BadRequestException(
      `${name} must be an integer between 1 and ${maximum}.`,
    );
  }
  return Number(value);
}

function validateClassId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > 4294967295
  ) {
    throw new BadRequestException('classId must be a positive integer.');
  }
  return Number(value);
}

function validateIsoDate(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${name} must be a valid ISO 8601 string.`);
  }

  // Must match standard ISO 8601 with timezone (e.g., 2026-10-29T01:00:00.000Z or +00:00)
  const isoRegex =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoRegex.test(value)) {
    throw new BadRequestException(
      `${name} must be a valid ISO 8601 timestamp with timezone.`,
    );
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      `${name} must be a valid ISO 8601 timestamp with timezone.`,
    );
  }
  return parsed;
}

function validateStatus(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const allowed = ['pending', 'present', 'late', 'absent'];
  if (!allowed.includes(value)) {
    throw new BadRequestException(
      `status must be one of: ${allowed.join(', ')}.`,
    );
  }
  return value;
}

function validateIncludeCancelled(value) {
  if (value === undefined || value === null || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(
    'includeCancelled must be either "true" or "false".',
  );
}

@Controller(['me/attendance-records', 'attendance/me'])
@UseGuards(AttendanceGuard)
export class AttendanceRecordsController {
  constructor(attendanceService) {
    this.attendanceService = attendanceService;
  }

  // Handle GET at root of controller prefix (i.e. /api/v1/me/attendance-records and /api/v1/attendance/me)
  @Get()
  async getPersonalAttendanceRecords(query, req) {
    // 1. Authentication is done by AttendanceGuard (verified server session).
    const effectiveUser = req?.attendanceUser;

    if (!effectiveUser) {
      throw new UnauthorizedException('Authentication required.');
    }

    if (effectiveUser.role !== 'student') {
      throw new ForbiddenException(
        'Only students can access personal attendance records.',
      );
    }

    const studentId = effectiveUser.id;

    // 2. Validate query parameters strictly
    const page = validatePagination(query?.page, 'page', 10000, 1);
    const limit = validatePagination(query?.limit, 'limit', 100, 20);
    const classId = validateClassId(query?.classId);
    const from = validateIsoDate(query?.from, 'from');
    const to = validateIsoDate(query?.to, 'to');
    const status = validateStatus(query?.status);
    const includeCancelled = validateIncludeCancelled(query?.includeCancelled);

    if (from && to && from.getTime() >= to.getTime()) {
      throw new BadRequestException(
        'The "from" date must be earlier than the "to" date.',
      );
    }

    return this.attendanceService.getPersonalAttendanceRecords({
      studentId,
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

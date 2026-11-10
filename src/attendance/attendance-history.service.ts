import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import {
  AttendanceRecordSchema,
  AttendanceStatus,
} from '../database/entities/attendance-record.schema';
import { Class } from '../database/entities';
import { pageMeta } from '../common/query-reader';
import { toClassSummary, toIso } from './class-summary';
import type { ClassSummaryDto } from './class-summary';
import type {
  PaginatedResponse,
  PersonalAttendanceRecordDto,
} from './dto/attendance-response.dto';

export interface PersonalAttendanceQuery {
  studentId: number;
  page?: number;
  limit?: number;
  classId?: number;
  from?: Date;
  to?: Date;
  status?: AttendanceStatus;
  includeCancelled?: boolean;
}

export interface HistoryClassOptionsQuery {
  studentId: number;
  page?: number;
  limit?: number;
}

@Injectable()
export class AttendanceHistoryService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  // Classes a student can pick in the history filter: current Enrolments plus
  // any Class with a saved Attendance record (former or cancelled-only). The
  // EXISTS predicates keep one row per Class, so pages never repeat a Class.
  async listHistoryClassOptions({
    studentId,
    page = 1,
    limit = 20,
  }: HistoryClassOptionsQuery): Promise<PaginatedResponse<ClassSummaryDto>> {
    if (!this.database?.isInitialized) {
      throw new ServiceUnavailableException(
        'Attendance database is unavailable.',
      );
    }

    const [classes, total] = await this.database
      .getRepository(Class)
      .createQueryBuilder('class')
      .innerJoinAndSelect('class.course', 'course')
      .innerJoinAndSelect('class.lecturer', 'lecturer')
      .where(
        `(EXISTS (SELECT 1 FROM enrolments e
                  WHERE e.class_id = class.id AND e.student_id = :studentId)
          OR EXISTS (SELECT 1 FROM attendance_records ar
                     JOIN class_sessions s ON s.id = ar.class_session_id
                     WHERE s.class_id = class.id AND ar.student_id = :studentId))`,
        { studentId },
      )
      .orderBy('class.term', 'DESC')
      .addOrderBy('course.code', 'ASC')
      .addOrderBy('class.section', 'ASC')
      .addOrderBy('class.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: classes.map(toClassSummary),
      meta: pageMeta(page, limit, total),
    };
  }

  async getPersonalAttendanceRecords({
    studentId,
    page = 1,
    limit = 20,
    classId,
    from,
    to,
    status,
    includeCancelled = false,
  }: PersonalAttendanceQuery): Promise<
    PaginatedResponse<PersonalAttendanceRecordDto>
  > {
    if (!this.database?.isInitialized) {
      throw new ServiceUnavailableException(
        'Attendance database is unavailable.',
      );
    }

    const repository = this.database.getRepository(AttendanceRecordSchema);

    const qb = repository
      .createQueryBuilder('ar')
      .innerJoinAndSelect('ar.classSession', 's')
      .innerJoinAndSelect('s.class', 'c')
      .innerJoinAndSelect('c.course', 'co')
      .innerJoinAndSelect('c.lecturer', 't')
      .where('ar.student_id = :studentId', { studentId });

    if (!includeCancelled) {
      qb.andWhere("s.state != 'cancelled'");
    }

    if (classId != null) {
      qb.andWhere('c.id = :classId', { classId });
    }

    if (from) {
      qb.andWhere('s.starts_at >= :from', { from });
    }

    if (to) {
      qb.andWhere('s.starts_at < :to', { to });
    }

    if (status) {
      qb.andWhere('ar.status = :status', { status });
    }

    qb.orderBy('s.starts_at', 'DESC').addOrderBy('ar.class_session_id', 'DESC');

    const total = await qb.getCount();
    const totalPages = Math.ceil(total / limit);

    qb.skip((page - 1) * limit).take(limit);

    const rawRecords = await qb.getMany();

    const data = rawRecords.map((record) => {
      const session = record.classSession;
      if (!session?.class)
        throw new Error(
          'Attendance history requires session and class relations.',
        );

      return {
        class_session_id: record.class_session_id,
        student_id: record.student_id,
        // The session's room overrides the class default room.
        class: toClassSummary({
          ...session.class,
          room_label: session.room_label,
        }),
        starts_at: toIso(session.starts_at),
        ends_at: toIso(session.ends_at),
        class_state: session.state,
        status: record.status,
        checked_in_at:
          record.status === 'present' || record.status === 'late'
            ? toIso(record.checked_in_at)
            : null,
      };
    });

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }
}

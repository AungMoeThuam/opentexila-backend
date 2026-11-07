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
import { toClassSummary, toIso } from './class-summary';
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

@Injectable()
export class AttendanceHistoryService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

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

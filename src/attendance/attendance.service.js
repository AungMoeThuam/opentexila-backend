import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { DATABASE } from '../database/database.constants';
import { AttendanceRecordSchema } from '../database/entities/attendance-record.schema';

function sanitizeLecturer(teacher) {
  if (!teacher) return null;

  return {
    id: teacher.id,
    name: teacher.name,
  };
}

function formatDate(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

@Injectable()
export class AttendanceService {
  constructor(database) {
    this.database = database;
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
  }) {
    if (!this.database?.isInitialized) {
      throw new ServiceUnavailableException(
        'Attendance database is unavailable.',
      );
    }

    const repository = this.database.getRepository(AttendanceRecordSchema);

    const qb = repository
      .createQueryBuilder('ar')
      .innerJoinAndSelect('ar.session', 's')
      .innerJoinAndSelect('s.meeting', 'm')
      .innerJoinAndSelect('m.classroom', 'c')
      .leftJoinAndSelect('c.teacher', 't')
      .where('ar.student_id = :studentId', { studentId });

    if (!includeCancelled) {
      qb.andWhere("m.state != 'cancelled' AND s.state != 'cancelled'");
    }

    if (classId != null) {
      qb.andWhere('c.id = :classId', { classId });
    }

    if (from) {
      qb.andWhere('m.starts_at >= :from', { from });
    }

    if (to) {
      qb.andWhere('m.starts_at < :to', { to });
    }

    if (status) {
      qb.andWhere('ar.status = :status', { status });
    }

    qb.orderBy('m.starts_at', 'DESC').addOrderBy('ar.session_id', 'DESC');

    const total = await qb.getCount();
    const totalPages = Math.ceil(total / limit);

    qb.skip((page - 1) * limit).take(limit);

    const rawRecords = await qb.getMany();

    const data = rawRecords.map((record) => {
      const session = record.session;
      const meeting = session?.meeting;
      const classroom = meeting?.classroom;

      const cancelled =
        meeting?.state === 'cancelled' || session?.state === 'cancelled';

      return {
        class_session_id: record.session_id,
        student_id: record.student_id,

        class: {
          id: classroom?.id,
          course: {
            id: classroom?.id,
            code: classroom?.code,
            name: classroom?.name || classroom?.subject,
          },
          section: classroom?.code?.split('-')?.[1] || 'A',
          term: classroom?.term,
          lecturer: sanitizeLecturer(classroom?.teacher),
          room_label: session?.room_label || classroom?.room_label,
        },

        starts_at: formatDate(meeting?.starts_at),
        ends_at: formatDate(meeting?.ends_at),

        class_state: cancelled ? 'cancelled' : meeting?.state || 'scheduled',

        status: record.status,

        checked_in_at:
          record.status === 'present' || record.status === 'late'
            ? formatDate(record.checked_in_at)
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

Inject(DATABASE)(AttendanceService, undefined, 0);

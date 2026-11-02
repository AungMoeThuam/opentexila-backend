import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, FindOptionsSelect, Repository } from 'typeorm';
import { ApiException, notFound } from '../common/api-exception';
import { pageMeta } from '../common/query-reader';
import { DATABASE } from '../database/database.constants';
import {
  AttendanceRecordEntity,
  AttendanceRecordSchema,
} from '../database/entities/attendance-record.schema';
import {
  ClassSessionEntity,
  ClassSessionSchema,
} from '../database/entities/class-session.schema';
import type { AttendanceCaller } from './attendance.rules';
import { toClassSummary, toIso } from './class-summary';

import type { SessionRecordsQueryDto } from './dto/attendance-query.dto';
import type { SessionRosterResponseDto } from './dto/attendance-response.dto';

// Explicit allow-lists: no student email, distance or coordinates are read.
const sessionFields: FindOptionsSelect<ClassSessionEntity> = {
  id: true,
  room_label: true,
  starts_at: true,
  late_after: true,
  ends_at: true,
  state: true,
  class: {
    id: true,
    section: true,
    term: true,
    room_label: true,
    course: { id: true, code: true, name: true },
    teacher: { id: true, name: true },
  },
};

const recordFields: FindOptionsSelect<AttendanceRecordEntity> = {
  class_session_id: true,
  student_id: true,
  status: true,
  checked_in_at: true,
  student: { id: true, name: true },
};

const toRow = (record: AttendanceRecordEntity) => ({
  class_session_id: record.class_session_id,
  student_id: record.student_id,
  status: record.status,
  checked_in_at: toIso(record.checked_in_at),
  student: { id: record.student!.id, name: record.student!.name },
});

const toContext = (session: ClassSessionEntity) => ({
  class_session_id: session.id,
  class: toClassSummary({
    ...session.class!,
    room_label: session.room_label ?? session.class!.room_label,
  }),
  starts_at: toIso(session.starts_at),
  late_after: toIso(session.late_after),
  ends_at: toIso(session.ends_at),
  class_state: session.state,
});

@Injectable()
export class ClassSessionRecordsService {
  private readonly classSessions: Repository<ClassSessionEntity>;
  private readonly records: Repository<AttendanceRecordEntity>;

  constructor(@Inject(DATABASE) database: DataSource) {
    this.classSessions = database.getRepository(ClassSessionSchema);
    this.records = database.getRepository(AttendanceRecordSchema);
  }

  // Read-only roster of one session for its assigned lecturer or an admin.
  async list(
    user: AttendanceCaller,
    classSessionId: number,
    query: SessionRecordsQueryDto,
  ): Promise<SessionRosterResponseDto> {
    if (user.role !== 'teacher' && user.role !== 'admin') {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'Only lecturers and admins can view a session roster.',
      );
    }
    const id = classSessionId;
    const { page, limit, status } = query;

    // A session of another lecturer looks the same as a missing session.
    const session = await this.classSessions.findOne({
      select: sessionFields,
      relations: { class: { course: true, teacher: true } },
      where: {
        id,
        ...(user.role === 'teacher' && { class: { teacher_id: user.id } }),
      },
    });
    if (!session) throw notFound('Class session not found.');

    const [records, total] = await this.records.findAndCount({
      select: recordFields,
      relations: { student: true },
      where: { class_session_id: id, ...(status && { status }) },
      order: { student_id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: records.map(toRow),
      context: toContext(session),
      meta: pageMeta(page, limit, total),
    };
  }
}

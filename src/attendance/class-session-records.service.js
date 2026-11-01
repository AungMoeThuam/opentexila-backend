import { Inject, Injectable } from '@nestjs/common';
import { ApiException, notFound } from '../common/api-exception';
import { QueryReader, pageMeta } from '../common/query-reader';
import { DATABASE } from '../database/database.constants';
import { AttendanceRecordSchema } from '../database/entities/attendance-record.schema';
import { ClassSessionSchema } from '../database/entities/class-session.schema';
import { toClassSummary, toIso } from './class-summary';

const MAX_ID = 4294967295;
const STATUSES = ['pending', 'present', 'late', 'absent'];

// Explicit allow-lists: no student email, distance or coordinates are read.
const sessionFields = {
  id: true,
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
const recordFields = {
  class_session_id: true,
  student_id: true,
  status: true,
  checked_in_at: true,
  student: { id: true, name: true },
};

const toRow = (record) => ({
  class_session_id: record.class_session_id,
  student_id: record.student_id,
  status: record.status,
  checked_in_at: toIso(record.checked_in_at),
  student: { id: record.student.id, name: record.student.name },
});

const toContext = (session) => ({
  class_session_id: session.id,
  class: toClassSummary(session.class),
  starts_at: toIso(session.starts_at),
  late_after: toIso(session.late_after),
  ends_at: toIso(session.ends_at),
  class_state: session.state,
});

@Injectable()
export class ClassSessionRecordsService {
  constructor(database) {
    this.classSessions = database.getRepository(ClassSessionSchema);
    this.records = database.getRepository(AttendanceRecordSchema);
  }

  // Read-only roster of one session taught by `user`.
  async list(user, classSessionId, query) {
    if (user.role !== 'teacher') {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'Only lecturers can view a session roster.',
      );
    }
    const reader = new QueryReader({ ...query, classSessionId });
    const id = reader.integer('classSessionId', {
      max: MAX_ID,
      required: true,
    });
    const page = reader.integer('page', { max: 10000, fallback: 1 });
    const limit = reader.integer('limit', { max: 100, fallback: 20 });
    const status = reader.oneOf('status', STATUSES);
    reader.finish();

    // A session of another lecturer looks the same as a missing session.
    const session = await this.classSessions.findOne({
      select: sessionFields,
      relations: { class: { course: true, teacher: true } },
      where: { id, class: { teacher_id: user.id } },
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

// JavaScript/Babel needs explicit constructor injection.
Inject(DATABASE)(ClassSessionRecordsService, undefined, 0);

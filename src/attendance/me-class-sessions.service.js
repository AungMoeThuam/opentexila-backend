import { Inject, Injectable } from '@nestjs/common';
import { And, LessThan, MoreThanOrEqual } from 'typeorm';
import { QueryReader, pageMeta } from '../common/query-reader';
import { DATABASE } from '../database/database.constants';
import { ClassSessionSchema } from '../database/entities/class-session.schema';
import { availabilityFor } from './availability';
import { toClassSummary, toIso } from './class-summary';

const MAX_ID = 4294967295;

// Explicit allow-list: no coordinates, radius or password data leave the database.
const publicFields = {
  id: true,
  class_id: true,
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

function startsAtRange(from, to) {
  if (from && to) return And(MoreThanOrEqual(from), LessThan(to));
  if (from) return MoreThanOrEqual(from);
  if (to) return LessThan(to);
  return undefined;
}

function toResponse(session, now) {
  return {
    id: session.id,
    class_id: session.class_id,
    class: toClassSummary(session.class),
    starts_at: toIso(session.starts_at),
    late_after: toIso(session.late_after),
    ends_at: toIso(session.ends_at),
    availability: availabilityFor(session, now),
    // Lecturers have no personal attendance. The student branch belongs to issue #10.
    my_attendance: null,
  };
}

@Injectable()
export class MeClassSessionsService {
  constructor(database) {
    this.sessions = database.getRepository(ClassSessionSchema);
  }

  // Lecturer branch: sessions of the classes taught by `user`.
  async list(user, query, now = new Date()) {
    const reader = new QueryReader(query);
    const page = reader.integer('page', { max: 10000, fallback: 1 });
    const limit = reader.integer('limit', { max: 100, fallback: 20 });
    const classId = reader.integer('classId', { max: MAX_ID });
    const from = reader.timestamp('from');
    const to = reader.timestamp('to');
    if (from && to && from >= to) {
      reader.fail('from', 'from must be earlier than to.');
    }
    reader.finish();

    const startsAt = startsAtRange(from, to);
    const [sessions, total] = await this.sessions.findAndCount({
      select: publicFields,
      relations: { class: { course: true, teacher: true } },
      where: {
        class: {
          teacher_id: user.id,
          ...(classId !== undefined && { id: classId }),
        },
        ...(startsAt && { starts_at: startsAt }),
      },
      order: { starts_at: 'ASC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: sessions.map((session) => toResponse(session, now)),
      meta: pageMeta(page, limit, total),
    };
  }
}

// JavaScript/Babel needs explicit constructor injection.
Inject(DATABASE)(MeClassSessionsService, undefined, 0);

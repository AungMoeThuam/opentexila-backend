import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.constants';
import {
  availability,
  eligibility,
  fail,
  validateLocation,
} from './attendance.rules';
import {
  databaseNow,
  lockClassSession,
  materialiseLockedRoster,
} from './roster.service';

const iso = (value) => (value == null ? null : new Date(value).toISOString());
export function attendanceDto(record) {
  return record
    ? {
        class_session_id: record.class_session_id,
        student_id: record.student_id,
        status: record.status,
        checked_in_at: iso(record.checked_in_at),
        distance_m:
          record.distance_m == null
            ? null
            : Number(record.distance_m).toFixed(2),
      }
    : null;
}
function requireRole(user, roles) {
  if (!roles.includes(user.role))
    fail(403, 'FORBIDDEN', 'Your role cannot perform this operation.');
}
async function membership(manager, session, user) {
  if (user.role !== 'student') return { enrolled: false, record: null };
  const [enrolment] = await manager.query(
    'SELECT student_id FROM enrolments WHERE class_id = ? AND student_id = ? FOR UPDATE',
    [session.class_id, user.id],
  );
  const [record] = await manager.query(
    'SELECT * FROM attendance_records WHERE class_session_id = ? AND student_id = ? FOR UPDATE',
    [session.id, user.id],
  );
  return { enrolled: Boolean(enrolment), record: record || null };
}
function authorise(classroom, user, enrolled, record) {
  if (
    (user.role === 'student' && !enrolled && !record) ||
    (user.role === 'teacher' && classroom.teacher_id !== user.id)
  )
    fail(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found.');
}
async function sessionDto(manager, session, classroom, record, now) {
  const [course] = await manager.query(
    'SELECT id, code, name FROM courses WHERE id = ?',
    [classroom.course_id],
  );
  const [lecturer] = await manager.query(
    'SELECT id, name FROM users WHERE id = ?',
    [classroom.teacher_id],
  );
  return {
    id: session.id,
    class_id: session.class_id,
    class: {
      id: classroom.id,
      course,
      section: classroom.section,
      term: classroom.term,
      lecturer,
      room_label: session.room_label,
    },
    starts_at: iso(session.starts_at),
    late_after: iso(session.late_after),
    ends_at: iso(session.ends_at),
    state: session.state,
    availability: availability(session, now),
    my_attendance: attendanceDto(record),
  };
}
@Injectable()
export class AttendanceService {
  constructor(database) {
    this.database = database;
  }
  async list(user, query) {
    requireRole(user, ['student', 'teacher']);
    const parameters = [user.id];
    const filters = [
      user.role === 'teacher'
        ? 'c.teacher_id = ?'
        : '(EXISTS (SELECT 1 FROM enrolments e WHERE e.class_id = s.class_id AND e.student_id = ?) OR EXISTS (SELECT 1 FROM attendance_records a WHERE a.class_session_id = s.id AND a.student_id = ?))',
    ];
    if (user.role === 'student') parameters.push(user.id);
    if (query.classId) {
      filters.push('s.class_id = ?');
      parameters.push(query.classId);
    }
    if (query.from) {
      filters.push('s.starts_at >= ?');
      parameters.push(query.from);
    }
    if (query.to) {
      filters.push('s.starts_at < ?');
      parameters.push(query.to);
    }
    const source = `FROM class_sessions s JOIN classes c ON c.id = s.class_id WHERE ${filters.join(' AND ')}`;
    const [count] = await this.database.query(
      `SELECT COUNT(*) AS total ${source}`,
      parameters,
    );
    const rows = await this.database.query(
      `SELECT s.id ${source} ORDER BY s.starts_at ASC, s.id ASC LIMIT ? OFFSET ?`,
      [...parameters, query.limit, (query.page - 1) * query.limit],
    );
    const data = [];
    for (const row of rows) {
      try {
        const result = await this.detail(user, row.id);
        const { check_in, ...session } = result.data;
        data.push(session);
      } catch (error) {
        // Membership may have changed after the list query. Never leak that row.
        if (error.getStatus?.() !== 404) throw error;
      }
    }
    const total = Number(count.total);
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
  async detail(user, id) {
    requireRole(user, ['student', 'teacher', 'admin']);
    return this.database.transaction(async (manager) => {
      const { session, classroom } = await lockClassSession(manager, id);
      let { enrolled, record } = await membership(manager, session, user);
      authorise(classroom, user, enrolled, record);
      const now = await databaseNow(manager);
      await materialiseLockedRoster(manager, session, now);
      if (user.role === 'student')
        ({ record } = await membership(manager, session, user));
      return {
        data: {
          ...(await sessionDto(manager, session, classroom, record, now)),
          check_in: eligibility(
            session,
            user,
            enrolled || Boolean(record),
            record,
            now,
          ),
        },
      };
    });
  }
  async checkIn(user, id, reading) {
    requireRole(user, ['student']);
    return this.database.transaction(async (manager) => {
      const { session, classroom } = await lockClassSession(manager, id);
      let { enrolled, record } = await membership(manager, session, user);
      authorise(classroom, user, enrolled, record);
      const now = await databaseNow(manager); // Time is sampled after acquiring locks.
      if (session.state === 'cancelled')
        fail(409, 'CLASS_CANCELLED', 'This class session has been cancelled.');
      // Successful replays retain original evidence, even after the time window.
      if (['present', 'late'].includes(record?.status))
        return {
          data: {
            class_session_id: id,
            attendance_record: attendanceDto(record),
          },
        };
      if (now < session.starts_at)
        fail(409, 'CLASS_NOT_STARTED', 'This class session has not started.');
      if (now >= session.ends_at)
        fail(409, 'CLASS_ENDED', 'This class session has ended.');
      await materialiseLockedRoster(manager, session, now);
      ({ record } = await membership(manager, session, user));
      if (!record || record.status !== 'pending')
        fail(
          403,
          'NOT_ELIGIBLE',
          'You have no eligible pending attendance record.',
        );
      const distance = validateLocation(reading, session, now);
      const status = now <= session.late_after ? 'present' : 'late';
      await manager.query(
        `UPDATE attendance_records SET status = ?, checked_in_at = ?, distance_m = ?
        WHERE class_session_id = ? AND student_id = ? AND status = 'pending'`,
        [status, now, distance.toFixed(2), id, user.id],
      );
      return {
        data: {
          class_session_id: id,
          attendance_record: attendanceDto({
            ...record,
            status,
            checked_in_at: now,
            distance_m: distance,
          }),
        },
      };
    });
  }
}
Inject(DATABASE)(AttendanceService, undefined, 0);

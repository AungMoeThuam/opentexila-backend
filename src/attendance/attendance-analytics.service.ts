import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { MALAYSIA_OFFSET_HOURS } from '../common/malaysia-day';
import { DATABASE } from '../database/database.constants';
import { fail, type AttendanceCaller } from './attendance.rules';
import {
  buildAnalytics,
  parseAnalyticsQuery,
  type AnalyticsQuery,
  type SessionRow,
  type StudentRow,
} from './attendance-analytics.rules';

// Sessions the lecturer teaches, in range, that have ended and are not
// cancelled, with the attendance records of currently enrolled students only.
const SCOPE = (byClass: boolean, extraJoin = '') => `
  FROM class_sessions s
  JOIN classes c ON c.id = s.class_id AND c.lecturer_id = ?
  JOIN attendance_records r ON r.class_session_id = s.id
  JOIN enrolments e ON e.class_id = s.class_id AND e.student_id = r.student_id
  ${extraJoin}
  WHERE s.state = 'scheduled'
    AND s.ends_at <= UTC_TIMESTAMP(3)
    AND s.starts_at >= ? AND s.starts_at < ?
    ${byClass ? 'AND s.class_id = ?' : ''}`;

@Injectable()
export class AttendanceAnalyticsService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  async read(lecturer: AttendanceCaller, rawQuery: Record<string, unknown>) {
    const query = parseAnalyticsQuery(rawQuery);
    if (query.classId !== undefined)
      await this.requireOwnClass(lecturer, query);
    const [sessions, students] = await Promise.all([
      this.sessionRows(lecturer, query),
      this.studentRows(lecturer, query),
    ]);
    return buildAnalytics(query, sessions, students);
  }

  // The same answer for a class that is someone else's and one that does not
  // exist, so the response never reveals which class ids exist.
  private async requireOwnClass(
    lecturer: AttendanceCaller,
    query: AnalyticsQuery,
  ): Promise<void> {
    const rows = await this.database.query<{ id: number }[]>(
      'SELECT id FROM classes WHERE id = ? AND lecturer_id = ?',
      [query.classId, lecturer.id],
    );
    if (rows.length === 0)
      fail(403, 'FORBIDDEN', 'This class is not assigned to you.');
  }

  private params(lecturer: AttendanceCaller, query: AnalyticsQuery) {
    return [
      lecturer.id,
      query.fromUtc,
      query.toUtcExclusive,
      ...(query.classId === undefined ? [] : [query.classId]),
    ];
  }

  // One row per ended, non-cancelled session with its status counts.
  private sessionRows(lecturer: AttendanceCaller, query: AnalyticsQuery) {
    return this.database.query<SessionRow[]>(
      `SELECT s.id AS class_session_id, s.class_id,
        DATE_FORMAT(DATE_ADD(s.starts_at, INTERVAL ${MALAYSIA_OFFSET_HOURS} HOUR), '%Y-%m-%d') AS day,
        s.starts_at, s.ends_at,
        co.code AS course_code, co.name AS course_name, c.section, c.term,
        SUM(r.status = 'present') AS present,
        SUM(r.status = 'late') AS late,
        SUM(r.status = 'absent') AS absent,
        SUM(r.status = 'pending') AS pending
      ${SCOPE(query.classId !== undefined, 'JOIN courses co ON co.id = c.course_id')}
      GROUP BY s.id, s.class_id, s.starts_at, s.ends_at,
        co.code, co.name, c.section, c.term
      ORDER BY s.starts_at, s.id`,
      this.params(lecturer, query),
    );
  }

  // One row per (student, class) over Finalised class sessions only: a
  // session with any pending record of an enrolled student is left out.
  private studentRows(lecturer: AttendanceCaller, query: AnalyticsQuery) {
    return this.database.query<StudentRow[]>(
      `SELECT s.class_id, r.student_id, u.name, u.email,
        COUNT(*) AS sessions,
        SUM(r.status = 'present') AS present,
        SUM(r.status = 'late') AS late,
        SUM(r.status = 'absent') AS absent
      ${SCOPE(query.classId !== undefined, 'JOIN users u ON u.id = r.student_id')}
        AND NOT EXISTS (
          SELECT 1 FROM attendance_records p
          JOIN enrolments pe
            ON pe.class_id = s.class_id AND pe.student_id = p.student_id
          WHERE p.class_session_id = s.id AND p.status = 'pending')
      GROUP BY s.class_id, r.student_id, u.name, u.email
      ORDER BY s.class_id, r.student_id`,
      this.params(lecturer, query),
    );
  }
}

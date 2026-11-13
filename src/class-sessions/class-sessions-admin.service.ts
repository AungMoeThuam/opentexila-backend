import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { Class } from '../database/entities';
import type { ClassSessionState } from '../database/entities';
import {
  ApiException,
  notFound,
  validationError,
  type ErrorFields,
} from '../common/api-exception';
import { pageMeta, type PageMeta } from '../common/query-reader';
import {
  definedEntries,
  emptyUpdate,
  toDecimal,
} from '../courses/class-management.rules';
import {
  availability,
  type SessionAvailability,
} from '../attendance/attendance.rules';
import {
  toClassSummary,
  type ClassSummaryDto,
} from '../attendance/class-summary';
import { databaseNow, lockClassSession } from '../attendance/roster.service';
import {
  findTimetableConflicts,
  type TimetableConflictType,
} from '../timetable/timetable-conflicts';
import type {
  CreateClassSessionDto,
  ListManagedSessionsQueryDto,
} from './dto/class-session-admin.dto';
import type { UpdateSessionPolicyDto } from './dto/session-policy.dto';
import {
  ScheduleConflictException,
  type ScheduleConflictDto,
} from './schedule-conflict.exception';
import { isDuplicateKey, sessionExists } from './session-exists';
import { mysqlUtc, parseUtcTimestamp } from './session-times';

export interface ManagedSessionDto {
  id: number;
  class_id: number;
  room_label: string;
  latitude: string;
  longitude: string;
  radius_m: string;
  starts_at: string;
  late_after: string;
  ends_at: string;
  state: ClassSessionState;
  availability: SessionAvailability;
  attendance: {
    present: number;
    late: number;
    absent: number;
    pending: number;
  };
}

interface SessionRow {
  id: number | string;
  class_id: number | string;
  room_label: string;
  latitude: string;
  longitude: string;
  radius_m: string;
  starts_at: Date | string;
  late_after: Date | string;
  ends_at: Date | string;
  state: ClassSessionState;
  present_count: number | string;
  late_count: number | string;
  absent_count: number | string;
  pending_count: number | string;
}

// The counts come from the record table in the same query as the sessions.
const SELECT = `SELECT s.id, s.class_id, s.room_label, s.latitude, s.longitude, s.radius_m,
  s.starts_at, s.late_after, s.ends_at, s.state,
  (SELECT COUNT(*) FROM attendance_records r WHERE r.class_session_id = s.id AND r.status = 'present') AS present_count,
  (SELECT COUNT(*) FROM attendance_records r WHERE r.class_session_id = s.id AND r.status = 'late') AS late_count,
  (SELECT COUNT(*) FROM attendance_records r WHERE r.class_session_id = s.id AND r.status = 'absent') AS absent_count,
  (SELECT COUNT(*) FROM attendance_records r WHERE r.class_session_id = s.id AND r.status = 'pending') AS pending_count
  FROM class_sessions s`;

const TIME_FIELDS = ['starts_at', 'late_after', 'ends_at'] as const;
// The error lists at most this many clashing sessions.
const MAX_LISTED_CONFLICTS = 10;

function toSession(row: SessionRow, now: Date): ManagedSessionDto {
  const starts = new Date(row.starts_at);
  const ends = new Date(row.ends_at);
  return {
    id: Number(row.id),
    class_id: Number(row.class_id),
    room_label: row.room_label,
    latitude: String(row.latitude),
    longitude: String(row.longitude),
    radius_m: String(row.radius_m),
    starts_at: starts.toISOString(),
    late_after: new Date(row.late_after).toISOString(),
    ends_at: ends.toISOString(),
    state: row.state,
    availability: availability(
      { state: row.state, starts_at: starts, ends_at: ends },
      now,
    ),
    attendance: {
      present: Number(row.present_count),
      late: Number(row.late_count),
      absent: Number(row.absent_count),
      pending: Number(row.pending_count),
    },
  };
}

const CONFLICT_TEXT: Record<TimetableConflictType, string> = {
  class: 'the same class',
  lecturer: 'the same lecturer',
  room: 'the same room',
};

// "a", "a and b", "a, b and c".
const joinWithAnd = (items: string[]): string =>
  items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

// Admin list, schedule and cancel for the sessions of one class. Check-in,
// roster creation and finalisation are in the attendance module and are not
// changed here; cancelling uses the same class -> session lock order as they do.
@Injectable()
export class ClassSessionsAdminService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  async list(
    classId: number,
    query: ListManagedSessionsQueryDto,
  ): Promise<{
    data: ManagedSessionDto[];
    context: { class: ClassSummaryDto };
    meta: PageMeta;
  }> {
    const classroom = await this.database.getRepository(Class).findOne({
      where: { id: classId },
      relations: { course: true, lecturer: true },
    });
    if (!classroom) throw notFound('Class not found.');
    const conditions = ['s.class_id = ?'];
    const params: unknown[] = [classId];
    if (query.state !== undefined) {
      conditions.push('s.state = ?');
      params.push(query.state);
    }
    const where = conditions.join(' AND ');
    const counted = (await this.database.query(
      `SELECT COUNT(*) AS total FROM class_sessions s WHERE ${where}`,
      params,
    )) as { total: number | string }[];
    const total = Number(counted[0]?.total ?? 0);
    const rows = (await this.database.query(
      `${SELECT} WHERE ${where} ORDER BY s.starts_at ASC, s.id ASC LIMIT ? OFFSET ?`,
      [...params, query.limit, (query.page - 1) * query.limit],
    )) as SessionRow[];
    const now = await databaseNow(this.database.manager);
    return {
      data: rows.map((row) => toSession(row, now)),
      context: { class: toClassSummary(classroom) },
      meta: pageMeta(query.page, query.limit, total),
    };
  }

  async create(
    classId: number,
    input: CreateClassSessionDto,
  ): Promise<{ data: ManagedSessionDto }> {
    const times = this.checkTimes(input);
    try {
      return await this.database.transaction(async (manager) => {
        // The class row is locked first, so two requests for one class are
        // checked one after the other.
        const [classroom] = (await manager.query(
          'SELECT * FROM classes WHERE id = ? FOR UPDATE',
          [classId],
        )) as {
          id: number;
          lecturer_id: number;
          room_label: string;
          latitude: string;
          longitude: string;
          radius_m: string;
        }[];
        if (!classroom) throw notFound('Class not found.');
        const now = await databaseNow(manager); // After the lock.
        if (times.starts_at.getTime() <= now.getTime())
          throw validationError({
            starts_at: 'The start time must be in the future.',
          });
        await this.checkFree(manager, classroom, times);
        const result = (await manager.query(
          `INSERT INTO class_sessions
           (class_id, room_label, latitude, longitude, radius_m, starts_at, late_after, ends_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            classId,
            classroom.room_label,
            classroom.latitude,
            classroom.longitude,
            classroom.radius_m,
            mysqlUtc(times.starts_at),
            mysqlUtc(times.late_after),
            mysqlUtc(times.ends_at),
          ],
        )) as { insertId: number | string };
        return { data: await this.load(manager, Number(result.insertId), now) };
      });
    } catch (error) {
      if (isDuplicateKey(error)) throw sessionExists();
      throw error;
    }
  }

  // Upcoming and running sessions can be cancelled. An ended session cannot,
  // because its attendance is history. Repeating a cancellation changes nothing.
  async cancel(classSessionId: number): Promise<{ data: ManagedSessionDto }> {
    return this.database.transaction(async (manager) => {
      const { session } = await lockClassSession(manager, classSessionId);
      const now = await databaseNow(manager); // After both locks.
      if (session.state !== 'cancelled') {
        if (now.getTime() >= new Date(session.ends_at).getTime())
          throw new ApiException(
            409,
            'CLASS_SESSION_ENDED',
            'A session that has ended cannot be cancelled.',
          );
        await manager.query(
          "UPDATE class_sessions SET state = 'cancelled' WHERE id = ?",
          [session.id],
        );
      }
      return { data: await this.load(manager, session.id, now) };
    });
  }

  // Changes the venue (room, location, radius) and the late time of one session
  // that has not started. The class is not touched, and neither are other
  // sessions. A session that has started, ended or been cancelled is history, so
  // the server refuses it. The class and session are locked first, as in
  // check-in, and the time is read after the locks, so a check-in cannot slip
  // between the check and the save.
  async updatePolicy(
    classSessionId: number,
    input: UpdateSessionPolicyDto,
  ): Promise<{ data: ManagedSessionDto }> {
    const sent = definedEntries(input);
    if (Object.keys(sent).length === 0) throw emptyUpdate();
    const late =
      sent.late_after === undefined ? null : parseUtcTimestamp(sent.late_after);
    if (sent.late_after !== undefined && !late)
      throw validationError({
        late_after:
          'late_after must be a UTC time such as 2026-11-20T01:15:00.000Z.',
      });
    return this.database.transaction(async (manager) => {
      const { session } = await lockClassSession(manager, classSessionId);
      const now = await databaseNow(manager); // After both locks.
      const starts = new Date(session.starts_at).getTime();
      if (session.state !== 'scheduled' || now.getTime() >= starts)
        throw new ApiException(
          409,
          'SESSION_NOT_EDITABLE',
          'A session that has started, ended or been cancelled cannot be changed.',
        );
      if (
        late &&
        (late.getTime() < starts ||
          late.getTime() >= new Date(session.ends_at).getTime())
      )
        throw validationError({
          late_after:
            'The late time must be between the start and the end time.',
        });
      // Column names come from this fixed list, never from the request.
      const changes: [string, string | number][] = [];
      if (sent.room_label !== undefined)
        changes.push(['room_label', sent.room_label]);
      if (sent.latitude !== undefined)
        changes.push(['latitude', toDecimal(sent.latitude, 6)]);
      if (sent.longitude !== undefined)
        changes.push(['longitude', toDecimal(sent.longitude, 6)]);
      if (sent.radius_m !== undefined)
        changes.push(['radius_m', toDecimal(sent.radius_m, 2)]);
      if (late) changes.push(['late_after', mysqlUtc(late)]);
      await manager.query(
        `UPDATE class_sessions SET ${changes.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
        [...changes.map(([, value]) => value), session.id],
      );
      return { data: await this.load(manager, session.id, now) };
    });
  }

  // All wrong fields are reported together. Times must be exact UTC text.
  private checkTimes(
    input: CreateClassSessionDto,
  ): Record<(typeof TIME_FIELDS)[number], Date> {
    const errors: ErrorFields = {};
    const parsed: Partial<Record<(typeof TIME_FIELDS)[number], Date>> = {};
    for (const field of TIME_FIELDS) {
      const date = parseUtcTimestamp(input[field]);
      if (date) parsed[field] = date;
      else
        errors[field] =
          `${field} must be a UTC time such as 2026-11-20T01:00:00.000Z.`;
    }
    const { starts_at: start, late_after: late, ends_at: end } = parsed;
    if (start && end && start.getTime() >= end.getTime())
      errors.ends_at = 'The end time must be after the start time.';
    if (start && late && late.getTime() < start.getTime())
      errors.late_after = 'The late time must not be before the start time.';
    else if (late && end && late.getTime() >= end.getTime() && !errors.ends_at)
      errors.late_after = 'The late time must be before the end time.';
    if (Object.keys(errors).length) throw validationError(errors);
    return parsed as Record<(typeof TIME_FIELDS)[number], Date>;
  }

  // Duplicate start, then overlap with another scheduled session of the same
  // class, lecturer or room. Cancelled sessions never cause an overlap, but a
  // cancelled session still holds its start time (unique per class).
  private async checkFree(
    manager: EntityManager,
    classroom: { id: number; lecturer_id: number; room_label: string },
    times: Record<(typeof TIME_FIELDS)[number], Date>,
  ): Promise<void> {
    const same = (await manager.query(
      'SELECT id FROM class_sessions WHERE class_id = ? AND starts_at = ?',
      [classroom.id, mysqlUtc(times.starts_at)],
    )) as { id: number }[];
    if (same.length) throw sessionExists();
    const rows = (await manager.query(
      `SELECT s.id, s.class_id, c.lecturer_id, s.room_label, s.starts_at, s.ends_at, s.state,
         co.code AS course_code, co.name AS course_name, c.section, c.term,
         u.name AS lecturer_name
       FROM class_sessions s
       JOIN classes c ON c.id = s.class_id
       JOIN courses co ON co.id = c.course_id
       JOIN users u ON u.id = c.lecturer_id
       WHERE s.state = 'scheduled' AND s.starts_at < ? AND s.ends_at > ?
         AND (s.class_id = ? OR c.lecturer_id = ?
              OR LOWER(TRIM(s.room_label)) = LOWER(TRIM(?)))
       ORDER BY s.starts_at ASC, s.id ASC`,
      [
        mysqlUtc(times.ends_at),
        mysqlUtc(times.starts_at),
        classroom.id,
        classroom.lecturer_id,
        classroom.room_label,
      ],
    )) as {
      id: number;
      class_id: number;
      lecturer_id: number;
      room_label: string;
      starts_at: Date;
      ends_at: Date;
      state: 'scheduled';
      course_code: string;
      course_name: string;
      section: string;
      term: string;
      lecturer_name: string;
    }[];
    // The same overlap rules as the timetable, with the new session as id 0.
    const proposed = {
      id: 0,
      class_id: classroom.id,
      lecturer_id: classroom.lecturer_id,
      room_label: classroom.room_label,
      starts_at: times.starts_at,
      ends_at: times.ends_at,
      state: 'scheduled' as const,
    };
    const typesBySession = new Map<number, Set<TimetableConflictType>>();
    for (const conflict of findTimetableConflicts([proposed, ...rows])) {
      if (conflict.session_id !== 0) continue;
      const types = typesBySession.get(conflict.with_session_id) ?? new Set();
      types.add(conflict.type);
      typesBySession.set(conflict.with_session_id, types);
    }
    if (!typesBySession.size) return;
    const conflicts: ScheduleConflictDto[] = rows
      .filter((row) => typesBySession.has(Number(row.id)))
      .slice(0, MAX_LISTED_CONFLICTS)
      .map((row) => ({
        types: [...typesBySession.get(Number(row.id))!],
        session: {
          id: Number(row.id),
          class: {
            id: Number(row.class_id),
            course: { code: row.course_code, name: row.course_name },
            section: row.section,
            term: row.term,
          },
          lecturer: { id: Number(row.lecturer_id), name: row.lecturer_name },
          room_label: row.room_label,
          starts_at: new Date(row.starts_at).toISOString(),
          ends_at: new Date(row.ends_at).toISOString(),
        },
      }));
    // The message names every kind of clash, also when the list is cut short.
    const kinds = new Set(
      [...typesBySession.values()].flatMap((types) => [...types]),
    );
    throw new ScheduleConflictException(
      `This time overlaps a scheduled session of ${joinWithAnd(
        [...kinds].map((type) => CONFLICT_TEXT[type]),
      )}.`,
      conflicts,
    );
  }

  private async load(
    manager: EntityManager,
    id: number,
    now: Date,
  ): Promise<ManagedSessionDto> {
    const rows = (await manager.query(`${SELECT} WHERE s.id = ?`, [
      id,
    ])) as SessionRow[];
    if (!rows[0]) throw notFound('Class session not found.');
    return toSession(rows[0], now);
  }
}

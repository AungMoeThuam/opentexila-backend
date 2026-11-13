import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import {
  ApiException,
  notFound,
  validationError,
} from '../common/api-exception';
import {
  isDuplicateKey,
  sessionExists,
} from '../class-sessions/session-exists';
import {
  malaysiaDayEnd,
  malaysiaDayMessage,
  malaysiaDayStart,
  parseMalaysiaDay,
} from '../common/malaysia-day';
import {
  LATE_TOO_LONG_MESSAGE,
  lateTooLong,
} from '../class-sessions/session-times';
import { DATABASE } from '../database/database.constants';
import {
  findTimetableConflicts,
  type TimetableConflictSession,
} from './timetable-conflicts';
import type {
  TimetableBatchUpdateDto,
  TimetableQueryDto,
} from './dto/timetable.dto';

interface SessionRow {
  id: number | string;
  class_id: number | string;
  lecturer_id: number | string;
  course_code: string;
  course_name: string;
  section: string;
  lecturer_name: string;
  room_label: string;
  starts_at: Date | string;
  late_after: Date | string;
  ends_at: Date | string;
  state: 'scheduled' | 'cancelled';
}

export interface SessionDto {
  id: number;
  class_id: number;
  course: {
    code: string;
    name: string;
  };
  section: string;
  lecturer: {
    id: number;
    name: string;
  };
  room_label: string;
  starts_at: string;
  late_after: string;
  ends_at: string;
  status: 'scheduled' | 'cancelled';
}

interface Queryable {
  query<T = any>(sql: string, parameters?: unknown[]): Promise<T>;
}

const SESSION_SQL = `
  SELECT
    s.id,
    s.class_id,
    c.lecturer_id,
    co.code AS course_code,
    co.name AS course_name,
    c.section,
    u.name AS lecturer_name,
    s.room_label,
    s.starts_at,
    s.late_after,
    s.ends_at,
    s.state
  FROM class_sessions s
  JOIN classes c ON c.id = s.class_id
  JOIN courses co ON co.id = c.course_id
  JOIN users u ON u.id = c.lecturer_id
`;

function parseUtcTimestamp(value: string): Date | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) {
    return null;
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  // Also reject impossible calendar values that JavaScript normalises.
  const inputWithoutMilliseconds = value.slice(0, 19);
  const actualWithoutMilliseconds = date.toISOString().slice(0, 19);

  if (inputWithoutMilliseconds !== actualWithoutMilliseconds) {
    return null;
  }

  return date;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new Error('Invalid session timestamp from database.');
  }

  return date.toISOString();
}

// MySQL DATETIME has no timezone.
// The project's mysql2 connection is configured with timezone: 'Z'.
function mysqlUtc(date: Date): string {
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function toSessionDto(row: SessionRow): SessionDto {
  return {
    id: Number(row.id),
    class_id: Number(row.class_id),
    course: {
      code: row.course_code,
      name: row.course_name,
    },
    section: row.section,
    lecturer: {
      id: Number(row.lecturer_id),
      name: row.lecturer_name,
    },
    room_label: row.room_label,
    starts_at: toIso(row.starts_at),
    late_after: toIso(row.late_after),
    ends_at: toIso(row.ends_at),
    status: row.state,
  };
}

function conflictSession(row: SessionRow): TimetableConflictSession {
  return {
    id: Number(row.id),
    class_id: Number(row.class_id),
    lecturer_id: Number(row.lecturer_id),
    room_label: row.room_label,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    state: row.state,
  };
}

function scheduleConflict(): ApiException {
  return new ApiException(
    409,
    'SCHEDULE_CONFLICT',
    'One or more sessions conflict with the timetable.',
  );
}

function sessionNotEditable(): ApiException {
  return new ApiException(
    409,
    'SESSION_NOT_EDITABLE',
    'A session has already started, ended or been cancelled.',
  );
}

@Injectable()
export class TimetableService {
  constructor(
    @Inject(DATABASE)
    private readonly database: DataSource,
  ) {}

  async list(query: TimetableQueryDto) {
    // from and to are Malaysia days (ADR 0001); "to" is inclusive.
    const from = parseMalaysiaDay(query.from);
    const to = parseMalaysiaDay(query.to);

    if (from === undefined || to === undefined || from > to) {
      const fields: Record<string, string> = {};
      if (from === undefined) fields.from = malaysiaDayMessage('from');
      if (to === undefined) fields.to = malaysiaDayMessage('to');
      else if (from !== undefined && from > to)
        fields.to = 'The end date must not be before the start date.';
      throw validationError(fields);
    }

    const start = malaysiaDayStart(from);
    const endExclusive = malaysiaDayEnd(to);

    const page = query.page ?? 1;
    const limit = query.limit ?? 100;

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw validationError({
        page: 'Provide a valid page.',
        limit: 'Limit must be between 1 and 100.',
      });
    }

    const [countRow] = await this.database.query<{ total: number | string }[]>(
      `
        SELECT COUNT(*) AS total
        FROM class_sessions
        WHERE ends_at > ?
          AND starts_at < ?
      `,
      [mysqlUtc(start), mysqlUtc(endExclusive)],
    );

    const total = Number(countRow?.total ?? 0);

    const rows = await this.database.query<SessionRow[]>(
      `
        ${SESSION_SQL}
        WHERE s.ends_at > ?
          AND s.starts_at < ?
        ORDER BY s.starts_at ASC, s.id ASC
        LIMIT ? OFFSET ?
      `,
      [mysqlUtc(start), mysqlUtc(endExclusive), limit, (page - 1) * limit],
    );

    return {
      data: rows.map(toSessionDto),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async updateBatch(body: TimetableBatchUpdateDto) {
    if (!Array.isArray(body.changes) || body.changes.length === 0) {
      throw validationError({
        changes: 'Provide at least one session change.',
      });
    }

    if (body.changes.length > 100) {
      throw validationError({
        changes: 'A batch may contain at most 100 changes.',
      });
    }

    const ids = body.changes.map((change) => change.id);

    if (new Set(ids).size !== ids.length) {
      throw validationError({
        changes: 'Each session can appear only once in a batch.',
      });
    }

    const requested = body.changes.map((change) => {
      const start = parseUtcTimestamp(change.starts_at);
      const late = parseUtcTimestamp(change.late_after);
      const end = parseUtcTimestamp(change.ends_at);

      if (
        !Number.isSafeInteger(change.id) ||
        change.id < 1 ||
        !start ||
        !late ||
        !end ||
        start.getTime() > late.getTime() ||
        late.getTime() >= end.getTime()
      ) {
        throw validationError({
          changes: 'Provide valid session IDs and UTC time ranges.',
        });
      }

      return {
        id: change.id,
        start,
        late,
        end,
      };
    });

    // A SERIALIZABLE transaction plus locking the session rows
    // protects this batch against competing timetable updates.
    // Cross-feature concurrency will also need integration tests
    // with the basic scheduling API from Backend Issue #19.
    try {
      return await this.database.transaction(
        'SERIALIZABLE',
        async (manager: EntityManager) => {
          const now = Date.now();

          // Lock session rows in a consistent order.
          // This is deliberately conservative for the first version.
          await manager.query(
            'SELECT id FROM class_sessions ORDER BY id FOR UPDATE',
          );

          const rows = await manager.query<SessionRow[]>(
            `${SESSION_SQL} ORDER BY s.id ASC`,
          );

          const byId = new Map(rows.map((row) => [Number(row.id), row]));

          const proposed = new Map(
            rows.map((row) => [Number(row.id), conflictSession(row)]),
          );

          for (const change of requested) {
            const original = byId.get(change.id);

            if (!original) {
              throw notFound(`Class session ${change.id} was not found.`);
            }

            const originalStart = new Date(original.starts_at).getTime();

            if (
              original.state !== 'scheduled' ||
              !Number.isFinite(originalStart) ||
              originalStart <= now
            ) {
              throw sessionNotEditable();
            }

            if (change.start.getTime() <= now) {
              throw validationError({
                starts_at: 'The new start time must be in the future.',
              });
            }

            // The late time is at most MAX_LATE_MINUTES after the start. A
            // session saved before there was a limit keeps its old allowance
            // when it is only moved, but cannot be given a new long one.
            const originalOffset =
              new Date(original.late_after).getTime() - originalStart;
            const newOffset = change.late.getTime() - change.start.getTime();
            if (
              lateTooLong(change.start, change.late) &&
              newOffset !== originalOffset
            ) {
              throw validationError({ late_after: LATE_TOO_LONG_MESSAGE });
            }

            proposed.set(change.id, {
              ...conflictSession(original),
              starts_at: change.start,
              ends_at: change.end,
            });
          }

          // Compare the final proposed timetable, not just
          // changed sessions against each other.
          const conflicts = findTimetableConflicts([...proposed.values()]);

          const changedIds = new Set(ids);

          const relevantConflicts = conflicts.filter(
            (conflict) =>
              changedIds.has(conflict.session_id) ||
              changedIds.has(conflict.with_session_id),
          );

          if (relevantConflicts.length > 0) {
            throw scheduleConflict();
          }

          // No changes are persisted before all validation succeeds.
          // A class cannot have two sessions with the same start, even for a
          // moment, and MySQL checks that row by row. So a swap (or a longer
          // cycle) would fail halfway. First park every changed row on its own
          // start time in the year 1000, which no real session uses, then write
          // the final times. All rows are locked, so nobody sees the parked rows.
          const parkIds = requested.map((change) => change.id);
          await manager.query(
            `UPDATE class_sessions
           SET starts_at = DATE_ADD('1000-01-01 00:00:00.000', INTERVAL id SECOND)
           WHERE id IN (${parkIds.map(() => '?').join(', ')})`,
            parkIds,
          );

          for (const change of requested) {
            await manager.query(
              `
              UPDATE class_sessions
              SET starts_at = ?,
                  late_after = ?,
                  ends_at = ?
              WHERE id = ?
            `,
              [
                mysqlUtc(change.start),
                mysqlUtc(change.late),
                mysqlUtc(change.end),
                change.id,
              ],
            );
          }

          const placeholders = requested.map(() => '?').join(', ');

          const updated = await manager.query<SessionRow[]>(
            `
            ${SESSION_SQL}
            WHERE s.id IN (${placeholders})
            ORDER BY s.starts_at ASC, s.id ASC
          `,
            ids,
          );

          return {
            data: updated.map(toSessionDto),
          };
        },
      );
    } catch (error) {
      // Moving onto the start time of a cancelled session of the same class.
      if (isDuplicateKey(error)) throw sessionExists();
      throw error;
    }
  }
}

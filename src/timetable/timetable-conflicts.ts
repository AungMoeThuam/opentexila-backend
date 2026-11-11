/**
 * Server-side scheduling conflict detection.
 *
 * Backend Issue #32 / Frontend Issue #23.
 * Does not create, cancel or modify class sessions.
 */

export type TimetableConflictType = 'class' | 'lecturer' | 'room';

export interface TimetableConflictSession {
  id: number;
  class_id: number;
  lecturer_id: number;
  room_label: string;
  starts_at: Date | string;
  ends_at: Date | string;
  state: 'scheduled' | 'cancelled';
}

export interface TimetableConflict {
  session_id: number;
  with_session_id: number;
  type: TimetableConflictType;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function sessionsOverlap(
  first: TimetableConflictSession,
  second: TimetableConflictSession,
): boolean {
  const firstStart = timestamp(first.starts_at);
  const firstEnd = timestamp(first.ends_at);
  const secondStart = timestamp(second.starts_at);
  const secondEnd = timestamp(second.ends_at);

  if (![firstStart, firstEnd, secondStart, secondEnd].every(Number.isFinite)) {
    return false;
  }

  return firstStart < secondEnd && secondStart < firstEnd;
}

export function findTimetableConflicts(
  sessions: readonly TimetableConflictSession[],
): TimetableConflict[] {
  const active = sessions.filter((session) => session.state === 'scheduled');

  const conflicts: TimetableConflict[] = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const first = active[i];
      const second = active[j];

      if (!sessionsOverlap(first, second)) {
        continue;
      }

      const types: TimetableConflictType[] = [];

      if (first.class_id === second.class_id) {
        types.push('class');
      }

      if (first.lecturer_id === second.lecturer_id) {
        types.push('lecturer');
      }

      const firstRoom = first.room_label.trim().toLowerCase();

      const secondRoom = second.room_label.trim().toLowerCase();

      if (firstRoom && firstRoom === secondRoom) {
        types.push('room');
      }

      for (const type of types) {
        conflicts.push({
          session_id: first.id,
          with_session_id: second.id,
          type,
        });
      }
    }
  }

  return conflicts;
}

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findTimetableConflicts,
  sessionsOverlap,
  type TimetableConflictSession,
} from '../dist/timetable/timetable-conflicts.js';

const START = '2026-11-18T01:00:00.000Z';
const END = '2026-11-18T03:00:00.000Z';

function session(
  overrides: Partial<TimetableConflictSession> = {},
): TimetableConflictSession {
  return {
    id: 1,
    class_id: 1,
    lecturer_id: 2,
    room_label: 'Demo Room 1',
    starts_at: START,
    ends_at: END,
    state: 'scheduled',
    ...overrides,
  };
}

test('detects overlapping sessions', () => {
  assert.equal(
    sessionsOverlap(
      session(),
      session({
        id: 2,
        starts_at: '2026-11-18T02:00:00.000Z',
        ends_at: '2026-11-18T04:00:00.000Z',
      }),
    ),
    true,
  );
});

test('allows adjacent sessions', () => {
  assert.equal(
    sessionsOverlap(
      session(),
      session({
        id: 2,
        starts_at: END,
        ends_at: '2026-11-18T05:00:00.000Z',
      }),
    ),
    false,
  );
});

test('detects same-class conflicts', () => {
  const conflicts = findTimetableConflicts([
    session(),
    session({
      id: 2,
      lecturer_id: 3,
      room_label: 'Demo Room 2',
    }),
  ]);

  assert.deepEqual(
    conflicts.map((item) => item.type),
    ['class'],
  );
});

test('detects lecturer conflicts', () => {
  const conflicts = findTimetableConflicts([
    session(),
    session({
      id: 2,
      class_id: 2,
      room_label: 'Demo Room 2',
    }),
  ]);

  assert.deepEqual(
    conflicts.map((item) => item.type),
    ['lecturer'],
  );
});

test('detects room conflicts case-insensitively', () => {
  const conflicts = findTimetableConflicts([
    session(),
    session({
      id: 2,
      class_id: 2,
      lecturer_id: 3,
      room_label: ' demo room 1 ',
    }),
  ]);

  assert.deepEqual(
    conflicts.map((item) => item.type),
    ['room'],
  );
});

test('allows overlapping sessions with different resources', () => {
  const conflicts = findTimetableConflicts([
    session(),
    session({
      id: 2,
      class_id: 2,
      lecturer_id: 3,
      room_label: 'Demo Room 2',
    }),
  ]);

  assert.deepEqual(conflicts, []);
});

test('ignores cancelled sessions', () => {
  const conflicts = findTimetableConflicts([
    session(),
    session({
      id: 2,
      state: 'cancelled',
    }),
  ]);

  assert.deepEqual(conflicts, []);
});

test('detects multiple conflict types', () => {
  const conflicts = findTimetableConflicts([session(), session({ id: 2 })]);

  assert.deepEqual(
    conflicts.map((item) => item.type),
    ['class', 'lecturer', 'room'],
  );
});

test('returns affected session ids', () => {
  const conflicts = findTimetableConflicts([
    session({ id: 10 }),
    session({ id: 20 }),
  ]);

  assert.deepEqual(conflicts[0], {
    session_id: 10,
    with_session_id: 20,
    type: 'class',
  });
});

test('rejects invalid timestamps from overlap checks', () => {
  assert.equal(
    sessionsOverlap(
      session(),
      session({
        id: 2,
        starts_at: 'invalid-date',
      }),
    ),
    false,
  );
});

test('detects overlaps across midnight', () => {
  assert.equal(
    sessionsOverlap(
      session({
        starts_at: '2026-11-18T23:00:00.000Z',
        ends_at: '2026-11-19T01:00:00.000Z',
      }),
      session({
        id: 2,
        starts_at: '2026-11-19T00:30:00.000Z',
        ends_at: '2026-11-19T02:00:00.000Z',
      }),
    ),
    true,
  );
});

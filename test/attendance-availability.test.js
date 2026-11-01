const { test } = require('node:test');
const assert = require('node:assert/strict');
const { availabilityFor } = require('../dist/attendance/availability');

const starts_at = new Date('2026-10-29T01:00:00.000Z');
const ends_at = new Date('2026-10-29T03:00:00.000Z');
const scheduled = { state: 'scheduled', starts_at, ends_at };
const at = (ms) => new Date(ms);

test('a scheduled session is upcoming before it starts', () => {
  assert.equal(
    availabilityFor(scheduled, at(starts_at.getTime() - 1)),
    'upcoming',
  );
});

test('a scheduled session is in progress from the start until the end', () => {
  assert.equal(availabilityFor(scheduled, starts_at), 'in_progress');
  assert.equal(
    availabilityFor(scheduled, at(ends_at.getTime() - 1)),
    'in_progress',
  );
});

test('a scheduled session is ended at and after the end time', () => {
  assert.equal(availabilityFor(scheduled, ends_at), 'ended');
  assert.equal(
    availabilityFor(scheduled, at(ends_at.getTime() + 86400000)),
    'ended',
  );
});

test('a cancelled session is always cancelled', () => {
  const cancelled = { ...scheduled, state: 'cancelled' };
  for (const now of [
    at(starts_at.getTime() - 1),
    starts_at,
    at(ends_at.getTime() + 1),
  ]) {
    assert.equal(availabilityFor(cancelled, now), 'cancelled');
  }
});

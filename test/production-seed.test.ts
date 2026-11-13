import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_EMAIL,
  LIVE_CLASS_KEY,
  LIVE_RADIUS_M,
  buildProductionPlan,
  checkPlan,
  numberWord,
} from '../database/seeds/production-data.ts';

const NOW = new Date('2026-11-14T03:00:00Z');

test('number words give the account names', () => {
  assert.equal(numberWord(1), 'one');
  assert.equal(numberWord(21), 'twenty-one');
  assert.equal(numberWord(50), 'fifty');
});

test('the plan has one admin and named lecturers and students', () => {
  const { users } = buildProductionPlan(NOW);
  assert.equal(users.filter((u) => u.role === 'admin').length, 1);
  assert.equal(users[0].email, ADMIN_EMAIL);
  assert.ok(users.some((u) => u.email === 'lecturer-one@example.com'));
  assert.ok(users.some((u) => u.email === 'student-fifty@example.com'));
  assert.equal(new Set(users.map((u) => u.email)).size, users.length);
  assert.ok(users.every((u) => !/teacher/i.test(u.name)));
});

test('main lists have 2 or 3 pages and nobody has too many rows', () => {
  const { counts, problems } = checkPlan(buildProductionPlan(NOW));
  assert.deepEqual(problems, []);
  assert.equal(counts.adminListPages.classes, 2);
  assert.equal(counts.adminListPages.users, 3);
});

test('the lists stay valid whatever day the seed runs', () => {
  for (let day = 0; day < 14; day += 1) {
    const now = new Date(+NOW + day * 86400000);
    assert.deepEqual(
      checkPlan(buildProductionPlan(now)).problems,
      [],
      String(now),
    );
  }
});

test('attendance records follow the rules', () => {
  const plan = buildProductionPlan(NOW);
  for (const session of plan.sessions) {
    assert.ok(session.starts_at <= session.late_after);
    assert.ok(session.late_after < session.ends_at);
    if (session.state === 'cancelled') assert.equal(session.records.length, 0);
    for (const r of session.records) {
      if (r.status === 'present') {
        assert.ok(r.checked_in_at && r.checked_in_at <= session.late_after);
      }
      if (r.status === 'late') {
        assert.ok(r.checked_in_at && r.checked_in_at > session.late_after);
        assert.ok(r.checked_in_at < session.ends_at);
      }
      if (r.status === 'pending' || r.status === 'absent')
        assert.equal(r.checked_in_at, null);
      else assert.ok(Number(r.distance_m) >= 0);
    }
  }
});

test('the live demo session is open now and covers any place', () => {
  const plan = buildProductionPlan(NOW);
  const live = plan.classes.find((c) => c.key === LIVE_CLASS_KEY);
  assert.equal(live?.radius_m, LIVE_RADIUS_M);
  const session = plan.sessions.find((s) => s.classKey === LIVE_CLASS_KEY);
  assert.ok(session && session.starts_at <= NOW && NOW < session.late_after);
  assert.ok(session.records.every((r) => r.status === 'pending'));
  assert.ok(live.studentEmails.includes('student-one@example.com'));
});

test('a lecturer has no overlapping sessions', () => {
  const plan = buildProductionPlan(NOW);
  const owner = new Map(plan.classes.map((c) => [c.key, c.lecturerEmail]));
  const rows = plan.sessions
    .filter((s) => s.classKey !== LIVE_CLASS_KEY)
    .map((s) => ({
      who: owner.get(s.classKey),
      a: +s.starts_at,
      b: +s.ends_at,
    }))
    .sort(
      (x, y) => (x.who as string).localeCompare(y.who as string) || x.a - y.a,
    );
  for (let i = 1; i < rows.length; i += 1)
    if (rows[i].who === rows[i - 1].who)
      assert.ok(rows[i].a >= rows[i - 1].b, 'sessions overlap');
});

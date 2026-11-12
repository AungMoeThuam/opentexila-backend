# Lecturer attendance analytics endpoint

Status: ready-for-agent
Spec: ../spec.md
Release blocked by: backend PR #34 (finalisation). Development is not blocked; build against `main`.

## Goal
Implement `GET /api/v1/lecturer/attendance-analytics` exactly as described in `../spec.md`.

## Acceptance criteria
- [ ] Lecturer gets summary, trend, byClass, atRisk, unfinalised for the filters; matches the shape in frontend #34 plus the additions in the spec.
- [ ] Only Finalised class sessions and currently enrolled students count; cancelled and unfinalised sessions never affect rates.
- [ ] Malaysia-time (UTC+8) day boundaries for `from`/`to` (inclusive whole days) and `trend[].date`.
- [ ] Attendance rate formula, per-class at-risk rows, server-side sort, `atRiskCount` = rows.
- [ ] 401, 403 (non-lecturer, other lecturer's or unknown classId), 422 with the `fields` keys listed in the spec, 500 message.
- [ ] Empty range returns 200 with zeros and empty arrays.
- [ ] No coordinates, distance or check-in times in the response.
- [ ] Aggregation done in SQL; query plan checked on a term-sized seed; index migration only if needed.
- [x] Confirm `GET /me/classes` fits the frontend class selector (see Comments).
- [ ] `docs/api/` updated with the contract; tests: aggregation, authorization, validation, day boundary (00:30 MYT), dropped student, unfinalised session.

## Tests (TDD seams)
Aggregation queries, authorization, validation, timezone boundary.

## Comments

- `GET /me/classes` fits: a lecturer gets only their own classes, `limit` is 1-100 (default 20, so the frontend must send `limit=100`), items have `id`, `course{id,code,name}`, `section`, `term` (snake_case, plus `lecturer` and `room_label`). Admins get 403.
- Implemented against `main`, not blocked by PR #34 for development. `npm run test:db` (real MySQL) could not be run in the session that wrote it (no Docker): run it before merging.
- Rate used for "at risk" is the displayed one-decimal rate, so 74.95% (shown 75.0) is not below 75.

# Lecturer attendance analytics (backend)

Frontend spec: https://github.com/AungMoeThuam/opentexila/issues/34 (shape, error table). This file records the decisions that sharpen or change it. Terms are in `GLOSSARY.md`; days in `docs/adr/0001-date-filters-use-malaysia-time.md`.

## Endpoint
`GET /api/v1/lecturer/attendance-analytics`, read-only, lecturer only.

## Query
`classId?`, `from`, `to` (YYYY-MM-DD, inclusive), `atRiskBelow` (whole number 75-100, default 75).
Without `classId`: all of the signed-in Lecturer's Classes.

## What counts
- Only **Finalised class sessions** in range (ended, not cancelled, no pending record of a currently enrolled student). Finalisation is by Lecturer request (backend PR #34, `POST /class-sessions/:id/finalise`); nothing finalises automatically.
- Only Attendance records of **currently enrolled** students. Students who dropped or withdrew are ignored everywhere (summary, trend, byClass, atRisk), including for earlier sessions.
- Assumptions for now: every student enrolled from the first session (no mid-term joiners); every session has at least one student.
- Days are Malaysia-local (UTC+8) calendar days of the session start, for `from`/`to` and `trend[].date`.

## Numbers
- Attendance rate = (present + late) / (present + late + absent), one decimal, 0-100; zero records -> 0.
- `summary.sessions` = distinct Finalised class sessions in range.
- At-risk is per (student, class), rate < `atRiskBelow`. `summary.atRiskCount` = `atRisk.length` (rows).
- `atRisk` sorted by rate ascending, then student name, then class. Row: studentId, name, email, classId, sessions, present, late, absent, attendanceRate. Students with no counted session are excluded.
- `byClass` includes every class that appears in `atRisk` or `unfinalised` (classId, course{code,name}, section, term).
- Empty result: 200 with zero counts and empty arrays.

## Additions to #34 (additive; frontend ignores until its card exists)
- `unfinalised[]`: Ended class sessions in range that are not finalised, oldest first: `classSessionId`, `classId`, `date` (MYT), `startsAt`, `endsAt` (UTC ISO), `pendingCount`.
- `summary.unfinalisedSessions` = `unfinalised.length`.
- Frontend follow-up: card listing them with a Finalise action.

## Errors (envelope `{ error: { code, message, fields } }`)
- 401 `UNAUTHENTICATED` signed out.
- 403 `FORBIDDEN` non-lecturer (admins too), or any valid `classId` that is not this Lecturer's, including IDs that do not exist.
- 422 `VALIDATION_ERROR` with `fields` keys `classId` (bad format), `from`, `to` (missing, bad format, `from > to`), `atRiskBelow`.
- 500 `INTERNAL_ERROR`, message "The server is not available."

## Privacy
Status counts only. No coordinates, distance or check-in times.

## Performance
Aggregate in the database. Check indexes on class session (class, start) and attendance record (session, student); add a migration if the query plan needs one.

## Class selector
`GET /me/classes` already returns a Lecturer's own Classes (paged). Verify `limit` up to 100 and `id`, `course{code,name}`, `section`, `term` when implementing.

## Out of scope
CSV/PDF export, email warnings, student or admin views, a cheaper threshold-only endpoint (a threshold change refetches everything for now), mid-term joiners (needs an enrolled-at date).

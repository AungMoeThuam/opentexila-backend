# Lecturer attendance analytics

`GET /api/v1/lecturer/attendance-analytics` — read-only, `lecturer` only. Feeds the frontend analytics dashboard (frontend issue #34). Terms are defined in [`GLOSSARY.md`](../../GLOSSARY.md); the Malaysia-time day rule is [ADR 0001](../adr/0001-analytics-days-use-malaysia-time.md).

> JSON property names here are **camelCase**, matching the frontend contract. This is a deliberate exception to the snake_case convention in [README.md](README.md).

## Query

| Parameter     | Required | Rule                                                                                  |
| ------------- | -------- | ------------------------------------------------------------------------------------- |
| `from`        | yes      | `YYYY-MM-DD`, a real date. Inclusive.                                                 |
| `to`          | yes      | `YYYY-MM-DD`, a real date, not before `from`. Inclusive (the whole day).              |
| `atRiskBelow` | no       | Whole number 75–100. Default `75`.                                                    |
| `classId`     | no       | Positive integer. Omitted: all of the signed-in Lecturer's Classes.                   |

Days are Malaysia calendar days (UTC+8) of the Class session's start, for `from`/`to` and `trend[].date`.

## What counts

- Only **Finalised class sessions**: not cancelled, `ends_at` passed, and no `pending` record of a currently enrolled student. A Lecturer finalises a session with `POST /class-sessions/:classSessionId/finalise`; nothing finalises automatically.
- Only Attendance records of **currently enrolled** students. A student who dropped or withdrew is ignored everywhere, including for earlier sessions.
- Attendance rate = (present + late) / (present + late + absent), one decimal, `0` when there are no records.
- At risk is judged **per class** on the rate as shown (one decimal): one row per (student, class) with rate < `atRiskBelow`.
- Assumptions for now: every student was enrolled from the first session (no mid-term joiners); every session has at least one student.

## Success `200`

```json
{
  "data": {
    "summary": { "sessions": 12, "present": 180, "late": 20, "absent": 40,
                 "attendanceRate": 83.3, "atRiskCount": 4, "unfinalisedSessions": 1 },
    "trend": [{ "date": "2026-10-06", "present": 28, "late": 3, "absent": 4 }],
    "byClass": [{ "classId": 7, "course": { "code": "COS30043", "name": "Interface Design" },
                  "section": "01", "term": "2026-S2",
                  "present": 95, "late": 10, "absent": 15, "attendanceRate": 87.5 }],
    "atRisk": [{ "studentId": 21, "name": "Student Two", "email": "student.two@example.com",
                 "classId": 7, "sessions": 12, "present": 6, "late": 1, "absent": 5,
                 "attendanceRate": 58.3 }],
    "unfinalised": [{ "classSessionId": 30, "classId": 7, "date": "2026-10-08",
                      "startsAt": "2026-10-08T02:00:00.000Z",
                      "endsAt": "2026-10-08T04:00:00.000Z", "pendingCount": 2 }]
  },
  "meta": { "from": "2026-10-01", "to": "2026-10-31", "atRiskBelow": 75 }
}
```

- `summary.sessions` counts Finalised class sessions only. `atRiskCount` = `atRisk.length` (rows, not distinct students). `unfinalisedSessions` = `unfinalised.length`.
- `trend` is ordered by date ascending; `byClass` by `classId`. `byClass` contains every class that has a counted or unfinalised session in range, so it labels every `atRisk` and `unfinalised` row.
- `atRisk` is sorted by the server: rate ascending, then student name, then `classId`.
- `unfinalised` lists ended, non-cancelled sessions that still have a pending record, oldest first. `classSessionId` is the id to pass to the finalise endpoint. Excluded from every count above.
- An empty result is `200` with zero counts and empty arrays.
- Privacy: status counts only. No coordinates, distance or check-in times.

## Errors

| Status | Code               | When                                                                                               |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------- |
| `401`  | `UNAUTHENTICATED`  | Signed out.                                                                                        |
| `403`  | `FORBIDDEN`        | Not a lecturer (admins too), or a valid `classId` that is not this Lecturer's — including ids that do not exist. |
| `422`  | `VALIDATION_ERROR` | `error.fields` keys `classId`, `from`, `to`, `atRiskBelow`. `from` after `to` is reported on `from`. |
| `500`  | `INTERNAL_ERROR`   | Message `The server is not available.`; no internal detail.                                        |

## Known limits

- Numbers stay low until Lecturers finalise sessions; `unfinalised` exists so the dashboard can show them.
- A student who joined mid-term is not handled (`enrolments` has no enrolled-at date).
- A threshold change refetches the whole response.

## Implementation

`attendance-analytics.service.ts` runs three queries: class ownership (only with `classId`), one row per session with status counts, and one row per (student, class). `attendance-analytics.rules.ts` holds the pure validation and assembly. Tests: `test/lecturer-attendance-analytics.test.ts` (HTTP, fake database) and `test/attendance-analytics.integration.ts` (`npm run test:db`, real MySQL).

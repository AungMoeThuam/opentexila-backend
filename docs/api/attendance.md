# Attendance API

[API overview](README.md) · [Authentication](auth.md)

**Status: planned; no endpoints implemented.** Paths below are relative to `/api/v1`. All operations require an active authenticated account and appropriate class access.

## Planned endpoints

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/classes/:id/attendance-sessions` | Authorised class members/admin | List visible attendance sessions for a class. |
| POST | `/classes/:id/attendance-sessions` | Assigned lecturer/admin | Open a session at class start and snapshot the eligible roster and location rules. |
| GET | `/attendance-sessions/:id` | Authorised class members/admin | Read session details and the student's own record when applicable. |
| PATCH | `/attendance-sessions/:id` | Assigned lecturer/admin | Finalise at/after class end, or cancel an invalid session with a reason. |
| POST | `/attendance-sessions/:id/check-ins` | Eligible enrolled student | Validate location and code, then save the student's attendance. |
| GET | `/attendance-sessions/:id/records` | Assigned lecturer/admin | View the session roster and attendance records. |
| GET | `/attendance/me` | Student | View the authenticated student's attendance history. |

Session responses must not expose code hashes or other students' records. Mutations require CSRF protection. Exact list filters, pagination and response schemas remain to be finalised.

## Full-class check-in window

- The lecturer opens the session when class starts; closing time is the class end.
- Accept new check-ins when `opens_at <= server_time < closes_at`.
- The late threshold changes Present to Late; it does not end check-in.
- Failed checks leave the record Pending so the student can retry during class.
- At class end, remaining Pending records become Absent. Reject normal early closure.
- A cancelled session is retained as history but excluded from attendance totals.

For a 09:00–11:00 class, a valid check-in is allowed from 09:00 until just before 11:00. No scheduled automatic opening or continuous tracking is included in the initial scope.

## Proposed check-in request

`POST /attendance-sessions/42/check-ins`

```json
{
  "latitude": 3.139,
  "longitude": 101.6869,
  "accuracy_m": 12,
  "reading_timestamp": "2026-10-24T01:05:00Z",
  "session_code": "example-session-code"
}
```

These coordinates are illustrative, not configured classroom coordinates. Field names and exact success/error responses are proposals pending implementation. The student ID is derived from the authenticated session, never supplied as the authority in the request body.

## Validation and record rules

- Require successful location acquisition; permission alone does not award attendance.
- Validate finite coordinate ranges, non-negative accuracy, reported freshness, session code, enrolment, roster eligibility and server time.
- Use the session's saved location and thresholds, not client-supplied acceptance settings.
- Proposed acceptance policy: `accuracy_m <= max_accuracy_m` and `distance_m + accuracy_m <= radius_m`.
- Save Present or Late only after all checks pass; staff cannot bypass location validation to award attendance.
- Repeated successful check-ins return the existing record and original timestamp. Include current session state so cancelled attendance is not shown as counting toward totals.
- Serialize check-in, closure and cancellation to avoid conflicting updates.
- Discard raw student coordinates after validation; retain the result, timing, calculated distance and reported accuracy.

Location readings can be manipulated and may be inaccurate indoors. One check-in does not prove presence throughout the class.

## Dependencies and contract details to finalise

Attendance requires users, class locations, lecturer assignments and enrolment records even though the broader users/classrooms features are deferred.

Before implementation, specify session creation and update payloads, code format, reading-freshness limits, list filters, success responses and error codes. Test location thresholds at the actual venue. Permission denial, location failures, outside-area readings and expired sessions must not create new successful attendance records.

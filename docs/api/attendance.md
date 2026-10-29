# Attendance API

[API overview](README.md) · [Database design](../database-design.md)

**Status: planned endpoints; database foundation implemented.** Paths are relative to /api/v1. Active authentication, role/class access and CSRF on mutations are required.

## Scheduled attendance flow

The institution configures concrete `class_sessions` in advance. At scheduled start, enrolled students see “Class in progress”, enter the class and check in using location. Attendance opens/closes from the timetable. There is **no session code and no lecturer opening action**.

When a class session is created, a service inserts one `pending` `attendance_records` row per enrolled student. A due-session worker marks remaining `pending` records `absent` after `ends_at`. These services are not implemented yet. Class-session ID is the stable frontend entry point.

## Resource names and compatibility

Use plural kebab-case resources under `/api/v1`, with explicit camelCase path IDs. `classId` identifies `classes.id` and `classSessionId` identifies `class_sessions.id`. JSON FK fields remain snake_case. APIs do not use frontend role prefixes; guards enforce roles and resource access.

Timing and cancellation come only from `class_sessions`. Attendance records belong directly to a class session and student. Cancelled class sessions are excluded from totals; retain their attendance evidence. No worker is implemented yet.

## Proposed endpoints

| Method | Path                                                | Access                   | Purpose                                                                             |
| ------ | --------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| GET    | /me/class-sessions                                  | Student/lecturer         | List visible upcoming, in-progress and ended class occurrences from the timetable.  |
| GET    | /class-sessions/:classSessionId                     | Authorised member/admin  | Class, schedule, availability and student's own check-in result.                    |
| POST   | /class-sessions/:classSessionId/check-ins           | Eligible student         | Validate location and record attendance on the student's pending record.            |
| GET    | /classes/:classId/class-sessions    | Authorised members/admin | Class timetable/history with pagination.                                            |
| POST   | /classes/:classId/class-sessions    | Admin                    | Configure a future occurrence; validate overlap, start/end and thresholds.          |
| PATCH  | /class-sessions/:classSessionId                     | Admin                    | Reschedule only before start; or cancel. |
| GET    | /class-sessions/:classSessionId/records             | Assigned lecturer/admin  | Read the roster; no manual Present/Late awards.                                     |
| GET    | /me/attendance-records                              | Student                  | Personal attendance history.                                                        |

Closure is a service operation at/after scheduled end, not a lecturer task. Response DTOs must hide other students' records, password/token hashes and session-store data. Fields, filters, pagination and error bodies remain contracts to finalise during API implementation.

## Check-in body

```json
{
  "latitude": 3.139,
  "longitude": 101.6869,
  "accuracy_m": 12,
  "reading_timestamp": "2026-10-27T01:08:00Z"
}
```

Coordinates are illustrative. Identity comes from the authenticated session; never trust a submitted student ID, distance or attendance status.

## Required rules

- Require a record in the session's roster and an active authenticated student. A new acceptance requires Pending; an already successful check-in returns its original result without changing its timestamp.
- Check `classSession.starts_at <= server_time < classSession.ends_at` using server time after acquiring the transaction lock.
- On/before late_after is Present; afterwards is Late. The late threshold does not close check-in.
- Validate finite coordinate bounds, reading freshness and accuracy. Use the class venue (`classes.latitude`, `longitude`, `radius_m`), not client acceptance settings.
- Proposed location rule: distance <= radius_m. The submitted accuracy is used for validation only and is not stored.
- Permission denial, unavailable/inaccurate/outside-area readings leave Pending; allow retries before end.
- At end, remaining Pending becomes Absent. Scheduled downtime must not extend the deadline.
- Repeated success returns the original result/timestamp. Cancelled sessions do not count toward totals.
- Keep raw location readings out of storage/logs; retain the accepted distance and server check-in time only.
- Lock the class session before its records for check-in, cancellation and finalisation; recheck cancellation after locking. See the database design.
- The composite primary key `(class_session_id, student_id)` protects against duplicate records.

One location check-in does not prove presence throughout the class. Real indoor thresholds, freshness limits and device behavior need testing separately from database setup.

# Attendance API

[API overview](README.md) · [Database design](../database-design.md)

**Status: planned endpoints; database foundation implemented.** Paths are relative to /api/v1. Active authentication, role/class access and CSRF on mutations are required.

## Scheduled attendance flow

The institution configures concrete class_meetings in advance. At scheduled start, enrolled students see “Class in progress”, enter the class and check in using location. Attendance opens/closes from the timetable. There is **no session code and no lecturer opening action**.

A due-meeting service/worker and idempotent API fallback will materialise one attendance_session and its eligible roster. They must handle restarts and overdue meetings. These services are not implemented yet. Meeting ID is the stable frontend entry point even before the attendance-session row exists.

## Proposed endpoints

| Method | Path                             | Access                   | Purpose                                                                                  |
| ------ | -------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| GET    | /me/meetings                     | Student/lecturer         | List visible upcoming, in-progress and ended class occurrences from the timetable.       |
| GET    | /class-meetings/:id              | Authorised member/admin  | Class, schedule, availability and student's own check-in result.                         |
| POST   | /class-meetings/:id/check-ins    | Eligible student         | Ensure due session; validate location and record attendance.                             |
| GET    | /classes/:id/class-meetings      | Authorised members/admin | Class timetable/history with pagination.                                                 |
| POST   | /classes/:id/class-meetings      | Admin                    | Configure a future occurrence; validate overlap, start/end and thresholds.               |
| PATCH  | /class-meetings/:id              | Admin                    | Reschedule before start or cancel with a reason; update associated session consistently. |
| GET    | /attendance-sessions/:id/records | Assigned lecturer/admin  | Read the roster; no manual Present/Late awards.                                          |
| GET    | /attendance/me                   | Student                  | Personal attendance history.                                                             |

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

- Require a record in the frozen scheduled-start roster and an active authenticated student. A new acceptance requires Pending; an already successful check-in returns its original result without changing its timestamp.
- Check opens_at <= server_time < closes_at using server time after acquiring the transaction lock.
- On/before late_after is Present; afterwards is Late. The late threshold does not close check-in.
- Validate finite coordinate bounds, reading freshness and accuracy. Use the snapshot venue, not client acceptance settings.
- Proposed location rule: accuracy <= max_accuracy_m and distance + accuracy <= radius_m.
- Permission denial, unavailable/inaccurate/outside-area readings leave Pending; allow retries before end.
- At end, remaining Pending becomes Absent. Scheduled downtime must not extend the deadline.
- Repeated success returns the original result/timestamp. Cancelled sessions do not count toward totals.
- Keep raw location readings out of storage/logs; retain accepted distance/accuracy and server times only.
- Serialize creation/check-in/closure/cancellation; a unique meeting FK and session/student pair protect against duplicate inserts.

One location check-in does not prove presence throughout the class. Real indoor thresholds, freshness limits and device behavior need testing separately from database setup.

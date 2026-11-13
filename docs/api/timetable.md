# Admin Timetable API

**Status:** Implemented.

All paths are relative to `/api/v1`. Both endpoints require an authenticated `admin` user.

These endpoints list and reschedule existing class sessions. They do not create or cancel sessions.

## GET /class-sessions

Lists timetable sessions for a selected UTC calendar date range.

### Query parameters

| Parameter | Required | Description                                      |
| --------- | -------- | ------------------------------------------------ |
| `from`    | Yes      | Start date in `YYYY-MM-DD` format (inclusive)    |
| `to`      | Yes      | End date in `YYYY-MM-DD` format (inclusive)      |
| `page`    | No       | Positive integer; defaults to `1`                |
| `limit`   | No       | Integer between `1` and `100`; defaults to `100` |

Example:

`GET /api/v1/class-sessions?from=2026-11-16&to=2026-11-22&page=1&limit=20`

Unlike the shared API timestamp convention, this endpoint uses UTC calendar dates. Both `from` and `to` are inclusive, and `from` must not be after `to`.

Sessions are included when their time interval overlaps the selected date range. Results are ordered by start time and session ID.

A successful response contains a `data` array of timetable sessions and pagination `meta` with `page`, `limit`, `total`, and `totalPages`.

The `totalPages` value is at least `1`, including when no sessions match the selected date range.

Each session includes its ID, class and course information, lecturer, room, UTC timestamps, and status.

## PATCH /class-sessions/batch

Atomically reschedules existing class sessions.

### Request body

The JSON body requires a `changes` array containing 1–100 entries.

| Field        | Type    | Description                                   |
| ------------ | ------- | --------------------------------------------- |
| `id`         | Integer | Existing session ID, between 1 and 4294967295 |
| `starts_at`  | String  | New start time, UTC ISO 8601                  |
| `late_after` | String  | New late threshold, UTC ISO 8601              |
| `ends_at`    | String  | New end time, UTC ISO 8601                    |

Example request:

```json
{
  "changes": [
    {
      "id": 1,
      "starts_at": "2026-11-18T09:00:00.000Z",
      "late_after": "2026-11-18T09:15:00.000Z",
      "ends_at": "2026-11-18T11:00:00.000Z"
    }
  ]
}
```

All timestamps must use UTC ISO 8601 format and end with `Z`.

Each session ID must be unique within the batch.

Timestamps must satisfy `starts_at <= late_after < ends_at`, and the new `starts_at` must be in the future.

`late_after` must also be at most 30 minutes after `starts_at` (the late allowance limit; see [attendance.md](attendance.md#patch-class-sessionsclasssessionidattendance-policy)). A longer time returns `422 VALIDATION_ERROR` with `fields.late_after`, and no change is saved. A session that was saved before the limit existed keeps its old allowance when it is only moved, that is when the new `late_after` is the same number of minutes after the new `starts_at` as the saved one was. It cannot be given a different allowance above the limit.

Only scheduled sessions that have not started can be rescheduled. Sessions that have already started, ended, or been cancelled cannot be rescheduled.

### Conflict detection

The service detects overlapping sessions involving the same class, lecturer, or room.

Cancelled sessions are excluded from scheduling conflict detection.

The service checks the final proposed timetable, including sessions that are not part of the batch.

If any requested change causes a scheduling conflict, the entire batch is rejected.

### Atomic updates

The batch runs within a `SERIALIZABLE` database transaction with row locking.

If validation, session eligibility checks, or conflict detection fails, no partial update is committed.

A successful response contains a `data` array of updated session details.

## Errors

Errors use the standard [API error envelope](README.md#shared-error-envelope-all-non-2xx-responses).

| HTTP | Code                       | Meaning                                                                      |
| ---- | -------------------------- | ---------------------------------------------------------------------------- |
| 401  | `UNAUTHENTICATED`          | Missing or invalid authentication                                            |
| 403  | `FORBIDDEN`                | Insufficient role permissions                                                |
| 403  | `PASSWORD_CHANGE_REQUIRED` | Password change required before using protected APIs                         |
| 404  | `RESOURCE_NOT_FOUND`       | A requested class session does not exist                                     |
| 409  | `SCHEDULE_CONFLICT`        | A proposed session conflicts with the timetable                              |
| 409  | `SESSION_NOT_EDITABLE`     | A session has started, ended, or been cancelled                              |
| 422  | `VALIDATION_ERROR`         | Invalid query parameters, duplicate session IDs, timestamps, or request body |

The `404` and `409` errors listed above apply to batch rescheduling.

## Related endpoints

Admin session creation, cancellation, and attendance-policy changes are documented separately in [Attendance API](attendance.md#admin-session-management).

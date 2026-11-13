# Attendance & Check-in API

[API overview](README.md) · [Authentication](auth.md) · [Classes & Enrolments](enrolments.md) · [Database design](../database-design.md)

**Status: student schedule, detail, check-in, roster materialisation, student history, history class options and the lecturer roster are implemented. Every route uses `AttendanceGuard`, accepting Bearer JWTs in JWT mode or a verified demo session in development mode. See [authentication](auth.md) and [development sign-in](../DEVELOPMENT_AUTH.md). The lecturer finalisation endpoint (`POST /class-sessions/:classSessionId/finalise`) is implemented.** All paths below are relative to `/api/v1`. Follow the [shared HTTP, pagination, CSRF and error envelope rules](README.md#shared-http-rules).

## Scheduled attendance flow

1. **Pre-scheduled occurrences (`class_sessions`)**: Each class meeting has `starts_at`, `late_after`, `ends_at`, `state` (`'scheduled' | 'cancelled'`), and a frozen venue snapshot (`room_label`, `latitude`, `longitude`, `radius_m`).
2. **Automatic roster materialisation**: At or after `starts_at`, the backend ensures one `attendance_records` row (`PRIMARY KEY (class_session_id, student_id)`) with `status = 'pending'` for each enrolled student in `enrolments`. There is **no session code and no lecturer opening action**.
3. **Geolocation check-in (`POST /class-sessions/:classSessionId/check-ins`)**: An enrolled student submits their browser coordinates while `starts_at <= server_now < ends_at`. A valid reading on or before `late_after` sets `status = 'present'`; after `late_after` and before `ends_at` sets `status = 'late'`. The server records `checked_in_at` and `distance_m` and never persists raw student coordinates.
4. **Lecturer finalisation (`POST /class-sessions/:classSessionId/finalise`)**: At or after `ends_at`, the assigned lecturer finalises the class session. Every remaining `pending` record, and every enrolled student without a record, is marked `absent`. There is no automatic finalisation: until the lecturer finalises, those students stay `pending`.

## Endpoint summary

| Method | Path | Access | Related issues | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/me/class-sessions` | `student`, `lecturer` | Backend `#10`, `#12` / Frontend `#7`, `#9` | List scheduled class sessions for enrolled or assigned classes |
| `GET` | `/class-sessions/:classSessionId` | Authorised `student`, `lecturer`, `admin` | Backend `#10` / Frontend `#7` | Class session detail, availability, and student check-in eligibility |
| `POST` | `/class-sessions/:classSessionId/check-ins` | Eligible `student` | Backend `#10` / Frontend `#7` | Validate browser location and record `present` or `late` |
| `POST` | `/class-sessions/:classSessionId/finalise` | Assigned `lecturer` | Backend `#13` | Mark remaining `pending` students `absent` after the session has ended |
| `GET` | `/class-sessions/:classSessionId/records` | Assigned `lecturer`, `admin` | Backend `#12` / Frontend `#9` | Read-only attendance roster for a class session |
| `GET` | `/classes/:classId/class-sessions` | `admin` | Backend `#19` / Frontend `#17` | List the sessions of one class with attendance counts |
| `POST` | `/classes/:classId/class-sessions` | `admin` | Backend `#19` / Frontend `#17` | Schedule a new session for a class |
| `POST` | `/class-sessions/:classSessionId/cancel` | `admin` | Backend `#19` / Frontend `#17` | Cancel a session that has not ended; keeps its attendance records |
| `PATCH` | `/class-sessions/:classSessionId/attendance-policy` | `admin` | Backend `#25` / Frontend `#25` | Change the venue and the late time of one session that has not started |
| `GET` | `/me/attendance-records` | `student` | Backend `#11` / Frontend `#8` | Personal attendance history across class sessions |
| `GET` | `/me/attendance-records/classes` | `student` | Backend `#17` / Frontend `#14` | Classes the student can pick in the attendance-history filter |

---

## Endpoint specifications

### `GET /me/class-sessions`

Returns a paginated list of class sessions ordered by `starts_at ASC, id ASC`:
- For `student`: sessions in classes the student is enrolled in (or where the student has a materialised `attendance_records` row), including `my_attendance`.
- For `lecturer`: sessions in classes assigned to the lecturer (`classes.lecturer_id = user.id`), with `my_attendance: null`.

Shared handler owned by the check-in workflow (`#10`) and extended with lecturer scoping by the lecturer roster workflow (`#12`).

- **Access**: `student` or `lecturer`.
- **Query parameters**:
  - `page` (optional, default `1`, integer `1`–`10000`)
  - `limit` (optional, default `20`, integer `1`–`100`)
  - `classId` (optional, positive integer matching `classes.id`)
  - `from` (optional, ISO 8601 timestamp with timezone; `from <= starts_at`)
  - `to` (optional, ISO 8601 timestamp with timezone; `starts_at < to`)

#### Success response — `200 OK`

```json
{
  "data": [
    {
      "id": 30,
      "class_id": 1,
      "class": {
        "id": 1,
        "course": {
          "id": 1,
          "code": "COS30043",
          "name": "Interface Design and Development"
        },
        "section": "A",
        "term": "2026-S2",
        "lecturer": {
          "id": 2,
          "name": "Lecturer One"
        },
        "room_label": "EN402"
      },
      "starts_at": "2026-10-29T01:00:00.000Z",
      "late_after": "2026-10-29T01:15:00.000Z",
      "ends_at": "2026-10-29T03:00:00.000Z",
      "state": "scheduled",
      "availability": "in_progress",
      "my_attendance": {
        "class_session_id": 30,
        "student_id": 3,
        "status": "present",
        "checked_in_at": "2026-10-29T01:05:00.000Z",
        "distance_m": "5.00"
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- `availability` is derived from server time: `"cancelled"` when `state = 'cancelled'`; otherwise `"upcoming"` before `starts_at`, `"in_progress"` when `starts_at <= server_now < ends_at`, and `"ended"` when `server_now >= ends_at`.
- `my_attendance` is `null` for lecturers, or `null` for students before a record is materialised. A pending record has `status: "pending"`, `checked_in_at: null`, and `distance_m: null`.

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller role is not `student` or `lecturer` |
| `422` | `VALIDATION_ERROR` | Invalid `page`, `limit`, `classId`, `from`, `to`, or `from >= to` |

---

### `GET /class-sessions/:classSessionId`

Returns the detail of a single class session, including `check_in: { allowed, reason }` so the student UI knows whether to enable the check-in button or display why check-in is unavailable.

- **Access**: Enrolled `student` (or student with a record in the session), assigned `lecturer`, or `admin`.
- **Path parameters**: `classSessionId` — positive integer `class_sessions.id`.

#### Success response — `200 OK`

```json
{
  "data": {
    "id": 30,
    "class_id": 1,
    "class": {
      "id": 1,
      "course": {
        "id": 1,
        "code": "COS30043",
        "name": "Interface Design and Development"
      },
      "section": "A",
      "term": "2026-S2",
      "lecturer": {
        "id": 2,
        "name": "Lecturer One"
      },
      "room_label": "EN402"
    },
    "starts_at": "2026-10-29T01:00:00.000Z",
    "late_after": "2026-10-29T01:15:00.000Z",
    "ends_at": "2026-10-29T03:00:00.000Z",
    "state": "scheduled",
    "availability": "in_progress",
    "my_attendance": {
      "class_session_id": 30,
      "student_id": 3,
      "status": "present",
      "checked_in_at": "2026-10-29T01:05:00.000Z",
      "distance_m": "5.00"
    },
    "check_in": {
      "allowed": false,
      "reason": "ALREADY_CHECKED_IN"
    }
  }
}
```

- `check_in.reason` is `null` when `check_in.allowed` is `true`.
- When `check_in.allowed` is `false`, `reason` is one of:
  - `"CLASS_CANCELLED"`
  - `"ROLE_NOT_STUDENT"`
  - `"NOT_ELIGIBLE"`
  - `"ALREADY_CHECKED_IN"`
  - `"NOT_STARTED"`
  - `"CLASS_ENDED"`
  (evaluated in that priority order).

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `404` | `RESOURCE_NOT_FOUND` | Session does not exist or caller has no access to this class session |
| `422` | `VALIDATION_ERROR` | Invalid `classSessionId` |

---

### `POST /class-sessions/:classSessionId/check-ins`

Validates the authenticated student's browser geolocation reading against the class session's time window and venue geofence (`latitude`, `longitude`, `radius_m`) and updates the student's `attendance_records` row (`(class_session_id, student_id)`).

- **Access**: Eligible `student` only.
- **Path parameters**: `classSessionId` — positive integer `class_sessions.id`.
- **Headers**: `Content-Type: application/json`, plus `Authorization: Bearer <accessToken>` in JWT mode; in demo mode send the session cookie and `X-CSRF-Token`.

#### Request body

```json
{
  "latitude": 3.139,
  "longitude": 101.6869,
  "accuracy_m": 12,
  "reading_timestamp": "2026-10-29T01:04:58.000Z"
}
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `latitude` | `number` | Yes | Finite number between `-90` and `90` |
| `longitude` | `number` | Yes | Finite number between `-180` and `180` |
| `accuracy_m` | `number` | Yes | Finite positive number (`> 0`) |
| `reading_timestamp` | `string` | Yes | Valid ISO 8601 UTC timestamp string |

#### Success response (first check-in or accepted replay) — `200 OK`

First acceptance updates the materialised `(class_session_id, student_id)` row from `pending` to `present` (when `server_now <= late_after`) or `late` (when `late_after < server_now < ends_at`), so it returns `200 OK` (not `201`). Replaying a check-in when already `present` or `late` returns the original record and timestamp unchanged (`200 OK`), provided the class session is not cancelled.

```json
{
  "data": {
    "class_session_id": 30,
    "attendance_record": {
      "class_session_id": 30,
      "student_id": 3,
      "status": "present",
      "checked_in_at": "2026-10-29T01:05:00.000Z",
      "distance_m": "5.00"
    }
  }
}
```

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | Malformed JSON body |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller role is not `student` |
| `403` | `CSRF_INVALID` | Missing or invalid `X-CSRF-Token` in demo mode |
| `403` | `NOT_ELIGIBLE` | Student has no eligible roster record for this class session |
| `404` | `RESOURCE_NOT_FOUND` | Class session does not exist or is outside the student's scope |
| `409` | `CLASS_NOT_STARTED` | Check-in attempted before `starts_at` |
| `409` | `CLASS_ENDED` | New check-in attempted at or after `ends_at` |
| `409` | `CLASS_CANCELLED` | Class session `state` is `'cancelled'` (including replay requests) |
| `422` | `LOCATION_STALE` | `reading_timestamp` is too old or in the future |
| `422` | `LOCATION_INACCURATE` | `accuracy_m` exceeds the service accuracy threshold |
| `422` | `OUTSIDE_ALLOWED_AREA` | Calculated distance exceeds `class_sessions.radius_m` |
| `422` | `VALIDATION_ERROR` | Missing/non-finite coordinates, non-positive `accuracy_m`, or invalid `reading_timestamp` |

Example `422 Unprocessable Entity` (`LOCATION_INACCURATE`):

```json
{
  "error": {
    "code": "LOCATION_INACCURATE",
    "message": "Your location is not accurate enough. Please retry.",
    "fields": {}
  }
}
```

Example `422 Unprocessable Entity` (`OUTSIDE_ALLOWED_AREA`):

```json
{
  "error": {
    "code": "OUTSIDE_ALLOWED_AREA",
    "message": "You are outside the allowed classroom check-in area.",
    "fields": {}
  }
}
```

---

### `GET /class-sessions/:classSessionId/records`

Returns the read-only attendance roster for a single class session ordered by `student_id ASC`, alongside session and class `context`.

- **Access**: Assigned `lecturer` (`classes.lecturer_id = user.id`) or `admin`.
- **Path parameters**: `classSessionId` — positive integer `class_sessions.id`.
- **Query parameters**:
  - `page` (optional, default `1`, integer `1`–`10000`)
  - `limit` (optional, default `20`, integer `1`–`100`)
  - `status` (optional, `'pending' | 'present' | 'late' | 'absent'`)

#### Success response — `200 OK`

```json
{
  "data": [
    {
      "class_session_id": 30,
      "student_id": 3,
      "status": "present",
      "checked_in_at": "2026-10-29T01:05:00.000Z",
      "student": {
        "id": 3,
        "name": "Student One"
      }
    }
  ],
  "context": {
    "class_session_id": 30,
    "class": {
      "id": 1,
      "course": {
        "id": 1,
        "code": "COS30043",
        "name": "Interface Design and Development"
      },
      "section": "A",
      "term": "2026-S2",
      "lecturer": {
        "id": 2,
        "name": "Lecturer One"
      },
      "room_label": "EN402"
    },
    "starts_at": "2026-10-29T01:00:00.000Z",
    "late_after": "2026-10-29T01:15:00.000Z",
    "ends_at": "2026-10-29T03:00:00.000Z",
    "class_state": "scheduled"
  },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- `pending` and `absent` rows have `checked_in_at: null`.
- `context` is always returned even when `data` is `[]` (for example, when filtering by a status with zero matches or viewing an upcoming unmaterialised session).

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller is a `student` |
| `404` | `RESOURCE_NOT_FOUND` | Session does not exist or caller is a `lecturer` not assigned to this class |
| `422` | `VALIDATION_ERROR` | Invalid `classSessionId`, `page`, `limit`, or unknown `status` |

---

### `GET /me/attendance-records`

Returns the authenticated student's personal attendance history ordered by `class_sessions.starts_at DESC, class_session_id DESC`. Sessions the lecturer has not yet finalised still show `pending` records.

- **Access**: `student` only (no `studentId` override parameter is accepted).
- **Query parameters**:
  - `page` (optional, default `1`, integer `1`–`10000`)
  - `limit` (optional, default `20`, integer `1`–`100`)
  - `classId` (optional, positive integer matching `classes.id`)
  - `from` (optional, ISO 8601 timestamp with timezone; `from <= starts_at`)
  - `to` (optional, ISO 8601 timestamp with timezone; `starts_at < to`)
  - `status` (optional, `'pending' | 'present' | 'late' | 'absent'`)
  - `includeCancelled` (optional, `'true' | 'false'`, default `'false'`)

#### Success response — `200 OK`

```json
{
  "data": [
    {
      "class_session_id": 30,
      "student_id": 3,
      "class": {
        "id": 1,
        "course": {
          "id": 1,
          "code": "COS30043",
          "name": "Interface Design and Development"
        },
        "section": "A",
        "term": "2026-S2",
        "lecturer": {
          "id": 2,
          "name": "Lecturer One"
        },
        "room_label": "EN402"
      },
      "starts_at": "2026-10-29T01:00:00.000Z",
      "ends_at": "2026-10-29T03:00:00.000Z",
      "class_state": "scheduled",
      "status": "present",
      "checked_in_at": "2026-10-29T01:05:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- Cancelled sessions (`class_state: "cancelled"`) are excluded by default (`includeCancelled=false`) and never count toward attendance percentage denominators `(present + late) / (present + late + absent)`.

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller is not a `student` |
| `422` | `VALIDATION_ERROR` | Invalid `page`, `limit`, `classId`, `from`, `to`, `status`, or `includeCancelled` |

---

### `GET /me/attendance-records/classes`

Returns the classes a student can choose in the attendance-history class filter. A class appears when the student has a **current enrolment** in it, or **any saved attendance record** for one of its class sessions, including records on cancelled sessions. Former classes therefore stay available after an enrolment is removed. Each class appears once, however many records it has. `GET /me/classes` (Backend `#8`) is unchanged and still lists current enrolments only.

- **Access**: `student` only. The student comes from the verified sign-in; no `studentId` is accepted.
- **Ordering**: `term DESC, course.code ASC, section ASC, classes.id ASC`.
- **Query parameters**:
  - `page` (optional, default `1`, integer `1`–`10000`)
  - `limit` (optional, default `20`, integer `1`–`100`)
- The controller also answers on the legacy alias `/attendance/me/classes`; use `/me/attendance-records/classes`.
- The options never depend on the history filters. Other query parameters, including `classId`, `from`, `to`, `status` and `includeCancelled`, are ignored.

#### Success response — `200 OK`

```json
{
  "data": [
    {
      "id": 1,
      "course": {
        "id": 1,
        "code": "COS30043",
        "name": "Interface Design and Development"
      },
      "section": "A",
      "term": "2026-S2",
      "lecturer": {
        "id": 2,
        "name": "Lecturer One"
      },
      "room_label": "EN402"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- `data` items use the same class summary as `GET /me/classes` and the `class` field of history rows.
- A student with no enrolments and no records gets `data: []` and `meta.total: 0`.
- A class known only from cancelled-session records is listed, but `GET /me/attendance-records?classId=…` returns no rows for it until `includeCancelled=true` is sent.

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller is not a `student` |
| `422` | `VALIDATION_ERROR` | Invalid `page` or `limit` |

---

### `POST /class-sessions/:classSessionId/finalise`

Lets the assigned lecturer finalise a class session after it has ended. The frontend calls this when the lecturer presses the finish button. It is idempotent, so repeated clicks are harmless.

- **Access**: `lecturer` assigned to the class (`classes.lecturer_id = user.id`). Admins and students are refused.
- **Path parameters**: `classSessionId` — positive integer `class_sessions.id`.
- **Body**: none. CSRF is required for demo-cookie sessions and not for Bearer tokens, as for check-ins.
- **Transaction**: lock the class, then the class session, then the attendance records. The server time and the lecturer's ownership are checked after the locks, inside the transaction.

Behaviour by session state:

| Condition                                                                     | `outcome`           | `absent_marked`                                                 | Effect                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `state = 'cancelled'`                                                         | `cancelled`         | `0`                                                             | None                                                                                                                              |
| `server_now < ends_at`                                                        | `not_due`           | `0`                                                             | None. There is no early close.                                                                                                    |
| Ended, `scheduled`, `pending` rows or unmaterialised enrolled students remain | `finalised`         | Count of rows changed to `absent` or newly inserted as `absent` | Missing rows are created as `absent`; `pending` becomes `absent`; `present` and `late` rows keep `checked_in_at` and `distance_m` |
| Ended, `scheduled`, nothing left to change                                    | `already_finalised` | `0`                                                             | None                                                                                                                              |

#### Success response — `200 OK`

All four outcomes return `200 OK`; the frontend branches on `outcome`.

```json
{
  "class_session_id": 30,
  "outcome": "finalised",
  "absent_marked": 2
}
```

#### Error responses

| HTTP  | `error.code`               | When                                                                                                                                                                                       |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `401` | `UNAUTHENTICATED`          | Missing or expired session                                                                                                                                                                 |
| `403` | `FORBIDDEN`                | Caller is a `student` or an `admin`                                                                                                                                                        |
| `404` | `RESOURCE_NOT_FOUND`       | Session does not exist, or the caller is a `lecturer` not assigned to this class                                                                                                           |
| `409` | `ATTENDANCE_DATA_CONFLICT` | A `pending` row has `checked_in_at`, or a `present`/`late` row has none. Nothing is changed. Defence in depth: the `ck_records_evidence` database constraint normally prevents these rows. |
| `422` | `VALIDATION_ERROR`         | Invalid `classSessionId`                                                                                                                                                                   |

### Assumptions and known gaps

- **Enrolled on time**: finalisation treats every current Enrolment as covering every class session of the class. `enrolments` has no enrolled-at date, so a student who joined mid-term is marked `absent` for earlier sessions, and a student who left before finalisation gets no row.
- **No automatic fallback**: if the lecturer never finalises, students stay `pending` and the session is ignored by the attendance percentage `(present + late) / (present + late + absent)`. A startup, scheduled or read-triggered sweep can later reuse the same finalisation logic.
- **No early close**: the lecturer cannot end a class session before `ends_at`.

## Implementation and integration notes

`AttendanceModule` registers the three discovery/detail/check-in routes in every environment. Lecturer schedule scoping is included in the shared list handler; lecturer roster reads are also implemented. `GET` responses derive availability from database UTC time; they materialise due non-cancelled rosters. Finalising pending records to absent is the lecturer endpoint of issue #13; this module runs no background worker.

### Authentication dependency

In JWT mode, `AttendanceGuard` delegates to the opt-in JWT guard, which verifies the Bearer access token and current account/session state. In demo mode it validates the server-owned session, expiry, session version and CSRF for mutations. Missing or invalid credentials fail closed; client-supplied identity headers and user IDs are never accepted.

Both modes check account status, mandatory password changes and roles, populate the shared `{ id, role }` identity, and retain service-level ownership, enrolment and location checks. Bearer-authenticated check-ins do not require CSRF; demo-cookie check-ins do. Responses use `Cache-Control: no-store`. See [JWT integration](../JWT_AUTH.md#attendance-modes).

### Location policy

Readings must be UTC ISO timestamps (ending in `Z`), at most 60 seconds old and at most 5 seconds in the future. Accuracy must be positive and no greater than 100 metres. Haversine distance uses Earth radius 6,371,000 metres; the unrounded distance must be at or within the session radius. Only the accepted distance rounded to two decimals and the database check-in time are persisted. Coordinates and accuracy are neither returned nor logged.

A structurally valid replay of an accepted check-in returns the original record even after the session ends or the reading becomes stale. Cancellation still takes precedence. Invalid body shapes remain `422 VALIDATION_ERROR` even on replay. Failed attempts are never automatically retried.

### Transactions and venue migration

Migration `1793491200000-SessionVenueSnapshot.ts` adds non-null room/coordinate/radius snapshots to sessions, backfills existing sessions from their current class venue, and adds coordinate/radius constraints. Historical venues cannot be reconstructed; backfill uses the class venue at migration time. Run migrations before starting the updated application. New session creators must copy all four venue fields when inserting a session; the demo seed now does so. Later class-venue changes do not change a session's check-in area.

`RosterService.materialise(classSessionId)` owns a transaction, locks the class before the class session, samples database time after the locks, and inserts missing pending rows without overwriting existing evidence. It skips future and cancelled sessions. `FinalisationService` reuses `lockClassSession` and `databaseNow` inside its own transaction. All enrolment, session cancellation, and finalisation writers must follow the same class → session lock order. Membership and attendance reads use locking current reads so they do not use an earlier repeatable-read snapshot after waiting on the class lock.

### Verification

`npm test` includes strict input validation, exact time/accuracy/freshness boundaries, geofence math, pending-state preservation, replay behavior, access scoping, safe DTOs and real Nest HTTP tests for authentication/CSRF/error envelopes. `npm run test:db` uses only its owned disposable MySQL container and covers concurrent materialisation/check-ins, venue snapshots, pagination/scoping, location failures and migration backfill/rollback. It never seeds the application database.

The local Docker stack supports authenticated browser-to-API verification with the development adapter enabled. Production login still requires the separate auth implementation.

## Admin session management

Admins list, schedule and cancel the sessions of a class. All three endpoints are admin only and use `AttendanceGuard`, so the same sign-in, CSRF (demo mode) and `PASSWORD_CHANGE_REQUIRED` rules apply. Responses use `Cache-Control: no-store`. Timetable rescheduling (`GET /class-sessions`, `PATCH /class-sessions/batch`) is a separate feature and is not changed here.

`PATCH /class-sessions/batch` applies a batch atomically, so sessions of one class can swap or rotate start times in one request. If a change lands on the start time of a cancelled session of the same class (cancelled sessions keep their start time), the whole batch fails with **409** `CLASS_SESSION_EXISTS` and nothing is saved.

The path for cancelling is `POST /class-sessions/:classSessionId/cancel`, in the same style as `…/finalise`. It has no request body. A `PATCH` on `/class-sessions/:classSessionId` is not used, because it would clash with the static route `PATCH /class-sessions/batch`.

### The session object

```json
{
  "id": 31,
  "class_id": 7,
  "room_label": "EN402",
  "latitude": "3.121500",
  "longitude": "101.656800",
  "radius_m": "75.00",
  "starts_at": "2026-11-20T01:00:00.000Z",
  "late_after": "2026-11-20T01:15:00.000Z",
  "ends_at": "2026-11-20T03:00:00.000Z",
  "state": "scheduled",
  "availability": "upcoming",
  "attendance": { "present": 0, "late": 0, "absent": 0, "pending": 0 }
}
```

- `state` is the saved state: `scheduled` or `cancelled`.
- `availability` comes from the server clock: `cancelled`, `upcoming`, `in_progress` or `ended`. It is not stored.
- `attendance` counts the saved records by status. Pending rows exist only after the session has started.
- Times are UTC with a `Z` suffix. Decimal fields are strings, as everywhere else in the API.

### `GET /classes/:classId/class-sessions`

| Query | Rule | Default |
| --- | --- | --- |
| `state` | `scheduled` or `cancelled` | both |
| `page` | Integer, 1–10000 | `1` |
| `limit` | Integer, 1–100 | `20` |

Sorted by `starts_at` from early to late, then `id`, so pages stay stable. Success: **200 OK**

```json
{
  "data": [ { "...": "session object" } ],
  "context": {
    "class": {
      "id": 7,
      "course": { "id": 1, "code": "COS30043", "name": "Interface Design" },
      "section": "A",
      "term": "2026-S2",
      "lecturer": { "id": 2, "name": "Lecturer One" },
      "room_label": "EN402"
    }
  },
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

A class with no sessions returns `"data": []` with `"total": 0`.

### `POST /classes/:classId/class-sessions`

```json
{
  "starts_at": "2026-11-20T01:00:00.000Z",
  "late_after": "2026-11-20T01:15:00.000Z",
  "ends_at": "2026-11-20T03:00:00.000Z"
}
```

| Field | Rule |
| --- | --- |
| `starts_at` | UTC timestamp `YYYY-MM-DDTHH:mm:ss[.sss]Z`. Must be later than the server time when the request is saved. |
| `late_after` | UTC timestamp. Not before `starts_at`, and before `ends_at`. |
| `ends_at` | UTC timestamp. After `starts_at`. |

Unknown fields are stripped, so `state`, `room_label` and the other venue fields cannot be set. The new session is `scheduled`. It copies the venue of the class (`room_label`, `latitude`, `longitude`, `radius_m`) at this moment, so a later change to the class does not move it. Attendance rosters are still created by the existing check-in flow when the session starts.

The server locks the class row, then checks for conflicts, so two requests for the same class cannot both pass the checks. A scheduled session conflicts when its time overlaps another **scheduled** session of the same class, of the same lecturer, or in the same room (letters and spacing ignored). Overlap means `starts_at < other.ends_at` and `other.starts_at < ends_at`, so sessions that touch end to start are allowed. Cancelled sessions never cause a conflict. A session with the same class and the same `starts_at` as an existing session, cancelled or not, is a duplicate.

#### Conflict details

A `409 SCHEDULE_CONFLICT` lists the sessions that clash, so the time can be changed. The usual `code`, `message` and `fields` stay the same, and `error.conflicts` is added:

```json
{
  "error": {
    "code": "SCHEDULE_CONFLICT",
    "message": "This time overlaps a scheduled session of the same lecturer and the same room.",
    "fields": {},
    "conflicts": [
      {
        "types": ["lecturer", "room"],
        "session": {
          "id": 12,
          "class": {
            "id": 8,
            "course": { "code": "COS20019", "name": "Networks" },
            "section": "A",
            "term": "2026-S2"
          },
          "lecturer": { "id": 2, "name": "Lecturer One" },
          "room_label": "EN402",
          "starts_at": "2026-11-20T01:00:00.000Z",
          "ends_at": "2026-11-20T03:00:00.000Z"
        }
      }
    ]
  }
}
```

- `types` says why the session clashes: `class`, `lecturer` and/or `room`. One session can have several.
- Only sessions that share a class, lecturer or room with the new session are listed, sorted by `starts_at`. At most 10 are listed, and `message` still names every kind of clash.
- The lecturer is the lecturer of the session's class.
- `CLASS_SESSION_EXISTS` has no `conflicts`. Its `fields.starts_at` says the class already has a session at that start time.

Success: **201 Created** with `{ "data": { session object } }`.

### `POST /class-sessions/:classSessionId/cancel`

No request body. The server locks the class, then the session, and reads the server time after both locks, in the same order as check-in and finalisation. A check-in and a cancellation that arrive together are therefore handled one after the other: a check-in saved before the cancellation stays, and every check-in after it receives `409 CLASS_CANCELLED`.

| Session now | Result |
| --- | --- |
| `upcoming` | Cancelled. |
| `in_progress` | Cancelled. Present and Late records already saved are kept. |
| `ended` | `409 CLASS_SESSION_ENDED`. History of an ended session is not changed. |
| `cancelled` | `200`, unchanged. Repeating the request is safe. |

Cancelling never deletes or changes attendance records, and it never creates absences. Finalisation ignores cancelled sessions. Sessions are never deleted. A cancelled session can not be reinstated through this API.

Success: **200 OK** with `{ "data": { session object } }` and `"state": "cancelled"`.

### `PATCH /class-sessions/:classSessionId/attendance-policy`

Changes the attendance settings of **one** session: where students can check in, and when a check-in counts as Late. The class is not touched, and neither are the other sessions of the class. A later change to the class defaults never changes a session that already exists.

```json
{
  "room_label": "EN305",
  "latitude": 3.1215,
  "longitude": 101.6568,
  "radius_m": 75,
  "late_after": "2026-11-20T01:15:00.000Z"
}
```

| Field | Rule |
| --- | --- |
| `room_label` | Optional. 1–100 characters after trimming. |
| `latitude` | Optional. Number from -90 to 90, rounded to 6 decimals. |
| `longitude` | Optional. Number from -180 to 180, rounded to 6 decimals. |
| `radius_m` | Optional. Number from 1 to 1000, rounded to 2 decimals. Same limits as a class. |
| `late_after` | Optional. UTC time `YYYY-MM-DDTHH:mm:ss[.sss]Z`. Not before the session's `starts_at` and before its `ends_at`. |

Send at least one field. An empty body returns `422`. Unknown fields are stripped, so `starts_at`, `ends_at`, `state` and `class_id` cannot be changed here (the timetable reschedules times). Fields you do not send keep their saved value.

**When it is allowed.** Only while the session is `scheduled` and has not started. The server locks the class, then the session, then reads its own clock, in the same order as check-in. A check-in therefore cannot happen between the check and the save. A session that has started, ended or been cancelled is history, so the server answers `409 SESSION_NOT_EDITABLE` and changes nothing. Attendance records are never changed.

**Check-in uses these values.** A student's check-in is checked against the session's saved location, radius and `late_after`, as before. After this change, the new values apply.

Success: **200 OK** with `{ "data": { session object } }` (the session object of this section).

### Errors

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | No valid sign-in |
| `403` | `FORBIDDEN` | The caller is not an admin |
| `403` | `PASSWORD_CHANGE_REQUIRED` | The calling admin must change the password first |
| `403` | `CSRF_INVALID` | Demo mode only: missing or wrong CSRF token |
| `404` | `RESOURCE_NOT_FOUND` | The class or session does not exist |
| `409` | `SESSION_NOT_EDITABLE` | Policy change: the session has started, ended or been cancelled |
| `409` | `CLASS_SESSION_EXISTS` | The class already has a session with this `starts_at` |
| `409` | `SCHEDULE_CONFLICT` | The time overlaps a scheduled session of the same class, lecturer or room. `error.conflicts` lists the sessions and why. |
| `409` | `CLASS_SESSION_ENDED` | Cancel: the session has already ended |
| `422` | `VALIDATION_ERROR` | An ID, query value or field is not valid, `starts_at` is not in the future, `late_after` is outside the session, or a policy change sends no field. `fields` names each one. |

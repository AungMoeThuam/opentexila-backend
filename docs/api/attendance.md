# Attendance & Check-in API

[API overview](README.md) · [Authentication](auth.md) · [Classes & Enrolments](enrolments.md) · [Database design](../database-design.md)

**Status: planned contract; database schema (`class_sessions`, `attendance_records`) implemented.** Until real authentication exists, the lecturer routes read the caller id from the temporary request header `X-Dev-User-Id` (no guard, no checks); a missing or invalid header gives `422 VALIDATION_ERROR`. All paths below are relative to `/api/v1`. Follow the [shared HTTP, pagination, CSRF and error envelope rules](README.md#shared-http-rules).

## Scheduled attendance flow

1. **Pre-scheduled occurrences (`class_sessions`)**: Each class meeting has `starts_at`, `late_after`, `ends_at`, `state` (`'scheduled' | 'cancelled'`), and a frozen venue snapshot (`room_label`, `latitude`, `longitude`, `radius_m`).
2. **Automatic roster materialisation**: At or after `starts_at`, the backend ensures one `attendance_records` row (`PRIMARY KEY (class_session_id, student_id)`) with `status = 'pending'` for each enrolled student in `enrolments`. There is **no session code and no lecturer opening action**.
3. **Geolocation check-in (`POST /class-sessions/:classSessionId/check-ins`)**: An enrolled student submits their browser coordinates while `starts_at <= server_now < ends_at`. A valid reading on or before `late_after` sets `status = 'present'`; after `late_after` and before `ends_at` sets `status = 'late'`. The server records `checked_in_at` and `distance_m` and never persists raw student coordinates.
4. **Automatic finalisation**: At or after `ends_at`, overdue non-cancelled class sessions have any remaining `pending` records (and any unmaterialised enrolled students) marked `absent` without lecturer intervention.

## Endpoint summary

| Method | Path | Access | Related issues | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/me/class-sessions` | `student`, `teacher` | Backend `#10`, `#12` / Frontend `#7`, `#9` | List scheduled class sessions for enrolled or assigned classes |
| `GET` | `/class-sessions/:classSessionId` | Authorised `student`, `teacher`, `admin` | Backend `#10` / Frontend `#7` | Class session detail, availability, and student check-in eligibility |
| `POST` | `/class-sessions/:classSessionId/check-ins` | Eligible `student` | Backend `#10` / Frontend `#7` | Validate browser location and record `present` or `late` |
| `GET` | `/class-sessions/:classSessionId/records` | Assigned `teacher`, `admin` | Backend `#12` / Frontend `#9` | Read-only attendance roster for a class session |
| `GET` | `/me/attendance-records` | `student` | Backend `#11` / Frontend `#8` | Personal attendance history across class sessions |

---

## Endpoint specifications

### `GET /me/class-sessions`

Returns a paginated list of class sessions ordered by `starts_at ASC, id ASC`:
- For `student`: sessions in classes the student is enrolled in (or where the student has a materialised `attendance_records` row), including `my_attendance`.
- For `teacher`: sessions in classes assigned to the lecturer (`classes.teacher_id = user.id`), with `my_attendance: null`.

Shared handler owned by the check-in workflow (`#10`) and extended with teacher scoping by the lecturer roster workflow (`#12`).

- **Access**: `student` or `teacher`.
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
          "name": "Lecturer Demo"
        },
        "room_label": "EN402"
      },
      "starts_at": "2026-10-29T01:00:00.000Z",
      "late_after": "2026-10-29T01:15:00.000Z",
      "ends_at": "2026-10-29T03:00:00.000Z",
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
- `my_attendance` is `null` for teachers, or `null` for students before a record is materialised. A pending record has `status: "pending"`, `checked_in_at: null`, and `distance_m: null`.

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller role is not `student` or `teacher` |
| `422` | `VALIDATION_ERROR` | Invalid `page`, `limit`, `classId`, `from`, `to`, or `from >= to` |

---

### `GET /class-sessions/:classSessionId`

Returns the detail of a single class session, including `check_in: { allowed, reason }` so the student UI knows whether to enable the check-in button or display why check-in is unavailable.

- **Access**: Enrolled `student` (or student with a record in the session), assigned `teacher`, or `admin`.
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
        "name": "Lecturer Demo"
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
- **Headers**: `Content-Type: application/json`, `X-CSRF-Token: <csrfToken>`.

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
| `403` | `CSRF_INVALID` | Missing or invalid `X-CSRF-Token` |
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
    "fields": {
      "accuracy_m": "Move to an area with a stronger location signal and retry."
    }
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

Returns the read-only attendance roster for a single class session ordered by `student_id ASC`, alongside session and class `context`. Triggers overdue finalisation catch-up if the session has ended.

- **Access**: Assigned `teacher` (`classes.teacher_id = user.id`) or `admin`.
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
        "name": "Lecturer Demo"
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
| `404` | `RESOURCE_NOT_FOUND` | Session does not exist or caller is a `teacher` not assigned to this class |
| `422` | `VALIDATION_ERROR` | Invalid `classSessionId`, `page`, `limit`, or unknown `status` |

---

### `GET /me/attendance-records`

Returns the authenticated student's personal attendance history ordered by `class_sessions.starts_at DESC, class_session_id DESC`. Ensures overdue ended sessions are finalised before returning results.

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
          "name": "Lecturer Demo"
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

## Internal service contract (Issue `#13`: Automatic finalisation & catch-up)

Automatic finalisation is an internal backend service/worker (`feat/attendance-finalisation`), **not a public HTTP endpoint**.

### `finaliseClassSession(classSessionId)` result DTO

```json
{
  "class_session_id": 30,
  "outcome": "finalised",
  "absent_marked": 2
}
```

- `outcome`: `"finalised" | "already_finalised" | "not_due" | "cancelled"`.
- `absent_marked`: number of student records marked `absent` (or newly materialised as `absent`) by this call (`0` for `"already_finalised"`, `"not_due"`, or `"cancelled"`).

### Catch-up batch result DTO

```json
{
  "processed": 3,
  "finalised": 1,
  "already_finalised": 1,
  "not_due": 0,
  "cancelled": 0,
  "failed": 1,
  "failures": [
    {
      "class_session_id": 32,
      "code": "TRANSIENT_DATABASE_ERROR",
      "retryable": true
    }
  ]
}
```

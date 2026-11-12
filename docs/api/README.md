# OpenTexila API Documentation

**Status: database foundation, opt-in JWT authentication, attendance APIs and development-only sample APIs are implemented. Enrolment APIs and admin account provisioning/reset remain planned.** The backend connects to MySQL through TypeORM. See each feature document for its implemented and planned routes.

This documentation belongs to the backend repository. The separate frontend repository links to these files rather than duplicating the API contract.

## Feature references

- [Sample classroom API](examples.md) — implemented development-only list/detail endpoints and a code pattern for teammates.
- [Authentication](auth.md) — JWT login, refresh, profile, logout and password changes.
- [Attendance](attendance.md) — sessions, location check-in and attendance history.
- [Lecturer attendance analytics](attendance-analytics.md) — summary, trend, class comparison, at-risk students and unfinalised sessions (`GET /lecturer/attendance-analytics`).
- **[Authentication & Account Onboarding](auth.md)** — CSRF token bootstrap, login, logout, current-user restoration (`/auth/me`), mandatory first-login password change, and admin account creation/password reset.
- **[Classes & Enrolments](enrolments.md)** — Admin class listing (`GET /classes`), personal enrolled/assigned classes (`GET /me/classes`), class student rosters (`GET /classes/:classId/enrolments`), and admin enrolment mutations (`POST` and `DELETE`).
- **[Courses & Class Management](courses-classes.md)** — Admin course list/create/edit (`GET`/`POST /courses`, `PATCH /courses/:courseId`), active lecturer options (`GET /lecturers`), and class create/detail/edit (`POST /classes`, `GET`/`PATCH /classes/:classId`) including lecturer assignment and attendance location.
- **[Attendance & Check-in](attendance.md)** — Personal and lecturer class-session schedules (`GET /me/class-sessions`), session detail & eligibility (`GET /class-sessions/:classSessionId`), geolocation check-in (`POST /class-sessions/:classSessionId/check-ins`), lecturer session rosters (`GET /class-sessions/:classSessionId/records`), student attendance history (`GET /me/attendance-records`), history class-filter options (`GET /me/attendance-records/classes`), and the internal finalisation service contract.
- **[Sample Classroom API](examples.md)** — Implemented development-only list/detail endpoints (`GET /examples/classrooms`, `GET /examples/classrooms/:id`) and a reference controller/service/test pattern for teammates.

## Master endpoint index

All paths below are relative to `/api/v1`. Admin account management and enrolment rows are planned contracts, not implemented endpoints.

| Domain         | Method   | Path                                        | Allowed roles                            | Purpose                                                         | Spec                                                                      |
| -------------- | -------- | ------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Auth**       | `GET`    | `/auth/csrf`                                | Guest / Any                              | Issue a signed CSRF token and cookie        | [auth.md](auth.md#get-authcsrf)                                           |
| **Auth**       | `POST`   | `/auth/login`                               | Guest                                    | Issue an access JWT and rotating refresh cookie   | [auth.md](auth.md#post-authlogin)                                         |
| **Auth** | `POST` | `/auth/refresh` | Refresh cookie + CSRF | Rotate tokens and return current profile | [auth.md](auth.md#post-authrefresh) |
| **Auth**       | `POST`   | `/auth/logout`                              | Any signed-in                            | Revoke the refresh session and clear cookies             | [auth.md](auth.md#post-authlogout)                                        |
| **Auth**       | `GET`    | `/auth/me`                                  | Any signed-in                            | Restore the current user's safe profile and role                | [auth.md](auth.md#get-authme)                                             |
| **Auth**       | `POST`   | `/auth/change-password`                     | Any signed-in                            | Change own password and clear `must_change_password`            | [auth.md](auth.md#post-authchange-password)                               |
| **Auth**       | `POST`   | `/admin/users`                              | `admin`                                  | Create a student/lecturer account with a temporary password     | [auth.md](auth.md#post-adminusers)                                        |
| **Auth**       | `POST`   | `/admin/users/:id/reset-password`           | `admin`                                  | Set a new temporary password and bump `session_version`         | [auth.md](auth.md#post-adminusersidreset-password)                        |
| **Enrolments** | `GET`    | `/classes`                                  | `admin`                                  | List classes with course, section, term, lecturer and room      | [enrolments.md](enrolments.md#get-classes)                                |
| **Courses**    | `GET`    | `/courses`                                  | `admin`                                  | Paginated course list and course selector                       | [courses-classes.md](courses-classes.md#get-courses)                      |
| **Courses**    | `POST`   | `/courses`                                  | `admin`                                  | Create a course                                                 | [courses-classes.md](courses-classes.md#post-courses)                     |
| **Courses**    | `PATCH`  | `/courses/:courseId`                        | `admin`                                  | Edit a course's code or name                                    | [courses-classes.md](courses-classes.md#patch-coursescourseid)            |
| **Courses**    | `GET`    | `/lecturers`                                | `admin`                                  | Active lecturer options for class assignment                    | [courses-classes.md](courses-classes.md#get-lecturers)                    |
| **Courses**    | `POST`   | `/classes`                                  | `admin`                                  | Create a class offering                                         | [courses-classes.md](courses-classes.md#post-classes)                     |
| **Courses**    | `GET`    | `/classes/:classId`                         | `admin`                                  | Class detail including attendance location                      | [courses-classes.md](courses-classes.md#get-classesclassid)               |
| **Courses**    | `PATCH`  | `/classes/:classId`                         | `admin`                                  | Edit a class offering, lecturer or attendance location          | [courses-classes.md](courses-classes.md#patch-classesclassid)             |
| **Enrolments** | `GET`    | `/me/classes`                               | `student`, `lecturer`                     | List student's enrolled classes or lecturer's assigned classes  | [enrolments.md](enrolments.md#get-meclasses)                              |
| **Enrolments** | `GET`    | `/classes/:classId/enrolments`              | `admin`, assigned `lecturer`              | List enrolled students for a class with class context           | [enrolments.md](enrolments.md#get-classesclassidenrolments)               |
| **Enrolments** | `POST`   | `/classes/:classId/enrolments`              | `admin`                                  | Enrol an active student into a class                            | [enrolments.md](enrolments.md#post-classesclassidenrolments)              |
| **Enrolments** | `DELETE` | `/classes/:classId/enrolments/:studentId`   | `admin`                                  | Remove a student's enrolment from a class                       | [enrolments.md](enrolments.md#delete-classesclassidenrolmentsstudentid)   |
| **Attendance** | `GET`    | `/me/class-sessions`                        | `student`, `lecturer`                     | List scheduled class sessions for enrolled/assigned classes     | [attendance.md](attendance.md#get-meclass-sessions)                       |
| **Attendance** | `GET`    | `/class-sessions/:classSessionId`           | Authorised `student`, `lecturer`, `admin` | Class session detail, availability, and student check-in status | [attendance.md](attendance.md#get-class-sessionsclasssessionid)           |
| **Attendance** | `POST`   | `/class-sessions/:classSessionId/check-ins` | Eligible `student`                       | Validate browser geolocation and record `present` or `late`     | [attendance.md](attendance.md#post-class-sessionsclasssessionidcheck-ins) |
| **Attendance** | `GET`    | `/class-sessions/:classSessionId/records`   | Assigned `lecturer`, `admin`              | Read-only attendance roster for a class session                 | [attendance.md](attendance.md#get-class-sessionsclasssessionidrecords)    |
| **Attendance** | `GET`    | `/me/attendance-records`                    | `student`                                | Personal attendance history across class sessions               | [attendance.md](attendance.md#get-meattendance-records)                   |
| **Attendance** | `GET`    | `/me/attendance-records/classes`            | `student`                                | Classes selectable in the attendance-history filter            | [attendance.md](attendance.md#get-meattendance-recordsclasses)         |
| **Attendance** | `GET`    | `/lecturer/attendance-analytics`            | `lecturer`                               | Attendance summary, trend, at-risk students for own classes     | [attendance-analytics.md](attendance-analytics.md)                        |
| **Examples**   | `GET`    | `/examples/classrooms`                      | Dev-only (`NODE_ENV=development`)        | Sample paginated classroom list                                 | [examples.md](examples.md#get-examplesclassrooms)                         |
| **Examples**   | `GET`    | `/examples/classrooms/:id`                  | Dev-only (`NODE_ENV=development`)        | Sample single classroom detail                                  | [examples.md](examples.md#get-examplesclassroomsid)                       |

## Base URL

Local development: `http://127.0.0.1:3000/api/v1` with the default host and port. For the shared Docker stack, the browser uses `/api/v1` through `http://localhost:5173`; Vite proxies to the API. `BACKEND_PORT` and `FRONTEND_DEV_PORT` can change those host ports; see [Docker configuration](../DOCKER.md#configuration). Paths in the feature documents are relative to `/api/v1`.

Separate source repositories do not require separate hosting origins. If the frontend and API use different origins, their credential, CORS, cookie and CSRF settings must be configured together.

## Resource route naming

Use plural kebab-case nouns (`classes`, `class-sessions`, `attendance-records`), explicit camelCase path/query IDs (`classId`, `classSessionId`, `studentId`, `courseId`) and snake_case JSON property names (`class_id`, `class_session_id`, `student_id`, `starts_at`). API resources use `/api/v1`, not `/student`, `/lecturer` or `/admin` prefixes (except admin-only account management under `/admin/users`). Reuse endpoints with server-enforced role/resource scoping. `/me` always refers to the authenticated user and never accepts a user/student ID parameter.

## Shared HTTP rules

- **Base path & Content-Type**: `/api/v1`. Send and return JSON; mutations with a body use `Content-Type: application/json`.
- **Authentication & CSRF**: JWT mode uses `Authorization: Bearer <accessToken>` on protected feature APIs, `/auth/me` and password changes. Send cookies and `X-CSRF-Token` for login, refresh and logout; obtain the token from `/auth/csrf` and replace it after login/refresh. Demo mode uses its server-owned cookie session and CSRF on mutations. See [authentication](auth.md) for token lifetimes and mode selection. New feature routes opt into guards explicitly.
- **Success envelopes**:
  - Single resource / mutation success (`200 OK` or `201 Created`):
    ```json
    {
      "data": { ... }
    }
    ```
  - Collection success (`200 OK`):
    ```json
    {
      "data": [ ... ],
      "meta": {
        "page": 1,
        "limit": 20,
        "total": 0,
        "totalPages": 0
      }
    }
    ```
    Collection endpoints may also include a documented top-level `context` object (for example, `context.class` on enrolment rosters or `context` on session attendance rosters).
  - Deletion / logout success (`204 No Content`): Empty response body.
- **Keys & data types**:
  - Surrogate IDs (`users.id`, `courses.id`, `classes.id`, `class_sessions.id`) are positive JSON integers.
  - Composite keys use `(class_id, student_id)` for `enrolments` and `(class_session_id, student_id)` for `attendance_records`.
  - Dates are ISO 8601 UTC strings (`"2026-10-29T01:00:00.000Z"`); optional timestamps/fields are explicit `null`.
  - JSON property names use `snake_case` except pagination `totalPages` and `csrfToken`; path and query parameters use `camelCase`. Exception: [lecturer attendance analytics](attendance-analytics.md) uses `camelCase` JSON to match its frontend contract.
- **Pagination**:
  - `page` defaults to `1` (integer `1`–`10000`).
  - `limit` defaults to `20` (integer `1`–`100`).
  - `total` is the authorised, filtered count before pagination; `totalPages = ceil(total / limit)` (`0` when `total` is `0`).
  - Requesting a `page` beyond `totalPages` returns `data: []` with the real `total` and `totalPages`.
- **Date range filters**:
  - Where `from` and `to` query parameters are supported, they are ISO 8601 timestamps with explicit timezones and filter on `class_sessions.starts_at` using `from <= starts_at < to`. Reject invalid timestamps or `from >= to` with `422 VALIDATION_ERROR`. Exception: [lecturer attendance analytics](attendance-analytics.md) takes inclusive `YYYY-MM-DD` Malaysia-time days ([ADR 0001](../adr/0001-analytics-days-use-malaysia-time.md)).
- **Security & privacy**:
  - Omit `password_hash`, `auth_sessions` payloads, refresh-token hashes, and raw student GPS coordinates (`latitude`, `longitude`, `accuracy_m`) from all responses and logs.
  - Never include SQL queries or stack traces in error responses.
  - Set `Cache-Control: no-store` on authenticated and CSRF responses.
  - While `users.must_change_password` is `true`, authentication endpoints remain available (including login and refresh); protected feature endpoints return `403 PASSWORD_CHANGE_REQUIRED`.

## Shared error envelope (all non-2xx responses)

Implemented feature controllers/guards return errors in the following envelope. The development-only `/examples/classrooms` routes and malformed JSON rejected before auth controller dispatch retain NestJS default errors; see [examples.md](examples.md#errors) and [authentication](auth.md#errors-and-rate-limiting).

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please correct the highlighted fields.",
    "fields": {
      "page": "Must be an integer between 1 and 10000."
    }
  }
}
```

- `code` is a stable uppercase string for frontend branching.
- `message` is a safe, human-readable summary.
- `fields` is always a JSON object mapping input field names to a single message string; use `{}` when the error is not tied to a specific input field.
- Never wrap `error` inside `data` or return HTTP `200` for failures.

### Standard HTTP status and error codes

| HTTP  | `error.code`               | When                                                                                |
| ----- | -------------------------- | ----------------------------------------------------------------------------------- |
| `400` | `BAD_REQUEST`              | Malformed JSON body or unreadable request syntax                                    |
| `401` | `UNAUTHENTICATED`          | Missing, expired, or invalidated authentication session                             |
| `401` | `INVALID_CREDENTIALS`      | Wrong email/password or inactive account on login                                   |
| `403` | `FORBIDDEN`                | Authenticated user's role cannot perform this operation                             |
| `403` | `ACCOUNT_INACTIVE`         | Inactive demo-session account; JWT mode rejects it as 401 UNAUTHENTICATED         |
| `403` | `PASSWORD_CHANGE_REQUIRED` | User has `must_change_password = true` and called a non-exempt endpoint             |
| `403` | `CSRF_INVALID`             | Missing or invalid `X-CSRF-Token` header on a mutation                              |
| `403` | `NOT_ELIGIBLE`             | Student is not in the class session's materialised attendance roster                |
| `404` | `RESOURCE_NOT_FOUND`       | Target resource does not exist or is outside the caller's authorised scope          |
| `409` | `EMAIL_ALREADY_EXISTS`     | Creating a user with an email that already exists in `users`                        |
| `409` | `ENROLMENT_ALREADY_EXISTS` | Student is already enrolled in the target class (`(class_id, student_id)`)          |
| `409` | `COURSE_CODE_TAKEN`        | Creating or renaming a course to a code that already exists                         |
| `409` | `CLASS_SECTION_TAKEN`      | Course/term/section combination already exists                                      |
| `409` | `CLASS_HAS_SESSIONS`       | Changing a class's course, term or section after class sessions exist               |
| `409` | `CLASS_NOT_STARTED`        | Check-in attempted before `class_sessions.starts_at`                                |
| `409` | `CLASS_ENDED`              | Check-in attempted at or after `class_sessions.ends_at`                             |
| `409` | `CLASS_CANCELLED`          | Check-in attempted on a class session with `state = 'cancelled'`                    |
| `422` | `VALIDATION_ERROR`         | Invalid path ID, query parameter, body field, unknown status, or invalid date range |
| `422` | `STUDENT_NOT_ELIGIBLE`     | Target user for enrolment is not an active `student`                                |
| `422` | `LECTURER_NOT_ELIGIBLE`    | Assigned user is missing, inactive or not a `lecturer`                              |
| `422` | `LOCATION_STALE`           | Geolocation `reading_timestamp` fails freshness/future-time policy                  |
| `422` | `LOCATION_INACCURATE`      | Geolocation `accuracy_m` exceeds the service accuracy threshold                     |
| `422` | `OUTSIDE_ALLOWED_AREA`     | Geolocation distance exceeds the class session's `radius_m` geofence                |
| `429` | `RATE_LIMITED`             | Request rate limit reached (include `Retry-After` response header)                  |
| `500` | `INTERNAL_ERROR`           | Unexpected server or database failure; generic message with no internal details     |

Example `404 Not Found`:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found.",
    "fields": {}
  }
}
```

## Updating this reference

When implementing or updating an endpoint:

1. Verify that its method, path, role guard, query/body validation, success DTO, and error codes match its feature document ([`auth.md`](auth.md), [`enrolments.md`](enrolments.md), [`courses-classes.md`](courses-classes.md), or [`attendance.md`](attendance.md)).
2. Coordinate any contract adjustments with the paired frontend issue/owner before merging.
3. Update the status banner in the feature document once the endpoint is merged and verified by automated tests.

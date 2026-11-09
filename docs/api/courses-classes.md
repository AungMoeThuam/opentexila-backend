# Courses & Class Management API

Admin APIs for creating and editing **courses** and **class offerings** (a section of a course in a term), assigning lecturers and setting each class's attendance location. Paired with frontend issue #16; backend issue #18.

All paths are relative to `/api/v1` and follow the [shared HTTP rules](README.md#shared-http-rules) and [error envelope](README.md#shared-error-envelope-all-non-2xx-responses).

## Endpoint summary

| Method  | Path                 | Allowed roles | Purpose                                                                |
| ------- | -------------------- | ------------- | ---------------------------------------------------------------------- |
| `GET`   | `/courses`           | `admin`       | Paginated course list; also the course selector                        |
| `POST`  | `/courses`           | `admin`       | Create a course                                                        |
| `PATCH` | `/courses/:courseId` | `admin`       | Edit a course's code and/or name                                       |
| `GET`   | `/lecturers`         | `admin`       | Paginated **active** lecturer options for selectors                    |
| `GET`   | `/classes`           | `admin`       | Class list — unchanged, see [enrolments.md](enrolments.md#get-classes) |
| `POST`  | `/classes`           | `admin`       | Create a class offering                                                |
| `GET`   | `/classes/:classId`  | `admin`       | Class detail including attendance location                             |
| `PATCH` | `/classes/:classId`  | `admin`       | Edit a class offering                                                  |

Deletion, bulk import and account management are out of scope. Students and lecturers receive `403 FORBIDDEN` on every endpoint here.

## Permissions and transport

- Every endpoint requires a signed-in, active `admin` without a pending password change.
- Mutations (`POST`, `PATCH`) require `X-CSRF-Token` in demo-session mode, like the other feature mutations.
- Responses set `Cache-Control: no-store`.
- Request bodies are JSON. Unknown properties are ignored. Send numbers as JSON numbers, not strings.

## Shared field rules

| Field         | Type    | Rule                                                                                                        |
| ------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `code`        | string  | Trimmed and upper-cased by the server, then 1–30 visible ASCII characters with no spaces (e.g. `COS30043`)  |
| `name`        | string  | Trimmed, 1–150 characters                                                                                   |
| `course_id`   | integer | Positive integer that matches an existing course                                                            |
| `term`        | string  | Trimmed, 1–50 characters (e.g. `2026-S2`); the duplicate check ignores letter case                          |
| `section`     | string  | Trimmed and upper-cased by the server, then 1–30 visible ASCII characters with no spaces (e.g. `A`, `LAB1`) |
| `lecturer_id` | integer | Positive integer that matches an **active** user whose role is `lecturer`                                   |
| `room_label`  | string  | Trimmed, 1–100 characters                                                                                   |
| `latitude`    | number  | Finite, `-90` to `90`; stored rounded to 6 decimal places                                                   |
| `longitude`   | number  | Finite, `-180` to `180`; stored rounded to 6 decimal places                                                 |
| `radius_m`    | number  | Finite, `1` to `1000` metres; stored rounded to 2 decimal places                                            |

The `radius_m` limit (`MAX_RADIUS_M = 1000`) is **provisional** and may be tuned once real venues are tested. It lives in one constant in `src/courses/class-management.rules.ts`.

In responses, `latitude`, `longitude` and `radius_m` are decimal **strings** (`"-37.822100"`, `"50.00"`), matching how other APIs return decimals (for example `distance_m`).

---

## `GET /courses`

Paginated course list ordered by `code ASC`, then `id ASC`.

Query parameters:

- `page` (optional, default `1`, integer `1`–`10000`)
- `limit` (optional, default `20`, integer `1`–`100`)
- `q` (optional, 1–100 characters after trimming): case-insensitive substring match against `code` or `name`

### `200 OK`

```json
{
  "data": [
    { "id": 1, "code": "COS30043", "name": "Interface Design and Development" }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### Errors

| HTTP  | `error.code`       | When                           |
| ----- | ------------------ | ------------------------------ |
| `401` | `UNAUTHENTICATED`  | Missing or expired session     |
| `403` | `FORBIDDEN`        | Caller is not an `admin`       |
| `422` | `VALIDATION_ERROR` | Invalid `page`, `limit` or `q` |

---

## `POST /courses`

### Request body

```json
{ "code": "cos30043", "name": "Interface Design and Development" }
```

Both fields are required.

### `201 Created`

```json
{
  "data": {
    "id": 9,
    "code": "COS30043",
    "name": "Interface Design and Development"
  }
}
```

### Errors

| HTTP  | `error.code`        | When                                                         |
| ----- | ------------------- | ------------------------------------------------------------ |
| `401` | `UNAUTHENTICATED`   | Missing or expired session                                   |
| `403` | `FORBIDDEN`         | Caller is not an `admin`                                     |
| `403` | `CSRF_INVALID`      | Missing or invalid CSRF token (demo-session mode)            |
| `409` | `COURSE_CODE_TAKEN` | Another course already uses this code. `fields.code` is set. |
| `422` | `VALIDATION_ERROR`  | Missing or invalid field; `fields` names each one            |

Example:

```json
{
  "error": {
    "code": "COURSE_CODE_TAKEN",
    "message": "A course with this code already exists.",
    "fields": { "code": "A course with this code already exists." }
  }
}
```

---

## `PATCH /courses/:courseId`

Partial update. Send any of `code` and `name`; at least one is required. Omitted fields keep their values. `null` is rejected.

Editing a course changes how every class of that course is displayed (including in attendance history), because classes read their code and name from the course. Enrolments, sessions and attendance records are not modified.

### `200 OK`

Same shape as `POST /courses`.

### Errors

| HTTP  | `error.code`         | When                                                         |
| ----- | -------------------- | ------------------------------------------------------------ |
| `401` | `UNAUTHENTICATED`    | Missing or expired session                                   |
| `403` | `FORBIDDEN`          | Caller is not an `admin`                                     |
| `403` | `CSRF_INVALID`       | Missing or invalid CSRF token (demo-session mode)            |
| `404` | `RESOURCE_NOT_FOUND` | No course with this ID                                       |
| `409` | `COURSE_CODE_TAKEN`  | Another course already uses this code. `fields.code` is set. |
| `422` | `VALIDATION_ERROR`   | Invalid `courseId`, empty body, or invalid field             |

---

## `GET /lecturers`

Selector options for assigning a lecturer. Returns only **active** users with role `lecturer`, ordered by `name ASC`, then `id ASC`. Only `id`, `name` and `email` are returned (email distinguishes lecturers who share a name).

Query parameters: `page`, `limit` (as above) and optional `q` (1–100 characters after trimming), a case-insensitive substring match against `name` or `email`.

### `200 OK`

```json
{
  "data": [
    { "id": 2, "name": "Lecturer One", "email": "lecturer.one@example.com" }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### Errors

Same as `GET /courses`.

---

## `POST /classes`

### Request body

All fields are required.

```json
{
  "course_id": 1,
  "term": "2026-S2",
  "section": "a",
  "lecturer_id": 2,
  "room_label": "EN402",
  "latitude": -37.8221,
  "longitude": 145.0389,
  "radius_m": 50
}
```

### `201 Created`

Returns the [class detail](#class-detail-shape).

### Errors

| HTTP  | `error.code`            | When                                                                                            |
| ----- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `401` | `UNAUTHENTICATED`       | Missing or expired session                                                                      |
| `403` | `FORBIDDEN`             | Caller is not an `admin`                                                                        |
| `403` | `CSRF_INVALID`          | Missing or invalid CSRF token (demo-session mode)                                               |
| `409` | `CLASS_SECTION_TAKEN`   | The course already has this section in this term. `fields.section` is set.                      |
| `422` | `VALIDATION_ERROR`      | Missing or invalid field, including a `course_id` that does not exist (`fields.course_id`)      |
| `422` | `LECTURER_NOT_ELIGIBLE` | `lecturer_id` does not exist, is inactive, or is not a `lecturer`. `fields.lecturer_id` is set. |

Example:

```json
{
  "error": {
    "code": "CLASS_SECTION_TAKEN",
    "message": "This course already has this section in this term.",
    "fields": {
      "section": "This course already has this section in this term."
    }
  }
}
```

---

## `GET /classes/:classId`

### `200 OK` — class detail shape

```json
{
  "data": {
    "id": 1,
    "course": {
      "id": 1,
      "code": "COS30043",
      "name": "Interface Design and Development"
    },
    "term": "2026-S2",
    "section": "A",
    "lecturer": { "id": 2, "name": "Lecturer One" },
    "room_label": "EN402",
    "latitude": "-37.822100",
    "longitude": "145.038900",
    "radius_m": "50.00",
    "has_class_sessions": true
  }
}
```

`has_class_sessions` is `true` when at least one class session (any state) exists for the class. While it is `true`, `course_id`, `term` and `section` cannot be changed (see below); the frontend can use it to disable those inputs.

### Errors

| HTTP  | `error.code`         | When                       |
| ----- | -------------------- | -------------------------- |
| `401` | `UNAUTHENTICATED`    | Missing or expired session |
| `403` | `FORBIDDEN`          | Caller is not an `admin`   |
| `404` | `RESOURCE_NOT_FOUND` | No class with this ID      |
| `422` | `VALIDATION_ERROR`   | Invalid `classId`          |

---

## `PATCH /classes/:classId`

Partial update. Send any of the class fields; at least one is required. Omitted fields keep their values. `null` is rejected.

### `200 OK`

Returns the updated [class detail](#class-detail-shape).

### Edit rules

| Field(s)                                          | Class has no sessions | Class has sessions (any state, including the active one)                                                                                                                                                                                     |
| ------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `course_id`, `term`, `section`                    | Editable              | **Rejected** with `409 CLASS_HAS_SESSIONS` if the value changes. Sending the current value is allowed.                                                                                                                                       |
| `room_label`, `latitude`, `longitude`, `radius_m` | Editable              | Editable. Applies to class sessions created **afterwards** only. Existing sessions — including one in progress — keep the venue copied when they were created, so check-ins are always validated against the venue students were told about. |
| `lecturer_id`                                     | Editable              | Editable. Takes effect immediately: the new lecturer can see the class's sessions and rosters, and the previous lecturer loses access. Attendance records are unaffected.                                                                    |

`course_id`, `term` and `section` identify the offering that enrolments, sessions and attendance history belong to. Changing them after sessions exist would silently relabel that history, so a mistake found later is fixed by creating a new class.

### Concurrency

The update runs in a transaction that first locks the class row (`SELECT … FOR UPDATE`). Check-ins lock the same row first, so an update and a check-in for the same class run one after the other, never interleaved. The lecturer row is read with a shared lock so it cannot be deactivated or change role mid-update. Duplicate-section races between two admins are caught by the database's unique key and reported as `409 CLASS_SECTION_TAKEN`.

Enrolments and attendance records are never modified by these endpoints.

### Errors

| HTTP  | `error.code`            | When                                                                                                |
| ----- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| `401` | `UNAUTHENTICATED`       | Missing or expired session                                                                          |
| `403` | `FORBIDDEN`             | Caller is not an `admin`                                                                            |
| `403` | `CSRF_INVALID`          | Missing or invalid CSRF token (demo-session mode)                                                   |
| `404` | `RESOURCE_NOT_FOUND`    | No class with this ID                                                                               |
| `409` | `CLASS_HAS_SESSIONS`    | Changing `course_id`, `term` or `section` after sessions exist. `fields` names each rejected field. |
| `409` | `CLASS_SECTION_TAKEN`   | The new course/term/section combination already exists                                              |
| `422` | `VALIDATION_ERROR`      | Invalid `classId`, empty body, invalid field, or unknown `course_id`                                |
| `422` | `LECTURER_NOT_ELIGIBLE` | New `lecturer_id` is missing, inactive or not a `lecturer`                                          |

Example:

```json
{
  "error": {
    "code": "CLASS_HAS_SESSIONS",
    "message": "Course, term and section cannot change after class sessions exist.",
    "fields": { "term": "Cannot change after class sessions exist." }
  }
}
```

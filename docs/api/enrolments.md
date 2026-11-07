# Classes & Enrolments API

[API overview](README.md) · [Authentication](auth.md) · [Attendance](attendance.md) · [Database design](../database-design.md)

**Status: `GET /me/classes` implemented for students and lecturers; other endpoints below remain planned. Database schema (`courses`, `classes`, `enrolments`) implemented.** All paths below are relative to `/api/v1`. Follow the [shared HTTP, pagination, CSRF and error envelope rules](README.md#shared-http-rules).

## Domain overview

- **`courses`** stores shared course identity (`id`, `code`, `name`).
- **`classes`** stores one offering of a course in a term and section (`id`, `course_id`, `lecturer_id`, `section`, `term`, `room_label`, `latitude`, `longitude`, `radius_m`), unique on `(course_id, term, section)`.
- **`enrolments`** stores current student membership in a class using composite primary key `(class_id, student_id)`.
- Removing an enrolment deletes the `(class_id, student_id)` row from `enrolments` without deleting any materialised `attendance_records` on past or started `class_sessions` (`attendance_records` references `class_sessions` and `users`, not `enrolments`).

## Endpoint summary

| Method | Path | Access | Related issues | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/classes` | `admin` | Backend `#7` / Frontend `#4` | List classes so an admin can select a class to manage enrolments |
| `GET` | `/me/classes` | `student`, `lecturer` | Backend `#8` / Frontend `#5` | List the signed-in student's enrolled classes or lecturer's assigned classes |
| `GET` | `/classes/:classId/enrolments` | `admin`, assigned `lecturer` | Backend `#7`, `#9` / Frontend `#4`, `#6` | Read the student roster of a class alongside class context |
| `POST` | `/classes/:classId/enrolments` | `admin` | Backend `#7` / Frontend `#4` | Add an active student to a class |
| `DELETE` | `/classes/:classId/enrolments/:studentId` | `admin` | Backend `#7` / Frontend `#4` | Remove a student from a class (`204 No Content`) |

---

## Endpoint specifications

### `GET /classes`

Returns a paginated list of class offerings ordered by `classes.id ASC`.

- **Access**: `admin` only in this workflow.
- **Query parameters**:
  - `page` (optional, default `1`, integer `1`–`10000`)
  - `limit` (optional, default `20`, integer `1`–`100`)
  - `courseId` (optional, positive integer matching `courses.id`)
  - `term` (optional, exact non-empty string of at most 50 characters such as `"2026-S2"`)

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
        "name": "Lecturer Demo"
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

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller is not an `admin` |
| `422` | `VALIDATION_ERROR` | Invalid `page`, `limit`, `courseId`, or `term` |

---

### `GET /me/classes`

Returns the classes belonging to the signed-in user, ordered by `classes.id ASC`:
- For `student`: classes where the student has a row in `enrolments` (`(class_id, student_id)`).
- For `lecturer`: classes assigned to the lecturer (`classes.lecturer_id = user.id`).

Identity always comes from the verified JWT or development session. Unknown query fields, including `studentId` and `userId`, are stripped and cannot override identity. Responses use `Cache-Control: no-store`.

- **Access**: `student` or `lecturer` (`admin` receives `403 FORBIDDEN` and uses `GET /classes` instead).
- **Query parameters**:
  - `page` (optional, default `1`, integer `1`–`10000`)
  - `limit` (optional, default `20`, integer `1`–`100`)
  - `courseId` (optional, positive integer matching `courses.id`)
  - `term` (optional, exact non-empty string of at most 50 characters such as `"2026-S2"`)

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
        "name": "Lecturer Demo"
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

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller role is `admin` |
| `422` | `VALIDATION_ERROR` | Invalid `page`, `limit`, `courseId`, or `term` |

---

### `GET /classes/:classId/enrolments`

Returns the paginated student roster for a class ordered by `student_id ASC`, together with `context.class`. Shared handler for both admin enrolment management (Issue `#7`) and lecturer class roster viewing (Issue `#9`).

- **Access**: `admin`, or `lecturer` where `classes.lecturer_id = user.id`.
- **Path parameters**: `classId` — positive integer `classes.id`.
- **Query parameters**:
  - `page` (optional, default `1`, integer `1`–`10000`)
  - `limit` (optional, default `20`, integer `1`–`100`)

#### Success response — `200 OK`

```json
{
  "data": [
    {
      "class_id": 1,
      "student_id": 3,
      "student": {
        "id": 3,
        "name": "Student One",
        "email": "student.one@example.com"
      }
    }
  ],
  "context": {
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
    }
  },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

An empty roster still returns `context.class` with `data: []`, `total: 0`, `totalPages: 0`.

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller is a `student` |
| `404` | `RESOURCE_NOT_FOUND` | Class `:classId` does not exist, or caller is a `lecturer` not assigned to this class |
| `422` | `VALIDATION_ERROR` | Invalid `classId`, `page`, or `limit` |

---

### `POST /classes/:classId/enrolments`

Enrols an existing active student into the specified class by inserting `(class_id, student_id)` into `enrolments`.

- **Access**: `admin` only.
- **Path parameters**: `classId` — positive integer `classes.id`.
- **Headers**: `Content-Type: application/json`, `X-CSRF-Token: <csrfToken>`.

#### Request body

```json
{
  "student_id": 3
}
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `student_id` | `integer` | Yes | Positive integer referencing an existing `users.id` with `role = 'student'` and `status = 'active'` |

#### Success response — `201 Created`

```json
{
  "data": {
    "class_id": 1,
    "student_id": 3,
    "student": {
      "id": 3,
      "name": "Student One",
      "email": "student.one@example.com"
    }
  }
}
```

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller is not an `admin` |
| `403` | `CSRF_INVALID` | Missing or invalid `X-CSRF-Token` |
| `404` | `RESOURCE_NOT_FOUND` | Class `:classId` or user `student_id` does not exist |
| `409` | `ENROLMENT_ALREADY_EXISTS` | `(class_id, student_id)` already exists in `enrolments` |
| `422` | `STUDENT_NOT_ELIGIBLE` | Target user is not a `student` or has `status = 'inactive'` (`fields.student_id` explains why) |
| `422` | `VALIDATION_ERROR` | Invalid `classId` or non-integer `student_id` |

Example `409 Conflict`:

```json
{
  "error": {
    "code": "ENROLMENT_ALREADY_EXISTS",
    "message": "This student is already enrolled in the selected class.",
    "fields": {}
  }
}
```

Example `422 Unprocessable Entity` (`STUDENT_NOT_ELIGIBLE`):

```json
{
  "error": {
    "code": "STUDENT_NOT_ELIGIBLE",
    "message": "The selected user cannot be enrolled as a student.",
    "fields": {
      "student_id": "Selected account must be an active student."
    }
  }
}
```

---

### `DELETE /classes/:classId/enrolments/:studentId`

Removes the `(class_id, student_id)` membership row from `enrolments`. Existing `attendance_records` on past or started `class_sessions` are preserved untouched.

- **Access**: `admin` only.
- **Path parameters**:
  - `classId` — positive integer `classes.id`.
  - `studentId` — positive integer `users.id`.
- **Headers**: `X-CSRF-Token: <csrfToken>`.
- **Request body**: None.

#### Success response — `204 No Content`

Empty response body.

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller is not an `admin` |
| `403` | `CSRF_INVALID` | Missing or invalid `X-CSRF-Token` |
| `404` | `RESOURCE_NOT_FOUND` | Class `:classId` does not exist or `(class_id, student_id)` is not enrolled |
| `422` | `VALIDATION_ERROR` | Invalid `classId` or `studentId` |

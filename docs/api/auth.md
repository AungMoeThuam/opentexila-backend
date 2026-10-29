# Authentication & Account Onboarding API

[API overview](README.md) · [Classes & Enrolments](enrolments.md) · [Attendance](attendance.md) · [Database design](../database-design.md)

**Status: planned contract; database schema (`users`, `auth_sessions`) implemented.** All paths below are relative to `/api/v1`. Follow the [shared HTTP, CSRF and error envelope rules](README.md#shared-http-rules).

## Account and session lifecycle

1. **Initial setup**: An administrator account is provisioned during setup or demo seeding (`users.role = 'admin'`).
2. **Admin account provisioning (`POST /admin/users`)**: An administrator creates a student or lecturer (`teacher`) account, assigns the role, and sets an initial temporary password. The backend stores only an Argon2id hash in `users.password_hash` and sets `users.must_change_password = true`. There is no email invitation or token activation table.
3. **Login (`POST /auth/login`)**: The user signs in with email and password, receives an `HttpOnly` session cookie backed by `auth_sessions`, and receives their safe profile payload.
4. **Mandatory password change (`POST /auth/change-password`)**: While `must_change_password` is `true`, the user must change their password before accessing enrolment or attendance endpoints. Changing the password sets `must_change_password = false` and increments `users.session_version`.
5. **Session restoration & logout (`GET /auth/me`, `POST /auth/logout`)**: The frontend restores the current identity on page load via `GET /auth/me` and destroys the session on `POST /auth/logout`.

## Endpoint summary

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/auth/csrf` | Guest or signed-in | Initialise/retrieve a session-bound CSRF token |
| `POST` | `/auth/login` | Guest | Authenticate an active user and establish a server session |
| `POST` | `/auth/logout` | Signed-in user | Destroy the current server session and clear the session cookie |
| `GET` | `/auth/me` | Signed-in user | Return the current user's safe profile and role |
| `POST` | `/auth/change-password` | Signed-in user | Change own password, clear `must_change_password`, bump `session_version` |
| `POST` | `/admin/users` | `admin` | Create a `student` or `teacher` account with a temporary password |
| `POST` | `/admin/users/:id/reset-password` | `admin` | Set a new temporary password, set `must_change_password = true`, bump `session_version` |

---

## Endpoint specifications

### `GET /auth/csrf`

Initialises an anonymous or authenticated cookie session if one does not exist and returns the CSRF token required in the `X-CSRF-Token` header for all mutations (`POST`, `PATCH`, `DELETE`).

- **Access**: Guest or any signed-in user (allowed even when `must_change_password = true`).
- **Query / body**: None.

#### Success response — `200 OK`

```json
{
  "data": {
    "csrfToken": "b7f5c2e9d8a14f3b9c0e1a2d3f4b5c6d"
  }
}
```

---

### `POST /auth/login`

Authenticates an active user with email and password, regenerates the server session ID to prevent session fixation, sets the `HttpOnly` session cookie, and returns the user's safe profile.

- **Access**: Guest (requires `X-CSRF-Token` from `GET /auth/csrf`).
- **Headers**: `Content-Type: application/json`, `X-CSRF-Token: <csrfToken>`.

#### Request body

```json
{
  "email": "student.one@example.com",
  "password": "DemoPassword123!"
}
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `email` | `string` | Yes | Trimmed, valid email format, max 255 chars (matched case-insensitively) |
| `password` | `string` | Yes | Non-empty string, max 255 chars |

#### Success response — `200 OK`

```json
{
  "data": {
    "id": 3,
    "name": "Student One",
    "email": "student.one@example.com",
    "role": "student",
    "status": "active",
    "must_change_password": false
  }
}
```

If the user signed in with an admin-issued temporary password, `must_change_password` is `true` and the frontend redirects them to `/change-password`.

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `400` | `BAD_REQUEST` | Malformed JSON body |
| `401` | `INVALID_CREDENTIALS` | Unknown email, wrong password, or `status = 'inactive'` (generic message to prevent account enumeration) |
| `403` | `CSRF_INVALID` | Missing or invalid `X-CSRF-Token` |
| `422` | `VALIDATION_ERROR` | Missing/invalid `email` or empty `password` |
| `429` | `RATE_LIMITED` | Too many login attempts |

Example `401 Unauthorized`:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password.",
    "fields": {}
  }
}
```

---

### `POST /auth/logout`

Invalidates and deletes the caller's current row in `auth_sessions` and clears the session cookie.

- **Access**: Any signed-in user (allowed even when `must_change_password = true`).
- **Headers**: `X-CSRF-Token: <csrfToken>`.
- **Request body**: None.

#### Success response — `204 No Content`

Empty body.

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | No active session cookie |
| `403` | `CSRF_INVALID` | Missing or invalid `X-CSRF-Token` |

---

### `GET /auth/me`

Returns the safe profile of the currently authenticated user. Validates that the user's `status` is `'active'` and that the session's `session_version` matches `users.session_version`.

- **Access**: Any signed-in user (allowed even when `must_change_password = true`).
- **Query / body**: None.

#### Success response — `200 OK`

```json
{
  "data": {
    "id": 3,
    "name": "Student One",
    "email": "student.one@example.com",
    "role": "student",
    "status": "active",
    "must_change_password": false
  }
}
```

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing, expired, or invalidated session (including mismatched `session_version`) |
| `403` | `ACCOUNT_INACTIVE` | Account `status` is `inactive` |

---

### `POST /auth/change-password`

Changes the signed-in user's own password, clears `must_change_password` to `false`, increments `users.session_version` to invalidate other sessions, and rotates/updates the current session so the user stays signed in.

- **Access**: Any signed-in user (allowed when `must_change_password = true`).
- **Headers**: `Content-Type: application/json`, `X-CSRF-Token: <csrfToken>`.

#### Request body

```json
{
  "current_password": "TempPassword123!",
  "new_password": "NewSecurePassword456!"
}
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `current_password` | `string` | Yes | Must match current `users.password_hash` |
| `new_password` | `string` | Yes | Min 8 chars, max 255 chars, must differ from `current_password` |

#### Success response — `200 OK`

```json
{
  "data": {
    "id": 3,
    "name": "Student One",
    "email": "student.one@example.com",
    "role": "student",
    "status": "active",
    "must_change_password": false
  }
}
```

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `CSRF_INVALID` | Missing or invalid `X-CSRF-Token` |
| `422` | `VALIDATION_ERROR` | `current_password` is incorrect, or `new_password` fails password policy / matches `current_password` |

Example `422 Unprocessable Entity`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please correct the highlighted fields.",
    "fields": {
      "current_password": "Current password is incorrect.",
      "new_password": "New password must be at least 8 characters long."
    }
  }
}
```

---

### `POST /admin/users`

Creates a new `student` or `teacher` (Lecturer) account with an administrator-assigned temporary password. Sets `status = 'active'` and `must_change_password = true`.

- **Access**: `admin` only (requires `must_change_password = false`).
- **Headers**: `Content-Type: application/json`, `X-CSRF-Token: <csrfToken>`.

#### Request body

```json
{
  "name": "Student Twenty-Three",
  "email": "student23@example.com",
  "role": "student",
  "temporary_password": "TempPassword123!"
}
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `name` | `string` | Yes | Non-empty trimmed string, max 200 chars |
| `email` | `string` | Yes | Valid email address, max 255 chars, unique in `users` |
| `role` | `string` | Yes | `'student'` or `'teacher'` |
| `temporary_password` | `string` | Yes | Min 8 chars, max 255 chars; hashed with Argon2id, never returned or logged |

#### Success response — `201 Created`

```json
{
  "data": {
    "id": 27,
    "name": "Student Twenty-Three",
    "email": "student23@example.com",
    "role": "student",
    "status": "active",
    "must_change_password": true
  }
}
```

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller is not an `admin` |
| `403` | `CSRF_INVALID` | Missing or invalid `X-CSRF-Token` |
| `409` | `EMAIL_ALREADY_EXISTS` | `email` is already registered in `users` |
| `422` | `VALIDATION_ERROR` | Invalid `name`, `email`, `role`, or `temporary_password` |

Example `409 Conflict`:

```json
{
  "error": {
    "code": "EMAIL_ALREADY_EXISTS",
    "message": "An account with this email address already exists.",
    "fields": {
      "email": "This email address is already in use."
    }
  }
}
```

---

### `POST /admin/users/:id/reset-password`

Sets a new temporary password for an existing user account, sets `must_change_password = true`, and increments `users.session_version` to immediately invalidate all existing sessions for that user.

- **Access**: `admin` only.
- **Path parameters**: `id` — positive integer `users.id`.
- **Headers**: `Content-Type: application/json`, `X-CSRF-Token: <csrfToken>`.

#### Request body

```json
{
  "temporary_password": "ResetTempPassword123!"
}
```

#### Success response — `200 OK`

```json
{
  "data": {
    "id": 3,
    "name": "Student One",
    "email": "student.one@example.com",
    "role": "student",
    "status": "active",
    "must_change_password": true
  }
}
```

#### Error responses

| HTTP | `error.code` | When |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | Missing or expired session |
| `403` | `FORBIDDEN` | Caller is not an `admin` |
| `403` | `CSRF_INVALID` | Missing or invalid `X-CSRF-Token` |
| `404` | `RESOURCE_NOT_FOUND` | User `:id` does not exist |
| `422` | `VALIDATION_ERROR` | Invalid `:id` or `temporary_password` fails policy |

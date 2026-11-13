# Authentication & Account Onboarding API

[API overview](README.md) · [Attendance](attendance.md) · [JWT setup and guards](../JWT_AUTH.md)

**Status: JWT login, refresh, current profile, logout, password change, and admin account creation, password reset and user listing are implemented.** Paths are relative to `/api/v1`.

Enable `JWT_AUTH_ENABLED=true`, set a random `JWT_SECRET`, and keep `DEV_AUTH_ENABLED=false`. These flags select the auth adapter, not global route protection. Unrelated feature endpoints remain public until a guard is explicitly applied. Existing attendance routes are guarded. The [demo adapter](../DEVELOPMENT_AUTH.md) remains available as a separate development mode; it does not use the JWT contract below. The frontend JWT adapter is separate work.

## Endpoint summary

| Method | Path | Credential / CSRF | Success |
| --- | --- | --- | --- |
| GET | `/auth/csrf` | No identity required | 200, signed CSRF token and HttpOnly cookie |
| POST | `/auth/login` | CSRF cookie + `X-CSRF-Token` | 200, access JWT, profile, CSRF token; refresh cookie |
| POST | `/auth/refresh` | Refresh cookie + CSRF | 200, rotated tokens and current profile |
| GET | `/auth/me` | Bearer access JWT | 200, current safe profile |
| POST | `/auth/logout` | CSRF; refresh cookie if present | 204, session revoked and cookies cleared |
| POST | `/auth/change-password` | Bearer access JWT | 204, password changed and all logins revoked |
| GET | `/admin/users` | Admin | 200, one page of users with `meta` |
| POST | `/admin/users` | Admin | 201, new student or lecturer account |
| POST | `/admin/users/:userId/reset-password` | Admin | 204, temporary password set and all logins revoked |

## Token lifecycle

Access JWTs expire after 15 minutes. Send `Authorization: Bearer <accessToken>` for profile, password changes and protected feature endpoints. Keep access tokens in memory. Cookie credentials alone do not authenticate those endpoints.

Refresh tokens are separately signed JWTs with a distinct audience and a random nonce. They are sent only through an HttpOnly cookie, and only their SHA-256 hashes are persisted in `auth_refresh_sessions`. Rotation replaces the stored hash; a previously issued signed token used again revokes that session, including its latest access/refresh tokens. A forged or wrong-purpose token is rejected before it can revoke a session. Serialize refresh calls, including across browser tabs; do not automatically replay a refresh after an ambiguous network failure.

A refresh session expires seven days after login; rotation does not extend it. Access checks read current user/session state, so logout, account deactivation, session expiry or a changed `session_version` take effect without waiting for JWT expiry. Password changes revoke every session. Expired/revoked session rows are retained; automatic database cleanup is not implemented.

CSRF tokens are signed, expire after one hour and are bound to the current refresh cookie (or an anonymous state before login). Send the cookie and matching `X-CSRF-Token` for login, refresh and logout. Replace your in-memory CSRF token after login/refresh. Re-bootstrap with `/auth/csrf` when needed. Bearer-only operations do not require CSRF.

Cookies are HttpOnly, SameSite=Strict, Path=/ with no Domain. Production uses Secure cookies named `__Host-ot_refresh` and `__Host-ot_csrf`; development names are `ot_refresh` and `ot_csrf`. Production therefore requires HTTPS. CORS is not enabled; the current browser setup uses the same-origin Vite proxy.

### `GET /auth/csrf`

No request body. Sets a signed CSRF cookie and returns:

```json
{ "data": { "csrfToken": "<signed-csrf-token>" } }
```

This endpoint does not sign in a user or create a database session.

### `POST /auth/login`

Headers: `Content-Type: application/json`, `X-CSRF-Token: <csrfToken>`, plus the CSRF cookie.

```json
{ "email": "student.one@example.com", "password": "<password>" }
```

Email must be valid and at most 254 characters; password must be a string of 1–1024 characters. Unknown fields are stripped. Email lookup is case-insensitive; passwords are never trimmed. Invalid credentials and inactive accounts receive the same `401 INVALID_CREDENTIALS` response.

Success sets refresh and replacement CSRF cookies:

```json
{
  "data": {
    "accessToken": "<access-jwt>",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "user": {
      "id": 3,
      "name": "Student One",
      "email": "student.one@example.com",
      "role": "student",
      "must_change_password": false
    },
    "csrfToken": "<replacement-csrf-token>"
  }
}
```

`must_change_password: true` still permits login, profile, refresh and password change. The feature JWT guard blocks other protected operations until the password is changed. There is no public registration endpoint; demo accounts come from the development seed.

### `POST /auth/refresh`

No body. Send the current refresh cookie, CSRF cookie and `X-CSRF-Token`. Returns the same shape as login and replaces both cookies. Missing, expired, revoked or replayed refresh credentials return `401 UNAUTHENTICATED`; replay revocation is committed before the error is returned. Database-backed sessions survive backend restarts when the database and signing secret are retained.

### `GET /auth/me`

Requires a Bearer access JWT. Returns `{ "data": { ...profile } }` using exactly the safe profile fields in the login example. A cookie alone, a refresh/CSRF token used as a Bearer token, or an invalid/revoked access token returns `401 UNAUTHENTICATED`.

### `POST /auth/logout`

No body. Requires valid CSRF. With a valid signed refresh cookie, revokes that session and clears both cookies (204). A valid stale refresh credential can revoke its session too. With no refresh cookie, clears cookies without creating a session. Malformed, forged or expired refresh credentials return 401. Other sessions remain active.

### `POST /auth/change-password`

Headers: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`.

```json
{ "currentPassword": "<current-password>", "newPassword": "<new-password>" }
```

The current password must be 1–1024 characters and match the stored Argon2 hash. The new password must be 12–1024 characters and differ from the current password. Success stores an Argon2id hash, clears `must_change_password`, increments `session_version`, revokes all refresh sessions, clears cookies and returns 204. Discard the old access token and sign in again.

## Errors and rate limiting

Controller/guard errors use the shared envelope:

```json
{ "error": { "code": "UNAUTHENTICATED", "message": "A valid sign-in is required.", "fields": {} } }
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `INVALID_CREDENTIALS` | Incorrect login/current password or inactive login account |
| 401 | `UNAUTHENTICATED` | Missing, invalid, expired or revoked credential |
| 403 | `CSRF_INVALID` | Missing, forged, expired or mismatched CSRF credential |
| 403 | `PASSWORD_CHANGE_REQUIRED` | Feature guard requires a password change |
| 403 | `FORBIDDEN` | Role guard denies a feature operation |
| 422 | `VALIDATION_ERROR` | Invalid DTO fields or unchanged new password |
| 429 | `RATE_LIMITED` | Auth operation limit reached; includes `Retry-After` seconds |
| 500 | `INTERNAL_ERROR` | Authentication services unavailable; internal details are not exposed |

Login is limited to 10 attempts/minute per IP and normalized email; password changes to 10/minute per IP; other auth operations to 60/minute per IP per operation. The bounded limiter is per-process, resets on restart and ignores forwarded IP headers. Multi-instance deployments need a shared limiter. Malformed JSON rejected before controller dispatch uses Nest's parser error response. Successful auth responses and handled controller/guard errors are not cacheable.

## Admin account administration

There is no public registration. Only an admin creates accounts, and the user must change the temporary password at first sign-in. Both endpoints use the same guard as the other admin features (`AttendanceGuard` with `@Roles('admin')`), so they also apply the JWT/demo-session checks, CSRF in demo mode, and `PASSWORD_CHANGE_REQUIRED`. **Known issue:** in JWT mode these admin routes currently return `503 AUTH_UNAVAILABLE`, because their module does not import `AuthModule` (so `AttendanceGuard` has no `JwtAuthGuard`). They work in demo (`DEV_AUTH_ENABLED=true`) mode only until that is fixed. Responses use `Cache-Control: no-store`. Passwords are never returned, logged or trimmed.

### `GET /admin/users`

Lists accounts so an admin can find a user, for example before a password reset.

| Query | Rule | Default |
| --- | --- | --- |
| `search` | 1–100 characters after trimming. Case-insensitive substring of `name` or `email`. `%` and `_` match literally. | none |
| `role` | `student`, `lecturer` or `admin` | all roles |
| `page` | Integer, 1–10000 | `1` |
| `limit` | Integer, 1–100 | `20` |

Results are sorted by `name` A to Z, then `id`, so pages stay stable.

Success: **200 OK**

```json
{
  "data": [
    {
      "id": 12,
      "name": "Student Two",
      "email": "student.two@example.com",
      "role": "student",
      "must_change_password": true,
      "is_active": true
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

No match returns `"data": []` with `"total": 0`. Password hashes and session data are never returned. Errors are 401, 403 (`FORBIDDEN` or `PASSWORD_CHANGE_REQUIRED`) and 422 `VALIDATION_ERROR` for a bad query value.

### `POST /admin/users`

```json
{
  "name": "Student Two",
  "email": "student.two@example.com",
  "role": "student",
  "temporary_password": "<temporary-password>"
}
```

| Field | Rule |
| --- | --- |
| `name` | 1–100 characters after trimming |
| `email` | Valid email, at most 254 characters. Trimmed and stored in lower case. Must be unique in any letter case. |
| `role` | `student` or `lecturer`. `admin` is rejected. |
| `temporary_password` | String of 12–1024 characters. Stored as an Argon2id hash. |

Unknown fields are stripped, so `status`, `must_change_password` and similar fields cannot be set by the caller. The account is created `active` with `must_change_password: true`.

Success: **201 Created**

```json
{
  "data": {
    "id": 12,
    "name": "Student Two",
    "email": "student.two@example.com",
    "role": "student",
    "must_change_password": true,
    "is_active": true
  }
}
```

### `POST /admin/users/:userId/reset-password`

```json
{ "temporary_password": "<temporary-password>" }
```

`userId` is an integer from 1 to 4294967295. The temporary password follows the same rule as above. In one transaction the server stores the new Argon2id hash, sets `must_change_password` to `true`, adds 1 to `session_version` and revokes every open refresh session of that user. The user row is locked before the sessions, as in the other auth changes.

Success: **204 No Content** with no body. Passwords of `admin` accounts cannot be reset here.

### Errors

| HTTP | Code | When |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | No valid access token or session |
| 403 | `FORBIDDEN` | The caller is not an admin, or the target of a reset is an admin account |
| 403 | `PASSWORD_CHANGE_REQUIRED` | The calling admin must change their own password first |
| 403 | `CSRF_INVALID` | Demo-session mode only: missing or wrong CSRF token |
| 404 | `RESOURCE_NOT_FOUND` | Reset: no user with this `userId` |
| 409 | `EMAIL_ALREADY_EXISTS` | Create: the email is in use. `fields.email` has the message. |
| 422 | `VALIDATION_ERROR` | A field or `userId` is not valid. `fields` names each one. |

Editing, deactivating and deleting users, and email invitations are not part of this API.

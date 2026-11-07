# Authentication & Account Onboarding API

[API overview](README.md) · [Attendance](attendance.md) · [JWT setup and guards](../JWT_AUTH.md)

**Status: JWT login, refresh, current profile, logout and password change are implemented. Admin account provisioning/reset remain planned.** Paths are relative to `/api/v1`.

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

## Planned account administration (not implemented)

The following routes are design targets only and currently have no backend handlers.

### `POST /admin/users`

An admin would create a student or lecturer account using `name`, `email`, `role` and `temporary_password`. The password would be hashed with Argon2id, and `must_change_password` set to true. No invitation/activation flow or public self-registration is planned here.

### `POST /admin/users/:id/reset-password`

An admin would set a temporary password, require a subsequent password change, increment `session_version` and revoke all refresh sessions. Implement role checks and validation with the endpoint before exposing it.

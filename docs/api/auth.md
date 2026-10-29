# Authentication API

[API overview](README.md) · [Attendance](attendance.md)

**Status: planned; no endpoints implemented.** Paths below are relative to `/api/v1`.

## Account flow

1. An initial administrator is created during institution setup.
2. An administrator creates a student or lecturer account, assigns the role and sets a temporary password. There is no invitation or activation step.
3. The user logs in with the temporary password and receives a server-side session cookie. While `must_change_password` is true, the only allowed actions are changing the password and logging out.
4. The frontend restores identity through `/auth/me` and ends the session through `/auth/logout`.

There is no public signup or role selection. Creating an account does not automatically grant class enrolment.

## Planned endpoints

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/auth/csrf` | Guest or signed-in user | Initialise/retrieve a session-bound CSRF token. |
| POST | `/auth/login` | Guest | Authenticate an active account and regenerate its session. |
| POST | `/auth/logout` | Signed-in user | Invalidate the server session. |
| GET | `/auth/me` | Signed-in user | Return the current user's safe profile and role fields. |
| POST | `/auth/change-password` | Signed-in user | Change own password; clears `must_change_password` and bumps `session_version`. |
| POST | `/admin/users` | Admin | Create a student/lecturer account with a temporary password. |
| POST | `/admin/users/:id/reset-password` | Admin | Set a new temporary password, set `must_change_password` and bump `session_version`. |

Mutations require CSRF protection according to the [shared conventions](README.md). User listing, profile editing and general account administration are deferred to the users feature.

## Proposed request examples

Login — `POST /auth/login`:

```json
{
  "email": "student@example.com",
  "password": "example-only-password"
}
```

Change password — `POST /auth/change-password`:

```json
{
  "current_password": "example-temporary-password",
  "new_password": "example-only-password"
}
```

Successful login must establish the session cookie and return the safe profile envelope below. Neither login nor password changes should expose password hashes or internal session identifiers in JSON.

## Frontend integration contract

The shared frontend client and session state now expect this contract. These endpoints are **not implemented in the backend yet**; the frontend can use explicit development-only mock identities while they are built.

| Endpoint | Response / behaviour |
| --- | --- |
| `GET /auth/csrf` | `200` with `{ "data": { "csrfToken": "opaque-token" } }`; initialise the cookie session if needed, including for guests |
| `GET /auth/me` | `200` with the safe profile below; `401` when no valid active session exists |
| `POST /auth/login` | `200` with the safe profile below; regenerate the session and set its HttpOnly cookie |
| `POST /auth/logout` | `204 No Content`; destroy the server session and clear its cookie |

Safe profile example (fictional):

```json
{
  "data": {
    "id": 1,
    "name": "Student Demo",
    "email": "student@example.test",
    "role": "student",
    "status": "active",
    "must_change_password": false
  }
}
```

- CSRF header: `X-CSRF-Token`, required for mutations including login.
- Invalid CSRF: `403` with `{ "error": { "code": "CSRF_INVALID", "message": "Your session token expired. Please retry.", "fields": {} } }`.
- Validation: use the shared error envelope with a field-name-to-message map in `fields` (for example `{ "email": "Enter a valid email address." }`). The frontend also understands Nest's default error envelope while features are being developed.
- The frontend sends cookies with `credentials: 'include'`, resets its cached CSRF token after successful login/logout, clears identity on 401, and does not log users out on 403 or server/network failure. It never automatically replays a mutation.
- Session/CSRF responses should not be cached. Coordinate cookie and CORS configuration with hosting. UI route guards and hidden menu entries do not replace server authorization.
- Mock frontend roles never authenticate to this API. The mock mode blocks calls through the shared API client, and is excluded from production builds.

Coordinate changes to this contract with the frontend's `docs/FRONTEND_FOUNDATION.md` and session adapter before merging.

## Validation and security rules

- Only active accounts can log in.
- Admin-set passwords are temporary: store only an Argon2id hash, set `must_change_password`, and never return or log the password.
- Password reset, password change and deactivation bump `session_version`, which invalidates existing sessions.
- Account creation cannot change an existing user's identity or role.
- Regenerate the session at login; invalidate it at logout.
- Apply rate limits and generic login failure messages.

## Contract details to finalise

- Password policy and how the temporary password is delivered to the user.
- Request fields for account creation and validation messages.
- Cookie configuration and session lifetime.
- Success bodies and remaining endpoint-specific error codes/statuses.

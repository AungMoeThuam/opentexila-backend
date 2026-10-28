# Authentication API

[API overview](README.md) · [Attendance](attendance.md)

**Status: planned; no endpoints implemented.** Paths below are relative to `/api/v1`.

## Account flow

1. An initial administrator is created during institution setup.
2. An administrator invites a student or lecturer and assigns the account role.
3. The invited user activates the account using an expiring, single-use token and sets a password.
4. The active user logs in and receives a server-side session cookie.
5. The frontend restores identity through `/auth/me` and ends the session through `/auth/logout`.

There is no public signup or role selection during activation. Invitation does not automatically grant class enrolment.

## Planned endpoints

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/auth/csrf` | Guest or signed-in user | Initialise/retrieve a session-bound CSRF token. |
| POST | `/auth/activate` | Valid invitation token | Set a password and activate the invited account. |
| POST | `/auth/login` | Guest | Authenticate an active account and regenerate its session. |
| POST | `/auth/logout` | Signed-in user | Invalidate the server session. |
| GET | `/auth/me` | Signed-in user | Return the current user's safe profile and role fields. |
| POST | `/admin/invitations` | Admin | Provision an invited student/lecturer account. |
| POST | `/admin/users/:id/invitations` | Admin | Resend an invitation and invalidate previous tokens. |
| DELETE | `/admin/invitations/:id` | Admin | Revoke an outstanding invitation. |

Mutations require CSRF protection according to the [shared conventions](README.md). User listing, profile editing and general account administration are deferred to the users feature.

## Proposed request examples

Login — `POST /auth/login`:

```json
{
  "email": "student@example.com",
  "password": "example-only-password"
}
```

Activation — `POST /auth/activate`:

```json
{
  "token": "example-invitation-token",
  "password": "example-only-password"
}
```

Successful login must establish the session cookie and return the safe profile envelope below. Neither activation nor login should expose password hashes or internal session identifiers in JSON. Activation's success payload remains to be finalised.

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
    "status": "active"
  }
}
```

- CSRF header: `X-CSRF-Token`, required for mutations including login and activation.
- Invalid CSRF: `403` with `{ "error": { "code": "CSRF_INVALID", "message": "Your session token expired. Please retry.", "fields": {} } }`.
- Validation: use the shared error envelope with a field-name-to-message map in `fields` (for example `{ "email": "Enter a valid email address." }`). The frontend also understands Nest's default error envelope while features are being developed.
- The frontend sends cookies with `credentials: 'include'`, resets its cached CSRF token after successful login/logout, clears identity on 401, and does not log users out on 403 or server/network failure. It never automatically replays a mutation.
- Session/CSRF responses should not be cached. Coordinate cookie and CORS configuration with hosting. UI route guards and hidden menu entries do not replace server authorization.
- Mock frontend roles never authenticate to this API. The mock mode blocks calls through the shared API client, and is excluded from production builds.

Coordinate changes to this contract with the frontend's `docs/FRONTEND_FOUNDATION.md` and session adapter before merging.

## Validation and security rules

- Only active accounts can log in. Activation must consume the invitation atomically.
- Expired, revoked and used invitation tokens are rejected; store token hashes rather than raw tokens.
- Resending an invitation invalidates earlier tokens for that account.
- Activation cannot change the invited identity or admin-assigned role.
- Deactivation invalidates access and outstanding invitations.
- Regenerate the session at login; invalidate it at logout.
- Apply rate limits and generic login failure messages.

## Contract details to finalise

- Password policy, invitation lifetime and delivery method.
- Request fields for invitation creation and validation messages.
- Cookie configuration, token expiry and session lifetime.
- Activation/invitation success bodies and remaining endpoint-specific error codes/statuses.

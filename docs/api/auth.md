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

The exact schemas and responses are pending implementation. Successful login should establish the session cookie; neither response should expose password hashes or internal session identifiers in JSON.

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
- Cookie configuration, CSRF header/token format and expiry behaviour.
- Exact success bodies and endpoint-specific error codes/statuses.

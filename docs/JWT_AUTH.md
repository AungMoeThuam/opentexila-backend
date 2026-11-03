# JWT authentication (opt-in)

The real authentication endpoints are implemented. Reusable feature guards and
attendance integration are scheduled for Batch 3. Enabling these endpoints does
not impose authentication or roles on unrelated feature routes.

## Enable

Set these in the backend environment:

```dotenv
JWT_AUTH_ENABLED=true
DEV_AUTH_ENABLED=false
JWT_SECRET=<a-random-secret-generated-locally>
```

Generate the secret with `openssl rand -base64 32`; do not commit it. Run
`npm run db:migrate` before host startup. Docker Compose passes these settings
and runs migrations before starting the backend. Production requires HTTPS for
its Secure cookies. Never share a development secret with production.

The JWT and demo adapters currently own the same `/auth/*` routes, so startup
rejects enabling both. For the existing demo frontend/attendance workflow, keep
`JWT_AUTH_ENABLED=false` and use `DEV_AUTH_ENABLED=true` as before. The current
frontend session adapter has not yet been converted to Bearer JWTs.

## API flow

All paths below start with `/api/v1`. Success responses use `{ data: ... }` except
204 responses. Authentication responses, including handled errors, use
`Cache-Control: no-store`.

1. `GET /auth/csrf` returns `data.csrfToken` and sets an HttpOnly CSRF cookie.
   Keep the cookie and send the token as `X-CSRF-Token` on cookie-based mutations.
2. `POST /auth/login` accepts `{ "email": "...", "password": "..." }` and requires
   CSRF. It returns `data.accessToken`, `tokenType: "Bearer"`, `expiresIn: 900`,
   `user` and a replacement `csrfToken`. It sets an HttpOnly refresh cookie.
3. `GET /auth/me` requires `Authorization: Bearer <accessToken>` and returns the
   safe user profile. Cookies alone do not authenticate this endpoint.
4. `POST /auth/refresh` requires the refresh cookie and its current CSRF token.
   It rotates both credentials and returns a new access token/profile/CSRF token.
5. `POST /auth/logout` requires CSRF, revokes the cookie's session immediately,
   and clears the cookies (204). The session's access JWTs also stop working.
6. `POST /auth/change-password` accepts `currentPassword` and `newPassword`
   (12–1024 characters), requires a Bearer token, and returns 204. It clears the
   required-password-change flag, increments the user's session version, revokes
   every login and clears cookies. Sign in again with the new password.

Clients must keep access tokens in memory, retain cookies and replace the CSRF
value after login/refresh. Refresh calls must be serialized: reuse of an old
refresh token revokes the session, including its latest token. After CSRF expiry,
call `/auth/csrf` again. CSRF tokens expire after one hour and are signed and bound
to the current refresh cookie. Refresh cookies expire seven days after login;
rotation does not extend that deadline.

Only SHA-256 hashes of refresh tokens are persisted. Their high-entropy secrets
are generated server-side. Passwords use Argon2id. JWT verification pins HS256,
issuer and audience, checks expiration, and reads current user/session state.
Inactive accounts, revoked/expired sessions and stale session versions are
rejected. Users required to change their password can access their auth profile,
refresh and change-password endpoints; feature enforcement is added explicitly
with guards in Batch 3. No admin provisioning/reset endpoints are included yet.

The controller rate limiter allows 10 login attempts per minute per IP and per
normalized email, 10 password-change attempts per IP, and 60 requests per IP per
other auth operation. It returns 429 with Retry-After. Its bounded counters are
per process and reset on restart; a multi-instance deployment needs a shared
limiter. Proxy trust is not enabled, so forwarded client-IP headers are ignored.

## Verification

`npm test` covers JWT configuration and preserves the existing development-auth
HTTP checks. `npm run test:db` exercises these endpoints against disposable MySQL,
including credential validation, CSRF, rotation/replay, concurrent refresh,
logout, account state, password revocation and public-route access. It never
reads the application's `.env` or migrates its database.

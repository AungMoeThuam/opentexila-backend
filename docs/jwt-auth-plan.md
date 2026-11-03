# Opt-in JWT authentication

Implement one batch per turn, verify and commit it, then wait for `continue`.
No global authentication middleware or guard will be installed. Existing
attendance protection and development role selection remain available.

- [x] Batch 1: foundation, JWT configuration, typed DTOs and refresh-token storage.
- [x] Batch 2: login, refresh rotation, current user, logout, password changes,
  login rate limiting and revocation.
- [x] Batch 3: opt-in JWT/role guards, current-user decorator and integration with
  development auth, resolving ownership of overlapping auth routes.
- [x] Batch 4: complete security, development compatibility and Docker checks;
  update the authentication API contract.

Batch 1 completed on 2026-11-03:

- Added Nest JWT dependency and AuthModule. The module is deliberately not yet
  imported into AppModule: login routes and startup secret validation become
  active in Batch 2. No endpoints or route protections changed in this batch.
- JWT configuration requires a supplied secret of at least 32 bytes and pins
  HS256, issuer and audience. Access tokens expire after 15 minutes. Generate
  random secrets using the command documented in `.env.example`.
- Added validated login/password-change DTOs and typed token/profile contracts.
- Added the `auth_refresh_sessions` entity and reversible migration with user
  ownership, a SHA-256-sized token-hash column, expiration and revocation dates.
  Raw refresh tokens must never be persisted. Rotation and reuse handling are
  implemented in Batch 2. The existing cookie-session table is preserved.
- Type checking, formatting, 73 unit/HTTP tests and 19 disposable MySQL tests
  passed, including JWT rejection checks and migration rollback/reapplication.
- No migration was run against the application's database.

The browser integration is a separate frontend batch: memory-held Bearer access
JWTs and HttpOnly refresh cookies, with CSRF protection for cookie operations.
Auth-sensitive routes verify identity; other feature routes opt in explicitly.
Before deployment, review and protect all routes that require an identity or role.


Batch 2 completed on 2026-11-03:

- Added login, refresh, profile, logout and password-change endpoints with
  Argon2id checks, 15-minute access JWTs and rotating seven-day refresh cookies.
- Added signed, refresh-bound CSRF tokens for cookie mutations, rate limiting,
  account/session checks and transactional replay/password revocation.
- JWT_AUTH_ENABLED opts into this adapter; JWT_SECRET is required only in that
  mode. Compose passes both settings. No global auth middleware/guard was added.
- Route overlap handling was brought forward from Batch 3: JWT and demo modes
  are mutually exclusive, preserving the current demo adapter unchanged.
- See [JWT authentication](JWT_AUTH.md) for activation and the new API flow.
- Reusable feature guards and attendance integration remain Batch 3. Full Docker
  verification and the final API-contract rewrite remain Batch 4.

- Final checks passed: strict type checking, formatting, 74 unit/HTTP tests and
  27 disposable MySQL integration tests. Checks include forged CSRF rejection,
  session-version invalidation of both access and refresh tokens, concurrent
  refresh replay revocation, logout, and password changes across sessions.
- No changes were made to the application's `.env` or database.


Batch 3 completed on 2026-11-03:

- Exported opt-in JwtAuthGuard and RolesGuard, shared Roles metadata, and a typed
  CurrentUser decorator exposing only the verified user ID and current role.
- Attendance imports JWT providers only in JWT mode, verifies Bearer credentials,
  and retains its existing role and resource rules. Demo sessions and CSRF remain
  supported in demo mode; JWT failure cannot fall back to a demo session.
- Moved attendance's duplicate decorators into the shared auth module. No global
  guard or new global middleware was added; undecorated routes remain public.
- The full AppModule test exposed a host-startup compatibility issue: Node 22.15.1
  cannot load TypeORM's TypeScript migrations without the type-stripping flag.
  Added the flag to start/start:prod while retaining compiled dist/main.js.
- Verified guard ordering, role overrides, current database roles, required
  password changes, revocation, JWT attendance reads/check-in authorization,
  demo-auth regression tests and the real AppModule in an isolated child process.
- Full security/Docker review and final API-contract updates remain Batch 4.

- Final checks passed: strict type checking, formatting, 74 unit/HTTP tests and
  30 disposable MySQL integration tests. No application database or `.env` changes.


Batch 4 completed on 2026-11-03:

- Security review found that an unverified refresh-token secret could revoke a
  session by its ID. Refresh credentials are now signed JWTs with a distinct
  audience and random nonce, verified before refresh or logout can alter state.
  Only hashes remain stored; the database schema is unchanged. Credentials from
  the previous unsigned format require a new login.
- Added regressions for forged refresh credentials, access/refresh token-purpose
  separation, unsigned/wrong-algorithm JWTs, production cookie attributes,
  expired/mismatched CSRF and duplicate cookie injection.
- Passed strict type checking, formatting, 77 unit/HTTP tests and 31 disposable
  MySQL integration tests (108 total). Relative documentation links were checked.
- Built the current Compose stack from temporary source copies, synthetic
  credentials and an isolated volume. Verified JWT login through Vite's proxy,
  CSRF, profile, attendance authorization, refresh rotation, session survival
  after restart, logout revocation, and source/build-config reloads.
- Switched the disposable stack to demo mode and verified role selection, CSRF,
  profile, attendance and logout without a JWT secret. Removed and verified the
  absence of all test containers, network and database volume afterward.
- The Docker smoke harness was corrected to seed from the host (as documented)
  and rediscover ephemeral host ports after restart. No application `.env`,
  database or frontend source was changed.
- Replaced the stale authentication contract and updated API, Docker, database
  and development guides to distinguish implemented JWT behavior from planned
  admin provisioning/reset and enrolment work.

All four authentication batches are complete. Frontend JWT integration, admin
account provisioning/reset, production packaging, shared multi-instance rate
limiting and expired-session cleanup remain outside this implementation.

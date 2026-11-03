# Opt-in JWT authentication

Implement one batch per turn, verify and commit it, then wait for `continue`.
No global authentication middleware or guard will be installed. Existing
attendance protection and development role selection remain available.

- [x] Batch 1: foundation, JWT configuration, typed DTOs and refresh-token storage.
- [x] Batch 2: login, refresh rotation, current user, logout, password changes,
  login rate limiting and revocation.
- [ ] Batch 3: opt-in JWT/role guards, current-user decorator and integration with
  development auth, resolving ownership of overlapping auth routes.
- [ ] Batch 4: complete security, development compatibility and Docker checks;
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

# Development sign-in with real APIs

Use this adapter to develop attendance and other features before production authentication is available. It replaces password sign-in only. Role checks, enrolment permissions, account state, session version checks, geolocation rules and CSRF remain active. Actions change the local database.

## Shared Docker stack

In the backend's untracked `.env`:

```dotenv
DEV_AUTH_ENABLED=true
FRONTEND_MOCK_AUTH=false
```

Run `npm run stack:up`. Open http://localhost:5173 and use **Preview as** in the yellow **Development sign-in · real API and database** toolbar. Selecting Student opens `/student/attendance`. If the toolbar is missing after changing settings, reload the page.

The selector uses only these existing demo accounts:

| Selection | Account                  |
| --------- | ------------------------ |
| Student   | student.one@example.com  |
| Lecturer  | lecturer.one@example.com |
| Admin     | admin.demo@example.com   |

If an account is missing, set a fictional `SEED_PASSWORD` of at least 12 characters in the local `.env` and run `npm ci` followed by `npm run db:seed` on the host. Keep host `DB_HOST=127.0.0.1` and `DB_PORT` equal to the published MySQL port. Seeding is repeatable and does not reset existing accounts. An inactive account, wrong role, or mandatory password-change flag is reported rather than overridden.

For separate host processes, set backend `NODE_ENV=development`, `DEV_AUTH_ENABLED=true` and a local `DB_HOST`; set frontend `VITE_ENABLE_DEV_AUTH=true` in `.env.local`. Restart both processes. The development API proxy is still used.

## Behavior and boundaries

- The backend refuses startup when `DEV_AUTH_ENABLED=true` outside `NODE_ENV=development` or with a remote database host. The existing Docker ports bind to localhost. Do not publish or tunnel this development stack: anyone with access can select a demo role.
- The setting defaults to false. When disabled, the development auth module and its endpoints are not registered. Production frontend builds omit the toolbar and development mode.
- Sessions are random opaque HttpOnly, SameSite=Strict cookies backed by process memory, expire after eight hours, and disappear on API restart. They are separate from future production auth cookies and do not use localStorage.
- `GET /auth/csrf` bootstraps the session. `POST /dev/auth/select-role` requires that session's CSRF token and accepts only an allowlisted role. Switching roles rotates both the cookie and CSRF token. `/auth/me` restores the selected profile; `/auth/logout` requires CSRF and destroys the session.
- The middleware supplies `request.session` in the format used by the attendance guard. JWT mode is a separate adapter; see [JWT authentication](JWT_AUTH.md) for opt-in feature guards and attendance integration.
- The older `FRONTEND_MOCK_AUTH=true` mode remains an offline UI preview and blocks real APIs. Development sign-in takes precedence if both flags are enabled.
- Geolocation is not bypassed. The existing demo venues use synthetic coordinates (0, 0). Real-device GPS will be outside those venues; use browser location emulation or intentionally configured local test venues for check-in testing. Sessions must also be in progress.

To return to normal authentication, set `DEV_AUTH_ENABLED=false`, leave `FRONTEND_MOCK_AUTH=false`, and rerun `npm run stack:up`. Normal sign-in still requires the separate production authentication feature.

## Fresh check-in sessions

After host `npm ci`, run `npm run db:seed:attendance` from the backend on the host when existing fixtures are outside their check-in window. This requires development sign-in enabled and existing demo enrolments. Each run adds two sessions to the demo student's first class, preserving all existing data:

- **DEV PRESENT**: open for four hours, on-time threshold two hours from creation.
- **DEV LATE**: open for four hours, already past the on-time threshold.

The command prints the new session IDs and UTC deadlines. Open `/student/attendance/class-sessions/<id>` after selecting Student. Both venues use synthetic coordinates `0, 0` with a 100-metre radius; location checks still apply. Each run creates fresh pending records so accepted check-ins do not need to be reset.

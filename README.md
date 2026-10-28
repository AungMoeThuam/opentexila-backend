# OpenTexila backend

NestJS in **JavaScript**, with MySQL 8.4 and TypeORM EntitySchema. The database foundation and a development-only sample classroom API are implemented. Authentication and enrolment APIs, attendance APIs and scheduled attendance processing are still to be built.

## Start the whole stack

With Git, Node.js 22.15.1+ and Docker Desktop running, clone this backend and run:

```sh
npm run stack:up
```

This fetches the frontend into `../frontend` if missing, preserves existing checkouts and `.env`, and starts MySQL, migrations, the NestJS API and Vue with hot reload. Open <http://localhost:5173>. No host `npm ci` is required for this workflow. See the [shared Docker guide](docs/DOCKER.md) for configuration, mock UI mode and stopping the stack.

## Start locally without application containers

Requires Node.js 22.15.1+, npm and Docker with Compose.

```sh
npm ci
[ -f .env ] || cp .env.example .env
# Set DB_PASSWORD and DB_ROOT_PASSWORD to local development passwords.
npm run db:up
npm run db:migrate
# Optional: set SEED_PASSWORD in .env (12+ characters, demo-only), then:
# npm run db:seed
npm run start:dev
```

Do not overwrite an existing `.env`. Docker and the application read the same DB settings. MySQL binds only to localhost. Database storage persists in the Compose volume; `db:stop` does not delete it. Keep the server/session database timezone at UTC; the Compose service configures this.

The API binds to `127.0.0.1:3000` with prefix `/api/v1`. With `NODE_ENV=development`, try `GET /api/v1/examples/classrooms` and `GET /api/v1/examples/classrooms/:id`; see the [sample API guide](docs/api/examples.md). Application startup requires a reachable database. The application never runs migrations itself; the shared Docker stack runs them in a separate prerequisite container. In this host workflow, run `npm run db:migrate` explicitly. Build/source/schema changes do not silently synchronize tables.

## Team starting points

- [Team guide](docs/TEAM_GUIDE.md): daily workflow, API implementation and PR checklist.
- [Shared Docker stack](docs/DOCKER.md): one-command startup, configuration and troubleshooting.
- [Database design](docs/database-design.md): tables, fields, schedule model and integrity rules.
- [Using the database in APIs](docs/database-development.md): repositories, JavaScript dependency injection, transactions and migration workflow.
- [Sample API](docs/api/examples.md): working controller/service/module pattern, validation, pagination, error responses and curl examples.
- [API overview](docs/api/README.md), [auth](docs/api/auth.md), [attendance](docs/api/attendance.md): planned contracts.

## Commands

| Command                | Purpose                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run stack:up`     | Fetch a missing frontend checkout, build/start the shared stack and apply pending migrations.                                                                      |
| `npm run stack:logs`   | Follow all shared-stack service logs.                                                                                                                              |
| `npm run stack:down`   | Stop/remove shared-stack containers and network while preserving the database volume.                                                                              |
| `npm run db:up`        | Start local MySQL and wait for health.                                                                                                                             |
| `npm run db:stop`      | Stop local MySQL while preserving data.                                                                                                                            |
| `npm run db:migrate`   | Build and apply pending versioned migrations.                                                                                                                      |
| `npm run db:status`    | Build and list applied/pending migrations.                                                                                                                         |
| `npm run db:revert`    | Revert the last migration. **The initial rollback deletes all application tables and data; use only on disposable databases.**                                     |
| `npm run db:seed`      | Add fictional local development fixtures without resetting existing demo accounts.                                                                                 |
| `npm run test:db`      | Build, create an isolated MySQL container, test migration/constraints/seeds/Nest DI, then remove only that container. Requires Docker; pulls mysql:8.4 if missing. |
| `npm run start:dev`    | Rebuild/restart the backend on source changes.                                                                                                                     |
| `npm start`            | Build and start the backend.                                                                                                                                       |
| `npm run start:prod`   | Run an existing compiled build.                                                                                                                                    |
| `npm run build`        | Compile JavaScript with Babel 7.                                                                                                                                   |
| `npm run format:check` | Check source, migrations, seeds, tests and JSON formatting.                                                                                                        |

## Database structure

### Verification status

`npm test` builds the backend and checks configuration validation, TypeORM metadata, seed safety guards, sample API behavior and stack launcher behavior without a live database. Launcher tests require Git and create temporary local repositories; HTTP tests require localhost listening access. Run host tests after `npm ci`, even if application startup uses Docker. Sample API tests start a temporary localhost HTTP server with a fake repository and verify routing, dependency injection, validation, pagination, response fields, errors and development-only registration.

Live MySQL 8.4 verification now passes: `npm run test:db` checks migration application, rollback/reapplication, repeatable seeds, constraints, UTC values and Nest connection cleanup in a disposable container. This does not apply migrations to your application database; follow the local setup above for that.

### Files

```text
src/database/
  database.constants.js       # DATABASE injection token
  database.module.js          # Async DataSource provider and shutdown cleanup
  database-options.js         # Environment validation; synchronize:false
  data-source.js              # Same DataSource for Nest and migration CLI
  entities/
    user.schema.js
    invitation.schema.js
    classroom.schema.js
    enrolment.schema.js
    meeting.schema.js
    attendance-session.schema.js
    attendance-record.schema.js
    columns.js
    index.js
database/
  migrations/                 # Immutable, versioned CommonJS JavaScript migrations
  seeds/demo.js               # Local demo fixtures
test/database.integration.test.js
```

Seven domain tables and one adapter-owned `auth_sessions` table are created, plus TypeORM's `schema_migrations` and `typeorm_metadata` bookkeeping tables. The latter is created because the schemas use generated columns. Both bookkeeping tables remain after rolling back the application migration. Dates are UTC `DATETIME(3)`, IDs are unsigned integers, and decimal columns are returned as strings.

Auth/attendance feature folders remain available for controllers, services, runtime request validation and guards. No TypeScript is used. In plain JavaScript, dependencies require explicit injection tokens; see the database development guide.

## Seed fixtures

The seed creates an admin, lecturer, two enrolled students, one non-member student, one invited student, a demo class, two scheduled meetings and a completed history fixture. Emails are printed; passwords and hashes are not. All active demo accounts initially use the supplied `SEED_PASSWORD`, hashed with Argon2id. Reruns do not reset existing passwords or override member roles.

The class uses **synthetic coordinates (0,0)** and example radius/accuracy values. It is for API development, not a real campus attendance configuration. Default meeting start is 01:00 UTC (09:00 Kuala Lumpur) today. Set `SEED_MEETING_START=2026-10-27T01:00:00.000Z` for repeatable fixtures; rerunning with a different date adds that day's schedule. The seed does not implement live attendance or invitation delivery.

## Current attendance direction

Attendance follows scheduled class meetings automatically. Students enter a class and check in with location. There is no session code or manual lecturer opening action. The schema supports this flow; scheduling, roster materialisation, check-in validation and closure still require API/service implementation.

The existing Multer override remains in place. Docker supports local development; authentication/session middleware and production deployment configuration remain to be implemented.

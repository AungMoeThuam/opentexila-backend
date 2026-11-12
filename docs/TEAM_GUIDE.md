# Team guide: working in the backend

Day-to-day instructions for team members. This guide is a checklist. The details live in the linked documents, so don't copy them here.

- [README](../README.md): setup, implementation status and the command table
- [Shared Docker stack](DOCKER.md): cloning the frontend, starting all services and environment settings
- [Database design](database-design.md): tables, fields, integrity rules
- [Using the database in APIs](database-development.md): repositories, injection, transactions, migrations
- [Sample API](api/examples.md): a working module, controller and service pattern
- [API contracts](api/README.md): shared conventions, status codes, error format

## 1. First-time setup

Requires Git, Node.js 22.15.1+ (including npm), and running Docker with Compose 2.17+. Clone the backend into a folder named `backend`, then run from that folder:

```sh
npm run stack:up
```

This creates `.env` with random local database passwords if absent, clones the frontend into `../frontend` if missing, applies pending migrations, and starts MySQL, NestJS and Vue with hot reload. Existing `.env` and frontend work are preserved. Host `npm ci` is unnecessary for startup; it is needed for host tests, formatting and optional seeding. See [DOCKER.md](DOCKER.md) for details and configuration.

Open <http://localhost:5173>. Check the real API through the frontend proxy:

```sh
curl http://localhost:5173/api/v1/examples/classrooms
```

An empty `data` array is expected before seeding. Attendance APIs and optional development sign-in are implemented; production authentication and enrolment APIs are still pending. For seeded accounts with real attendance APIs, follow [development sign-in](DEVELOPMENT_AUTH.md); accounts are listed in [demo accounts](DEMO_ACCOUNTS.md). For UI work with mock identities, set `FRONTEND_MOCK_AUTH=true` in **backend/.env** and rerun `npm run stack:up`. Mock mode blocks live API calls; use `false` when integrating real APIs.

> [!WARNING]
> Never commit `.env`. Changing `DB_PASSWORD` does **not** change credentials inside an existing Docker volume. Restore the credentials that initialized it rather than deleting data to fix a login problem.

### Optional demo data

Set `SEED_PASSWORD` in `.env` to a fictional password of at least 12 characters. Keep `NODE_ENV=development`, `DB_HOST=127.0.0.1` and `DB_PORT` equal to MySQL's published port, then run on the host:

```sh
npm ci
npm run db:seed
```

The seed creates 26 active accounts with the seed password (1 admin, 4 lecturers, 20 students `student.one@example.com` to `student.twenty@example.com`, and `nonmember.demo@example.com`), 5 courses, 8 classes in term `2026-S2` (two sections for some courses), enrolments, 8 weekly class sessions per class (5 past, 1 current, 2 upcoming, some cancelled) and attendance records: mixed present/late/absent for past sessions and pending for current and upcoming ones. Emails are printed; passwords are not. Rerunning does not reset existing passwords. Location coordinates are synthetic, and no live check-in is created.

To run NestJS on the host instead of in Docker, follow [the alternative README workflow](../README.md#start-locally-without-application-containers). Avoid running both API processes on the same port.

## 2. Daily workflow

1. Finish or safely save local work before switching branches. Update `main` with `git switch main` and `git pull --ff-only`.
2. Create a branch for **one issue**, e.g. `git switch -c enr-be-1-my-classes`.
3. Run `npm run stack:up`; it starts the database before applying migrations and starting the applications. It does not pull an existing frontend checkout; update that repository separately when needed.
4. Edit your feature code. Re-run `npm run stack:up` after dependency, migration or Docker changes.
5. Before pushing, run the checks in section 6. Make small commits and open a PR referencing the issue and its paired frontend issue.

Use `npm run stack:logs` to inspect services and `npm run stack:down` to stop the full stack without deleting database data. For the alternative host workflow, the order is `npm run db:up`, `npm run db:migrate`, then `npm run start:dev`; stop its database with `npm run db:stop`.

## 3. Where code goes

```text
src/<feature>/            # one folder per feature: auth, enrolments, attendance, ...
  <feature>.module.ts
  <feature>.controller.ts # routes, input validation, delegates to the service
  <feature>.service.ts    # database queries and response mapping
src/database/entities/    # shared decorated TypeORM entities
database/migrations/      # schema changes (new file per change)
database/seeds/demo.ts    # fictional demo data
test/                     # tests
docs/api/                 # API contract per feature
```

`src/attendance/` contains the implemented attendance feature; `src/dev/` contains local development authentication. Create `src/auth/` and `src/enrolments/` when implementing the production features. Work in your own feature folder and coordinate edits to another member's files. Talk to the owner first if you need a change in shared code (`src/database/`, `app.module.ts`, auth guards).

Course code/name belong to `courses`. A `classes` row is one offering in a term; use `course_id`, `section` and `term`. Classes have no `code`, `name` or `subject` columns; read the related course. See the [database design](database-design.md#classes) and [sample response](api/examples.md#get-examplesclassrooms).

## 4. Adding an API endpoint

The backend application in `src/` is written in TypeScript and compiled with `tsc`. Use standard NestJS parameter decorators (`@Inject`, `@Req`, `@Query`, `@Param`, `@Body`), as in [classrooms-example.controller.ts](../src/examples/classrooms-example.controller.ts).

1. **Write the contract first.** Add or update `docs/api/<feature>.md` with method, path, who can call it, parameters, response and errors. Get it reviewed before building on it.
2. **Create the service.** Inject `DATABASE` and take repositories from it. Never open your own connection.
   ```ts
   import { Inject, Injectable } from '@nestjs/common';
   import type { DataSource, Repository } from 'typeorm';
   import { DATABASE } from '../database/database.constants';
   import { Enrolment } from '../database/entities';

   @Injectable()
   export class EnrolmentsService {
     private readonly enrolments: Repository<Enrolment>;

     constructor(@Inject(DATABASE) database: DataSource) {
       this.enrolments = database.getRepository(Enrolment);
     }
   }
   ```
3. **Create the controller.** Validate every query, param and body value at runtime. Take the acting user from the validated server session, never from a client-supplied user ID in the body, query or path. Validate resource IDs separately and authorize access to them.
4. **Register the module** and add it to `imports` in [app.module.ts](../src/app.module.ts).
5. **Return only allowlisted fields.** Never return an entity or `SELECT *` result directly.
6. **Add unit/HTTP tests** as `test/*.test.ts`; `npm test` discovers them automatically. Add MySQL feature checks as `test/*.integration.ts` helpers and call them from `test/database.integration.ts`.

### TypeScript and request validation

- Keep `strict` enabled. Run `npm run typecheck` and `npm test` before submitting changes; both build the application automatically. Run `npm run test:db` for database changes.
- Use concrete DTO classes for `@Query()`, `@Param()` and `@Body()` so the global validation pipe can validate and whitelist input. See `src/attendance/dto/`. Query strings use explicit transformations; JSON numeric fields must remain numbers. Do not enable implicit conversion globally.
- Use a Nest pipe for endpoint-specific parsing, as in the sample classroom routes, which retain their documented 400 errors. Attendance validation returns the shared 422 error envelope.
- Take users from `@CurrentUser()` behind `AttendanceGuard`; use `@Roles(...)` for endpoint roles. Keep resource ownership checks in services.
- A module whose routes use `AttendanceGuard` must import `AttendanceModule`. In JWT mode (`JWT_AUTH_ENABLED=true`) `AttendanceModule` re-exports `AuthModule`, so the guard can find `JwtAuthGuard`. Without that import the routes answer `503 AUTH_UNAVAILABLE` in JWT mode but still work in development sign-in mode, so test new routes in both modes. The check in `test/database.integration.ts` ("JWT mode protects the routes of every module") boots the real app in JWT mode; add a row for a new module's route there.
- Give public service responses explicit types. Type raw SQL result rows with `query<RowType[]>()` and use typed repositories. These types describe the expected database result; they do not validate SQL at runtime. Preserve transaction boundaries and lock order.
- Use `unknown` for caught errors and narrow them before inspecting properties. Entity property `!` declarations are for ORM hydration, not a replacement for checking nullable lookup results.
- Development auth uses controllers, an injectable session store and a CSRF guard. Its middleware only restores a server-owned session. It is still local-development-only.

### Rules that matter

- **Permissions on the server.** Check account status, role and class membership in the API. Hiding a button in the UI is not enough.
- **Scope queries before counting.** Filter to what the user may see first, then compute `meta.total`.
- **Hidden fields.** `password_hash` is not selected by default. The login service explicitly selects it for verification. It never belongs in an API response.
- **Dates are UTC.** Accept timestamps with an explicit timezone and convert to UTC. The frontend shows institution time.
- **Decimal columns arrive as strings.** Convert with `Number()` and check that the value is finite before doing maths.
- **Writes use a transaction** when several rows must change together. Use only the `manager` from the callback inside it. See [database-development.md](database-development.md#transactions).

The shared entity names are `Class`, `ClassSession` and `AttendanceRecord`. Enrolments and class sessions use `class_id`, and attendance records use `class_session_id`. Do not confuse these with login `auth_sessions`.

## 5. Changing the database

The project now uses one consolidated initial migration. Existing old development databases must be recreated separately; `stack:up` does not reset them. Read the [baseline setup guide](database-refactor-migration.md). The following rules apply to future schema changes after this agreed consolidation.

Do this only when your feature needs a new table or column.

1. **Tell the team and open a separate PR.** Database changes are reviewed on their own.
2. **Never edit a migration that has been merged.** Add a new one: `database/migrations/<timestamp>-<Name>.ts`. Export a class implementing `MigrationInterface` with typed `QueryRunner` arguments and explicit SQL. Use `1793491200000-SessionVenueSnapshot.ts` as the model. Migrations run through Node type stripping, so keep imports of interfaces type-only and avoid decorators, enums and parameter properties.
3. **Update the matching entity** in `src/database/entities/` and [database-design.md](database-design.md) in the same PR.
4. Apply it with `npm run stack:up` (Docker workflow) or `npm run db:migrate` after starting MySQL (host workflow), then run `npm run test:db` on the host.
5. **Don't use `db:revert` casually.** The initial rollback deletes all application tables and data. Use it only on a disposable database, and never to "fix" a teammate's data.
6. After pulling the merge, everyone reruns their workflow’s migration/start command above.

`synchronize` is off on purpose. Changing a schema file does **not** change the database.

To add demo data, extend `database/seeds/demo.ts`. Keep it safe to rerun and fictional. Coordinate seed changes with the team, especially the attendance developer; fixture ownership has not been established in this guide.

## 6. Before you push

Run these on the host after `npm ci`. The application containers do not include the test files.

```sh
npm run format        # fix formatting
npm run format:check
npm run typecheck     # builds first, then checks source, scripts and tests
npm test              # builds and runs the unit and HTTP tests
npm run test:db       # only if you changed migrations, schemas or queries
```

| Command           | Purpose                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test`        | No live database needed. Checks database metadata/configuration, sample HTTP routes using fake repositories, and launcher behavior using temporary local Git repositories. Requires Git and localhost HTTP access. |
| `npm run test:db` | Starts a temporary MySQL container, tests migrations, constraints and seeds, and removes it afterwards.                                                                                                            |

## 7. Pull request checklist

- [ ] The PR links the issue and the paired frontend issue
- [ ] `docs/api/<feature>.md` is updated and the endpoint is marked implemented
- [ ] Permissions checked on the server (role, ownership, class membership)
- [ ] Input validated, and only allowlisted fields returned
- [ ] Tests added and passing, including a test that another user's data is not exposed
- [ ] Any migration is new (no edits to old ones), and the schema and database docs are updated
- [ ] `format:check`, `typecheck` and `npm test` pass
- [ ] No `.env`, passwords or tokens in the diff

## 8. Troubleshooting

| Problem                                       | Likely cause and fix                                                                                                                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Access denied` for the DB user               | The volume was created with different credentials. Use those, or ask the team before touching the volume.                                                                                                                                                      |
| API won't start                               | Inspect `npm run stack:logs`; check database health and the migration service. In the host workflow, start MySQL with `npm run db:up` and apply migrations first.                                                                                              |
| `Unknown column` or `Table doesn't exist`     | Check pending migrations/schema drift. Run `npm run stack:up`, or `npm run db:migrate` in the host workflow. Inspect migration failures rather than resetting tables.                                                                                          |
| Port 3306, 3000 or 5173 in use                | For the shared stack, change `DB_PORT`, `BACKEND_PORT` or `FRONTEND_DEV_PORT` in backend `.env`. Host NestJS uses `PORT` instead of `BACKEND_PORT`.                                                                                                            |
| Dates look off by 8 hours                     | You are comparing UTC with local time. Keep UTC in the backend.                                                                                                                                                                                                |
| `db:seed` refuses to run                      | Check `SEED_PASSWORD` (12+ characters), `NODE_ENV=development`, local `DB_HOST`, valid `SEED_MEETING_START` if set, and applied migrations. Run the seed on the host.                                                                                          |
| Frontend shows "Unable to check your session" | For real local APIs, enable `DEV_AUTH_ENABLED=true`, keep `FRONTEND_MOCK_AUTH=false`, seed the demo accounts on the host, and follow [development sign-in](DEVELOPMENT_AUTH.md). For offline UI previews, use mock auth instead. Production sign-in is still pending. |

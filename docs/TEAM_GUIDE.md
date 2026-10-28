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

An empty `data` array is expected before seeding. Authentication, enrolment and attendance APIs are not implemented yet. For UI work with mock identities, set `FRONTEND_MOCK_AUTH=true` in **backend/.env** and rerun `npm run stack:up`. Mock mode blocks live API calls; use `false` when integrating real APIs.

> [!WARNING]
> Never commit `.env`. Changing `DB_PASSWORD` does **not** change credentials inside an existing Docker volume. Restore the credentials that initialized it rather than deleting data to fix a login problem.

### Optional demo data

Set `SEED_PASSWORD` in `.env` to a fictional password of at least 12 characters. Keep `NODE_ENV=development`, `DB_HOST=127.0.0.1` and `DB_PORT` equal to MySQL's published port, then run on the host:

```sh
npm ci
npm run db:seed
```

The seed creates an admin, a lecturer, two enrolled students, one non-member student and one invited student. Only active accounts receive a password. It also creates course `COS30043`, one section `DEMO` in term `DEMO`, two scheduled meetings and a completed attendance history fixture. Emails are printed; passwords are not. Rerunning does not reset existing passwords. Location coordinates are synthetic, and no usable invitation token or live check-in is created.

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
  <feature>.module.js
  <feature>.controller.js # routes, input validation, delegates to the service
  <feature>.service.js    # database queries and response mapping
src/database/entities/    # shared schemas (use them; don't copy them)
database/migrations/      # schema changes (new file per change)
database/seeds/demo.js    # fictional demo data
test/                     # tests
docs/api/                 # API contract per feature
```

Several feature folders, including `src/auth/` and `src/attendance/`, are placeholders with `.gitkeep`. `src/enrolments/` has not been created yet; create it when implementing that feature. Work in your own feature folder and coordinate edits to another member's files. Talk to the owner first if you need a change in shared code (`src/database/`, `app.module.js`, auth guards).

Course code/name belong to `courses`. A classroom is one course section in a term; use `course_id`, `section` and `term`. Do not use the retained legacy classroom `code`, `name` or `subject` fields for new features. See the [database design](database-design.md#classrooms--course-sections) and [sample response](api/examples.md#get-examplesclassrooms).

## 4. Adding an API endpoint

The project uses plain JavaScript with Babel, not TypeScript. Dependencies are injected with explicit `Inject(...)(...)` calls, as in [classrooms-example.controller.js](../src/examples/classrooms-example.controller.js).

1. **Write the contract first.** Add or update `docs/api/<feature>.md` with method, path, who can call it, parameters, response and errors. Get it reviewed before building on it.
2. **Create the service.** Inject `DATABASE` and take repositories from it. Never open your own connection.
   ```js
   import { Inject, Injectable } from '@nestjs/common';
   import { DATABASE } from '../database/database.constants';
   import { EnrolmentSchema } from '../database/entities';

   @Injectable()
   export class EnrolmentsService {
     constructor(database) {
       this.database = database;
       this.enrolments = database.getRepository(EnrolmentSchema);
     }
   }
   Inject(DATABASE)(EnrolmentsService, undefined, 0);
   ```
3. **Create the controller.** Validate every query, param and body value at runtime. Take the acting user from the validated server session, never from a client-supplied user ID in the body, query or path. Validate resource IDs separately and authorize access to them.
4. **Register the module** and add it to `imports` in [app.module.js](../src/app.module.js).
5. **Return only allowlisted fields.** Never return an entity or `SELECT *` result directly.
6. **Add tests** in `test/`, and add the file to the `test` script in `package.json`.

### Rules that matter

- **Permissions on the server.** Check account status, role and class membership in the API. Hiding a button in the UI is not enough.
- **Scope queries before counting.** Filter to what the user may see first, then compute `meta.total`.
- **Hidden fields.** `password_hash` and token hashes are not selected by default. The login service explicitly selects the password hash for verification. Invitation activation verifies a submitted token against its digest. Neither hash belongs in an API response.
- **Dates are UTC.** Accept timestamps with an explicit timezone and convert to UTC. The frontend shows institution time.
- **Decimal columns arrive as strings.** Convert with `Number()` and check that the value is finite before doing maths.
- **Writes use a transaction** when several rows must change together. Use only the `manager` from the callback inside it. See [database-development.md](database-development.md#transactions).

## 5. Changing the database

The existing course/section migration has an explicit legacy-data mapping and guarded rollback. Before first upgrading an existing database, stop writers and read the [migration procedure](course-section-migration-plan.md#migration-operation-and-rollback-limits); `stack:up` applies pending migrations automatically.

Do this only when your feature needs a new table or column.

1. **Tell the team and open a separate PR.** Database changes are reviewed on their own.
2. **Never edit a migration that has been merged.** Add a new one: `database/migrations/<timestamp>-<Name>.js`. It is a CommonJS file with explicit SQL. Use the existing `1793059200000-InitialSchema.js` as the model.
3. **Update the matching schema** in `src/database/entities/` and [database-design.md](database-design.md) in the same PR.
4. Apply it with `npm run stack:up` (Docker workflow) or `npm run db:migrate` after starting MySQL (host workflow), then run `npm run test:db` on the host.
5. **Don't use `db:revert` casually.** The initial rollback deletes all application tables and data. Use it only on a disposable database, and never to "fix" a teammate's data.
6. After pulling the merge, everyone reruns their workflow’s migration/start command above.

`synchronize` is off on purpose. Changing a schema file does **not** change the database.

To add demo data, extend `database/seeds/demo.js`. Keep it safe to rerun and fictional. Coordinate seed changes with the team, especially the attendance developer; fixture ownership has not been established in this guide.

## 6. Before you push

Run these on the host after `npm ci`. The application containers do not include the test files.

```sh
npm run format        # fix formatting
npm run format:check
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
- [ ] `format:check` and `npm test` pass
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
| Frontend shows "Unable to check your session" | `/api/v1/auth/me` is not implemented yet. For shared-stack UI work set `FRONTEND_MOCK_AUTH=true` in backend `.env` and rerun `npm run stack:up`. Direct host Vite uses `VITE_ENABLE_MOCK_AUTH=true` in frontend `.env.local`. Mock mode cannot call real APIs. |

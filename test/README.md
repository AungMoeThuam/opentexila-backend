# Backend tests

## Commands

- `npm test`: builds the backend and runs `test/*.test.ts`. These unit and HTTP tests do not need MySQL. HTTP tests need permission to listen on localhost.
- `npm run test:db`: builds the backend and runs `test/database.integration.ts`. It owns a disposable Docker MySQL container and removes it afterwards; it does not use the application database.
- `npm run typecheck` and `npm run format:check`: check TypeScript and formatting.

Do not run build-backed test commands simultaneously: each build replaces `dist/`.

## Test responsibilities

- `attendance-history.service.test.ts`: response mapping, private-field exclusion, empty results and explicit failures. Repository results are stubbed; the stub does not parse SQL.
- `attendance-history.controller.test.ts`: DTO validation and forwarding the verified identity to the service. Direct controller tests do not prove HTTP guard wiring.
- `attendance-records.test.ts`: real HTTP routing, guard behaviour and safe errors with fake repositories, including `GET /me/attendance-records/classes`. Its fake query builder only proves the verified student id reaches the query; the SQL itself is verified against MySQL.
- `attendance-history.integration.ts`: real MySQL history filtering, student isolation, ordering, paging, date boundaries and cancelled records, plus the history class-filter options (current, former and cancelled-only classes, dedupe across pages, ordering and isolation).
- `attendance.test.ts` and `attendance.integration.ts`: attendance rules, request handling, transactions and concurrency at their respective levels.
- `class-session-finalise.test.ts`: real HTTP routing, access, CSRF, validation and the outcome/error contract of `POST /class-sessions/:id/finalise`. The transaction is a fake that does not parse SQL.
- `finalisation.integration.ts`: real MySQL finalisation: pending and unmaterialised students become absent, evidence is kept, repeat and concurrent calls are idempotent, and open, cancelled and foreign sessions are untouched.
- Authentication, cookies, database configuration, migrations, seeds, development auth and stack tests retain their separate coverage.

## Adding coverage

Name new unit/HTTP entry points `*.test.ts` so `npm test` discovers them automatically. Name MySQL helpers `*.integration.ts` and call them from `database.integration.ts`, reusing its disposable database. Helpers do not run merely because they have that suffix.

Prefer observable results. Verify SQL behaviour against MySQL rather than writing a second query engine inside a mock. Keep permission, token, time/location-boundary and concurrent-write tests even when several layers cover related scenarios: they protect different failure modes.

Use named subtests for independent cases. Test counts can change when cases move between unit and database suites; review preserved behaviours rather than comparing counts alone.

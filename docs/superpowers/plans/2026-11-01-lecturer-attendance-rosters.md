# Lecturer Attendance Rosters Implementation Plan

> **Superseded:** the temporary `X-Dev-User-Id` header and `callerFrom` helper described here were removed. Lecturer routes now use `AttendanceGuard` and `request.attendanceUser`, and the lecturer session list is the shared `GET /me/class-sessions` route.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `GET /api/v1/me/class-sessions` (teacher branch) and `GET /api/v1/class-sessions/:classSessionId/records` for a lecturer caller.

**Architecture:** One `AttendanceModule` with two controllers and two services, following `src/examples/`. Shared error envelope, query validation and pagination live in `src/common/`. There is no guard and no authentication (team lead's decision). A temporary helper `callerFrom(request)` in `src/auth/dev-caller.js` reads `X-Dev-User-Id`; services take `user = { id }`, so real auth replaces only that helper.

**Tech Stack:** NestJS 12 (JavaScript, Babel legacy decorators), TypeORM `EntitySchema`, MySQL 8.4, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-01-lecturer-attendance-rosters-design.md` (contract: `docs/api/attendance.md`).

## Global Constraints

- Work only in this worktree (`.claude/worktrees/lecturer-attendance-rosters`). Never edit the `main` checkout.
- Plain JavaScript. Explicit injection: `Inject(TOKEN)(Class, undefined, index)`; route params with `Query()(Class.prototype, 'method', index)`, `Param('name')(...)`, `Req()(...)` (Babel has no parameter-decorator syntax).
- Class decorators (`@Controller`, `@UseFilters`, `@Injectable`, `@Get`) use normal `@` syntax, as in `src/examples/`.
- Repositories come from `DATABASE` (`database.getRepository(Schema)`). No migration. `synchronize` stays off.
- Return dates with `Date#toISOString()`. Map responses field by field (allow-list).
- Error envelope: `{ "error": { "code", "message", "fields" } }`. Error filter only on the two new controllers.
- Limits: `page` 1–10000 (default 1), `limit` 1–100 (default 20), ids max 4294967295.
- Tests: CommonJS files in `test/` that `require('../dist/...')` (run `npm run build` first; `npm test` does it). Format with Prettier (`npm run format`).
- **Do not commit or push until the user asks.** The last task stops before the commit and asks.

## Review Focus

- `?page=1&page=2` (repeated name) → 422, not a crash or a wrong page. (Task 1, Task 4)
- `from=2026-10-29T01:00:00` (no timezone) → 422. (Task 1)
- `page` after the last page → 200, `data: []`, real `total`. (Task 4)
- Roster of a cancelled session or a session without records → 200, `data: []`, `context` present with `class_state`. (Task 5)
- `classSessionId=4294967296` or `1abc` → 422, not a 500 from the database. (Task 5)

## File Map

- Create `src/common/api-exception.js` — `ApiException`, `validationError`, `notFound`.
- Create `src/common/api-exception.filter.js` — `ApiExceptionFilter`.
- Create `src/common/query-reader.js` — `QueryReader`, `pageMeta`.
- Create `src/attendance/availability.js` — `availabilityFor`.
- Create `src/auth/dev-caller.js` — temporary `callerFrom` (no guard, no checks).
- Create `src/attendance/class-summary.js` — `toClassSummary`, `toIso` (shared mapping).
- Create `src/attendance/me-class-sessions.{controller,service}.js`.
- Create `src/attendance/class-session-records.{controller,service}.js`.
- Create `src/attendance/attendance.module.js`; modify `src/app.module.js`.
- Create tests `test/common.test.js`, `test/attendance-availability.test.js`, `test/dev-caller.test.js`, `test/helpers/attendance-app.js`, `test/attendance-class-sessions.test.js`, `test/attendance-records.test.js`; modify `test/database.integration.test.js`.
- Modify `package.json` (test script), `docs/api/attendance.md`.

---

### Task 1: Error envelope, query reader, pagination meta

**Files:**
- Create: `src/common/api-exception.js`, `src/common/api-exception.filter.js`, `src/common/query-reader.js`
- Test: `test/common.test.js`

**Interfaces:**
- Produces:
  - `class ApiException extends HttpException` — `constructor(status: number, code: string, message: string, fields: object = {})`.
  - `validationError(fields: object): ApiException` — 422, `VALIDATION_ERROR`, message `Please correct the highlighted fields.`
  - `notFound(message: string): ApiException` — 404, `RESOURCE_NOT_FOUND`.
  - `ApiExceptionFilter` — `@Catch(ApiException)`; writes status and `{ error: { code, message, fields } }`.
  - `class QueryReader` — `constructor(source: object)`; `integer(name, { max, fallback, required = false }) → number | undefined`; `timestamp(name) → Date | undefined`; `oneOf(name, allowed: string[]) → string | undefined`; `fail(name, message)`; `finish() → void` (throws `validationError(fields)` if any error).
  - `pageMeta(page, limit, total) → { page, limit, total, totalPages }`.

- [ ] **Step 1: Write failing tests in `test/common.test.js`**

Tests (each calls `new QueryReader(obj)`, then `finish()` inside `assert.throws`/no throw):
  - `integer('page', {max: 10000, fallback: 1})` returns `1` for `{}`; returns `3` for `{page: '3'}`; each of `'0'`, `'-1'`, `'1.5'`, `'1e2'`, `''`, `'10001'`, `['1','2']` makes `finish()` throw an `ApiException` with `getStatus() === 422` and `getResponse().error.fields.page` set.
  - `integer('classSessionId', {max: 4294967295, required: true})` on `{}` fails; on `'4294967296'` fails; on `'1abc'` fails.
  - `timestamp('from')`: `'2026-10-29T01:00:00.000Z'` and `'2026-10-29T09:00:00+08:00'` return a `Date` equal to `2026-10-29T01:00:00.000Z`; `'2026-10-29T01:00:00'`, `'2026-10-29'`, `'abc'`, `'2026-13-40T00:00:00Z'` fail; absent returns `undefined`.
  - `oneOf('status', ['pending','present','late','absent'])`: `'late'` ok; `'LATE'`, `'x'` fail.
  - Several bad params give one `finish()` error with every field name in `fields`.
  - `pageMeta(2, 5, 21)` equals `{page:2, limit:5, total:21, totalPages:5}`; `pageMeta(1, 20, 0).totalPages === 0`.
  - `ApiExceptionFilter.catch(new ApiException(404,'RESOURCE_NOT_FOUND','x'), host)` with a fake `host.switchToHttp().getResponse()` that records `status(n).json(body)` → status 404, body `{error:{code:'RESOURCE_NOT_FOUND',message:'x',fields:{}}}`.

- [ ] **Step 2: Run `npm run build && node --test test/common.test.js`. Expected: FAIL (modules not found).**

- [ ] **Step 3: Implement the three files per the Interfaces block.** `QueryReader` keeps a `fields` object; the first error per name wins. Integer regex `^[1-9]\d*$` plus `Number.isSafeInteger` and `<= max`; a non-string value (array) is an error. Timestamp regex must require `T`, time `HH:mm` with optional `:ss(.SSS)`, and `Z` or `±HH:MM`; then `Date.parse` must be a number and the same instant must round-trip when the date fields are valid (reject `2026-13-40`).

- [ ] **Step 4: Run `npm run build && node --test test/common.test.js`. Expected: all PASS.**

---

### Task 2: Availability

**Files:**
- Create: `src/attendance/availability.js`
- Test: `test/attendance-availability.test.js`

**Interfaces:**
- Produces: `availabilityFor(session: { state: string, starts_at: Date, ends_at: Date }, now: Date): 'cancelled' | 'upcoming' | 'in_progress' | 'ended'`.

- [ ] **Step 1: Write failing tests.** With `starts_at = 2026-10-29T01:00:00Z`, `ends_at = 2026-10-29T03:00:00Z`: `now` one ms before start → `upcoming`; `now == starts_at` → `in_progress`; one ms before end → `in_progress`; `now == ends_at` → `ended`; after end → `ended`; `state: 'cancelled'` returns `cancelled` for a past, current and future `now`.
- [ ] **Step 2: Run `npm run build && node --test test/attendance-availability.test.js`. Expected: FAIL.**
- [ ] **Step 3: Implement `availabilityFor`** as in the spec (cancelled first, then compare epoch ms).
- [ ] **Step 4: Run the test. Expected: PASS.**

---

### Task 3: Temporary caller helper (replaces the guard)

Team lead decision: no guard and no authentication at this stage. Both routes still need a lecturer id, so one small helper reads it from a header. It does no check.

**Files:**
- Create: `src/auth/dev-caller.js`
- Test: `test/dev-caller.test.js`

**Interfaces:**
- Consumes: `QueryReader` (Task 1).
- Produces: `callerFrom(request: { headers }): { id: number }`. Reads `request.headers['x-dev-user-id']`. A missing value, a value that is not an integer from 1 to 4294967295, or a repeated value (`'2, 3'`) throws `validationError` with the single field name `X-Dev-User-Id`. No database call, no role check, no `NODE_ENV` rule.

- [x] **Step 1: Write failing tests:** `{ 'x-dev-user-id': '2' }` → `{ id: 2 }`; `'4294967295'` → `{ id: 4294967295 }`; `{}`, `'abc'`, `'0'`, `'1.5'`, `'4294967296'`, `'2, 3'` → 422 `VALIDATION_ERROR` with `fields` keys equal to `['X-Dev-User-Id']`.
- [x] **Step 2: Run `npm run build && node --test test/dev-caller.test.js`. Expected: FAIL (module not found).**
- [x] **Step 3: Implement `callerFrom`** with `QueryReader.integer(name, { max: 4294967295, required: true })`. Add a comment: temporary, replaced when real auth lands.
- [x] **Step 4: Run the test. Expected: PASS.**

---

### Task 4: `GET /me/class-sessions` (teacher)

**Files:**
- Create: `src/attendance/class-summary.js`, `src/attendance/me-class-sessions.service.js`, `src/attendance/me-class-sessions.controller.js`, `src/attendance/attendance.module.js`, `test/helpers/attendance-app.js`
- Modify: `src/app.module.js` (import `AttendanceModule` unconditionally)
- Test: `test/attendance-class-sessions.test.js`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `toIso(date: Date | null): string | null`.
  - `toClassSummary(classroom): { id, course: { id, code, name }, section, term, lecturer: { id, name }, room_label }` (input has `course` and `teacher` relations loaded). Reused by Task 5.
  - `MeClassSessionsService` — `constructor(database)`; `list(user, query, now = new Date()): Promise<{ data, meta }>`. Validates `query` with `QueryReader` (`page`, `limit`, `classId` max 4294967295, `from`, `to`; `from >= to` → `reader.fail('from', 'from must be earlier than to.')`).
  - `MeClassSessionsController` — `@Controller('me/class-sessions')`, `@UseFilters(ApiExceptionFilter)`, `list(query, request)`, which calls `callerFrom(request)` and passes the result to the service.
  - `AttendanceModule` — controllers: this one (Task 5 adds the second), providers: the services.
  - Test helper `startAttendanceApp(repositories: { ClassSession, AttendanceRecord }) → Promise<{ base: string, close(): Promise<void> }>`: a global module provides `DATABASE` with `getRepository(schema) → repositories[schema.options.name]`, imports `AttendanceModule`, sets prefix `api/v1`, listens on port 0, with no `NODE_ENV` rule. Pattern: `test/examples.test.js`. Requests send `x-dev-user-id`.

Item mapping: `{ id, class_id, class: toClassSummary(...), starts_at, late_after, ends_at, availability, my_attendance: null }`. No `state`.

Repository call: `ClassSession` `findAndCount` with `where.class.teacher_id = user.id` (plus `where.class.id = classId` when given, `starts_at` range from `from`/`to` using TypeORM `And`, `MoreThanOrEqual`, `LessThan`), `relations: { class: { course: true, teacher: true } }`, an explicit `select` allow-list (no latitude, longitude, radius, password data), `order: { starts_at: 'ASC', id: 'ASC' }`, `skip`, `take`.

- [ ] **Step 1: Write failing tests** (`startAttendanceApp` with the header `x-dev-user-id: 2`, and a fake `ClassSession.findAndCount` that records options):
  - default call: status 200; body `data[0]` has exactly the keys in the item mapping (no `state`, no coordinates); `my_attendance === null`; `meta` equals `{page:1, limit:20, total, totalPages}`; recorded options have `skip 0`, `take 20`, `order {starts_at:'ASC', id:'ASC'}`, `where.class.teacher_id === 2`.
  - `availability` for fixture sessions that are past, running, future and `state: 'cancelled'` with a fixed `now` is `ended`, `in_progress`, `upcoming`, `cancelled` (call the service directly with an injected `now`).
  - `?classId=5&page=3&limit=5&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z` → `where.class.id === 5`, `skip 10`, `take 5`, and a `starts_at` condition.
  - Review Focus: `?page=1&page=2` → 422 with `error.fields.page`; `?from=2026-10-29T01:00:00` → 422 with `error.fields.from`; `?from=2026-10-30T00:00:00Z&to=2026-10-29T00:00:00Z` → 422; `?limit=101`, `?page=0`, `?classId=abc` → 422 and the repository is not called.
  - Review Focus: `?page=9` with fake `[[], 3]` → 200, `data: []`, `meta {page:9, limit:20, total:3, totalPages:1}`.
  - No `x-dev-user-id` header, or `x-dev-user-id: abc` → 422 `VALIDATION_ERROR` with `error.fields['X-Dev-User-Id']`, and no repository call. (There is no 401 and no 403.)
  - Repository throws `new Error('private details')` → 500 and the body does not contain `private details`.
- [ ] **Step 2: Run `npm run build && node --test test/attendance-class-sessions.test.js`. Expected: FAIL.**
- [ ] **Step 3: Implement** `class-summary.js`, the service, the controller, `AttendanceModule`, and register the module in `src/app.module.js`.
- [ ] **Step 4: Run the test. Expected: PASS. Run `npm test` and confirm `examples.test.js` still passes.**

---

### Task 5: `GET /class-sessions/:classSessionId/records`

**Files:**
- Create: `src/attendance/class-session-records.service.js`, `src/attendance/class-session-records.controller.js`
- Modify: `src/attendance/attendance.module.js` (add controller and service)
- Test: `test/attendance-records.test.js`

**Interfaces:**
- Consumes: `QueryReader`, `pageMeta`, `notFound`, `toClassSummary`, `toIso`, `startAttendanceApp`.
- Produces:
  - `ClassSessionRecordsService` — `constructor(database)`; `list(user, classSessionId: string, query): Promise<{ data, context, meta }>`. Order: validate path id and query first (`QueryReader`: `classSessionId` required max 4294967295; `page`; `limit`; `status` `oneOf(['pending','present','late','absent'])`), then find the session, then the records.
  - `ClassSessionRecordsController` — `@Controller('class-sessions')`, same guard and filter, `@Get(':classSessionId/records') list(classSessionId, query, request)`.

Repository calls: `ClassSession.findOne({ where: { id, class: { teacher_id: user.id } }, relations: { class: { course: true, teacher: true } }, select: allow-list })` → `null` throws `notFound('Class session not found.')`. `AttendanceRecord.findAndCount({ where: { class_session_id, ...(status && { status }) }, relations: { student: true }, select: allow-list (no `distance_m`, no student email), order: { student_id: 'ASC' }, skip, take })`.

Row: `{ class_session_id, student_id, status, checked_in_at: toIso(...) (null when absent), student: { id, name } }`. `context`: `{ class_session_id, class: toClassSummary(...), starts_at, late_after, ends_at, class_state: session.state }`.

- [ ] **Step 1: Write failing tests:**
  - success: body keys exactly `data`, `context`, `meta`; row keys exactly the list above (no email, no `distance_m`); `checked_in_at` is an ISO string for `present` and `null` for `pending` and `absent`; `findOne` options have `where.class.teacher_id === 2`; records options have `order {student_id:'ASC'}`.
  - `?status=late` → records `where.status === 'late'`; a missing `status` → no `status` key in `where`.
  - Review Focus: fake records `[[], 0]` for a session with `state: 'cancelled'` → 200, `data: []`, `context.class_state === 'cancelled'`, `meta.totalPages === 0`.
  - Review Focus: `/class-sessions/4294967296/records`, `/class-sessions/1abc/records`, `/class-sessions/0/records` → 422 with `error.fields.classSessionId`, and no repository call.
  - `?status=LATE`, `?status=x`, `?page=1&page=2`, `?limit=0` → 422.
  - fake `ClassSession.findOne` returns `null` → 404 `{error:{code:'RESOURCE_NOT_FOUND', message:'Class session not found.', fields:{}}}` and `AttendanceRecord.findAndCount` is not called.
  - no header or a bad header → 422 with `error.fields['X-Dev-User-Id']`, and no repository call. (There is no 401 and no 403.)
- [ ] **Step 2: Run `npm run build && node --test test/attendance-records.test.js`. Expected: FAIL.**
- [ ] **Step 3: Implement the service and controller; add them to `AttendanceModule`.**
- [ ] **Step 4: Run the test. Expected: PASS.**

---

### Task 6: Docs, real-database test, full checks

**Files:**
- Modify: `docs/api/attendance.md`, `package.json`, `test/database.integration.test.js`

- [ ] **Step 1: Docs.** In `docs/api/attendance.md` `GET /me/class-sessions`: remove `"state": "scheduled"` from the success example and delete the bullet that says `state` is the persisted column; keep `availability` (its `cancelled` value is already documented). In the `/records` section keep `context.class_state`. Add one sentence: until real auth exists the API uses the temporary header `X-Dev-User-Id` (no guard, no check).
- [ ] **Step 2: `package.json`.** Add the five new test files to the `test` script (`test/common.test.js test/attendance-availability.test.js test/dev-caller.test.js test/attendance-class-sessions.test.js test/attendance-records.test.js`).
- [ ] **Step 3: Write a failing DB test.** In `test/database.integration.test.js`, after the seeds subtest (inside `if (!fixturesReady) return;` flow), add `await t.test('lecturer attendance routes read real data', ...)`. Build `MeClassSessionsService` and `ClassSessionRecordsService` from `../dist/attendance/...` with `ds`. Assertions: for the seeded `lecturer.one@example.com` (id from `fixtures.accounts`), `list` returns `meta.total` equal to a raw SQL count of `class_sessions` joined to `classes` on `teacher_id`; every `data[i].class_id` belongs to that lecturer; `data` is sorted by `starts_at`, `id`; filtering by `classId` returns only that class; a `from`/`to` range returns only sessions in range; `my_attendance` is `null`. Pick a session of that lecturer with records: `list` for it returns rows sorted by `student_id`, `student` has only `id` and `name`, `context.class.lecturer.name` is `Lecturer One`, and `status=absent` returns only absent rows. A session of a different lecturer (raw SQL) makes `list` reject with a 404 `ApiException`. A cancelled seeded session returns `data: []` with `context.class_state === 'cancelled'`.
- [ ] **Step 4: Run `npm run build && npm run test:db`. Expected: the new subtest FAILS first only if code is wrong; fix code until all PASS.** (Needs Docker.)
- [ ] **Step 5: Full checks.** Run `npm run format`, then `npm run format:check`, `npm test`, `npm run test:db`. Expected: all pass. Report any failed or skipped check with its output.
- [ ] **Step 6: Manual check (optional, if Docker stack is up).** With `npm run db:up && npm run db:migrate && npm run db:seed` and `NODE_ENV=development npm run start:dev`, call `curl -H 'X-Dev-User-Id: <lecturer id>' 'http://127.0.0.1:3000/api/v1/me/class-sessions?limit=2'` and the roster route for one id.
- [ ] **Step 7: Stop.** Show `git status` and `git diff --stat`. Ask the user whether to commit and push. Do not commit before the answer.

---

## Self-Review

- **Spec coverage:** route 1 (Task 4), route 2 (Task 5), availability (Task 2), envelope and validation (Task 1), stub identity (Task 3), docs edit and DB proof (Task 6). No student, admin, auth or migration work, as the spec says.
- **Type consistency:** `QueryReader`, `pageMeta`, `ApiException`, `notFound`, `toClassSummary`, `toIso`, `availabilityFor`, `callerFrom`, `startAttendanceApp` have the same names and signatures in every task.
- **Review Focus** lines each map to a named test (Tasks 1, 4, 5).

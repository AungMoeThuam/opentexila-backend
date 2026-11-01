# Lecturer attendance rosters API — design

Issue: AungMoeThuam/opentexila-backend#12. Paired frontend: AungMoeThuam/opentexila#9.
Contract source: `docs/api/attendance.md`. Branch: `feat/lecturer-attendance-rosters`.

## Intent

A lecturer must see the class sessions of the classes they teach, and the read-only
attendance of the students in one session. The frontend pages are
`/lecturer/attendance` (list with filters) and `/lecturer/class-sessions/:classSessionId`
(roster).

## Scope

Two routes, **lecturer (`teacher`) caller only**:

1. `GET /api/v1/me/class-sessions` — teacher branch only.
2. `GET /api/v1/class-sessions/:classSessionId/records`

### Non-goals

- Student branch of `/me/class-sessions`, session detail, check-in: issue #10.
- Student history: #11. Class and enrolment routes (class dropdown data
  `GET /me/classes`): #8, #9. Automatic finalisation: #13.
- Admin access, student 403, real 401, CSRF, sessions, login: auth is postponed.
- No writes. No roster materialisation. The roster shows only existing
  `attendance_records` rows.

### Anti-goals

- Never show another lecturer's sessions or roster.
- Never return student email, `distance_m`, coordinates, or password data.
- Never leak database error text.

## Decisions (from the user)

- No default view on the server. The frontend chooses the view with query params.
- Filters: `classId` (the frontend shows a drop-down of the lecturer's classes),
  `from`, `to`, `page`, `limit`. Only `classId`; no `courseId`.
- Cancelled sessions stay in the list.
- The UI "Status" column shows the field `availability`
  (`upcoming | in_progress | ended | cancelled`). The list item has **no `state`** field.
- Ordering: list `starts_at ASC, id ASC`; roster `student_id ASC`.
- Everything is built inside this worktree. `main` is not edited.

## Route 1: `GET /me/class-sessions` (teacher)

Sessions of classes where `classes.teacher_id = caller.id`.

Query (all optional; an unknown name is ignored; a repeated name is a 422):

| Name | Rule |
| --- | --- |
| `page` | integer 1–10000, default 1 |
| `limit` | integer 1–100, default 20 |
| `classId` | positive integer (max 4294967295). A class of another lecturer gives an empty list. |
| `from` | ISO 8601 timestamp **with** timezone; `from <= starts_at` |
| `to` | same format; `starts_at < to` |

`from >= to` (both present) is a 422. A bad value is a 422 `VALIDATION_ERROR` with
`fields` naming each bad parameter.

Item:

```json
{
  "id": 30, "class_id": 1,
  "class": {
    "id": 1,
    "course": { "id": 1, "code": "COS30043", "name": "Interface Design and Development" },
    "section": "A", "term": "2026-S2",
    "lecturer": { "id": 2, "name": "Lecturer One" },
    "room_label": "EN402"
  },
  "starts_at": "…Z", "late_after": "…Z", "ends_at": "…Z",
  "availability": "in_progress",
  "my_attendance": null
}
```

Response: `{ "data": [...], "meta": { "page", "limit", "total", "totalPages" } }`.
`totalPages` is `ceil(total / limit)`; it is 0 when `total` is 0. A page after the last
page gives `data: []` with the real `total`.

`availability` (server clock, UTC): `cancelled` if `state = 'cancelled'`; else `upcoming`
when `now < starts_at`; `in_progress` when `starts_at <= now < ends_at`; `ended` when
`now >= ends_at`.

## Route 2: `GET /class-sessions/:classSessionId/records`

- `classSessionId`: positive integer (max 4294967295), else 422.
- Query: `page`, `limit` (as above), `status` (`pending | present | late | absent`), else 422.
- The session must belong to a class where `teacher_id = caller.id`. Unknown session or
  another lecturer's session: 404 `RESOURCE_NOT_FOUND`, message `Class session not found.`
- Order `student_id ASC`.

Response `200`:

```json
{
  "data": [{
    "class_session_id": 30, "student_id": 3, "status": "present",
    "checked_in_at": "…Z", "student": { "id": 3, "name": "Student One" }
  }],
  "context": {
    "class_session_id": 30,
    "class": { "id": 1, "course": { "id", "code", "name" }, "section", "term",
               "lecturer": { "id", "name" }, "room_label" },
    "starts_at", "late_after", "ends_at", "class_state": "scheduled"
  },
  "meta": { "page", "limit", "total", "totalPages" }
}
```

`context` is always present, also when `data` is `[]` (no records, a cancelled session, or
a `status` filter with no match). `checked_in_at` is `null` for `pending` and `absent`
rows. The roster page reads `context.class_state` for its cancelled banner, so the roster
keeps `class_state` (the list item does not have `state`).

## Errors

Shared envelope `{ "error": { "code", "message", "fields" } }` (`fields` is `{}` when no
field applies).

| HTTP | `code` | When |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | Temporary stub: missing or unknown caller, or not development |
| 403 | `FORBIDDEN` | Temporary stub: caller is not an active teacher |
| 404 | `RESOURCE_NOT_FOUND` | Route 2: session missing or not yours |
| 422 | `VALIDATION_ERROR` | Any bad path or query value |

Unexpected errors stay Nest's default 500 `{ statusCode, message: 'Internal server error' }`.

## Temporary caller identity (your part of auth)

Auth is postponed. A **dev-only stub guard** identifies the caller: header
`X-Dev-User-Id: <users.id>`. It works only when `NODE_ENV=development` (same rule as the
sample API). It loads the user, requires `role = 'teacher'` and `status = 'active'`, and sets
`request.user = { id, role }`. Services take the caller as an argument `(user)`, so the real
`AuthGuard` replaces only this guard later. The stub lives in `src/auth/` and is deleted
when real auth lands.

## Constraints

- Plain JavaScript, Babel decorators, NestJS controller/service/module pattern like
  `src/examples/`. Constructor injection is explicit (`Inject(...)(Class, undefined, n)`).
- TypeORM `EntitySchema` repositories from `DATABASE`. `synchronize` stays off. **No
  migration is needed.**
- Dates: store and return UTC ISO strings (`Date#toISOString()`).
- Response mapping is explicit (allow-list), like `toResponse` in the examples service.
- `npm run format:check`, `npm test`, `npm run test:db` must pass.

## Calls made by the author (not by the user)

- The stub guard, its header name, and its dev-only rule.
- Non-teacher caller in the stub gives 403; no admin or student path is written.
- A repeated query name (`?page=1&page=2`) is a 422, like the sample API rejects it.
- `from` and `to` need an explicit timezone; the client must URL-encode `+` in an offset.
- `AttendanceModule` is always registered; in non-development it answers 401.
- `docs/api/attendance.md` drops `state` from the list item.
- Error filter is attached to the two new controllers only, so the sample API keeps its
  current 400 shape.

## Left to the builder

File and function names beyond the plan, query-builder vs `find` options, and test helper
structure — as long as the behaviour above holds.

# OpenTexila database design

**Version 3 · 28 October 2026 · Course and section schema.**

See the [database ER diagram](database-erd.md) for a visual map of the implemented tables and relationships.

MySQL **8.4**, TypeORM **0.3**, plain JavaScript EntitySchema, explicit migrations. This replaces the earlier review draft: scheduled meetings are now in scope; session codes and lecturer-operated opening are removed. The initial migration is `database/migrations/1793059200000-InitialSchema.js`; `1793145600000-CourseSections.js` adds courses and separate sections. This document describes the schema after both migrations, not the migration status of any particular database. The development-only [sample classroom API](api/examples.md) is implemented. Authentication, enrolment and attendance endpoints, and the attendance worker, remain unimplemented.

## Relationships and naming

- A user has role `student`, `teacher` or `admin`; show teacher as Lecturer.
- A course stores one shared course code/name.
- A classroom means one course section in one academic term, not a physical room inventory.
- Each classroom references exactly one course; a course can have many sections across terms.
- A classroom has one assigned lecturer, many enrolment intervals, and many scheduled class meetings.
- Each meeting has at most one automatically materialised attendance session.
- Each session has at most one attendance record per eligible student.
- Invitations reference both the invited user and creating admin.
- `auth_sessions` holds browser login sessions; it is unrelated to attendance sessions.
- Single institution; no tenant ID or institutions table.

Persisted scalar properties and database columns use **snake_case**; relation accessors such as `cancelledBy` may use camelCase. Repository entity names are `User`, `AccountInvitation`, `Course`, `Classroom`, `Enrolment`, `ClassMeeting`, `AttendanceSession`, and `AttendanceRecord`. The corresponding schemas are in `src/database/entities/`.

## Common columns

All eight domain tables have auto-increment `id INT UNSIGNED`, `created_at DATETIME(3)` and `updated_at DATETIME(3)`. Audit timestamps default to the database clock; updated_at changes on writes. Keep database server/session timezone UTC; the driver uses `timezone: 'Z'`. Return dates as ISO 8601 UTC.

Relationships use foreign keys with RESTRICT deletion/update, not cascading removal of academic history. Deactivate users, withdraw memberships and cancel/archive domain records. Names support utf8mb4. Email comparisons are case-insensitive and accent-sensitive; normalized lowercase storage is required. Institutional IDs, course codes and section labels use ASCII binary comparison and uppercase storage.

### users

| Field                 | Type / rule                                                      |
| --------------------- | ---------------------------------------------------------------- |
| name                  | varchar(150), nonblank                                           |
| email                 | varchar(254), lowercase and trimmed, unique                      |
| institution_member_id | varchar(50), uppercase and trimmed, unique                       |
| password_hash         | nullable varchar(255); excluded from ordinary repository SELECTs |
| role                  | student / teacher / admin                                        |
| status                | invited / active / inactive; defaults invited                    |
| activated_at          | nullable datetime(3)                                             |
| session_version       | unsigned integer, default 0                                      |

Active accounts require a nonempty password hash and activation timestamp. Increment session_version on global session revocation/deactivation/password changes; auth middleware must compare it on protected requests. The database does not hash passwords or implement authentication.

### account_invitations

| Field               | Type / rule                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| user_id, created_by | required user FKs                                                                   |
| token_hash          | unique ASCII binary char(64), lowercase SHA-256 hex; excluded from ordinary SELECTs |
| expires_at          | required; later than created_at                                                     |
| used_at, revoked_at | nullable; mutually exclusive                                                        |
| outstanding_user_id | read-only generated column; unique when unused and unrevoked                        |

The generated unique key prevents two outstanding invitations for one user, even concurrently. Expired unused tokens still occupy that slot: revoke them inside the resend transaction before inserting a replacement. Validity also requires current server time before expiry and an eligible invited account. Store only a digest of a high-entropy token; never return token hashes.

### courses

| Field | Type / rule                                          |
| ----- | ---------------------------------------------------- |
| code  | unique uppercase trimmed ASCII varchar(30), nonempty |
| name  | varchar(150), nonblank                               |

One course can be offered as multiple sections and in different terms. For example, course `COS30043` can have Section A and Section B in `2026-S2`. Course administration APIs remain to be implemented.

### classrooms — course sections

| Field                     | Type / rule                                                    |
| ------------------------- | -------------------------------------------------------------- |
| course_id                 | required `courses.id` FK                                       |
| section                   | uppercase trimmed ASCII varchar(30), nonempty                  |
| term                      | varchar(50); academic period, e.g. `2026-S2`                   |
| teacher_id                | required user FK                                               |
| room_label                | varchar(100)                                                   |
| latitude / longitude      | decimal(9,6), within -90..90 / -180..180                       |
| radius_m / max_accuracy_m | positive decimal(10,2); accuracy threshold <= radius           |
| archived_at               | nullable datetime(3)                                           |
| code                      | nullable legacy ASCII varchar(30); hidden from default selects |
| name, subject             | nullable legacy varchar(150); hidden from default selects      |

Unique `(course_id, term, section)` prevents duplicate section offerings. A section label can be reused for a different course or term. The database does not enforce a term format or provide a separate academic-terms table.

The legacy fields preserve old values for guarded rollback and are not the source of truth for new features. New class rows can leave them null. Use `classroom.course.code`, `classroom.course.name` and `classroom.section` instead. The sample API explicitly loads the course relation. The old `(code, term)` unique key has been removed.

An active lecturer assignment is a service rule. Each section has its own lecturer, room, enrolments and meetings. Defaults describe its venue for upcoming sessions; session creation snapshots them. Production location thresholds need testing at the venue.

### enrolments

| Field                    | Type / rule                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| classroom_id, student_id | required class/user FKs                                           |
| enrolled_at              | required datetime(3)                                              |
| withdrawn_at             | nullable datetime(3), strictly later than enrolled_at             |
| active_student_id        | read-only generated column; student_id while withdrawn_at is NULL |

Unique `(classroom_id, active_student_id)` permits one current membership per section and multiple historical intervals. It does not prevent a student joining two sections of the same course/term; that policy still needs agreement and service enforcement. The service must reject overlapping historical intervals and validate the student's role/account. Lock the classroom before enrolment changes. Do not backdate edits in v1.

Membership at time t: `enrolled_at <= t AND (withdrawn_at IS NULL OR t < withdrawn_at)`. Snapshot eligibility at the **scheduled start**, even if a worker materialises the session later. Once records exist, membership changes affect future meetings only; current account inactivity still blocks check-in.

### class_meetings — timetable occurrences

| Field                                           | Type / rule                                                  |
| ----------------------------------------------- | ------------------------------------------------------------ |
| classroom_id                                    | class FK                                                     |
| starts_at, late_after, ends_at                  | required UTC datetime(3); starts_at <= late_after < ends_at  |
| state                                           | scheduled / cancelled; default scheduled                     |
| created_by                                      | required user FK; account that configured the occurrence     |
| cancelled_at, cancelled_by, cancellation_reason | nullable; all required, with nonblank reason, when cancelled |

Unique `(classroom_id, starts_at)` prevents duplicate occurrences at the same start; overlapping periods require service validation. A meeting is a **concrete occurrence**, not a recurring weekday rule. Recurring timetable UI, public-holiday generation and room inventory are future work.

“In progress” is derived: noncancelled meeting with `starts_at <= now < ends_at`; upcoming/ended also derive from timestamps. Do not store a second mutable in-progress flag. Class cancellation and rescheduling must update this source of truth. A started meeting or one with a materialised session is immutable except cancellation; reschedule before start, or cancel and create a replacement.

### attendance_sessions — immutable meeting snapshot

| Field                                                     | Type / rule                                          |
| --------------------------------------------------------- | ---------------------------------------------------- |
| meeting_id                                                | unique, required class_meetings FK                   |
| opens_at, late_after, closes_at                           | scheduled meeting times copied at materialisation    |
| state                                                     | open / closed / cancelled; default open              |
| closed_at                                                 | nullable datetime(3); if set, >= closes_at           |
| room_label, latitude, longitude, radius_m, max_accuracy_m | venue snapshot with classroom-equivalent constraints |
| cancelled_at, cancelled_by, cancellation_reason           | cancellation metadata                                |

There is **no opened_by or code_hash**. The class is available through session.meeting.classroom; classroom_id is not duplicated here.

A session can be inserted by a due-meeting worker or an idempotent ensure-session service called by dashboard/class/check-in endpoints. Lock classroom then meeting, confirm it is due/noncancelled/nonarchived, and create the session plus full roster in one transaction. Unique meeting_id prevents duplicate sessions under concurrent requests. Copy scheduled starts_at into opens_at; created_at is the actual materialisation time. Do not give students a later check-in deadline because a worker was delayed.

If materialisation happens after class end, create/finalise the snapshot and absent rows consistently rather than treating the class as live. This still requires the attendance service; the schema alone does not run a scheduler.

### attendance_records

| Field                  | Type / rule                                        |
| ---------------------- | -------------------------------------------------- |
| session_id, student_id | required FKs; unique pair                          |
| status                 | pending / present / late / absent; default pending |
| checked_in_at          | nullable server acceptance datetime(3)             |
| distance_m, accuracy_m | nullable nonnegative decimal(10,2)                 |
| location_validated_at  | nullable server validation datetime(3)             |

Present/Late requires **all four** evidence/time fields; Pending/Absent requires all four to be NULL. The record's existence represents the frozen eligible roster, not successful attendance. Do not store raw student latitude/longitude, continuous tracking, client permission flags, or aggregate percentages.

### auth_sessions — adapter-owned infrastructure

`session_id VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY`, `expires INT UNSIGNED` (Unix seconds), `data MEDIUMTEXT NULL`; expiry index included.

The migration matches the [express-mysql-session schema](https://github.com/chill117/express-mysql-session/blob/master/schema.sql), using table name auth_sessions. Future middleware should use `createDatabaseTable: false` and `schema: { tableName: 'auth_sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } }`. The adapter/middleware are not installed or wired yet; the auth developer owns that next step. No TypeORM entity is exposed for session payloads.

Use maintained express-session middleware and its store, not custom session generation. Store user ID/session version and CSRF state as needed, never passwords or locations. Anonymous pre-login sessions are allowed. Regenerate at login, destroy at logout, enforce expiry on reads and clean up expired rows.

## Indexes and integrity

The migration and EntitySchemas define unique identity fields, outstanding invitations, active membership, course code, course/term/section, class/start, meeting/session and session/student. List/query indexes cover role/status, invitation expiry, teacher/classes, student memberships, due meetings, sessions due for closing, student history and roster status.

Database CHECKs cover identity normalization, account activation, token lifecycle/shape, membership interval ordering, meeting windows/cancellation, coordinates/thresholds, session lifecycle, and attendance evidence completeness. MySQL DDL is the authority for these CHECKs; do not use TypeORM synchronize or schema auto-generation to replace them.

Foreign keys do **not** validate role, authorization, historical membership overlap, classroom schedule overlap, meeting/session time equality, location accuracy against the session, or Present versus Late timing. These are required service rules.

## Transactions for API developers

| Operation                  | Lock/validation protocol                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invite/resend/activate     | Lock user, then invitation; atomically consume/revoke token and change account.                                                                          |
| Enrol/withdraw or schedule | Lock classroom; validate intervals/roles/schedule and insert/update.                                                                                     |
| Ensure due session         | Lock classroom, then meeting; create one snapshot and full eligible roster, or reuse existing.                                                           |
| Check in                   | Ensure session, then lock session/record; use server time **after lock acquisition**; validate current account, frozen eligibility, window and location. |
| Close                      | Lock session; after closes_at convert Pending to Absent and mark Closed atomically.                                                                      |
| Cancel meeting/session     | Lock classroom → meeting → session; update cancellation consistently and retain evidence.                                                                |

Scheduled processing must not rely only on an in-memory timer: APIs must reject check-in at/after closes_at even before a worker persists closure. Worker startup catch-up and read-time finalisation must handle downtime. Return the original successful result for repeated check-ins without changing its timestamp. Use the transaction's manager/repositories for all writes in that transaction.

For accepted check-in: finite coordinates, fresh reading, `accuracy <= max_accuracy_m`, and proposed conservative rule `distance + accuracy <= radius_m`. Validate unrounded distance before storage. Before/on late_after is Present; after late_after and before closes_at is Late. Failed location attempts stay Pending; no manual Present/Late bypass.

Cancelled sessions never count in attendance totals. For completed noncancelled sessions, percentage = (Present + Late) / (Present + Late + Absent) × 100; use N/A when denominator is zero.

## Implementation boundary

Implemented: database connection, eight EntitySchemas, nine application tables plus `schema_migrations` and `typeorm_metadata` bookkeeping tables, reversible initial migration and guarded course/section migration, guarded local seeds, database tests, two development-only sample API routes, and the shared Docker stack. Both bookkeeping tables remain after the initial migration is reverted.

Still required: auth/session/CSRF middleware, request schemas, guards, safe response DTOs, scheduling and due-session services, geolocation checks, roster/closure/cancellation transactions, production feature API endpoints and real-device tests. Enrolment endpoint contracts and write permissions still need agreement; the schema alone does not decide whether students may enrol themselves.

See [database development](database-development.md) for setup and repository usage. Backend API docs are updated for this flow; older root architecture sections describing manual opening or codes are superseded by this schema decision.

## Course/section migration and retained data

The new migration preserves classroom IDs, enrolments, meetings and attendance history. It maps only the known `COS30043-DEMO` / `DEMO` fixture with subject `Interface Design and Development` to course `COS30043`, section `DEMO`, term `DEMO`. Other legacy rows trigger an error before schema changes; arbitrary hyphenated codes are not parsed.

Original classroom display fields remain in the nullable legacy columns, and the backfill preserves classroom audit timestamps. Rollback is permitted only for an empty new model or the unchanged mapped legacy fixture. It refuses when reverting could discard new courses/sections, including fresh seed rows without legacy values. A later cleanup migration can remove these columns after rollback needs are reviewed. See the [checkpoint and upgrade procedure](course-section-migration-plan.md#migration-operation-and-rollback-limits).

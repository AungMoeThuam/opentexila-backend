# OpenTexila database design

**Version 7 · 3 November 2026 · Baseline and JWT refresh sessions.**

The initial, venue-snapshot and `1793664000000-RefreshSessions.ts` migrations create six domain tables, `auth_refresh_sessions` and the preserved `auth_sessions` table. Seven decorated TypeORM entities represent the domain tables and refresh sessions. This is a fresh-database baseline, not an upgrade path for earlier development schemas. Development databases from an older, incompatible baseline must be recreated separately; databases using the current baseline apply subsequent migrations normally.

See the [ER diagram](database-erd.md) and [baseline setup guide](database-refactor-migration.md). `users.role`, `users.status`, `class_sessions.state` and `attendance_records.status` are MySQL ENUMs. JWT authentication and attendance business services are implemented.

## Tables

| Table                | Purpose                                                    | Key / unique rules                     |
| -------------------- | ---------------------------------------------------------- | -------------------------------------- |
| `users`              | Students, lecturers (role `lecturer`) and admins.           | `email` unique                         |
| `courses`            | What is taught (code and name), stored once.               | `code` unique                          |
| `classes`            | One offering of a course: a term, a section and a lecturer. | unique `(course_id, term, section)`    |
| `enrolments`         | Which students belong to which class.                      | primary key `(class_id, student_id)`   |
| `class_sessions`     | One class meeting with start, late and end time (UTC).     | unique `(class_id, starts_at)`         |
| `attendance_records` | One row per student per class session.                     | primary key `(class_session_id, student_id)` |
| `auth_sessions` | Preserved unused cookie-adapter table. | primary key `session_id` |
| `auth_refresh_sessions` | Hashed JWT refresh credentials, expiry and revocation. | primary key `id`; FK `user_id` |
| `announcements` | Class news posted by the class lecturer (migration `1793750400000-Announcements.ts`). | primary key `id`; FKs `class_id`, `author_id` |
| `announcement_likes` | One like for each user and announcement. | primary key `(announcement_id, user_id)`; deleted with the announcement |
| `announcement_comments` | Comments on an announcement. | primary key `id`; FKs `announcement_id` (cascade), `author_id` |

Entity names are `User`, `Course`, `Class`, `Enrolment`, `ClassSession`, `AttendanceRecord`, `RefreshSession`, `Announcement`, `AnnouncementLike` and `AnnouncementComment`. Schemas are in `src/database/entities/`. Columns use **snake_case**.

## Design rules

- **Term** is the academic period, e.g. `2026-S2`. The same course runs every term, so a class is identified by course + term + section.
- **Section** separates multiple groups of one course in the same term (Section A, Section B).
- Foreign keys use `RESTRICT`. Deactivate users instead of deleting them, so attendance history is kept.
- All times are `DATETIME(3)` in UTC. Keep the database session timezone UTC; the driver uses `timezone: 'Z'`.
- `enrolments` and `attendance_records` use composite primary keys, so uniqueness needs no extra index.
- Creating a user does not enrol them in any class.
- Single institution; no tenant ID.

### users

| Field                | Type / rule                                              |
| -------------------- | -------------------------------------------------------- |
| name                 | varchar(150), nonblank                                   |
| email                | varchar(254), lowercase and trimmed, unique              |
| password_hash        | varchar(255), required; excluded from ordinary SELECTs   |
| role                 | ENUM('student','lecturer','admin'), required              |
| status               | ENUM('active','inactive'), default 'active'              |
| must_change_password | boolean, default true                                    |
| session_version      | unsigned integer, default 0                              |
| created_at           | datetime(3), defaults to the database clock              |

Accounts are created by an admin who sets a temporary password; there is no invitation or activation flow. `must_change_password` forces a password change at first login. Increment `session_version` on password reset, password change or deactivation; auth guards compare it on protected requests. The database does not hash passwords or implement authentication.

### courses

| Field | Type / rule                                          |
| ----- | ---------------------------------------------------- |
| code  | unique uppercase trimmed ASCII varchar(30), nonempty |
| name  | varchar(150), nonblank                               |

### classes

| Field                | Type / rule                                   |
| -------------------- | --------------------------------------------- |
| course_id            | required `courses.id` FK                      |
| section              | uppercase trimmed ASCII varchar(30), nonempty |
| term                 | varchar(50); academic period, e.g. `2026-S2`  |
| lecturer_id           | required user FK (the lecturer)               |
| room_label           | varchar(100)                                  |
| latitude / longitude | decimal(9,6), within -90..90 / -180..180      |
| radius_m             | positive decimal(10,2); check-in radius       |

Course code and name exist only in `courses`. Use `class.course.code`, `class.course.name` and `class.section`. A section label can be reused for a different course or term. Lecturer role and active status are service rules.

### enrolments

Composite primary key `(class_id, student_id)`. To withdraw a student, delete the row; attendance records stay because they reference the student, not the enrolment. The service must validate the student's role and active status.

### class_sessions

| Field                          | Type / rule                                                  |
| ------------------------------ | ------------------------------------------------------------ |
| class_id                       | class FK                                                     |
| room_label                     | varchar(100); session venue snapshot                         |
| latitude / longitude           | decimal(9,6), within -90..90 / -180..180                     |
| radius_m                       | positive decimal(10,2); session check-in radius              |
| starts_at, late_after, ends_at | required UTC datetime(3); starts_at <= late_after < ends_at  |
| state                          | ENUM('scheduled','cancelled'), NOT NULL, default 'scheduled' |

Unique `(class_id, starts_at)` prevents duplicate occurrences at the same start; overlapping periods require service validation. A session is a **concrete occurrence**, not a recurring weekday rule. "In progress" is derived: noncancelled with `starts_at <= now < ends_at`; do not store a second flag.

### attendance_records

| Field                          | Type / rule                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| class_session_id, student_id   | composite primary key; both are FKs                                    |
| status                         | ENUM('pending','present','late','absent'), NOT NULL, default 'pending' |
| checked_in_at                  | nullable server acceptance datetime(3)                                 |
| distance_m                     | nullable nonnegative decimal(10,2)                                     |

Present/Late requires both `checked_in_at` and `distance_m`; Pending/Absent requires both to be NULL. Do not store raw student latitude/longitude, continuous tracking or aggregate percentages.

When a session is created, insert one `pending` record per enrolled student. When the session ends, a service marks remaining `pending` records `absent`. Attendance percentage is computed, not stored: `(present + late) / non-cancelled sessions`.

### auth_sessions — adapter-owned infrastructure

`session_id VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY`, `expires INT UNSIGNED` (Unix seconds), `data MEDIUMTEXT NULL`; expiry index included.

This baseline table is preserved for compatibility and is not used by JWT authentication or the in-memory development adapter. No TypeORM entity exposes its payloads.

### auth_refresh_sessions — JWT sessions

The `RefreshSession` entity stores `id CHAR(36)` (session UUID), `user_id` (restricted user foreign key), `token_hash CHAR(64)` (SHA-256, excluded from normal selects), `expires_at DATETIME(3)` and nullable `revoked_at DATETIME(3)`. User and expiry indexes support lookups. The latest refresh credential is hashed; raw access/refresh tokens are not stored.

Refresh tokens are signed with a separate audience, and rotation replaces their stored hash within a transaction. Reuse revokes the session; password changes revoke every session for the user. Session rows remain until a future cleanup task removes expired records. See [authentication](api/auth.md) for the active contract.

## Indexes and checks

Unique keys: `users.email`, `courses.code`, `(course_id, term, section)` on classes, `(class_id, starts_at)` on class sessions. Additional indexes cover role/status, lecturer classes, student enrolments, due class sessions, student attendance history and session rosters. Index definitions match the decorated TypeORM entities.

Checks cover identity normalization, nonempty password hash, class-session windows, coordinates, radius and attendance evidence. ENUMs constrain vocabulary, not transitions. Keep strict SQL mode. Do not use TypeORM synchronize to replace explicit migrations.

Foreign keys do not enforce role, access, overlapping schedules or geolocation acceptance. These remain required service rules.

## Check-in rule

Check-in is allowed for a noncancelled class session with `starts_at <= now < ends_at`, for an enrolled student with an active account. Accept only finite coordinates and a fresh reading, with proposed rule `distance <= radius_m`. On/before `late_after` is Present; afterwards and before `ends_at` is Late. Failed location attempts stay Pending. Cancelled sessions are excluded from attendance totals.

## Implementation boundary

Implemented: three migrations, seven decorated TypeORM entities, eight application tables, shared connection, guarded demo seeds, attendance APIs, development sign-in, sample APIs and Docker setup. TypeORM also maintains `schema_migrations`, which remains after initial-migration rollback.

Still required: admin account provisioning/reset, enrolment APIs, session creation/finalisation/cancellation services and real-device location testing. Attendance reads and check-in, session/account guards and development CSRF checks are implemented.

Sample URLs remain `/api/v1/examples/classrooms` and `/api/v1/examples/classrooms/:id`, backed by `ClassSchema`. `SEED_MEETING_START` remains supported; seed output includes `class_id` and `class_session_ids`.

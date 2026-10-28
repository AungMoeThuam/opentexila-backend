# OpenTexila database ER diagram

Based on the [initial migration](../database/migrations/1793059200000-InitialSchema.js), [course/section migration](../database/migrations/1793145600000-CourseSections.js), and [EntitySchemas](../src/database/entities/). This shows the schema after both migrations: nine application tables, including the adapter-owned `auth_sessions` table. TypeORM's `schema_migrations` and `typeorm_metadata` bookkeeping tables are omitted.

View this Markdown on GitHub or in a Mermaid-capable preview. The diagram describes the implemented database structure; authentication and attendance business services are still planned. See [database design](database-design.md) for validation rules and [API documentation](api/README.md) for implementation status.

## Main relationships

This overview omits audit references (`created_by` and `cancelled_by`) and the separate login session store. The detailed diagram below includes them.

```mermaid
erDiagram
    users ||..o{ accountInvitations : receives
    courses ||..o{ classrooms : offers
    users ||..o{ classrooms : teaches
    users ||..o{ enrolments : joins
    classrooms ||..o{ enrolments : has
    classrooms ||..o{ classMeetings : schedules
    classMeetings ||..o| attendanceSessions : materialises
    attendanceSessions ||..o{ attendanceRecords : contains
    users ||..o{ attendanceRecords : has

    users["users"]
    accountInvitations["account_invitations"]
    courses["courses"]
    classrooms["classrooms"]
    enrolments["enrolments"]
    classMeetings["class_meetings"]
    attendanceSessions["attendance_sessions"]
    attendanceRecords["attendance_records"]
```

A course stores the shared code/name. A classroom is one section of that course in one academic term, with its own lecturer and venue. Each scheduled meeting can have zero or one attendance session. Each attendance record belongs to one session and one student; a Pending record represents roster eligibility, not a successful check-in.

## Tables, columns and foreign keys

`PK` = primary key; `FK` = foreign key; `UK` = a single-column unique key. Composite unique keys are listed separately below. A field is required unless its comment says nullable. All `int` fields shown are unsigned; the eight domain-table `id` fields auto-increment. All `datetime` fields are `DATETIME(3)` in UTC. Decimal precision and string lengths are shown in comments.

Crow's-foot markers: `||` means exactly one, `o|`/`|o` means zero or one, and `o{` means zero or many. Dotted lines indicate non-identifying relationships: child tables have their own primary keys, rather than using parent IDs as their primary keys. Optionality is shown by the endpoint markers.

```mermaid
erDiagram
    users ||..o{ accountInvitations : "user_id"
    users ||..o{ accountInvitations : "created_by"
    courses ||..o{ classrooms : "course_id"
    users ||..o{ classrooms : "teacher_id"
    users ||..o{ enrolments : "student_id"
    classrooms ||..o{ enrolments : "classroom_id"
    classrooms ||..o{ classMeetings : "classroom_id"
    users ||..o{ classMeetings : "created_by"
    users |o..o{ classMeetings : "cancelled_by"
    classMeetings ||..o| attendanceSessions : "meeting_id"
    users |o..o{ attendanceSessions : "cancelled_by"
    attendanceSessions ||..o{ attendanceRecords : "session_id"
    users ||..o{ attendanceRecords : "student_id"

    users["users"] {
        int id PK
        varchar name "150"
        varchar email UK "254; lowercase and trimmed"
        varchar institution_member_id UK "50; uppercase and trimmed"
        varchar password_hash "255; nullable; hidden from default selects"
        varchar role "20; student, teacher, admin"
        varchar status "20; invited, active, inactive"
        datetime activated_at "nullable"
        int session_version "default 0"
        datetime created_at
        datetime updated_at
    }

    accountInvitations["account_invitations"] {
        int id PK
        int user_id FK
        char token_hash UK "64; SHA-256 hex; hidden from default selects"
        datetime expires_at
        datetime used_at "nullable"
        datetime revoked_at "nullable"
        int created_by FK
        int outstanding_user_id UK "generated; nullable; not a foreign key"
        datetime created_at
        datetime updated_at
    }

    courses["courses"] {
        int id PK
        varchar code UK "30; uppercase and trimmed"
        varchar name "150; nonblank"
        datetime created_at
        datetime updated_at
    }

    classrooms["classrooms"] {
        int id PK
        int course_id FK
        varchar section "30; uppercase and trimmed"
        varchar term "50; unique with course_id and section"
        varchar code "30; nullable legacy; hidden from default selects"
        varchar name "150; nullable legacy; hidden from default selects"
        varchar subject "150; nullable legacy; hidden from default selects"
        int teacher_id FK
        varchar room_label "100"
        decimal latitude "9,6"
        decimal longitude "9,6"
        decimal radius_m "10,2"
        decimal max_accuracy_m "10,2"
        datetime archived_at "nullable"
        datetime created_at
        datetime updated_at
    }

    enrolments["enrolments"] {
        int id PK
        int classroom_id FK
        int student_id FK
        datetime enrolled_at
        datetime withdrawn_at "nullable"
        int active_student_id "generated; nullable; unique with classroom_id"
        datetime created_at
        datetime updated_at
    }

    classMeetings["class_meetings"] {
        int id PK
        int classroom_id FK
        datetime starts_at "unique with classroom_id"
        datetime late_after
        datetime ends_at
        varchar state "20; scheduled, cancelled"
        int created_by FK
        datetime cancelled_at "nullable"
        int cancelled_by FK "nullable"
        varchar cancellation_reason "500; nullable"
        datetime created_at
        datetime updated_at
    }

    attendanceSessions["attendance_sessions"] {
        int id PK
        int meeting_id FK, UK
        datetime opens_at
        datetime late_after
        datetime closes_at
        datetime closed_at "nullable"
        varchar state "20; open, closed, cancelled"
        varchar room_label "100; venue snapshot"
        decimal latitude "9,6; venue snapshot"
        decimal longitude "9,6; venue snapshot"
        decimal radius_m "10,2; venue snapshot"
        decimal max_accuracy_m "10,2; venue snapshot"
        datetime cancelled_at "nullable"
        int cancelled_by FK "nullable"
        varchar cancellation_reason "500; nullable"
        datetime created_at
        datetime updated_at
    }

    attendanceRecords["attendance_records"] {
        int id PK
        int session_id FK
        int student_id FK
        varchar status "20; pending, present, late, absent"
        datetime checked_in_at "nullable"
        decimal distance_m "10,2; nullable"
        decimal accuracy_m "10,2; nullable"
        datetime location_validated_at "nullable"
        datetime created_at
        datetime updated_at
    }

    authSessions["auth_sessions"] {
        varchar session_id PK "128"
        int expires "Unix seconds; indexed"
        mediumtext data "nullable; serialized session payload"
    }
```

## Constraints that the relationship lines do not show

| Table                 | Unique constraint                   | Meaning                                                                                                                                       |
| --------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`               | `email`; `institution_member_id`    | Each is independently unique.                                                                                                                 |
| `account_invitations` | `token_hash`; `outstanding_user_id` | Token digests are unique; at most one unused, unrevoked invitation per user. Expired unused invitations still occupy that slot until revoked. |
| `courses`             | `code`                              | One shared course identity across terms and sections.                                                                                         |
| `classrooms`          | `(course_id, term, section)`        | One section offering per course and term; the legacy `(code, term)` unique key is removed.                                                    |
| `enrolments`          | `(classroom_id, active_student_id)` | One current membership per student/class, with multiple withdrawn historical intervals allowed.                                               |
| `class_meetings`      | `(classroom_id, starts_at)`         | No duplicate start time in one class; overlap checks require service logic.                                                                   |
| `attendance_sessions` | `meeting_id`                        | At most one attendance session for each meeting.                                                                                              |
| `attendance_records`  | `(session_id, student_id)`          | At most one roster/attendance record per student per session.                                                                                 |

- `outstanding_user_id` is generated from `user_id` when both `used_at` and `revoked_at` are null. `active_student_id` is generated from `student_id` while `withdrawn_at` is null. Neither generated field is an additional foreign key.
- All foreign keys use `ON DELETE RESTRICT` and `ON UPDATE RESTRICT`. Role requirements such as student membership, lecturer assignment and administrator-only actions are service rules, not guarantees made by the FK.
- `auth_sessions` has no database FK to `users`. Its serialized payload may hold a user ID when session middleware is implemented; anonymous sessions are also possible. No relationship line is drawn because that FK does not exist.
- Classroom `code`, `name` and `subject` are retained nullable legacy data for guarded rollback. New code reads the course relation and separate section; these fields are not maintained as duplicate current course information. See the [migration limits](course-section-migration-plan.md#migration-operation-and-rollback-limits).
- A student can have enrolments in multiple sections of one course; preventing that requires an agreed service rule, not just the classroom unique key.
- `attendance_sessions` stores a meeting and venue snapshot. It has no duplicate `classroom_id`, session code or `opened_by`. Reach its class through `meeting_id`.
- Present/Late records require all four evidence fields: `checked_in_at`, `distance_m`, `accuracy_m`, and `location_validated_at`. Pending/Absent records require them all to be null. Raw student coordinates are not stored.

Update this diagram alongside future migrations and EntitySchema changes. The migration remains the authority for column definitions, checks and indexes.

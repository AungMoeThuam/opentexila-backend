# OpenTexila database ER diagram

**Version 6 · 29 October 2026 · Minimal consolidated baseline.** This diagram matches the EntitySchemas and single `1793059200000-InitialSchema.js` migration. See [database design](database-design.md) and the [baseline setup guide](database-refactor-migration.md).

Seven application tables are shown; TypeORM's `schema_migrations` table is omitted. View in a Mermaid-capable preview. Older generated PNGs, if present, are obsolete; use this Markdown diagram.

```mermaid
erDiagram
    courses ||--o{ classes : "course_id"
    users ||--o{ classes : "teacher_id"
    users ||--o{ enrolments : "student_id"
    classes ||--o{ enrolments : "class_id"
    classes ||--o{ class_sessions : "class_id"
    class_sessions ||--o{ attendance_records : "class_session_id"
    users ||--o{ attendance_records : "student_id"

    users {
        int id PK
        varchar name "150"
        varchar email UK "254; lowercase and trimmed"
        varchar password_hash "255; hidden from default selects"
        enum role "student, teacher, admin"
        enum status "active, inactive; default active"
        bool must_change_password "default true"
        int session_version "default 0"
        datetime created_at
    }
    courses {
        int id PK
        varchar code UK "30; uppercase and trimmed"
        varchar name "150"
    }
    classes {
        int id PK
        int course_id FK
        varchar section "30; uppercase and trimmed"
        varchar term "50; unique with course_id and section"
        int teacher_id FK
        varchar room_label "100"
        decimal latitude "9,6"
        decimal longitude "9,6"
        decimal radius_m "10,2"
    }
    enrolments {
        int class_id PK, FK
        int student_id PK, FK
    }
    class_sessions {
        int id PK
        int class_id FK
        datetime starts_at "UTC; unique with class_id"
        datetime late_after "UTC"
        datetime ends_at "UTC"
        enum state "scheduled, cancelled; default scheduled"
    }
    attendance_records {
        int class_session_id PK, FK
        int student_id PK, FK
        enum status "pending, present, late, absent; default pending"
        datetime checked_in_at "nullable"
        decimal distance_m "10,2; nullable"
    }
    auth_sessions {
        varchar session_id PK "128"
        int expires "Unix seconds; indexed"
        mediumtext data "nullable; serialized session payload"
    }
```

`PK` = primary key; `FK` = foreign key; `UK` = unique key. All `int` fields are unsigned; `id` fields auto-increment. All `datetime` fields are `DATETIME(3)` in UTC. `auth_sessions` is infrastructure owned by the session middleware and has no foreign keys.

## Constraints that the relationship lines do not show

| Table                | Key / unique constraint                | Meaning                                                              |
| -------------------- | -------------------------------------- | -------------------------------------------------------------------- |
| `users`              | `email`                                | Unique, lowercase and trimmed.                                       |
| `courses`            | `code`                                 | One shared course identity across terms and sections.                |
| `classes`            | `(course_id, term, section)`           | One class per course, term and section.                              |
| `enrolments`         | primary key `(class_id, student_id)`   | A student is enrolled in a class at most once.                       |
| `class_sessions`     | `(class_id, starts_at)`                | No duplicate start time in one class; overlap checks are a service rule. |
| `attendance_records` | primary key `(class_session_id, student_id)` | At most one record per student per class session.              |

- All foreign keys use `ON DELETE RESTRICT` and `ON UPDATE RESTRICT`. Role requirements such as student membership and lecturer assignment are service rules, not guarantees made by the FK.
- `users.role`, `users.status`, `class_sessions.state` and `attendance_records.status` are NOT NULL MySQL ENUMs with the values and defaults shown.
- Present/Late records require both `checked_in_at` and `distance_m`. Pending/Absent records require both to be null. Raw student coordinates are not stored.
- Cancelled class sessions are excluded from attendance totals.

The initial migration directly creates this design. Existing databases with the previous baseline need separate recreation; migration history alone cannot distinguish old and rewritten contents with the same migration name.

# Course and section migration checkpoints

## Checkpoint 1 — inspection complete

Inspected the existing local development database on 28 October 2026 using read-only queries. This section records the pre-migration inspection. Checkpoint 2 below describes the implementation now present in the checkout; the local application database has not been migrated.

Applied migration: `InitialSchema1793059200000`.

The database currently contains one classroom, two enrolments, two scheduled meetings, one attendance session and two attendance records. The classroom is the known fictional seed fixture:

| Existing field | Value                              |
| -------------- | ---------------------------------- |
| `id`           | `1`                                |
| `code`         | `COS30043-DEMO`                    |
| `subject`      | `Interface Design and Development` |
| `term`         | `DEMO`                             |
| `archived_at`  | null                               |

## Agreed demo mapping

| Destination            | Proposed value                                                        |
| ---------------------- | --------------------------------------------------------------------- |
| `courses.code`         | `COS30043`                                                            |
| `courses.name`         | `Interface Design and Development`                                    |
| `classrooms.id`        | Preserve `1`                                                          |
| `classrooms.course_id` | Reference the newly created course; do not hard-code its generated ID |
| `classrooms.section`   | `DEMO`                                                                |
| `classrooms.term`      | Preserve `DEMO`                                                       |

`DEMO` is proposed as an explicit fictional section label, not an inferred real Section A or B. Real offerings can later use section labels such as `A` and `B` and terms such as `2026-S2`.

Preserve lecturer assignment, venue/location settings, archived state and audit timestamps. Existing enrolments and meetings keep their classroom IDs, and attendance history keeps its existing links. Before dropping the old `code`, `name` and `subject` columns, retain the legacy values in a documented rollback/backfill strategy; the existing display name must not be silently lost during migration.

This mapping is specific to the inspected seed fixture. Other developers may have additional classroom rows. Do not split arbitrary codes on hyphens or assume all rows are demo data. The migration must detect unsupported or conflicting mappings before changing the schema, and require an explicit mapping for those rows.

## Checkpoint 2 — implemented and tested

Implemented in the checkout, but **not applied to the local application database**:

- New `CourseSchema` and `courses` table with unique uppercase/trimmed code and nonblank name.
- Required `classrooms.course_id` and uppercase/trimmed `section`, unique together with `term`.
- New migration `1793145600000-CourseSections.js`; initial migration unchanged.
- Known demo mapping above, preserving classroom IDs, related rows and classroom audit timestamps. Unknown legacy classes cause a preflight error before schema changes.
- Legacy classroom `code`, `name` and `subject` remain nullable and excluded from default entity selects. They preserve original data for guarded rollback; new seeds and the API use course/section instead. These legacy columns are not the current source of truth.
- Seed now creates/reuses course `COS30043` and section `DEMO` without overwriting an existing section's lecturer, room or attendance records.
- Sample API returns classroom `id`, `section`, `term`, `room_label` and nested `course: { id, code, name }`; its API reference is updated.

Verification completed:

- `npm test`: 14 tests passed, including the HTTP response shape and nested field allowlist.
- `npm run test:db`: 10 tests passed in disposable MySQL, including fresh migration, legacy upgrade and guarded rollback, unchanged IDs/history/audit fields, unknown-mapping rejection, repeatable seeds, multiple sections and terms, course/section constraints and real joined service queries.
- The local database and its existing fixture remain untouched. This checkpoint is included in the course/section implementation commit.

### Migration operation and rollback limits

Stop application writers before applying the migration. Back up any data you need to retain. The Docker stack automatically applies pending migrations on its next startup; for a controlled first upgrade, stop its API/frontend services, then build/run the migration service before restarting applications. A host migration uses `npm run db:up` followed by `npm run db:migrate` with the host API stopped.

MySQL DDL implicitly commits, so a runtime failure after preflight can leave partial schema changes. Inspect/recover rather than blindly retrying or reverting. Unknown-data rejection happens before any DDL; no arbitrary section splitting is attempted.

The down migration restores the original schema only for an empty new model or the unchanged mapped legacy fixture. It refuses before DDL if courses or sections were created or changed in ways the old model cannot represent safely, including fresh seed rows with no legacy values. Use a forward migration or backup restoration in that case. It does not silently discard new data.

## Checkpoint 3 — documentation and ER refresh complete

Updated README, database design, ER diagram, database development guide, team guide, Docker guide and API overview for eight EntitySchemas and nine application tables. The ER diagram includes all current columns, the new course FK, section uniqueness and nullable legacy fields. Removed the pre-course snapshot notices.

The sample API reference already documents the new nested course payload. Application code and schema were not changed in this documentation checkpoint. The local application database is still not migrated; these checkpoints are included in the course/section implementation commit.

Documentation verification: the ER diagram contains nine application tables, 92 columns and 13 foreign-key relationships. Domain column names, types, nullability and primary keys match the TypeORM metadata; the adapter session table matches its migration. All 64 local links/anchors and 15 referenced npm scripts across 11 Markdown documents resolve. Formatting and diff checks passed; application tests were not repeated for documentation-only edits.

Removing the nullable legacy columns is a separate later cleanup migration once rollback needs and all consumers are reviewed; it is not required to use separate course and section fields now.

## Scope boundaries

- Course/section administration UI and CRUD APIs are separate feature work.
- Student self-enrolment and preventing membership in multiple sections of the same course remain policy decisions; the new unique classroom key does not enforce them.
- The ER-diagram work has been extended to include the course model and is included in the implementation commit.
- Next work: perform a controlled application-database upgrade when requested. Removing legacy columns remains a later optional cleanup.

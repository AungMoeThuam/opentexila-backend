# Development database baseline

The schema is consolidated into one migration: `1793059200000-InitialSchema.ts`. It directly creates `users`, `courses`, `classes`, `enrolments`, `class_sessions`, `attendance_records` and `auth_sessions`.

The later `1793491200000-SessionVenueSnapshot.ts` migration adds and backfills session venue snapshots.

The previous course/section and attendance-refactor migrations have been removed. There is no legacy data mapping, table renaming step or historical column retention. Section `code`, `name` and `subject` no longer exist; course identity lives in `courses`.

## Fresh database setup

For a fresh, empty development database, use the [Docker guide](DOCKER.md) or [host workflow](../README.md#start-locally-without-application-containers). Run migrations before starting the matching API or seeding. `npm run db:migrate` applies the baseline; `npm run db:seed` adds fictional data when the seed environment requirements are met. The shared stack runs its migration container before starting the API.

## Existing development databases

This rewritten baseline is **not an upgrade migration**. Databases created from an older, incompatible baseline must be recreated separately before using this checkout. Databases created from the current baseline can apply subsequent migrations normally. The migration name is unchanged, so `db:status` may report it applied even when the actual tables still follow the old design. Neither rebuilding the application nor rerunning `db:migrate` fixes that mismatch.

Stop application writers and retain any data you need before deliberately recreating the development database and its migration history. Do not delete only migration-history rows or run the rewritten down migration against an old schema. No reset commands are performed by this repository change; local database recreation is a separate action.

The shared stack preserves its database volume. Running `stack:up` is not a database reset and cannot convert an existing old baseline. See [Docker setup](DOCKER.md).

## Rollback and future changes

`npm run db:revert` reverts the most recently applied migration. Reverting the venue-snapshot migration removes its session venue columns and constraints; reverting the initial baseline drops all seven application tables and their data in dependency order. TypeORM's `schema_migrations` table remains. Use this only on a disposable database. MySQL DDL implicitly commits, so a partial failure requires inspection/recovery rather than assuming transactional rollback.

This consolidation is an agreed development reset. For subsequent shared schema changes, add a new migration with matching decorated entity changes instead of silently changing a baseline that teammates already use.

## Verification and compatibility

The baseline was verified with `npm test` and `npm run test:db` on disposable MySQL 8.4. Current tooling verification is tracked in [the batch checklist](ts-tooling-plan.md). Tests cover fresh installation, migration idempotency, empty and populated rollback/reapply, repeatable seeds, schema/metadata alignment, ENUM values and defaults, foreign keys, unique constraints, CHECKs and provider shutdown. Database tests create and remove only their own disposable MySQL container; they do not read `.env` or reset the application database.

The development sample URL `/api/v1/examples/classrooms` remains backed by ClassSchema. `SEED_MEETING_START` remains the fixture setting; seed output uses `class_id` and `class_session_ids`. Proposed API/browser paths are separate from table names; see [attendance resource mapping](api/attendance.md#resource-names-and-compatibility).

Use the [database design](database-design.md) and [Markdown ERD](database-erd.md) for current schema details. Attendance services and development sign-in are implemented. Production authentication and enrolment APIs are still pending.

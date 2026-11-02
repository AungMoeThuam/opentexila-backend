# Building APIs on the shared database

For a working controller/service/module example, start with the [sample classroom API](api/examples.md) in `src/examples/`. It includes HTTP tests and curl commands.

For startup and migrations, use the [shared Docker guide](DOCKER.md). The [README host workflow](../README.md#start-locally-without-application-containers) remains available.

## Use the existing connection

Import `DATABASE` from `src/database/database.constants.ts`. AppModule imports the global DatabaseModule, which exposes an initialized TypeORM DataSource and destroys it at Nest shutdown. Do not open one connection/pool per feature or request.

Use typed repositories and constructor parameter injection. This example belongs in `src/users/users.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { User } from '../database/entities';

type UserProfile = Pick<User, 'id' | 'name' | 'email' | 'role' | 'status'>;

@Injectable()
export class UsersService {
  private readonly users: Repository<User>;

  constructor(@Inject(DATABASE) database: DataSource) {
    this.users = database.getRepository(User);
  }

  async findProfile(id: number): Promise<UserProfile | null> {
    const user = await this.users.findOne({
      where: { id },
      select: { id: true, name: true, email: true, role: true, status: true },
    });
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    };
  }
}
```

Register the service in its feature module. The six decorated entity classes are exported by `src/database/entities/index.ts`. Pass an entity class to `getRepository(User)` so TypeORM infers its type. Existing `UserSchema` and similar exports are compatibility aliases for those classes, not `EntitySchema` objects. Application imports use extensionless paths; scripts and tests import compiled JavaScript from `dist/` where needed.

Passwords/token hashes default to `select: false`. The login service must explicitly addSelect the password hash for verification, then return an allowlisted profile. Never return raw entities or SELECT * results directly as HTTP responses.

```ts
const user = await database
  .getRepository(User)
  .createQueryBuilder('user')
  .addSelect('user.password_hash')
  .where('user.email = :email', { email: email.trim().toLowerCase() })
  .getOne();
// Verify user.password_hash with argon2.verify; enforce active status separately.
```

Argon2 is installed for demo passwords and available to the auth implementation. The seed uses Argon2id with memoryCost 19456 KiB, timeCost 2, parallelism 1; production password policy and rate limiting still need implementation.

## Course and section queries

Use the `Course` entity and its typed repository for shared course `code` and `name`. Create a `Class` with `course_id`, `section`, `term`, lecturer and venue fields. `section` must be nonempty, uppercase and trimmed; `(course_id, term, section)` is unique. Course code and name live only in `courses`; class rows have no display columns of their own.

Explicitly load the `course` relation when its details are needed. See the sample service's selected fields and response mapper: its API returns `course: { id, code, name }` alongside `section`, `term` and `room_label`. Keep enrolments and class sessions linked to `class_id` so they identify the correct section and term.

Use the [baseline setup guide](database-refactor-migration.md) before running this checkout against an existing development database: the single initial migration requires a fresh schema. Seeds return `class_id` and `class_session_ids`; `SEED_MEETING_START` remains supported.

## Transactions

Import `Class` and `ClassSession` from the shared entities. Within a service with a `DataSource` and numeric `classId` / `classSessionId` arguments:

```ts
await database.transaction(async (manager) => {
  const classRow = await manager.getRepository(Class).findOne({
    where: { id: classId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!classRow) throw new Error('Class not found');
  const classSession = await manager.getRepository(ClassSession).findOne({
    where: { id: classSessionId, class_id: classId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!classSession) throw new Error('Class session not found');
  // Validate authorization/state and use ONLY manager repositories for this transaction.
  // The class is locked before the class session.
});
```

Use a consistent lock order and bounded deadlock retry. Unique constraints are the final concurrency guard; handle duplicate-key conflicts deliberately. Never use the global repository for writes inside a transaction callback.

Dates are JavaScript Date objects representing UTC. Accept explicit timezone-bearing inputs, convert to UTC, and render in institution time on the frontend. Location DECIMAL fields are **strings** on reads; convert using Number and validate finite values when calculating distance. Do not enable decimalNumbers globally or trust client distance/attendance status.

## Team workflow

- Auth: User and adapter-owned auth_sessions.
- Attendance: ClassSession and AttendanceRecord.
- Supporting data: Course, Class (one section/term) and Enrolment; seeds unblock early API work.
- Each member works in their feature module, imports the shared entity classes and proposes database changes in a separate reviewed migration.
- Do not edit an already-shared/applied migration. Add a new timestamped TypeScript migration under `database/migrations/`, implementing `MigrationInterface` with typed `QueryRunner` arguments. Use explicit SQL, as in `1793491200000-SessionVenueSnapshot.ts`, and update the related decorated entity and docs in the same PR. Keep migrations compatible with Node type stripping: use `import type` for types and avoid decorators, enums and constructor parameter properties.
- Use explicit SQL for MySQL CHECKs and generated-column uniqueness. Do not rely on schema generation to preserve these constraints.
- After pulling subsequent incremental migrations on a compatible baseline, run `npm run stack:up` to build and run the migration container, or start MySQL and run `npm run db:migrate` in the host workflow. Keep synchronize:false and migrationsRun:false in every environment; migrations run outside Nest startup.
- Initial rollback deletes tables. Use db:revert only on a disposable database, never to “fix” a teammate's data. Back up important data before schema changes.
- MySQL DDL implicitly commits. A partially failed migration needs inspection/recovery; it cannot be rolled back as a normal multi-statement transaction. Fix only unapplied local work or add a repair migration; do not blindly drop tables.
- The database user needs DDL permissions for migrations and DML for runtime locally. Separate migration/runtime permissions before production deployment.

## Local verification

Run on the host after `npm ci` (Git and Docker are needed for the corresponding tests):

```sh
npm run typecheck     # pretypecheck builds first, including on a fresh checkout
npm test
npm run format:check
npm run test:db
```

The integration test creates a uniquely named MySQL 8.4 container with random credentials and a random localhost port. It does not load .env. It verifies migrate/revert/reapply, repeatable seed inserts, hidden password fields, password verification, foreign keys, uniqueness, CHECK constraints, ENUM definitions/rejection, empty/populated rollback and reapplication, UTC date round-trip, and Nest provider/shutdown. Only its own container is removed. A force-killed test may leave a container with prefix opentexila-schema-test-; inspect before removing it manually.

The database suite also exercises attendance services against real MySQL, including locking and check-in replay. `npm test` covers DTO validation, guards, development cookie authentication and HTTP routes with test fixtures. Continue adding endpoint and business-rule coverage as features are implemented.

## Configuration

| Variable                        | Purpose                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------- |
| DB_HOST / DB_PORT               | Host workflow database address; default 127.0.0.1:3306                           |
| DB_NAME / DB_USER / DB_PASSWORD | Application database credentials                                                 |
| DB_ROOT_PASSWORD                | Docker initialization only; never used by the API                                |
| INSTITUTION_TIMEZONE            | Display/schedule input convention, default Asia/Kuala_Lumpur in example          |
| SEED_PASSWORD                   | Local demo-only initial password; not printed; existing hashes retained on rerun |
| SEED_MEETING_START              | Optional fixture start as UTC ISO timestamp ending Z                             |

The shared stack fixes the API container database address to `db:3306`; backend `.env` `DB_PORT` controls only the published host port in that workflow. See [Docker configuration](DOCKER.md#configuration) for `BACKEND_PORT`, frontend settings and port overrides. `INSTITUTION_TIMEZONE` is a convention/configuration value; schedule conversion is not implemented yet.

Do not commit .env. Changing MYSQL_PASSWORD environment variables does not change credentials inside an existing Docker volume; use the existing credentials or deliberately administer that database. Never remove a volume to fix authentication without checking its data.

Reference APIs: [MySQL driver](https://typeorm.io/docs/drivers/mysql/), [session-store schema](https://github.com/chill117/express-mysql-session/blob/master/schema.sql). Installed TypeORM 0.3 source and lockfile determine runtime behavior; website examples may target newer versions.

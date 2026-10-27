# Building APIs on the shared database

For a working controller/service/module example, start with the [sample classroom API](api/examples.md) in `src/examples/`. It includes HTTP tests and curl commands.

## Use the existing connection

Import `DATABASE` from `src/database/database.constants.js`. AppModule imports the global DatabaseModule, which exposes an initialized TypeORM DataSource and destroys it at Nest shutdown. Do not open one connection/pool per feature or request.

Plain JavaScript does not infer constructor dependency types. Example feature service:

```js
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../database/database.constants';
import { UserSchema } from '../database/entities';

@Injectable()
export class UsersService {
  constructor(database) {
    this.database = database;
    this.users = database.getRepository(UserSchema);
  }

  async findProfile(id) {
    return this.users.findOne({
      where: { id },
      select: { id: true, name: true, email: true, role: true, status: true },
    });
  }
}

// Explicit parameter injection for Babel/JavaScript.
Inject(DATABASE)(UsersService, undefined, 0);
```

Register the service in its feature module. Imports here are examples for a file in src/users/. All seven schema objects are exported by `src/database/entities/index.js`. String entity names also work, e.g. `getRepository('ClassMeeting')`.

Passwords/token hashes default to `select: false`. The login service must explicitly addSelect the password hash for verification, then return an allowlisted profile. Never return raw entities or SELECT * results directly as HTTP responses.

```js
const user = await database
  .getRepository('User')
  .createQueryBuilder('user')
  .addSelect('user.password_hash')
  .where('user.email = :email', { email: email.trim().toLowerCase() })
  .getOne();
// Verify user.password_hash with argon2.verify; enforce active status separately.
```

Argon2 is installed for demo passwords and available to the auth implementation. The seed uses Argon2id with memoryCost 19456 KiB, timeCost 2, parallelism 1; production password policy and rate limiting still need implementation.

## Transactions

```js
await database.transaction(async (manager) => {
  const meeting = await manager.getRepository('ClassMeeting').findOne({
    where: { id: meetingId },
    lock: { mode: 'pessimistic_write' },
  });
  // Validate authorization/state and use ONLY manager repositories for this transaction.
  // For session creation, first acquire the classroom lock as documented in database-design.md.
});
```

Use a consistent lock order and bounded deadlock retry. Unique constraints are the final concurrency guard; handle duplicate-key conflicts deliberately. Never use the global repository for writes inside a transaction callback.

Dates are JavaScript Date objects representing UTC. Accept explicit timezone-bearing inputs, convert to UTC, and render in institution time on the frontend. Location DECIMAL fields are **strings** on reads; convert using Number and validate finite values when calculating distance. Do not enable decimalNumbers globally or trust client distance/attendance status.

## Team workflow

- Auth: User, AccountInvitation and adapter-owned auth_sessions.
- Attendance: ClassMeeting, AttendanceSession and AttendanceRecord.
- Supporting data: Classroom and Enrolment; seeds unblock early API work.
- Each member works in their feature module, imports the shared schemas and proposes database changes in a separate reviewed migration.
- Do not edit an already-shared/applied migration. Add a new timestamped CommonJS JavaScript migration under database/migrations; update the related EntitySchema and docs in the same PR.
- Use explicit SQL for MySQL CHECKs and generated-column uniqueness. Do not rely on schema generation to preserve these constraints.
- Run migrations after pulling teammates' database changes. Keep synchronize:false and migrationsRun:false in every environment.
- Initial rollback deletes tables. Use db:revert only on a disposable database, never to “fix” a teammate's data. Back up important data before schema changes.
- MySQL DDL implicitly commits. A partially failed migration needs inspection/recovery; it cannot be rolled back as a normal multi-statement transaction. Fix only unapplied local work or add a repair migration; do not blindly drop tables.
- The database user needs DDL permissions for migrations and DML for runtime locally. Separate migration/runtime permissions before production deployment.

## Local verification

```sh
npm run build
npm test
npm run format:check
npm run test:db
```

The integration test creates a uniquely named MySQL 8.4 container with random credentials and a random localhost port. It does not load .env. It verifies migrate/revert/reapply, repeatable seed inserts, hidden password fields, password verification, foreign keys, uniqueness, CHECK constraints, UTC date round-trip, and Nest provider/shutdown. Only its own container is removed. A force-killed test may leave a container with prefix opentexila-schema-test-; inspect before removing it manually.

These are database-foundation tests, not authentication or attendance-service tests. Add endpoint/business-rule coverage as each feature is implemented.

## Configuration

| Variable                        | Purpose                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------- |
| DB_HOST / DB_PORT               | Database address; local default 127.0.0.1:3306                                   |
| DB_NAME / DB_USER / DB_PASSWORD | Application database credentials                                                 |
| DB_ROOT_PASSWORD                | Docker initialization only; never used by the API                                |
| INSTITUTION_TIMEZONE            | Display/schedule input convention, default Asia/Kuala_Lumpur in example          |
| SEED_PASSWORD                   | Local demo-only initial password; not printed; existing hashes retained on rerun |
| SEED_MEETING_START              | Optional fixture start as UTC ISO timestamp ending Z                             |

Do not commit .env. Changing MYSQL_PASSWORD environment variables does not change credentials inside an existing Docker volume; use the existing credentials or deliberately administer that database. Never remove a volume to fix authentication without checking its data.

Reference APIs: [TypeORM EntitySchema](https://typeorm.io/docs/entity/separating-entity-definition/), [MySQL driver](https://typeorm.io/docs/drivers/mysql/), [session-store schema](https://github.com/chill117/express-mysql-session/blob/master/schema.sql). Installed TypeORM 0.3 source and lockfile determine runtime behavior; website examples may target newer versions.

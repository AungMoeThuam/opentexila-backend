const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { DataSource } = require('typeorm');
const mysql = require('mysql2/promise');
const argon2 = require('argon2');
const { databaseOptions } = require('../dist/database/database-options');
const { seedDemo } = require('../database/seeds/demo');

// This command owns its container. It never reads .env or connects to the app database.
test(
  'MySQL 8.4 schema, migrations and development fixtures',
  { timeout: 240000 },
  async (t) => {
    const name = `opentexila-schema-test-${randomBytes(6).toString('hex')}`;
    const password = randomBytes(24).toString('hex');
    const dockerEnv = {
      ...process.env,
      MYSQL_ROOT_PASSWORD: password,
      MYSQL_DATABASE: 'opentexila_test',
      MYSQL_USER: 'test_app',
      MYSQL_PASSWORD: password,
    };
    let started = false;
    let ds;
    const docker = (args) =>
      execFileSync('docker', args, {
        env: dockerEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
      }).trim();
    try {
      docker([
        'run',
        '--detach',
        '--rm',
        '--name',
        name,
        '-e',
        'MYSQL_ROOT_PASSWORD',
        '-e',
        'MYSQL_DATABASE',
        '-e',
        'MYSQL_USER',
        '-e',
        'MYSQL_PASSWORD',
        '-p',
        '127.0.0.1::3306',
        'mysql:8.4',
        '--default-time-zone=+00:00',
      ]);
      started = true;
      const port = Number(docker(['port', name, '3306/tcp']).split(':').at(-1));
      const env = {
        NODE_ENV: 'development',
        DB_HOST: '127.0.0.1',
        DB_PORT: String(port),
        DB_NAME: 'opentexila_test',
        DB_USER: 'test_app',
        DB_PASSWORD: password,
        SEED_PASSWORD: randomBytes(18).toString('hex'),
        SEED_MEETING_START: '2026-10-27T01:00:00.000Z',
      };
      let ready = false;
      for (let i = 0; i < 90; i++) {
        try {
          const conn = await mysql.createConnection({
            host: env.DB_HOST,
            port,
            user: env.DB_USER,
            password,
            database: env.DB_NAME,
            connectTimeout: 1000,
          });
          await conn.end();
          ready = true;
          break;
        } catch {
          await delay(1000);
        }
      }
      assert.ok(ready, 'Disposable MySQL did not become ready');
      ds = await new DataSource(databaseOptions(env)).initialize();
      const tableNames = async () =>
        (await ds.query('SHOW TABLES'))
          .map((row) => Object.values(row)[0])
          .sort();
      // TypeORM creates metadata storage for our generated columns. Both
      // infrastructure tables survive rollback of the application migration.
      const infrastructureTables = ['schema_migrations', 'typeorm_metadata'];
      let migrationsReady = false;
      await t.test(
        'migration applies once and supports rollback/reapply',
        async () => {
          assert.equal((await ds.runMigrations()).length, 2);
          assert.equal((await ds.runMigrations()).length, 0);
          await ds.undoLastMigration();
          await ds.undoLastMigration();
          assert.deepEqual(await tableNames(), infrastructureTables);
          assert.equal((await ds.runMigrations()).length, 2);
          assert.deepEqual(
            await tableNames(),
            [
              ...infrastructureTables,
              'users',
              'courses',
              'account_invitations',
              'classrooms',
              'enrolments',
              'class_meetings',
              'attendance_sessions',
              'attendance_records',
              'auth_sessions',
            ].sort(),
          );
          migrationsReady = true;
        },
      );
      if (!migrationsReady) return;
      await t.test(
        'legacy upgrade preserves IDs, audit values and attendance; unknown mappings fail before DDL',
        async () => {
          await ds.undoLastMigration(); // Work with the original schema using raw SQL.
          await ds.query(
            "INSERT INTO users(id,name,email,institution_member_id,role) VALUES (91,'Admin','legacy.admin@example.test','LEGACY-ADMIN','admin'), (92,'Teacher','legacy.teacher@example.test','LEGACY-TEACHER','teacher'), (93,'Student','legacy.student@example.test','LEGACY-STUDENT','student')",
          );
          await ds.query(
            "INSERT INTO classrooms(id,code,name,subject,term,teacher_id,room_label,latitude,longitude,radius_m,max_accuracy_m,created_at,updated_at) VALUES (71,'COS30043-DEMO','Original display name','Interface Design and Development','DEMO',92,'B-204',0,0,100,30,'2026-01-01','2026-01-02')",
          );
          await ds.query(
            "INSERT INTO enrolments(id,classroom_id,student_id,enrolled_at) VALUES (81,71,93,'2026-10-01')",
          );
          await ds.query(
            "INSERT INTO class_meetings(id,classroom_id,starts_at,late_after,ends_at,created_by) VALUES (101,71,'2026-10-27 01:00:00','2026-10-27 01:15:00','2026-10-27 03:00:00',91)",
          );
          await ds.query(
            "INSERT INTO attendance_sessions(id,meeting_id,opens_at,late_after,closes_at,closed_at,state,room_label,latitude,longitude,radius_m,max_accuracy_m) VALUES (111,101,'2026-10-27 01:00:00','2026-10-27 01:15:00','2026-10-27 03:00:00','2026-10-27 03:00:00','closed','B-204',0,0,100,30)",
          );
          await ds.query(
            "INSERT INTO attendance_records(id,session_id,student_id,status,checked_in_at,distance_m,accuracy_m,location_validated_at) VALUES (121,111,93,'present','2026-10-27 01:05:00',5,10,'2026-10-27 01:05:00')",
          );
          const tables = [
            'users',
            'classrooms',
            'enrolments',
            'class_meetings',
            'attendance_sessions',
            'attendance_records',
          ];
          const before = Object.fromEntries(
            await Promise.all(
              tables.map(async (table) => [
                table,
                await ds.query(`SELECT * FROM ${table} ORDER BY id`),
              ]),
            ),
          );
          assert.equal((await ds.runMigrations()).length, 1);
          for (const table of tables) {
            const columns = Object.keys(before[table][0])
              .map((key) => '`' + key + '`')
              .join(',');
            assert.deepEqual(
              await ds.query(`SELECT ${columns} FROM ${table} ORDER BY id`),
              before[table],
              table,
            );
          }
          const classroom = await ds
            .getRepository('Classroom')
            .findOne({ where: { id: 71 }, relations: { course: true } });
          assert.equal(classroom.section, 'DEMO');
          assert.equal(classroom.course.code, 'COS30043');
          assert.equal(
            classroom.course.name,
            'Interface Design and Development',
          );
          assert.equal(classroom.name, undefined);
          const {
            ClassroomsExampleService,
          } = require('../dist/examples/classrooms-example.service');
          const response = await new ClassroomsExampleService(ds).findOne(71);
          assert.deepEqual(response.data.course, {
            id: classroom.course.id,
            code: 'COS30043',
            name: 'Interface Design and Development',
          });
          assert.equal(response.data.section, 'DEMO');
          assert.equal(response.data.subject, undefined);
          await ds.undoLastMigration();
          assert.deepEqual(
            await ds.query('SELECT * FROM classrooms ORDER BY id'),
            before.classrooms,
          );
          await ds.query("UPDATE classrooms SET code='UNMAPPED-A' WHERE id=71");
          const preflightTables = await tableNames();
          await assert.rejects(
            () => ds.runMigrations(),
            /mapping required for classroom IDs: 71/,
          );
          assert.deepEqual(await tableNames(), preflightTables);
          assert.equal(
            (await ds.query('SELECT code FROM classrooms WHERE id=71'))[0].code,
            'UNMAPPED-A',
          );
          await ds.query(
            "UPDATE classrooms SET code='COS30043-DEMO' WHERE id=71",
          );
          // Clear only this disposable database by reverting the initial migration.
          await ds.undoLastMigration();
          assert.equal((await ds.runMigrations()).length, 2);
        },
      );
      let fixtures;
      let fixturesReady = false;
      await t.test(
        'seeds are repeatable and private password fields stay hidden',
        async () => {
          fixtures = await seedDemo(ds, env);
          await seedDemo(ds, env);
          assert.equal(await ds.getRepository('User').count(), 6);
          assert.equal(await ds.getRepository('Course').count(), 1);
          assert.equal(await ds.getRepository('Classroom').count(), 1);
          assert.equal(await ds.getRepository('ClassMeeting').count(), 2);
          assert.equal(await ds.getRepository('AttendanceRecord').count(), 2);
          const user = await ds
            .getRepository('User')
            .findOneBy({ email: 'admin.demo@example.com' });
          assert.equal(user.password_hash, undefined);
          const secret = await ds
            .getRepository('User')
            .createQueryBuilder('u')
            .addSelect('u.password_hash')
            .where('u.id = :id', { id: user.id })
            .getOne();
          assert.equal(
            await argon2.verify(secret.password_hash, env.SEED_PASSWORD),
            true,
          );
          const meeting = await ds
            .getRepository('ClassMeeting')
            .findOneBy({ id: fixtures.meeting_ids[1] });
          assert.equal(meeting.starts_at.toISOString(), env.SEED_MEETING_START);
          fixturesReady = true;
        },
      );
      if (!fixturesReady) return;
      async function rejectsInTransaction(work, errno) {
        const runner = ds.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
          await assert.rejects(
            () => work(runner),
            (e) => e.errno === errno || e.driverError?.errno === errno,
          );
        } finally {
          await runner.rollbackTransaction();
          await runner.release();
        }
      }
      await t.test(
        'course codes, section uniqueness and references are enforced',
        async () => {
          await rejectsInTransaction(
            (r) =>
              r.query(
                "INSERT INTO courses(code,name) VALUES ('COS30043','Duplicate')",
              ),
            1062,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                "INSERT INTO courses(code,name) VALUES ('lower','Invalid')",
              ),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query("INSERT INTO courses(code,name) VALUES ('EMPTY','   ')"),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query("UPDATE classrooms SET section='a' WHERE id=?", [
                fixtures.classroom_id,
              ]),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query("UPDATE classrooms SET section='' WHERE id=?", [
                fixtures.classroom_id,
              ]),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query('UPDATE classrooms SET course_id=4294967295 WHERE id=?', [
                fixtures.classroom_id,
              ]),
            1452,
          );
          await rejectsInTransaction(
            (r) =>
              r.query('DELETE FROM courses WHERE id=?', [fixtures.course_id]),
            1451,
          );
          const runner = ds.createQueryRunner();
          await runner.connect();
          await runner.startTransaction();
          try {
            const repo = runner.manager.getRepository('Classroom');
            const original = await repo.findOneBy({
              id: fixtures.classroom_id,
            });
            await assert.rejects(
              () => repo.save({ ...original, id: undefined }),
              (e) => e.driverError.errno === 1062,
            );
            await repo.save({ ...original, id: undefined, section: 'B' });
            await repo.save({ ...original, id: undefined, term: '2027-S1' });
            assert.equal(await repo.count(), 3);
            const {
              ClassroomsExampleService,
            } = require('../dist/examples/classrooms-example.service');
            const list = await new ClassroomsExampleService(
              runner.manager,
            ).list(1, 20);
            assert.equal(list.meta.total, 3);
            assert.ok(list.data.every((row) => row.course.code === 'COS30043'));
            assert.ok(list.data.some((row) => row.section === 'B'));
          } finally {
            await runner.rollbackTransaction();
            await runner.release();
          }
          // New-model seed rows have no legacy data: rollback must refuse before DDL.
          const before = await tableNames();
          await assert.rejects(
            () => ds.undoLastMigration(),
            /Rollback would discard/,
          );
          assert.deepEqual(await tableNames(), before);
          assert.equal((await ds.runMigrations()).length, 0);
        },
      );
      await t.test(
        'invalid accounts, normalization and foreign keys are rejected',
        async () => {
          await rejectsInTransaction(
            (r) =>
              r.query(
                "INSERT INTO users(name,email,institution_member_id,role,status) VALUES ('Bad','bad@example.com','BAD','student','active')",
              ),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                "INSERT INTO users(name,email,institution_member_id,role) VALUES ('Bad','UPPER@example.com','BAD','student')",
              ),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                "INSERT INTO users(name,email,institution_member_id,role) VALUES ('Dup','admin.demo@example.com','OTHER','admin')",
              ),
            1062,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                'INSERT INTO enrolments(classroom_id,student_id,enrolled_at) VALUES (?,4294967295,UTC_TIMESTAMP(3))',
                [fixtures.classroom_id],
              ),
            1452,
          );
          await rejectsInTransaction(
            (r) =>
              r.query('DELETE FROM users WHERE id=?', [
                fixtures.accounts[1].id,
              ]),
            1451,
          );
        },
      );
      await t.test(
        'current enrolment is unique but historical intervals remain possible',
        async () => {
          await rejectsInTransaction(
            (r) =>
              r.query(
                'INSERT INTO enrolments(classroom_id,student_id,enrolled_at) VALUES (?,?,UTC_TIMESTAMP(3))',
                [fixtures.classroom_id, fixtures.accounts[2].id],
              ),
            1062,
          );
          const runner = ds.createQueryRunner();
          await runner.connect();
          await runner.startTransaction();
          try {
            await runner.query(
              'UPDATE enrolments SET withdrawn_at=? WHERE student_id=?',
              ['2026-10-27 00:00:00', fixtures.accounts[2].id],
            );
            await runner.manager.getRepository('Enrolment').save({
              classroom_id: fixtures.classroom_id,
              student_id: fixtures.accounts[2].id,
              enrolled_at: new Date('2026-10-28T00:00:00Z'),
            });
            assert.equal(
              await runner.manager
                .getRepository('Enrolment')
                .countBy({ student_id: fixtures.accounts[2].id }),
              2,
            );
          } finally {
            await runner.rollbackTransaction();
            await runner.release();
          }
        },
      );
      await t.test(
        'invitation digest and outstanding-token uniqueness are enforced',
        async () => {
          const runner = ds.createQueryRunner();
          await runner.connect();
          await runner.startTransaction();
          try {
            const invitations =
              runner.manager.getRepository('AccountInvitation');
            const record = {
              user_id: fixtures.accounts[5].id,
              created_by: fixtures.accounts[0].id,
              token_hash: 'a'.repeat(64),
              expires_at: new Date(Date.now() + 3600000),
            };
            // save() adds the generated ID to its input. Keep the template
            // ID-free so subsequent saves insert new invitations, not updates.
            const invitation = await invitations.save({ ...record });
            assert.equal(
              (await invitations.findOneBy({ id: invitation.id })).token_hash,
              undefined,
            );
            await assert.rejects(
              () => invitations.save({ ...record, token_hash: 'b'.repeat(64) }),
              (e) => e.driverError.errno === 1062,
            );
            await invitations.update(invitation.id, { revoked_at: new Date() });
            await invitations.save({ ...record, token_hash: 'b'.repeat(64) });
            assert.equal(
              await invitations.countBy({ user_id: record.user_id }),
              2,
            );
          } finally {
            await runner.rollbackTransaction();
            await runner.release();
          }
        },
      );
      await t.test(
        'schedule boundaries, session uniqueness and attendance evidence are enforced',
        async () => {
          await rejectsInTransaction(
            (r) =>
              r.query(
                'UPDATE class_meetings SET ends_at=starts_at WHERE id=?',
                [fixtures.meeting_ids[1]],
              ),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                "UPDATE attendance_records SET status='present' WHERE status='absent'",
              ),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                'UPDATE attendance_records SET accuracy_m=-1 WHERE status=?',
                ['present'],
              ),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query('UPDATE classrooms SET latitude=100 WHERE id=?', [
                fixtures.classroom_id,
              ]),
            3819,
          );
          const session = await ds
            .getRepository('AttendanceSession')
            .findOneBy({ meeting_id: fixtures.meeting_ids[0] });
          await rejectsInTransaction(
            (r) =>
              r.manager
                .getRepository('AttendanceSession')
                .save({ ...session, id: undefined }),
            1062,
          );
          await rejectsInTransaction(
            (r) =>
              r.manager.getRepository('AttendanceRecord').save({
                session_id: session.id,
                student_id: fixtures.accounts[2].id,
              }),
            1062,
          );
        },
      );
      await t.test(
        'Nest exposes the shared database provider and closes the pool',
        async () => {
          Object.assign(process.env, env);
          const { NestFactory } = require('@nestjs/core');
          const { AppModule } = require('../dist/app.module');
          const { DATABASE } = require('../dist/database/database.constants');
          const app = await NestFactory.createApplicationContext(AppModule, {
            logger: false,
          });
          const connection = app.get(DATABASE);
          try {
            assert.equal(
              await connection.getRepository('Classroom').count(),
              1,
            );
          } finally {
            await app.close();
          }
          assert.equal(connection.isInitialized, false);
        },
      );
    } finally {
      if (ds?.isInitialized) await ds.destroy();
      if (started) docker(['rm', '--force', name]);
    }
  },
);

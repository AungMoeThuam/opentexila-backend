const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { DataSource } = require('typeorm');
const mysql = require('mysql2/promise');
const argon2 = require('argon2');
const { databaseOptions } = require('../dist/database/database-options');
const { seedDemo } = require('../database/seeds/demo.ts');

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
      // TypeORM's migration history table survives rollback of the application migration.
      const infrastructureTables = ['schema_migrations'];
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
              'classes',
              'enrolments',
              'class_sessions',
              'attendance_records',
              'auth_sessions',
            ].sort(),
          );
          migrationsReady = true;
        },
      );
      if (!migrationsReady) return;
      let fixtures;
      let fixturesReady = false;
      await t.test(
        'seeds are repeatable and private password fields stay hidden',
        async () => {
          fixtures = await seedDemo(ds, env);
          await seedDemo(ds, env);
          assert.equal(await ds.getRepository('User').count(), 26);
          assert.equal(await ds.getRepository('Course').count(), 5);
          assert.equal(await ds.getRepository('Class').count(), 8);
          assert.equal(await ds.getRepository('ClassSession').count(), 64);
          assert.equal(
            (await ds.getRepository('AttendanceRecord').count()) > 100,
            true,
          );
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
            .getRepository('ClassSession')
            .findOneBy({ id: fixtures.class_session_ids[1] });
          assert.equal(meeting.starts_at.toISOString(), env.SEED_MEETING_START);
          fixturesReady = true;
        },
      );
      if (!fixturesReady) return;
      await t.test('attendance SQL and concurrency', async (attendanceTest) => {
        await require('./attendance.integration')(attendanceTest, ds, fixtures);
      });
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
        'course codes, class uniqueness and references are enforced',
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
              r.query("UPDATE classes SET section='a' WHERE id=?", [
                fixtures.class_id,
              ]),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query("UPDATE classes SET section='' WHERE id=?", [
                fixtures.class_id,
              ]),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query('UPDATE classes SET course_id=4294967295 WHERE id=?', [
                fixtures.class_id,
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
            const repo = runner.manager.getRepository('Class');
            const original = await repo.findOneBy({
              id: fixtures.class_id,
            });
            await assert.rejects(
              () => repo.save({ ...original, id: undefined }),
              (e) => e.driverError.errno === 1062,
            );
            await repo.save({ ...original, id: undefined, section: 'C' });
            await repo.save({ ...original, id: undefined, term: '2027-S1' });
            assert.equal(await repo.count(), 10);
            const {
              ClassroomsExampleService,
            } = require('../dist/examples/classrooms-example.service');
            const list = await new ClassroomsExampleService(
              runner.manager,
            ).list(1, 20);
            assert.equal(list.meta.total, 10);
            assert.ok(list.data.some((row) => row.course.code === 'COS30043'));
            assert.ok(list.data.some((row) => row.section === 'C'));
          } finally {
            await runner.rollbackTransaction();
            await runner.release();
          }
        },
      );
      await t.test(
        'ENUM columns and table shapes match the target schema',
        async () => {
          for (const [table, column, expected, defaultValue] of [
            ['users', 'role', "enum('student','teacher','admin')", null],
            ['users', 'status', "enum('active','inactive')", 'active'],
            [
              'class_sessions',
              'state',
              "enum('scheduled','cancelled')",
              'scheduled',
            ],
            [
              'attendance_records',
              'status',
              "enum('pending','present','late','absent')",
              'pending',
            ],
          ]) {
            const [field] = await ds.query(
              'SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
              [table, column],
            );
            assert.equal(field.COLUMN_TYPE, expected);
            assert.equal(field.IS_NULLABLE, 'NO');
            assert.equal(field.COLUMN_DEFAULT, defaultValue);
            await rejectsInTransaction(
              (r) => r.query(`UPDATE ${table} SET ${column}='unsupported'`),
              1265,
            );
          }
          for (const [table, key] of [
            ['enrolments', 'class_id,student_id'],
            ['attendance_records', 'class_session_id,student_id'],
          ]) {
            const primary = await ds.query(
              `SHOW INDEX FROM ${table} WHERE Key_name='PRIMARY'`,
            );
            assert.equal(primary.map((i) => i.Column_name).join(), key);
          }
          for (const entity of ds.entityMetadatas) {
            const columns = await ds.query(
              `SHOW COLUMNS FROM ${entity.tableName}`,
            );
            assert.deepEqual(
              columns.map((c) => c.Field).sort(),
              entity.columns.map((c) => c.databaseName).sort(),
              entity.name,
            );
            const indexes = await ds.query(
              `SHOW INDEX FROM ${entity.tableName}`,
            );
            for (const index of entity.indices)
              assert(
                indexes.some((i) => i.Key_name === index.name),
                index.name,
              );
          }
        },
      );
      await t.test(
        'invalid accounts, normalization and foreign keys are rejected',
        async () => {
          await rejectsInTransaction(
            (r) =>
              r.query(
                "INSERT INTO users(name,email,password_hash,role) VALUES ('Bad','UPPER@example.com','x','student')",
              ),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                "INSERT INTO users(name,email,password_hash,role) VALUES ('Bad','bad@example.com','','student')",
              ),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                "INSERT INTO users(name,email,role) VALUES ('Bad','bad@example.com','student')",
              ),
            1364,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                "INSERT INTO users(name,email,password_hash,role) VALUES ('Dup','admin.demo@example.com','x','admin')",
              ),
            1062,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                'INSERT INTO enrolments(class_id,student_id) VALUES (?,4294967295)',
                [fixtures.class_id],
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
          const user = await ds
            .getRepository('User')
            .findOneBy({ email: 'student.one@example.com' });
          assert.equal(user.must_change_password, false);
        },
      );
      await t.test(
        'an enrolment exists at most once per student and class',
        async () => {
          await rejectsInTransaction(
            (r) =>
              r.query(
                'INSERT INTO enrolments(class_id,student_id) VALUES (?,?)',
                [fixtures.class_id, fixtures.accounts[2].id],
              ),
            1062,
          );
          await rejectsInTransaction(
            (r) =>
              r.query('DELETE FROM classes WHERE id=?', [fixtures.class_id]),
            1451,
          );
        },
      );
      await t.test(
        'schedule boundaries, session uniqueness and attendance evidence are enforced',
        async () => {
          await rejectsInTransaction(
            (r) =>
              r.query(
                'UPDATE class_sessions SET ends_at=starts_at WHERE id=?',
                [fixtures.class_session_ids[1]],
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
                'UPDATE attendance_records SET distance_m=-1 WHERE status=?',
                ['present'],
              ),
            3819,
          );
          await rejectsInTransaction(
            (r) =>
              r.query('UPDATE classes SET latitude=100 WHERE id=?', [
                fixtures.class_id,
              ]),
            3819,
          );
          const original = await ds
            .getRepository('ClassSession')
            .findOneBy({ id: fixtures.class_session_ids[0] });
          await rejectsInTransaction(
            (r) =>
              r.manager
                .getRepository('ClassSession')
                .save({ ...original, id: undefined }),
            1062,
          );
          await rejectsInTransaction(
            (r) =>
              r.query(
                'INSERT INTO attendance_records(class_session_id,student_id) VALUES (?,?)',
                [original.id, fixtures.accounts[2].id],
              ),
            1062,
          );
        },
      );
      await t.test('lecturer attendance routes read real data', async () => {
        const {
          ClassSessionRecordsService,
        } = require('../dist/attendance/class-session-records.service');
        const rosters = new ClassSessionRecordsService(ds);
        const accountId = (email) =>
          fixtures.accounts.find((account) => account.email === email).id;
        const lecturer = {
          id: accountId('lecturer.one@example.com'),
          role: 'teacher',
        };
        const placeholders = (values) => values.map(() => '?').join(',');

        // The lecturer's own sessions.
        const mine = await ds.query(
          `SELECT s.id, s.class_id, s.starts_at FROM class_sessions s
             JOIN classes c ON c.id = s.class_id
             WHERE c.teacher_id = ? ORDER BY s.starts_at, s.id`,
          [lecturer.id],
        );
        assert.ok(mine.length > 0 && mine.length <= 100);

        // Roster of a session with records.
        const [target] = await ds.query(
          `SELECT class_session_id AS id, COUNT(*) AS n FROM attendance_records
             WHERE class_session_id IN (${placeholders(mine)})
             GROUP BY class_session_id HAVING n > 1 ORDER BY id LIMIT 1`,
          mine.map((row) => row.id),
        );
        assert.ok(target, 'the seed should give the lecturer a roster');
        const roster = await rosters.list(lecturer, String(target.id), {
          limit: '100',
        });
        assert.equal(roster.data.length, Number(target.n));
        const studentIds = roster.data.map((row) => row.student_id);
        assert.deepEqual(
          studentIds,
          [...studentIds].sort((a, b) => a - b),
        );
        for (const row of roster.data) {
          assert.deepEqual(Object.keys(row.student).sort(), ['id', 'name']);
          const checkedIn = ['present', 'late'].includes(row.status);
          assert.equal(
            typeof row.checked_in_at,
            checkedIn ? 'string' : 'object',
          );
          if (!checkedIn) assert.equal(row.checked_in_at, null);
        }
        assert.equal(roster.context.class_session_id, target.id);
        assert.equal(roster.context.class.lecturer.name, 'Lecturer One');

        // Roster status filter returns only that status.
        for (const status of ['pending', 'present', 'late', 'absent']) {
          const [{ n }] = await ds.query(
            `SELECT COUNT(*) AS n FROM attendance_records
               WHERE class_session_id = ? AND status = ?`,
            [target.id, status],
          );
          const filtered = await rosters.list(lecturer, String(target.id), {
            status,
            limit: '100',
          });
          assert.equal(filtered.data.length, Number(n), status);
          assert.ok(filtered.data.every((row) => row.status === status));
          assert.equal(filtered.context.class_session_id, target.id);
        }

        // A session of another lecturer looks like a missing session.
        const [foreign] = await ds.query(
          `SELECT s.id FROM class_sessions s JOIN classes c ON c.id = s.class_id
             WHERE c.teacher_id <> ? LIMIT 1`,
          [lecturer.id],
        );
        await assert.rejects(
          () => rosters.list(lecturer, String(foreign.id), {}),
          (error) => error.getStatus() === 404,
        );

        // A cancelled session: empty roster, context kept.
        const [cancelled] = await ds.query(
          `SELECT s.id, c.teacher_id FROM class_sessions s
             JOIN classes c ON c.id = s.class_id
             WHERE s.state = 'cancelled' LIMIT 1`,
        );
        assert.ok(cancelled, 'the seed should contain a cancelled session');
        const owner = { id: cancelled.teacher_id, role: 'teacher' };
        const empty = await rosters.list(owner, String(cancelled.id), {});
        assert.deepEqual(empty.data, []);
        assert.equal(empty.context.class_state, 'cancelled');
        assert.equal(empty.meta.totalPages, 0);
      });
      await t.test('student attendance history reads real data', async () => {
        const {
          AttendanceHistoryService,
        } = require('../dist/attendance/attendance-history.service');
        const history = new AttendanceHistoryService(ds);
        const [{ student_id: studentId }] = await ds.query(
          `SELECT student_id FROM attendance_records
             GROUP BY student_id ORDER BY COUNT(*) DESC, student_id LIMIT 1`,
        );
        const expected = await ds.query(
          `SELECT r.class_session_id AS id, r.status FROM attendance_records r
             JOIN class_sessions s ON s.id = r.class_session_id
             WHERE r.student_id = ? AND s.state <> 'cancelled'
             ORDER BY s.starts_at DESC, r.class_session_id DESC`,
          [studentId],
        );
        assert.ok(expected.length > 0);
        const result = await history.getPersonalAttendanceRecords({
          studentId,
          limit: 100,
        });
        assert.deepEqual(
          result.data.map((row) => row.class_session_id),
          expected.map((row) => row.id),
        );
        assert.equal(result.meta.total, expected.length);
        for (const row of result.data) {
          assert.equal(row.student_id, studentId);
          assert.deepEqual(Object.keys(row.class.lecturer).sort(), [
            'id',
            'name',
          ]);
          assert.ok(
            row.class.course.code && row.class.section && row.class.term,
          );
          assert.equal(typeof row.starts_at, 'string');
        }
        const filtered = await history.getPersonalAttendanceRecords({
          studentId,
          classId: result.data[0].class.id,
          status: result.data[0].status,
          limit: 100,
        });
        assert.ok(filtered.data.length > 0);
        assert.ok(
          filtered.data.every(
            (row) =>
              row.class.id === result.data[0].class.id &&
              row.status === result.data[0].status,
          ),
        );
        const withCancelled = await history.getPersonalAttendanceRecords({
          studentId,
          includeCancelled: true,
          limit: 100,
        });
        assert.ok(withCancelled.meta.total >= result.meta.total);
      });
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
            assert.equal(await connection.getRepository('Class').count(), 8);
          } finally {
            await app.close();
          }
          assert.equal(connection.isInitialized, false);
        },
      );
      await t.test(
        'venue migration backfills populated sessions without losing attendance',
        async () => {
          const count = await ds.getRepository('AttendanceRecord').count();
          await ds.undoLastMigration();
          assert.equal((await ds.runMigrations()).length, 1);
          const [row] = await ds.query(
            `SELECT s.room_label, s.latitude, s.longitude, s.radius_m,
          c.room_label AS class_room, c.latitude AS class_latitude
          FROM class_sessions s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
            [fixtures.class_session_ids[0]],
          );
          assert.equal(row.room_label, row.class_room);
          assert.equal(row.latitude, row.class_latitude);
          assert.equal(
            await ds.getRepository('AttendanceRecord').count(),
            count,
          );
        },
      );
      await t.test(
        'populated baseline rollback and clean reapplication',
        async () => {
          await ds.undoLastMigration();
          await ds.undoLastMigration();
          assert.deepEqual(await tableNames(), infrastructureTables);
          assert.equal((await ds.runMigrations()).length, 2);
          await seedDemo(ds, env);
          assert.ok((await ds.getRepository('AttendanceRecord').count()) > 100);
        },
      );
    } finally {
      if (ds?.isInitialized) await ds.destroy();
      if (started) docker(['rm', '--force', name]);
    }
  },
);

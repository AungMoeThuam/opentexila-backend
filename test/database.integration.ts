import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DataSource, type QueryRunner } from 'typeorm';
import mysql from 'mysql2/promise';
import argon2 from 'argon2';
import { NestFactory } from '@nestjs/core';
import { MyClassesService } from '../dist/enrolments/my-classes.service.js';
import { ClassRosterService } from '../dist/enrolments/class-roster.service.js';
import { databaseOptions } from '../dist/database/database-options.js';
import { DATABASE } from '../dist/database/database.constants.js';
import { ClassroomsExampleService } from '../dist/examples/classrooms-example.service.js';
import { ClassSessionRecordsService } from '../dist/attendance/class-session-records.service.js';
import { attendanceHistoryIntegration } from './attendance-history.integration.ts';
import { enrolmentsIntegration } from './enrolments.integration.ts';
import { coursesIntegration } from './courses.integration.ts';
import type { AttendanceCaller } from '../dist/attendance/attendance.rules.js';
import { seedDemo } from '../database/seeds/demo.ts';
import { authIntegration } from './auth.integration.ts';
import { adminUsersIntegration } from './admin-users.integration.ts';
import { announcementsIntegration } from './announcements.integration.ts';
import { attendanceIntegration } from './attendance.integration.ts';

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
    let ds: DataSource | undefined;
    const docker = (args: string[]) =>
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
        (await ds!.query('SHOW TABLES'))
          .map((row: any) => Object.values(row)[0])
          .sort();
      // TypeORM's migration history table survives rollback of the application migration.
      const infrastructureTables = ['schema_migrations'];
      let migrationsReady = false;
      await t.test(
        'migration applies once and supports rollback/reapply',
        async () => {
          assert.equal((await ds!.runMigrations()).length, 4);
          assert.equal((await ds!.runMigrations()).length, 0);
          await ds!.undoLastMigration();
          await ds!.undoLastMigration();
          await ds!.undoLastMigration();
          await ds!.undoLastMigration();
          assert.deepEqual(await tableNames(), infrastructureTables);
          assert.equal((await ds!.runMigrations()).length, 4);
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
              'auth_refresh_sessions',
              'announcements',
              'announcement_likes',
              'announcement_comments',
            ].sort(),
          );
          migrationsReady = true;
        },
      );
      if (!migrationsReady) return;
      let fixtures: any;
      let fixturesReady = false;
      await t.test(
        'seeds are repeatable and private password fields stay hidden',
        async () => {
          fixtures = await seedDemo(ds!, env);
          await seedDemo(ds!, env);
          assert.equal(await ds!.getRepository('User').count(), 26);
          assert.equal(await ds!.getRepository('Course').count(), 5);
          assert.equal(await ds!.getRepository('Class').count(), 8);
          assert.equal(await ds!.getRepository('ClassSession').count(), 64);
          // Three announcements for each of the eight classes, with their
          // likes and comments, and the same totals after a second run.
          const announcementTotals = async () =>
            Promise.all(
              ['Announcement', 'AnnouncementLike', 'AnnouncementComment'].map(
                (name) => ds!.getRepository(name).count(),
              ),
            );
          const [posts, likes, comments] = await announcementTotals();
          assert.equal(posts, 24);
          assert.ok(likes > 24 && comments > 24);
          await seedDemo(ds!, env);
          assert.deepEqual(await announcementTotals(), [
            posts,
            likes,
            comments,
          ]);
          assert.equal(
            (await ds!.getRepository('AttendanceRecord').count()) > 100,
            true,
          );
          const user = await ds!
            .getRepository('User')
            .findOneBy({ email: 'admin.demo@example.com' });
          assert.equal(user!.password_hash, undefined);
          const secret = await ds!
            .getRepository('User')
            .createQueryBuilder('u')
            .addSelect('u.password_hash')
            .where('u.id = :id', { id: user!.id })
            .getOne();
          assert.equal(
            await argon2.verify(secret!.password_hash, env.SEED_PASSWORD),
            true,
          );
          const meeting = await ds!
            .getRepository('ClassSession')
            .findOneBy({ id: fixtures.class_session_ids[1] });
          assert.equal(
            meeting!.starts_at.toISOString(),
            env.SEED_MEETING_START,
          );
          fixturesReady = true;
        },
      );
      if (!fixturesReady) return;
      await t.test('attendance SQL and concurrency', async (attendanceTest) => {
        await attendanceIntegration(attendanceTest, ds!, fixtures);
      });
      async function rejectsInTransaction(
        work: (runner: QueryRunner) => Promise<unknown>,
        errno: number,
      ) {
        const runner = ds!.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
          await assert.rejects(
            () => work(runner),
            (e: any) => e.errno === errno || e.driverError?.errno === errno,
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
          const runner = ds!.createQueryRunner();
          await runner.connect();
          await runner.startTransaction();
          try {
            const repo = runner.manager.getRepository('Class');
            const original = await repo.findOneBy({
              id: fixtures.class_id,
            });
            await assert.rejects(
              () => repo.save({ ...original, id: undefined }),
              (e: any) => e.driverError.errno === 1062,
            );
            await repo.save({ ...original, id: undefined, section: 'C' });
            await repo.save({ ...original, id: undefined, term: '2027-S1' });
            assert.equal(await repo.count(), 10);
            const list = await new ClassroomsExampleService(
              runner.manager as any,
            ).list(1, 20);
            assert.equal(list.meta.total, 10);
            assert.ok(
              list.data.some((row: any) => row.course.code === 'COS30043'),
            );
            assert.ok(list.data.some((row: any) => row.section === 'C'));
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
            ['users', 'role', "enum('student','lecturer','admin')", null],
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
          ] as const) {
            const [field] = await ds!.query(
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
            const primary = await ds!.query(
              `SHOW INDEX FROM ${table} WHERE Key_name='PRIMARY'`,
            );
            assert.equal(primary.map((i: any) => i.Column_name).join(), key);
          }
          for (const entity of ds!.entityMetadatas) {
            const columns = await ds!.query(
              `SHOW COLUMNS FROM ${entity.tableName}`,
            );
            assert.deepEqual(
              columns.map((c: any) => c.Field).sort(),
              entity.columns.map((c) => c.databaseName).sort(),
              entity.name,
            );
            const indexes = await ds!.query(
              `SHOW INDEX FROM ${entity.tableName}`,
            );
            for (const index of entity.indices)
              assert(
                indexes.some((i: any) => i.Key_name === index.name),
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
          const user = await ds!
            .getRepository('User')
            .findOneBy({ email: 'student.one@example.com' });
          assert.equal(user!.must_change_password, false);
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
          const original = await ds!
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
                [original!.id, fixtures.accounts[2].id],
              ),
            1062,
          );
        },
      );
      await t.test(
        'my classes scopes current membership and lecturer assignment',
        async () => {
          const service = new MyClassesService(ds!);
          for (const role of ['student', 'lecturer'] as const) {
            const account = fixtures.accounts.find((a: any) => a.role === role);
            const expected = await ds!.query(
              role === 'student'
                ? 'SELECT c.id FROM classes c JOIN enrolments e ON e.class_id=c.id WHERE e.student_id=? ORDER BY c.id'
                : 'SELECT id FROM classes WHERE lecturer_id=? ORDER BY id',
              [account.id],
            );
            const result = await service.list(
              { id: account.id, role },
              { page: 1, limit: 100 },
            );
            assert.deepEqual(
              result.data.map((c) => c.id),
              expected.map((c: any) => c.id),
            );
            assert.equal(result.meta.total, expected.length);
            assert.ok(result.data.length > 0);
            const first = result.data[0];
            const filtered = await service.list(
              { id: account.id, role },
              {
                page: 1,
                limit: 1,
                courseId: first.course.id,
                term: first.term,
              },
            );
            assert.equal(filtered.data[0].id, first.id);
            const page2 = await service.list(
              { id: account.id, role },
              { page: 2, limit: 1 },
            );
            assert.deepEqual(
              page2.data.map((c) => c.id),
              expected.slice(1, 2).map((c: any) => c.id),
            );
            const empty = await service.list(
              { id: account.id, role },
              { page: 1, limit: 20, term: 'no-such-term' },
            );
            assert.deepEqual(empty.meta, {
              page: 1,
              limit: 20,
              total: 0,
              totalPages: 0,
            });
          }
        },
      );
      await t.test(
        'class roster lists real enrolments for the assigned lecturer only',
        async () => {
          const service = new ClassRosterService(ds!);
          const [{ id: lecturerId, class_id: classId }] = await ds!.query(
            `SELECT c.lecturer_id AS id, c.id AS class_id FROM classes c
               JOIN enrolments e ON e.class_id = c.id
               GROUP BY c.id, c.lecturer_id HAVING COUNT(*) > 1
               ORDER BY c.id LIMIT 1`,
          );
          const expected = await ds!.query(
            'SELECT student_id FROM enrolments WHERE class_id = ? ORDER BY student_id',
            [classId],
          );
          const lecturer = { id: lecturerId, role: 'lecturer' } as any;
          const all = await service.list(lecturer, classId, {
            page: 1,
            limit: 100,
          });
          assert.deepEqual(
            all.data.map((row) => row.student_id),
            expected.map((row: any) => row.student_id),
          );
          assert.equal(all.meta.total, expected.length);
          assert.equal(all.context.class.id, classId);
          assert.equal(all.context.class.lecturer.id, lecturerId);
          const second = await service.list(lecturer, classId, {
            page: 2,
            limit: 1,
          });
          assert.deepEqual(
            second.data.map((row) => row.student_id),
            [expected[1].student_id],
          );

          // Inactive students stay on the roster.
          const inactiveId = expected[0].student_id;
          await ds!.query("UPDATE users SET status='inactive' WHERE id=?", [
            inactiveId,
          ]);
          try {
            const withInactive = await service.list(lecturer, classId, {
              page: 1,
              limit: 100,
            });
            assert.equal(withInactive.meta.total, expected.length);
            assert.equal(withInactive.data[0].student_id, inactiveId);
          } finally {
            await ds!.query("UPDATE users SET status='active' WHERE id=?", [
              inactiveId,
            ]);
          }

          // Another lecturer cannot tell the class exists.
          const [other] = await ds!.query(
            "SELECT id FROM users WHERE role='lecturer' AND id <> ? LIMIT 1",
            [lecturerId],
          );
          await assert.rejects(
            service.list({ id: other.id, role: 'lecturer' } as any, classId, {
              page: 1,
              limit: 20,
            }),
            { status: 404 },
          );
          await assert.rejects(
            service.list(lecturer, 4294967295, { page: 1, limit: 20 }),
            { status: 404 },
          );

          // A class with no students keeps its context.
          const created = await ds!.query(
            `INSERT INTO classes(course_id,lecturer_id,section,term,room_label,latitude,longitude,radius_m)
               SELECT course_id,lecturer_id,'ZZ',term,room_label,latitude,longitude,radius_m
               FROM classes WHERE id=?`,
            [classId],
          );
          try {
            const empty = await service.list(lecturer, created.insertId, {
              page: 1,
              limit: 20,
            });
            assert.deepEqual(empty.data, []);
            assert.deepEqual(empty.meta, {
              page: 1,
              limit: 20,
              total: 0,
              totalPages: 0,
            });
            assert.equal(empty.context.class.id, created.insertId);
          } finally {
            await ds!.query('DELETE FROM classes WHERE id=?', [
              created.insertId,
            ]);
          }
        },
      );
      await t.test('lecturer attendance routes read real data', async () => {
        const rosters = new ClassSessionRecordsService(ds!);
        const accountId = (email: string) =>
          fixtures.accounts.find((account: any) => account.email === email).id;
        const lecturer: AttendanceCaller = {
          id: accountId('lecturer.one@example.com'),
          role: 'lecturer',
        };
        const placeholders = (values: unknown[]) =>
          values.map(() => '?').join(',');

        // The lecturer's own sessions.
        const mine = await ds!.query(
          `SELECT s.id, s.class_id, s.starts_at FROM class_sessions s
             JOIN classes c ON c.id = s.class_id
             WHERE c.lecturer_id = ? ORDER BY s.starts_at, s.id`,
          [lecturer.id],
        );
        assert.ok(mine.length > 0 && mine.length <= 100);

        // Roster of a session with records.
        const [target] = await ds!.query(
          `SELECT class_session_id AS id, COUNT(*) AS n FROM attendance_records
             WHERE class_session_id IN (${placeholders(mine)})
             GROUP BY class_session_id HAVING n > 1 ORDER BY id LIMIT 1`,
          mine.map((row: any) => row.id),
        );
        assert.ok(target, 'the seed should give the lecturer a roster');
        const roster = await rosters.list(lecturer, target.id, {
          page: 1,
          limit: 100,
        });
        assert.equal(roster.data.length, Number(target.n));
        const studentIds = roster.data.map((row: any) => row.student_id);
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
        assert.equal(roster.context.class.lecturer!.name, 'Lecturer One');

        // Roster status filter returns only that status.
        for (const status of [
          'pending',
          'present',
          'late',
          'absent',
        ] as const) {
          const [{ n }] = await ds!.query(
            `SELECT COUNT(*) AS n FROM attendance_records
               WHERE class_session_id = ? AND status = ?`,
            [target.id, status],
          );
          const filtered = await rosters.list(lecturer, target.id, {
            page: 1,
            status,
            limit: 100,
          });
          assert.equal(filtered.data.length, Number(n), status);
          assert.ok(filtered.data.every((row: any) => row.status === status));
          assert.equal(filtered.context.class_session_id, target.id);
        }

        // A session of another lecturer looks like a missing session.
        const [foreign] = await ds!.query(
          `SELECT s.id FROM class_sessions s JOIN classes c ON c.id = s.class_id
             WHERE c.lecturer_id <> ? LIMIT 1`,
          [lecturer.id],
        );
        await assert.rejects(
          () => rosters.list(lecturer, foreign.id, { page: 1, limit: 20 }),
          (error: any) => error.getStatus() === 404,
        );

        // A cancelled session: empty roster, context kept.
        const [cancelled] = await ds!.query(
          `SELECT s.id, c.lecturer_id FROM class_sessions s
             JOIN classes c ON c.id = s.class_id
             WHERE s.state = 'cancelled' LIMIT 1`,
        );
        assert.ok(cancelled, 'the seed should contain a cancelled session');
        const owner: AttendanceCaller = {
          id: cancelled.lecturer_id,
          role: 'lecturer',
        };
        const empty = await rosters.list(owner, cancelled.id, {
          page: 1,
          limit: 20,
        });
        assert.deepEqual(empty.data, []);
        assert.equal(empty.context.class_state, 'cancelled');
        assert.equal(empty.meta.totalPages, 0);
      });
      await attendanceHistoryIntegration(t, ds!);
      await enrolmentsIntegration(t, ds!, fixtures);
      await coursesIntegration(t, ds!, fixtures);
      await authIntegration(t, ds!);
      await adminUsersIntegration(t, ds!);
      await announcementsIntegration(t, ds!);
      await t.test(
        'real AppModule wires JWT attendance protection without protecting example routes',
        () => {
          const script = `
          const assert = require('node:assert/strict');
          const { NestFactory } = require('@nestjs/core');
          const { AppModule } = require('./dist/app.module.js');
          const { AuthService } = require('./dist/auth/auth.service.js');
          const { createValidationPipe } = require('./dist/common/validation.pipe.js');
          (async () => {
            const app = await NestFactory.create(AppModule, { logger: ['error'], abortOnError: false });
            try {
              app.setGlobalPrefix('api/v1');
              app.useGlobalPipes(createValidationPipe());
              await app.listen(0, '127.0.0.1');
              const base = await app.getUrl();
              const login = await app.get(AuthService).login({ email: 'student.one@example.com', password: process.env.SEED_PASSWORD });
              const call = (path, token) => fetch(base + '/api/v1/' + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
              assert.equal((await call('me/class-sessions')).status, 401);
              assert.equal((await call('me/class-sessions', login.response.accessToken)).status, 200);
              assert.equal((await call('examples/classrooms')).status, 200);
              await app.get(AuthService).logout(login.refreshToken);
              assert.equal((await call('me/class-sessions', login.response.accessToken)).status, 401);
            } finally { await app.close(); }
          })().catch((error) => { console.error(error.message); process.exitCode = 1; });
        `;
          execFileSync(
            process.execPath,
            ['--experimental-strip-types', '--no-warnings', '-e', script],
            {
              env: {
                ...process.env,
                ...env,
                JWT_AUTH_ENABLED: 'true',
                DEV_AUTH_ENABLED: 'false',
                JWT_SECRET: randomBytes(48).toString('hex'),
              },
              timeout: 20000,
              stdio: 'pipe',
            },
          );
        },
      );
      await t.test(
        'Nest exposes the shared database provider and closes the pool',
        async () => {
          Object.assign(process.env, env);
          const { AppModule } = await import('../dist/app.module.js');
          const app = await NestFactory.createApplicationContext(AppModule, {
            logger: false,
          });
          const connection = app.get<DataSource>(DATABASE);
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
          const count = await ds!.getRepository('AttendanceRecord').count();
          // Announcements and refresh sessions come after the venue migration.
          await ds!.undoLastMigration();
          await ds!.undoLastMigration();
          await ds!.undoLastMigration();
          assert.equal((await ds!.runMigrations()).length, 3);
          const [row] = await ds!.query(
            `SELECT s.room_label, s.latitude, s.longitude, s.radius_m,
          c.room_label AS class_room, c.latitude AS class_latitude
          FROM class_sessions s JOIN classes c ON c.id = s.class_id WHERE s.id = ?`,
            [fixtures.class_session_ids[0]],
          );
          assert.equal(row.room_label, row.class_room);
          assert.equal(row.latitude, row.class_latitude);
          assert.equal(
            await ds!.getRepository('AttendanceRecord').count(),
            count,
          );
        },
      );
      await t.test(
        'populated baseline rollback and clean reapplication',
        async () => {
          await ds!.undoLastMigration();
          await ds!.undoLastMigration();
          await ds!.undoLastMigration();
          await ds!.undoLastMigration();
          assert.deepEqual(await tableNames(), infrastructureTables);
          assert.equal((await ds!.runMigrations()).length, 4);
          await seedDemo(ds!, env);
          assert.ok(
            (await ds!.getRepository('AttendanceRecord').count()) > 100,
          );
        },
      );
    } finally {
      if (ds?.isInitialized) await ds.destroy();
      if (started) docker(['rm', '--force', name]);
    }
  },
);

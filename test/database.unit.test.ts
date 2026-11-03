import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../dist/database/database-options.js';
import { seedDemo } from '../database/seeds/demo.ts';

const env = {
  DB_HOST: '127.0.0.1',
  DB_NAME: 'unit_only',
  DB_USER: 'unit_only',
  DB_PASSWORD: 'not-a-connection',
};

test('configuration fails before connecting when required values or ports are invalid', () => {
  for (const key of Object.keys(env))
    assert.throws(
      () => databaseOptions({ ...env, [key]: '' }),
      new RegExp(key),
    );
  for (const port of ['0', '65536', '3306.5', 'oops'])
    assert.throws(() => databaseOptions({ ...env, DB_PORT: port }), /DB_PORT/);
  const options = databaseOptions(env) as any;
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  assert.equal(options.timezone, 'Z');
  assert.equal(options.extra.multipleStatements, false);
  assert.ok(
    existsSync(
      path.join(
        path.dirname(options.migrations[0]),
        '1793059200000-InitialSchema.ts',
      ),
    ),
  );
});

test('TypeORM resolves every entity relation without duplicate FK columns or exposed secrets', async () => {
  const ds = new DataSource(databaseOptions(env));
  // Build metadata only: no connection, SQL or external database.
  await (ds as any).buildMetadatas();
  assert.equal(ds.entityMetadatas.length, 7);
  for (const entity of ds.entityMetadatas) {
    assert.equal(
      new Set(entity.columns.map((c) => c.databaseName)).size,
      entity.columns.length,
    );
    for (const fk of entity.foreignKeys) {
      assert.equal(fk.onDelete, 'RESTRICT');
      assert.equal(fk.onUpdate, 'RESTRICT');
      assert.ok(ds.entityMetadatas.includes(fk.referencedEntityMetadata));
    }
  }
  const column = (name: string, field: string) =>
    ds.getMetadata(name).columns.find((c) => c.propertyName === field)!;
  assert.equal(column('User', 'password_hash').isSelect, false);
  assert.equal(column('RefreshSession', 'token_hash').isSelect, false);
  assert.equal(column('Class', 'course_id').isNullable, false);
  assert.equal(column('Class', 'section').isNullable, false);
  for (const name of ['code', 'name', 'subject'])
    assert.equal(column('Class', name), undefined);
  assert.ok(
    ds
      .getMetadata('Class')
      .indices.some(
        (i) =>
          i.isUnique &&
          i.columns.map((c) => c.propertyName).join() ===
            'course_id,term,section',
      ),
  );
  assert.equal(column('User', 'password_hash').isNullable, false);
  assert.equal(column('User', 'institution_member_id'), undefined);
  assert.equal(column('Enrolment', 'class_id').isPrimary, true);
  assert.equal(column('Enrolment', 'student_id').isPrimary, true);
  assert.equal(column('AttendanceRecord', 'class_session_id').isPrimary, true);
  assert.equal(column('AttendanceRecord', 'student_id').isPrimary, true);
  assert.equal(column('ClassSession', 'starts_at').precision, 3);
  for (const name of [
    'AccountInvitation',
    'AttendanceRegister',
    'CourseSection',
  ])
    assert.equal(
      ds.entityMetadatas.some((e) => e.name === name),
      false,
      name,
    );
});

test('seed rejects production and remote databases before any connection use', async () => {
  await assert.rejects(
    seedDemo(null as any, { ...env, NODE_ENV: 'production' }),
    /development/,
  );
  await assert.rejects(
    seedDemo(null as any, {
      ...env,
      NODE_ENV: 'development',
      DB_HOST: 'db.example.com',
    }),
    /local DB_HOST/,
  );
  await assert.rejects(
    seedDemo(null as any, {
      ...env,
      NODE_ENV: 'development',
      SEED_PASSWORD: 'short',
    }),
    /12 characters/,
  );
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../dist/database/database-options');
const { seedDemo } = require('../database/seeds/demo');

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
  const options = databaseOptions(env);
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  assert.equal(options.timezone, 'Z');
  assert.equal(options.extra.multipleStatements, false);
  assert.ok(
    existsSync(
      path.join(
        path.dirname(options.migrations[0]),
        '1793059200000-InitialSchema.js',
      ),
    ),
  );
});

test('TypeORM resolves every JS schema relation without duplicate FK columns or exposed secrets', async () => {
  const ds = new DataSource(databaseOptions(env));
  // Build metadata only: no connection, SQL or external database.
  await ds.buildMetadatas();
  assert.equal(ds.entityMetadatas.length, 8);
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
  const column = (name, field) =>
    ds.getMetadata(name).columns.find((c) => c.propertyName === field);
  assert.equal(column('User', 'password_hash').isSelect, false);
  assert.equal(column('Classroom', 'course_id').isNullable, false);
  assert.equal(column('Classroom', 'section').isNullable, false);
  for (const name of ['code', 'name', 'subject'])
    assert.equal(column('Classroom', name).isSelect, false);
  assert.ok(
    ds
      .getMetadata('Classroom')
      .indices.some(
        (i) =>
          i.isUnique &&
          i.columns.map((c) => c.propertyName).join() ===
            'course_id,term,section',
      ),
  );
  assert.equal(column('AccountInvitation', 'token_hash').isSelect, false);
  assert.equal(column('Enrolment', 'active_student_id').isInsert, false);
  assert.equal(
    column('AccountInvitation', 'outstanding_user_id').isUpdate,
    false,
  );
  assert.equal(column('AttendanceSession', 'code_hash'), undefined);
  assert.equal(column('AttendanceSession', 'opened_by'), undefined);
  assert.equal(column('ClassMeeting', 'starts_at').precision, 3);
  assert.ok(
    ds
      .getMetadata('AttendanceSession')
      .indices.some(
        (i) =>
          i.isUnique &&
          i.columns.map((c) => c.propertyName).join() === 'meeting_id',
      ),
  );
});

test('seed rejects production and remote databases before any connection use', async () => {
  await assert.rejects(
    seedDemo(null, { ...env, NODE_ENV: 'production' }),
    /development/,
  );
  await assert.rejects(
    seedDemo(null, {
      ...env,
      NODE_ENV: 'development',
      DB_HOST: 'db.example.com',
    }),
    /local DB_HOST/,
  );
  await assert.rejects(
    seedDemo(null, { ...env, NODE_ENV: 'development', SEED_PASSWORD: 'short' }),
    /12 characters/,
  );
});

import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Module, Global } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExamplesModule } from '../dist/examples/examples.module.js';
import { DATABASE } from '../dist/database/database.constants.js';
import { ClassSchema } from '../dist/database/entities/class.schema.js';

const fixture = {
  id: 1,
  section: 'DEMO',
  course: { id: 7, code: 'COS30043', name: 'Interface Design and Development' },
  term: 'DEMO',
  room_label: 'Demo room',
};

test('sample HTTP routes validate input, paginate and allowlist responses', async (t) => {
  const calls: any[] = [];
  const repository = {
    async findAndCount(options: any) {
      calls.push(options);
      return [
        [
          {
            ...fixture,
            code: 'LEGACY',
            name: 'Legacy name',
            subject: 'Legacy subject',
            course: { ...fixture.course, created_at: 'private extra field' },
            latitude: '0.000000',
            lecturer_id: 99,
          },
        ],
        21,
      ];
    },
    async findOne(options: any) {
      calls.push(options);
      return options.where.id === 1 ? fixture : null;
    },
  };
  class TestDatabaseModule {}
  Global()(TestDatabaseModule);
  Module({
    providers: [
      {
        provide: DATABASE,
        useValue: {
          getRepository(schema: unknown) {
            assert.equal(schema, ClassSchema);
            return repository;
          },
        },
      },
    ],
    exports: [DATABASE],
  })(TestDatabaseModule);
  class TestAppModule {}
  Module({ imports: [TestDatabaseModule, ExamplesModule] })(TestAppModule);
  const app = await NestFactory.create(TestAppModule, { logger: false });
  t.after(() => app.close());
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1/examples/classrooms`;

  await t.test('list defaults and selected fields', async () => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: [fixture],
      meta: { page: 1, limit: 20, total: 21, totalPages: 2 },
    });
    assert.equal(calls.at(-1).skip, 0);
    assert.equal(calls.at(-1).take, 20);
    assert.deepEqual(calls.at(-1).order, { id: 'ASC' });
    assert.deepEqual(calls.at(-1).relations, { course: true });
    assert.deepEqual(calls.at(-1).select.course, {
      id: true,
      code: true,
      name: true,
    });
    assert.deepEqual(
      Object.keys(calls.at(-1).select).sort(),
      Object.keys(fixture).sort(),
    );
  });

  await t.test('custom pagination is passed to the repository', async () => {
    const response = await fetch(`${base}?page=3&limit=5`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).meta, {
      page: 3,
      limit: 5,
      total: 21,
      totalPages: 5,
    });
    assert.equal(calls.at(-1).skip, 10);
    assert.equal(calls.at(-1).take, 5);
  });

  await t.test(
    'invalid inputs return 400 before accessing the database',
    async () => {
      const count = calls.length;
      for (const suffix of [
        '?page=0',
        '?page=-1',
        '?page=1.5',
        '?page=10001',
        '?limit=101',
        '?limit=',
        '?limit=2&limit=3',
        '?page=1e2',
        '/abc',
        '/0',
        '/1.5',
        '/4294967296',
      ]) {
        const response = await fetch(`${base}${suffix}`);
        assert.equal(response.status, 400, suffix);
        assert.equal((await response.json()).error, 'Bad Request');
      }
      assert.equal(calls.length, count);
    },
  );

  await t.test('single record and missing record handling', async () => {
    const response = await fetch(`${base}/1`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: fixture });
    assert.equal(calls.at(-1).where.id, 1);
    const missing = await fetch(`${base}/999`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).message, 'Classroom not found.');
  });

  await t.test('empty lists and unexpected database errors', async () => {
    repository.findAndCount = async () => [[], 0];
    const empty = await fetch(base);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), {
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    repository.findAndCount = async () => {
      throw new Error('private database details');
    };
    const failure = await fetch(base);
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), {
      statusCode: 500,
      message: 'Internal server error',
    });
  });
});

test('sample module is registered only in development', () => {
  for (const environment of ['development', 'production', 'test', '']) {
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `
      require('reflect-metadata');
      const { AppModule } = require('./dist/app.module');
      const { ExamplesModule } = require('./dist/examples/examples.module');
      process.stdout.write(String(Reflect.getMetadata('imports', AppModule).includes(ExamplesModule)));
    `,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: environment,
          DB_HOST: '127.0.0.1',
          DB_NAME: 'unit_only',
          DB_USER: 'unit_only',
          DB_PASSWORD: 'not-a-connection',
        },
        encoding: 'utf8',
      },
    );
    assert.equal(output, String(environment === 'development'));
  }
});

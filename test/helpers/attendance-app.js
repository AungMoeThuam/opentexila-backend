require('reflect-metadata');
const assert = require('node:assert/strict');
const { Global, Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AttendanceModule } = require('../../dist/attendance/attendance.module');
const { DATABASE } = require('../../dist/database/database.constants');

// Starts the attendance routes with fake repositories keyed by entity name
// (for example `ClassSession`). Tests change the fake methods after start.
async function startAttendanceApp(repositories) {
  class TestDatabaseModule {}
  Global()(TestDatabaseModule);
  Module({
    providers: [
      {
        provide: DATABASE,
        useValue: {
          getRepository(schema) {
            const repository = repositories[schema.options.name];
            assert.ok(
              repository,
              `No fake repository for ${schema.options.name}`,
            );
            return repository;
          },
        },
      },
    ],
    exports: [DATABASE],
  })(TestDatabaseModule);
  class TestAppModule {}
  Module({ imports: [TestDatabaseModule, AttendanceModule] })(TestAppModule);
  const app = await NestFactory.create(TestAppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  return { base: `${await app.getUrl()}/api/v1`, close: () => app.close() };
}

module.exports = { startAttendanceApp };

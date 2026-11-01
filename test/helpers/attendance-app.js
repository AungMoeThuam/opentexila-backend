require('reflect-metadata');
const assert = require('node:assert/strict');
const { Global, Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AttendanceModule } = require('../../dist/attendance/attendance.module');
const { DATABASE } = require('../../dist/database/database.constants');

// Starts the attendance routes with fake repositories keyed by entity name
// (for example `ClassSession`). Tests change the fake methods after start.
// A trusted fixture middleware signs the caller in as `state.user`; set
// `state.session = undefined` to simulate a signed-out request and change
// `state.user` to simulate account changes.
async function startAttendanceApp(repositories) {
  const state = {
    user: {
      id: 2,
      role: 'teacher',
      status: 'active',
      session_version: 0,
      must_change_password: false,
    },
    session: undefined,
    signedIn: true,
  };
  const validSession = () => ({
    userId: state.user.id,
    sessionVersion: state.user.session_version,
    csrfToken: 'fixture-token',
    cookie: { expires: new Date(Date.now() + 60000) },
  });
  class TestDatabaseModule {}
  Global()(TestDatabaseModule);
  Module({
    providers: [
      {
        provide: DATABASE,
        useValue: {
          getRepository(schema) {
            const name =
              typeof schema === 'string' ? schema : schema.options.name;
            if (name === 'User') return { findOneBy: async () => state.user };
            const repository = repositories[name];
            assert.ok(repository, `No fake repository for ${name}`);
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
  app.use((request, response, next) => {
    request.session = state.signedIn ? validSession() : undefined;
    next();
  });
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  return {
    base: `${await app.getUrl()}/api/v1`,
    state,
    close: () => app.close(),
  };
}

module.exports = { startAttendanceApp };

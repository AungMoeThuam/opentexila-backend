import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EnrolmentsModule } from '../../dist/enrolments/enrolments.module.js';
import { AttendanceModule } from '../../dist/attendance/attendance.module.js';
import { DATABASE } from '../../dist/database/database.constants.js';
import { createValidationPipe } from '../../dist/common/validation.pipe.js';

// Starts the attendance routes with fake repositories keyed by entity name
// (for example `ClassSession`). Tests change the fake methods after start.
// A trusted fixture middleware signs the caller in as `state.user`; set
// `state.signedIn = false` to simulate a signed-out request and change
// `state.user` to simulate account changes.
export async function startAttendanceApp(repositories: Record<string, any>) {
  const state = {
    user: {
      id: 2,
      role: 'teacher',
      status: 'active',
      session_version: 0,
      must_change_password: false,
    },
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
          getRepository(schema: any) {
            const name =
              typeof schema === 'string'
                ? schema
                : (schema.options?.name ?? schema.name);
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
  Module({ imports: [TestDatabaseModule, AttendanceModule, EnrolmentsModule] })(
    TestAppModule,
  );
  const app = await NestFactory.create(TestAppModule, {
    logger: false,
    abortOnError: false,
  });
  app.use((request: any, _response: any, next: () => void) => {
    request.session = state.signedIn ? validSession() : undefined;
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  return {
    base: `${await app.getUrl()}/api/v1`,
    state,
    close: () => app.close(),
  };
}

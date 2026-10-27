import { Global, Module } from '@nestjs/common';
import { AppDataSource } from './data-source';
import { DATABASE } from './database.constants';

@Global()
@Module({
  providers: [
    { provide: DATABASE, useFactory: async () => AppDataSource.initialize() },
    {
      provide: 'DATABASE_LIFECYCLE',
      inject: [DATABASE],
      useFactory: (dataSource) => ({
        async onApplicationShutdown() {
          if (dataSource.isInitialized) await dataSource.destroy();
        },
      }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}

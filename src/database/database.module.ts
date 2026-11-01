import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { AppDataSource } from './data-source';
import { DATABASE } from './database.constants';

@Global()
@Module({
  providers: [
    { provide: DATABASE, useFactory: async () => AppDataSource.initialize() },
    {
      provide: 'DATABASE_LIFECYCLE',
      inject: [DATABASE],
      useFactory: (dataSource: DataSource): OnApplicationShutdown => ({
        async onApplicationShutdown() {
          if (dataSource.isInitialized) await dataSource.destroy();
        },
      }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}

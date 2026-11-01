import {
  Inject,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import type { RequestHandler } from 'express';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { createDevAuthMiddleware } from './dev-auth';

@Module({})
export class DevAuthModule implements NestModule {
  private readonly middleware: RequestHandler;

  constructor(@Inject(DATABASE) database: DataSource) {
    this.middleware = createDevAuthMiddleware(database);
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(this.middleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
